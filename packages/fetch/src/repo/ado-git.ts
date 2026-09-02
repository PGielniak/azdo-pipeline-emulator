/**
 * Azure DevOps Git fetcher (E09-S02-T01).
 *
 * Two operations, both pinned to a commit SHA so a `--frozen` re-convert is reproducible:
 *
 *   1. ref → SHA via the Refs endpoint (C-E09-030/031/032)
 *   2. whole-repository snapshot at that SHA, cached under docs/05 §4's layout:
 *
 *        <out>/.cache/repos/<host>/<org>/<project>/<repo>/<sha>/
 *
 * The snapshot has two methods — a bare `git clone` mirror (preferred; a run-time reference clone
 * can point at it) and the Items `$format=zip` route (C-E09-033/034). They leave *different shapes*
 * in that directory, so each entry records which one filled it in `snapshot.json`; without the
 * marker a later `--frozen` run would assume a mirror that may not be there.
 *
 * Secret hygiene (rule 4, C-E09-035). A git credential has three leak channels and this module
 * closes all three: the token is never placed in the clone URL, never persisted into the mirror's
 * `.git/config`, and never passed on the command line — the auth header travels through
 * `--config-env`, which reads it from the environment. `-c http.extraheader=…`, the agent's
 * pre-2.31 fallback, is deliberately *not* implemented: it would put the header in `ps` output.
 * Where git is too old for `--config-env`, the zip route is taken instead.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authorizationHeader } from '../oracle.js';
import { credentialAuthorizationHeader } from '../auth/status.js';
import type { StoredAzureCredential } from '../auth/storage.js';

export const GIT_API_VERSION = '7.1';
/** C-E09-035: `--config-env` is what keeps the token out of argv. */
export const MIN_GIT_VERSION_CONFIG_ENV = { major: 2, minor: 31 } as const;

const CACHE_SUBDIR = '.cache/repos';
const SNAPSHOT_MARKER = 'snapshot.json';

/** C-E09-034: `GitVersionType` — how `versionDescriptor.version` is interpreted. */
export type GitVersionType = 'branch' | 'tag' | 'commit';

export type SnapshotMethod = 'bare-mirror' | 'items-zip';

export interface AdoRepoCoordinates {
  /** Organization URL, e.g. `https://dev.azure.com/<org>`. */
  readonly orgUrl: string;
  readonly project: string;
  /** Repository name or id — the route accepts either. */
  readonly repository: string;
}

export interface ResolvedRef {
  /** Full ref name as the service spells it, e.g. `refs/heads/main`. */
  readonly ref: string;
  /** Always a commit SHA: the peeled value for an annotated tag (C-E09-032). */
  readonly commit: string;
  /** Set only when the ref is an annotated tag, in which case it is the tag object's own SHA. */
  readonly tagObject?: string;
}

export type RepoFetch = (url: string, init: RequestInit) => Promise<Response>;

export class AdoGitError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AdoGitError';
    this.status = status;
  }
}

function orgBase(coordinates: AdoRepoCoordinates): string {
  const org = coordinates.orgUrl.replace(/\/+$/, '');
  return (
    `${org}/${encodeURIComponent(coordinates.project)}` +
    `/_apis/git/repositories/${encodeURIComponent(coordinates.repository)}`
  );
}

/**
 * C-E09-030: `filter` omits the leading `refs/` that the returned `name` carries — `refs/heads/main`
 * is requested as `heads/main`.
 */
export function refFilterFor(ref: string): string {
  return ref.startsWith('refs/') ? ref.slice('refs/'.length) : ref;
}

export function refsUrl(coordinates: AdoRepoCoordinates, ref: string): string {
  const params = new URLSearchParams({
    filter: refFilterFor(ref),
    // C-E09-031: without this an annotated tag reports only its tag object.
    peelTags: 'true',
    'api-version': GIT_API_VERSION,
  });
  return `${orgBase(coordinates)}/refs?${params.toString()}`;
}

/**
 * C-E09-033/034: `$format=zip` obliges an explicit `api-version` query parameter.
 *
 * C-E09-037: the whole-repository scope is `scopePath`, **not** `path`. The docs list both as
 * independent filters and never say they conflict, but the service rejects the combination — a
 * measured 400, not a documented one.
 */
export function itemsZipUrl(
  coordinates: AdoRepoCoordinates,
  version: string,
  versionType: GitVersionType,
): string {
  const params = new URLSearchParams({
    scopePath: '/',
    recursionLevel: 'full',
    resolveLfs: 'true',
    download: 'true',
    $format: 'zip',
    'versionDescriptor.version': version,
    'versionDescriptor.versionType': versionType,
    'api-version': GIT_API_VERSION,
  });
  return `${orgBase(coordinates)}/items?${params.toString()}`;
}

interface GitRef {
  readonly name: string;
  readonly objectId: string;
  readonly peeledObjectId?: string;
}

function parseRefs(payload: unknown): GitRef[] {
  if (payload === null || typeof payload !== 'object') return [];
  const value = (payload as { value?: unknown }).value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.objectId !== 'string') return [];
    return [
      {
        name: row.name,
        objectId: row.objectId,
        ...(typeof row.peeledObjectId === 'string' ? { peeledObjectId: row.peeledObjectId } : {}),
      },
    ];
  });
}

export interface ResolveRefOptions {
  readonly credential: StoredAzureCredential;
  readonly fetchImpl?: RepoFetch;
}

/**
 * Resolve one *explicit* ref to a commit SHA.
 *
 * The "no ref given → default branch" rule is deliberately not here: it belongs to E09-S02-T03,
 * which owns alias resolution and the default-branch reading.
 */
export async function resolveAdoRef(
  coordinates: AdoRepoCoordinates,
  ref: string,
  options: ResolveRefOptions,
): Promise<ResolvedRef> {
  const wanted = ref.startsWith('refs/') ? ref : `refs/${ref}`;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(refsUrl(coordinates, ref), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        Authorization: credentialAuthorizationHeader(options.credential),
      },
    });
  } catch (error) {
    throw new AdoGitError(`ref resolution for ${wanted} failed`, undefined, { cause: error });
  }
  if (!response.ok) {
    throw new AdoGitError(
      `ref resolution for ${wanted} returned HTTP ${response.status}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new AdoGitError(`ref resolution for ${wanted} returned invalid JSON`, response.status, {
      cause: error,
    });
  }

  const refs = parseRefs(payload);
  // C-E09-030: the filter is a prefix match, so `heads/main` also returns `refs/heads/main-2`.
  // Selecting the first result would silently pin the wrong branch.
  const exact = refs.find((candidate) => candidate.name === wanted);
  if (exact === undefined) {
    const near =
      refs.length === 0 ? 'no refs matched' : `${refs.length} prefix match(es), none exact`;
    throw new AdoGitError(`ref ${wanted} does not exist in ${coordinates.repository} (${near})`);
  }

  // C-E09-031/032: for an annotated tag `objectId` is the tag object; the commit is the peeled one.
  return exact.peeledObjectId === undefined
    ? { ref: exact.name, commit: exact.objectId }
    : { ref: exact.name, commit: exact.peeledObjectId, tagObject: exact.objectId };
}

/** docs/05 §4 layout. `<host>` keeps two organizations on different hosts from colliding. */
export function repoCacheDir(
  cacheDir: string,
  coordinates: AdoRepoCoordinates,
  commit: string,
): string {
  const parsed = new URL(coordinates.orgUrl);
  const org = parsed.pathname.split('/').filter(Boolean).join('-') || parsed.hostname;
  return join(
    cacheDir,
    CACHE_SUBDIR,
    parsed.hostname,
    org,
    coordinates.project,
    coordinates.repository,
    commit,
  );
}

export interface SnapshotMarker {
  readonly version: 1;
  readonly method: SnapshotMethod;
  readonly ref: string;
  readonly commit: string;
  readonly storedAt: string;
}

export interface RepoSnapshot {
  readonly dir: string;
  readonly method: SnapshotMethod;
  readonly commit: string;
  readonly ref: string;
  /** False when the entry was already complete, i.e. nothing was fetched. */
  readonly fetched: boolean;
}

async function readMarker(dir: string): Promise<SnapshotMarker | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, SNAPSHOT_MARKER), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  const marker = parsed as Record<string, unknown>;
  if (marker.version !== 1) return undefined;
  if (marker.method !== 'bare-mirror' && marker.method !== 'items-zip') return undefined;
  if (typeof marker.commit !== 'string' || typeof marker.ref !== 'string') return undefined;
  if (typeof marker.storedAt !== 'string') return undefined;
  return {
    version: 1,
    method: marker.method,
    ref: marker.ref,
    commit: marker.commit,
    storedAt: marker.storedAt,
  };
}

export type GitRunner = (
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<{ code: number; stdout: string; stderr: string }>;

/** Argv array only; the auth header is handed over by environment, never as an argument. */
export const runGit: GitRunner = (args, env) =>
  new Promise((resolve) => {
    execFile(
      'git',
      [...args],
      { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const code =
          error === null || error === undefined
            ? 0
            : typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code: number }).code ?? 1)
              : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });

/** Parsed separately from the spawn so the "too old" branch is testable without an old git. */
export function parseGitVersion(output: string): { major: number; minor: number } | undefined {
  const match = /^git version (\d+)\.(\d+)/.exec(output.trim());
  if (match === null) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

/** `undefined` when git is absent or unparseable, which `supportsConfigEnv` reads as "too old". */
export async function readGitVersion(
  runner: GitRunner = runGit,
): Promise<{ major: number; minor: number } | undefined> {
  const { code, stdout } = await runner(['--version'], {});
  return code === 0 ? parseGitVersion(stdout) : undefined;
}

export function supportsConfigEnv(version: { major: number; minor: number } | undefined): boolean {
  if (version === undefined) return false;
  if (version.major !== MIN_GIT_VERSION_CONFIG_ENV.major) {
    return version.major > MIN_GIT_VERSION_CONFIG_ENV.major;
  }
  return version.minor >= MIN_GIT_VERSION_CONFIG_ENV.minor;
}

/**
 * C-E09-035: the agent's header value, verbatim in shape — `AUTHORIZATION: bearer <token>` for an
 * Entra/`az` access token, `AUTHORIZATION: basic <base64(:pat)>` for a PAT. Upstream marks the
 * base64 form as a secret in its own right, so this string is treated as one here too and never
 * enters an error message.
 */
export function extraHeaderValue(credential: StoredAzureCredential): string {
  const header =
    credential.mode === 'pat'
      ? authorizationHeader(credential.token).replace(/^Basic /, 'basic ')
      : `bearer ${credential.token}`;
  return `AUTHORIZATION: ${header}`;
}

export interface SnapshotOptions {
  readonly credential: StoredAzureCredential;
  readonly cacheDir: string;
  /** Injected for tests; defaults to spawning git. */
  readonly gitRunner?: GitRunner;
  readonly gitVersion?: { major: number; minor: number };
  readonly fetchImpl?: RepoFetch;
  /** Forces the zip route even where git would work (used by the offline/no-git path). */
  readonly method?: SnapshotMethod;
  readonly cloneUrl?: string;
}

function defaultCloneUrl(coordinates: AdoRepoCoordinates): string {
  const org = coordinates.orgUrl.replace(/\/+$/, '');
  return `${org}/${encodeURIComponent(coordinates.project)}/_git/${encodeURIComponent(coordinates.repository)}`;
}

async function writeMarker(dir: string, marker: SnapshotMarker): Promise<void> {
  await writeFile(join(dir, SNAPSHOT_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

async function cloneBareMirror(
  dir: string,
  coordinates: AdoRepoCoordinates,
  resolved: ResolvedRef,
  options: SnapshotOptions,
): Promise<void> {
  const runner = options.gitRunner ?? runGit;
  const envVar = 'AZDO_EMU_GIT_EXTRAHEADER';
  const target = join(dir, 'mirror.git');

  // The credential reaches git through the environment only (C-E09-035): not in argv, not in the
  // URL, and — because the header is never `git config --add`ed — not in the mirror's config.
  const { code, stderr } = await runner(
    [
      `--config-env=http.extraheader=${envVar}`,
      'clone',
      '--bare',
      '--no-tags',
      options.cloneUrl ?? defaultCloneUrl(coordinates),
      target,
    ],
    { [envVar]: extraHeaderValue(options.credential) },
  );
  if (code !== 0) {
    // stderr can echo back a request URL; it never carries the header, but keep the message narrow.
    throw new AdoGitError(
      `git clone --bare of ${coordinates.repository} at ${resolved.commit} exited ${code}`,
      undefined,
      { cause: new Error(stderr.split('\n').slice(0, 3).join('\n')) },
    );
  }
}

async function downloadZip(
  dir: string,
  coordinates: AdoRepoCoordinates,
  resolved: ResolvedRef,
  options: SnapshotOptions,
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  // Always pinned by SHA: a branch name would race a push between resolve and download.
  const url = itemsZipUrl(coordinates, resolved.commit, 'commit');

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        // C-E09-037: the service answers `application/octet-stream`, so this is a preference only.
        Accept: 'application/zip',
        Authorization: credentialAuthorizationHeader(options.credential),
      },
    });
  } catch (error) {
    throw new AdoGitError(`snapshot download of ${coordinates.repository} failed`, undefined, {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new AdoGitError(
      `snapshot download of ${coordinates.repository} returned HTTP ${response.status}`,
      response.status,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(join(dir, 'snapshot.zip'), bytes);
}

/**
 * Fetch (or reuse) a snapshot of `coordinates` at `resolved.commit`.
 *
 * A complete entry — one carrying a valid marker for the same commit — is returned without any
 * network or process call at all, which is what makes `--frozen` fully offline.
 */
export async function snapshotAdoRepo(
  coordinates: AdoRepoCoordinates,
  resolved: ResolvedRef,
  options: SnapshotOptions,
): Promise<RepoSnapshot> {
  const dir = repoCacheDir(options.cacheDir, coordinates, resolved.commit);
  const existing = await readMarker(dir);
  if (existing !== undefined && existing.commit === resolved.commit) {
    return {
      dir,
      method: existing.method,
      commit: existing.commit,
      ref: existing.ref,
      fetched: false,
    };
  }

  const method: SnapshotMethod =
    options.method ?? (supportsConfigEnv(options.gitVersion) ? 'bare-mirror' : 'items-zip');

  await mkdir(dir, { recursive: true });
  try {
    if (method === 'bare-mirror') {
      await cloneBareMirror(dir, coordinates, resolved, options);
    } else {
      await downloadZip(dir, coordinates, resolved, options);
    }
  } catch (error) {
    // A half-filled entry with no marker would be re-fetched anyway, but leaving it would make the
    // cache dir accumulate junk that looks like a snapshot. Remove it.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  await writeMarker(dir, {
    version: 1,
    method,
    ref: resolved.ref,
    commit: resolved.commit,
    storedAt: new Date().toISOString(),
  });
  return { dir, method, commit: resolved.commit, ref: resolved.ref, fetched: true };
}

/** Read a cached snapshot without fetching — the `--frozen` entry point. */
export async function readCachedSnapshot(
  cacheDir: string,
  coordinates: AdoRepoCoordinates,
  commit: string,
): Promise<RepoSnapshot | undefined> {
  const dir = repoCacheDir(cacheDir, coordinates, commit);
  const marker = await readMarker(dir);
  if (marker === undefined || marker.commit !== commit) return undefined;
  return { dir, method: marker.method, commit: marker.commit, ref: marker.ref, fetched: false };
}
