/**
 * E09-S03-T06 — `azdo-emu fetch-artifacts <outdir> [--refresh] [--latest]`.
 *
 * The generated project's `fetch-artifacts.sh` delegates here when the converter is on PATH
 * (docs/04 §7), so this is the implemented half of that pair. Everything it needs already exists:
 * the auth chain (docs/05 §1), the lockfile reader, and `downloadArtifact`, which performs the two
 * requests — metadata with `$expand=signedContent`, then the signed URL **unauthenticated**,
 * because the signature is the grant (C-E09-071).
 *
 * **`--latest` cannot corrupt a pin, and that is a property of the layout rather than a check.**
 * The cache is keyed `artifacts/<alias>/<runId>/<name>/`, so resolving to a newer run writes to a
 * *different* directory and the pinned one stays exactly as it was. That matters because
 * `verifyLockfile` resolves the artifact directory **from the pinned `runId`**: a `--latest` that
 * overwrote the pinned directory would leave the lockfile pointing at bytes from another run, and
 * the next `--frozen` convert would reproduce silently wrong output. Moving a pin is
 * `convert --update`'s job (docs/05 §4), never this command's — so `--latest` is a fetch-ahead,
 * and the report says so rather than leaving the operator to infer it.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  AzureDevOpsClient,
  LOCKFILE_NAME,
  artifactCacheDir,
  downloadArtifact,
  listRuns,
  readLockfile,
  remediationFor,
  selectAzureCredential,
  type PipelinePin,
} from '@azdo-emu/fetch';

import { CliError } from '../exit.js';

export interface FetchArtifactsFlags {
  readonly refresh: boolean;
  readonly latest: boolean;
  readonly org?: string | undefined;
  readonly project?: string | undefined;
}

/** Injected so the command is testable without a network or a credential store. */
export interface FetchArtifactsDeps {
  readonly selectAzureCredential: typeof selectAzureCredential;
  readonly listRuns: typeof listRuns;
  readonly downloadArtifact: typeof downloadArtifact;
  readonly readLockfile: typeof readLockfile;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists: (target: string) => boolean;
}

export const defaultFetchArtifactsDeps: FetchArtifactsDeps = {
  selectAzureCredential,
  listRuns,
  downloadArtifact,
  readLockfile,
  env: process.env,
  exists: existsSync,
};

/** One artifact to fetch: the pin it came from, flattened. */
interface Target {
  readonly alias: string;
  readonly pin: PipelinePin;
  readonly artifactName: string;
}

function targetsOf(pipelines: Readonly<Record<string, PipelinePin>>): Target[] {
  const targets: Target[] = [];
  // Sorted, so two runs of the same command report in the same order — a report whose line order
  // follows object insertion is a diff that changes for no reason.
  for (const alias of Object.keys(pipelines).sort()) {
    const pin = pipelines[alias]!;
    for (const artifactName of [...(pin.artifacts ?? [])].sort())
      targets.push({ alias, pin, artifactName });
  }
  return targets;
}

/**
 * Where the project was converted from, read out of its own lockfile.
 *
 * A **pipeline** pin carries `projectId`/`projectName` but no organization — but
 * `repositories.self.url` does (docs/05 §4), and it is the one field that says which organization
 * this project belongs to. Deriving from it is what makes `fetch-artifacts.sh` work in a freshly
 * converted project: `.env.example` emits `SYSTEM_ACCESSTOKEN` and **not** `AZDO_ORG_URL`, so
 * refusing without an environment variable would refuse over a value sitting a few lines above the
 * pins in the same file.
 *
 * Only Azure DevOps URLs, in the two spellings the service uses — `dev.azure.com/<org>/<project>`
 * and the legacy `<org>.visualstudio.com/<project>`. A `type: 'github'` repository is skipped
 * rather than parsed: its owner is not an organization in this sense, and guessing would produce
 * 404s that read like a missing artifact.
 */
export function originFromLockfile(lockfile: {
  readonly repositories?: Readonly<
    Record<string, { readonly type?: string; readonly url: string }>
  >;
}): { org?: string; project?: string } {
  const self = lockfile.repositories?.['self'];
  if (self === undefined || (self.type !== undefined && self.type !== 'azdo')) return {};
  let url: URL;
  try {
    url = new URL(self.url);
  } catch {
    return {};
  }
  // `_git` is the separator in both spellings; everything before it is the path to the project.
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  const gitAt = segments.indexOf('_git');
  if (gitAt < 1) return {};
  const host = url.host.toLowerCase();
  if (host === 'dev.azure.com' || host.endsWith('.dev.azure.com')) {
    // /<org>/<project>/_git/<repo> — and /<org>/_git/<repo> when the project and repo share a name.
    const [org, project] = segments;
    if (org === undefined) return {};
    return {
      org: `${url.protocol}//${url.host}/${org}`,
      ...(gitAt === 2 && project !== undefined ? { project } : {}),
    };
  }
  if (host.endsWith('.visualstudio.com')) {
    // The organization is the host here, not a path segment.
    return {
      org: `${url.protocol}//${url.host}`,
      ...(gitAt === 1 ? { project: segments[0]! } : {}),
    };
  }
  return {};
}

/**
 * The organization to fetch from.
 *
 * Precedence is flag → **lockfile** → environment, and the middle term is deliberate: the lockfile
 * describes *this* project, while `AZDO_ORG_URL` is ambient and may well belong to whatever the
 * operator was working on last. `--org` overrides both, which is what it is for.
 */
function requireOrg(
  flags: FetchArtifactsFlags,
  origin: { org?: string },
  env: FetchArtifactsDeps['env'],
): string {
  const org = flags.org ?? origin.org ?? env.AZDO_ORG_URL;
  if (org === undefined || org.trim().length === 0) {
    throw new CliError('no organization to fetch from', {
      hint: 'pass --org https://dev.azure.com/<name>, or set AZDO_ORG_URL',
    });
  }
  return org.trim();
}

/**
 * The project one pin lives in.
 *
 * `pin.projectName` leads, ahead even of `--project`: docs/05 §4 writes it **only** when the YAML
 * resource declared `project:`, i.e. when that resource lives somewhere other than this project —
 * so a global flag overriding it would send a cross-project pin to the wrong place.
 */
function requireProject(
  target: Target,
  flags: FetchArtifactsFlags,
  origin: { project?: string },
  env: FetchArtifactsDeps['env'],
): string {
  const project = target.pin.projectName ?? flags.project ?? origin.project ?? env.AZDO_PROJECT;
  if (project === undefined || project.trim().length === 0) {
    throw new CliError(`no project for pipelines.${target.alias}`, {
      hint: `add projectName to the pin in ${LOCKFILE_NAME}, pass --project, or set AZDO_PROJECT`,
    });
  }
  return project.trim();
}

export interface FetchArtifactsReport {
  readonly lines: readonly string[];
  readonly downloaded: number;
  readonly cached: number;
}

export async function fetchArtifacts(
  outdir: string,
  flags: FetchArtifactsFlags,
  deps: FetchArtifactsDeps = defaultFetchArtifactsDeps,
): Promise<FetchArtifactsReport> {
  const root = path.resolve(outdir);
  if (!deps.exists(root)) {
    throw new CliError(`no such directory: ${outdir}`, {
      hint: 'pass the directory `azdo-emu convert` wrote',
    });
  }

  const lockfilePath = path.join(root, LOCKFILE_NAME);
  const lockfile = await deps.readLockfile(lockfilePath);
  if (lockfile === undefined) {
    throw new CliError(`no ${LOCKFILE_NAME} in ${outdir}`, {
      hint: `artifact pins live in ${LOCKFILE_NAME}; convert the pipeline again to produce one`,
    });
  }

  const targets = targetsOf(lockfile.pipelines ?? {});
  if (targets.length === 0) {
    // Not an error: a pipeline with no `resources.pipelines` artifacts has nothing to fetch, and
    // failing here would make `fetch-artifacts.sh` a broken step in every such project.
    return {
      lines: [`${LOCKFILE_NAME} pins no artifacts — nothing to fetch`],
      downloaded: 0,
      cached: 0,
    };
  }

  const origin = originFromLockfile(lockfile);
  const orgUrl = requireOrg(flags, origin, deps.env);
  const selection = await deps.selectAzureCredential(orgUrl);
  if (selection.kind === 'unavailable') {
    const first = selection.attempts[0];
    throw new CliError(`no usable credential for ${orgUrl}`, {
      hint: first === undefined ? 'run `azdo-emu auth login`' : remediationFor(first),
    });
  }

  const cacheDir = path.join(root, '.cache');
  const lines: string[] = [];
  let downloaded = 0;
  let cached = 0;

  for (const target of targets) {
    const project = requireProject(target, flags, origin, deps.env);
    const client = new AzureDevOpsClient({
      orgUrl,
      project,
      credential: selection.credential,
    });

    let runId = target.pin.runId;
    let suffix = '';
    if (flags.latest) {
      const runs = await deps.listRuns(client, target.pin.pipelineId);
      const newest = runs.find((run) => run.state === 'completed');
      if (newest === undefined) {
        throw new CliError(`pipeline ${target.pin.pipelineId} has no completed run`, {
          hint: 'drop --latest to fetch the pinned run',
        });
      }
      runId = newest.id;
      // Said once per target rather than once per command: with several pins, "latest" resolves to
      // a different run for each, and one summary line would hide which.
      suffix =
        runId === target.pin.runId
          ? ' (latest is the pinned run)'
          : ` (latest; pinned run ${target.pin.runId} left as it is)`;
    }

    const dir = artifactCacheDir(cacheDir, target.alias, runId, target.artifactName);
    const label = `${target.alias}/${target.artifactName}@${runId}`;
    if (deps.exists(dir) && !flags.refresh) {
      cached += 1;
      lines.push(`cached    ${label}${suffix}`);
      continue;
    }

    const result = await deps.downloadArtifact(client, {
      cacheDir,
      alias: target.alias,
      pipelineId: target.pin.pipelineId,
      runId,
      artifactName: target.artifactName,
    });
    downloaded += 1;
    lines.push(`fetched   ${label}${suffix} — ${result.files} file(s), ${result.bytes} bytes`);
  }

  if (flags.latest && downloaded + cached > 0) {
    lines.push('');
    lines.push(
      '--latest wrote under each run’s own cache directory; the lockfile pins are unchanged, ' +
        'so a --frozen convert still uses them. Use `azdo-emu convert --update` to move a pin.',
    );
  }
  return { lines, downloaded, cached };
}
