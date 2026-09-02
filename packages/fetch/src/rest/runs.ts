/**
 * Pipeline runs and artifact download (E09-S03-T02).
 *
 * Resolves a `resources.pipelines` alias to a concrete run, then downloads that run's artifact into
 * `<out>/.cache/artifacts/<alias>/<runId>/<artifactName>/` (docs/05 §4).
 *
 * Two measured facts shape this more than the rest, and both contradict the obvious design:
 *
 *  - **There is no server-side branch or tag filter** (C-E09-067). Runs-List takes only the pipeline
 *    id, so selection is client-side — and the list item does not even carry the branch
 *    (C-E09-068), so filtering costs one Runs-Get per candidate. The list is newest-first, so this
 *    walks it in order and stops at the first match rather than expanding all 10,000.
 *  - **The signed URL is anonymous and expiring** (C-E09-070/071). The download therefore sends no
 *    `Authorization` header — the URL carries its own grant, as GitHub's storage URL does
 *    (C-E09-015/017) — and `signatureExpires` is why the lockfile pins `runId` and the artifact
 *    *name* rather than the URL.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureDevOpsClient, RestError, type RestFetch } from './client.js';
import { extractArchive } from '../repo/extract.js';

const CACHE_SUBDIR = '.cache/artifacts';

/** C-E09-070: the only expansion the endpoint defines. */
export const ARTIFACT_EXPAND_SIGNED_CONTENT = 'signedContent';

/** RunState / RunResult, verbatim from the reference page's enumerations. */
export type RunState = 'unknown' | 'inProgress' | 'canceling' | 'completed';
export type RunResult = 'unknown' | 'succeeded' | 'failed' | 'canceled';

/** What Runs-List actually returns — note the absence of `resources` (C-E09-068). */
export interface RunSummary {
  readonly id: number;
  readonly name?: string;
  readonly state?: RunState;
  readonly result?: RunResult;
  readonly createdDate?: string;
  readonly finishedDate?: string;
}

/** Runs-Get adds `resources`, and — undocumented — `tags` (C-E09-069). */
export interface RunDetail extends RunSummary {
  readonly refName?: string;
  readonly sourceVersion?: string;
  readonly repositoryType?: string;
  readonly tags: readonly string[];
}

export interface SignedArtifact {
  readonly name: string;
  readonly url?: string;
  readonly signedUrl?: string;
  /** C-E09-071: why the URL is never lockfile material. */
  readonly signatureExpires?: string;
}

function asRunSummary(value: unknown): RunSummary | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'number') return undefined;
  return {
    id: row.id,
    ...(typeof row.name === 'string' ? { name: row.name } : {}),
    ...(typeof row.state === 'string' ? { state: row.state as RunState } : {}),
    ...(typeof row.result === 'string' ? { result: row.result as RunResult } : {}),
    ...(typeof row.createdDate === 'string' ? { createdDate: row.createdDate } : {}),
    ...(typeof row.finishedDate === 'string' ? { finishedDate: row.finishedDate } : {}),
  };
}

/** List a pipeline's runs. The service returns them newest-first and caps at 10,000 (C-E09-067). */
export async function listRuns(
  client: AzureDevOpsClient,
  pipelineId: number,
): Promise<readonly RunSummary[]> {
  const response = await client.request<{ value?: unknown }>({
    path: `pipelines/${pipelineId}/runs`,
    area: 'pipelines',
  });
  const value = response.body?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const run = asRunSummary(entry);
    return run === undefined ? [] : [run];
  });
}

/** Fetch one run, which is the only way to learn its branch (C-E09-068). */
export async function getRun(
  client: AzureDevOpsClient,
  pipelineId: number,
  runId: number,
): Promise<RunDetail> {
  const response = await client.request<Record<string, unknown>>({
    path: `pipelines/${pipelineId}/runs/${runId}`,
    area: 'pipelines',
  });
  const body = response.body;
  const summary = asRunSummary(body);
  if (summary === undefined) {
    throw new RestError(`run ${runId} of pipeline ${pipelineId} returned no id`, {
      status: response.status,
      url: `pipelines/${pipelineId}/runs/${runId}`,
    });
  }

  const repositories = (body.resources as { repositories?: Record<string, unknown> } | undefined)
    ?.repositories;
  // `self` is the pipeline's own repository; any single entry is used when it is spelled otherwise.
  const selfKey =
    repositories === undefined
      ? undefined
      : (Object.keys(repositories).find((key) => key.toLowerCase() === 'self') ??
        Object.keys(repositories)[0]);
  const self =
    selfKey === undefined ? undefined : (repositories?.[selfKey] as Record<string, unknown>);

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];

  return {
    ...summary,
    ...(typeof self?.refName === 'string' ? { refName: self.refName } : {}),
    ...(typeof self?.version === 'string' ? { sourceVersion: self.version } : {}),
    ...(typeof (self?.repository as { type?: unknown } | undefined)?.type === 'string'
      ? { repositoryType: (self?.repository as { type: string }).type }
      : {}),
    tags,
  };
}

export interface RunSelector {
  /** Full ref, e.g. `refs/heads/main`. Compared exactly against the run's `refName`. */
  readonly branch?: string;
  /** Every tag must be present on the run (C-E09-069). */
  readonly tags?: readonly string[];
  /** Only consider runs in this state; defaults to `completed`. */
  readonly state?: RunState;
  /** Only consider runs with this result; unset accepts any. */
  readonly result?: RunResult;
  /** How many candidates to inspect before giving up; each costs one Runs-Get. */
  readonly maxCandidates?: number;
}

function matches(run: RunDetail, selector: RunSelector): boolean {
  if (selector.branch !== undefined && run.refName !== selector.branch) return false;
  if (selector.result !== undefined && run.result !== selector.result) return false;
  const wanted = selector.tags ?? [];
  return wanted.every((tag) => run.tags.includes(tag));
}

/**
 * Pick the newest run matching `selector`.
 *
 * C-E09-067/068: there is no server-side filter and the list omits the branch, so this walks the
 * newest-first list and fetches each candidate until one matches — bounded by `maxCandidates` so a
 * selector that matches nothing costs a fixed number of requests instead of 10,000.
 */
export async function resolveRun(
  client: AzureDevOpsClient,
  pipelineId: number,
  selector: RunSelector = {},
): Promise<RunDetail | undefined> {
  const state = selector.state ?? 'completed';
  const limit = selector.maxCandidates ?? 50;
  const candidates = (await listRuns(client, pipelineId))
    .filter((run) => run.state === state)
    .slice(0, limit);

  // No per-run call is needed when nothing branch- or tag-shaped was asked for.
  const needsDetail = selector.branch !== undefined || (selector.tags ?? []).length > 0;
  for (const candidate of candidates) {
    if (!needsDetail) {
      if (selector.result === undefined || candidate.result === selector.result) {
        return { ...candidate, tags: [] };
      }
      continue;
    }
    const detail = await getRun(client, pipelineId, candidate.id);
    if (matches(detail, selector)) return detail;
  }
  return undefined;
}

/** Artifact metadata, expanded to its signed content (C-E09-070). */
export async function getArtifact(
  client: AzureDevOpsClient,
  pipelineId: number,
  runId: number,
  artifactName: string,
): Promise<SignedArtifact> {
  const response = await client.request<Record<string, unknown>>({
    path: `pipelines/${pipelineId}/runs/${runId}/artifacts`,
    area: 'pipelines',
    query: { artifactName, $expand: ARTIFACT_EXPAND_SIGNED_CONTENT },
  });
  const body = response.body;
  const signed = body.signedContent as { url?: unknown; signatureExpires?: unknown } | undefined;
  return {
    name: typeof body.name === 'string' ? body.name : artifactName,
    ...(typeof body.url === 'string' ? { url: body.url } : {}),
    ...(typeof signed?.url === 'string' ? { signedUrl: signed.url } : {}),
    ...(typeof signed?.signatureExpires === 'string'
      ? { signatureExpires: signed.signatureExpires }
      : {}),
  };
}

/** docs/05 §4: `.cache/artifacts/<pipelineAlias>/<runId>/<artifactName>/`. */
export function artifactCacheDir(
  cacheDir: string,
  alias: string,
  runId: number,
  artifactName: string,
): string {
  return join(cacheDir, CACHE_SUBDIR, alias, String(runId), artifactName);
}

export interface ArtifactDownload {
  readonly dir: string;
  readonly artifactName: string;
  readonly runId: number;
  readonly bytes: number;
  readonly files: number;
}

export interface DownloadArtifactOptions {
  readonly cacheDir: string;
  readonly alias: string;
  readonly pipelineId: number;
  readonly runId: number;
  readonly artifactName: string;
  readonly fetchImpl?: RestFetch;
}

/**
 * Download and unpack one artifact.
 *
 * C-E09-071: the signed URL grants "limited-time anonymous access", so the request carries **no**
 * `Authorization` header — the same rule as GitHub's storage origin. Nothing about the URL is
 * persisted: `signatureExpires` makes it worthless to a later run, so only `runId` and the artifact
 * name are lockfile material.
 */
export async function downloadArtifact(
  client: AzureDevOpsClient,
  options: DownloadArtifactOptions,
): Promise<ArtifactDownload> {
  const artifact = await getArtifact(
    client,
    options.pipelineId,
    options.runId,
    options.artifactName,
  );
  if (artifact.signedUrl === undefined) {
    throw new RestError(
      `artifact ${options.artifactName} of run ${options.runId} returned no signed content url`,
      { url: `pipelines/${options.pipelineId}/runs/${options.runId}/artifacts` },
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    // Deliberately unauthenticated: the signature is the grant (C-E09-071).
    response = await fetchImpl(artifact.signedUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {},
    });
  } catch (error) {
    throw new RestError(`artifact ${options.artifactName} download failed`, {
      url: 'signed content url',
      cause: error,
    });
  }
  if (!response.ok) {
    throw new RestError(
      `artifact ${options.artifactName} download returned HTTP ${response.status}`,
      { status: response.status, url: 'signed content url' },
    );
  }

  const dir = artifactCacheDir(
    options.cacheDir,
    options.alias,
    options.runId,
    options.artifactName,
  );
  await mkdir(dir, { recursive: true });
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, 'artifact.zip'), bytes);
  const extracted = await extractArchive(bytes, 'zip', dir);

  return {
    dir,
    artifactName: options.artifactName,
    runId: options.runId,
    bytes: bytes.length,
    files: extracted.files,
  };
}
