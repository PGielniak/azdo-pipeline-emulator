/**
 * GitHub repository fetcher (E09-S02-T02).
 *
 * The GitHub half of E09-S02: ref → commit SHA, then a tarball snapshot pinned to that SHA, cached
 * under the same docs/05 §4 layout the ADO fetcher writes:
 *
 *   <out>/.cache/repos/github.com/<owner>/<owner>/<repo>/<sha>/
 *
 * Everything about *authentication* is E09-S01-T04's (`../auth/github.ts`): the `gh auth token` →
 * `GITHUB_TOKEN` → anonymous chain, the manual redirect, and the rule that the bearer token never
 * crosses to the storage origin. Nothing here re-derives it.
 *
 * One asymmetry with `ado-git.ts` is deliberate: GitHub's commits endpoint dereferences an
 * annotated tag to its commit for us (C-E09-041), so there is no peeling step here, where ADO
 * requires one (C-E09-032).
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GITHUB_API_ORIGIN,
  fetchGitHubTarball,
  githubHeaders,
  resolveGitHubCredential,
  type GitHubCredential,
  type GitHubFetch,
  type GitHubRequestOptions,
} from '../auth/github.js';

const CACHE_SUBDIR = '.cache/repos';
const SNAPSHOT_MARKER = 'snapshot.json';
export const GITHUB_CACHE_HOST = 'github.com';

export interface GitHubRepoCoordinates {
  readonly owner: string;
  readonly repo: string;
}

export interface ResolvedGitHubRef {
  /** The ref as it was asked for, normalized to its full `refs/…` form where one was given. */
  readonly ref: string;
  readonly commit: string;
}

export class GitHubRepoError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.name = 'GitHubRepoError';
    this.status = status;
  }
}

/**
 * C-E09-040: the documented `tags/TAG_NAME` shorthand returns 422, while the full `refs/…` form is
 * accepted for both namespaces. A bare name is also accepted but is ambiguous when a branch and a
 * tag share it, so anything that already names a namespace is sent in full `refs/…` form.
 */
export function commitRefFor(ref: string): string {
  if (ref.startsWith('refs/')) return ref;
  if (ref.startsWith('heads/') || ref.startsWith('tags/')) return `refs/${ref}`;
  return ref;
}

export function commitUrl(coordinates: GitHubRepoCoordinates, ref: string): string {
  const path = commitRefFor(ref)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return (
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(coordinates.owner)}` +
    `/${encodeURIComponent(coordinates.repo)}/commits/${path}`
  );
}

export interface ResolveGitHubRefOptions extends GitHubRequestOptions {
  readonly fetchImpl?: GitHubFetch;
}

/** Resolve one explicit ref to a commit SHA (C-E09-039/040/041). */
export async function resolveGitHubRef(
  coordinates: GitHubRepoCoordinates,
  ref: string,
  options: ResolveGitHubRefOptions = {},
): Promise<ResolvedGitHubRef> {
  const credential = options.credential ?? (await resolveGitHubCredential(options));
  const wanted = commitRefFor(ref);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(commitUrl(coordinates, ref), {
      method: 'GET',
      redirect: 'manual',
      headers: githubHeaders(credential),
    });
  } catch (error) {
    throw new GitHubRepoError(`ref resolution for ${wanted} failed`, undefined, { cause: error });
  }
  if (!response.ok) {
    // Same reading as C-E09-014: an anonymous 404 hides a private repo, it does not deny one.
    const hint =
      response.status === 404 && credential.source === 'anonymous'
        ? ': not found, or private and this request was unauthenticated'
        : '';
    throw new GitHubRepoError(
      `ref resolution for ${wanted} returned HTTP ${response.status}${hint}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new GitHubRepoError(
      `ref resolution for ${wanted} returned invalid JSON`,
      response.status,
      {
        cause: error,
      },
    );
  }
  const sha =
    payload !== null && typeof payload === 'object'
      ? (payload as { sha?: unknown }).sha
      : undefined;
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new GitHubRepoError(
      `ref resolution for ${wanted} returned no commit sha`,
      response.status,
    );
  }
  // C-E09-041: `sha` is already the commit even for an annotated tag — no peeling step.
  return { ref: wanted, commit: sha };
}

/** docs/05 §4 layout, with `<owner>` standing in for both the org and project segments. */
export function githubRepoCacheDir(
  cacheDir: string,
  coordinates: GitHubRepoCoordinates,
  commit: string,
): string {
  return join(
    cacheDir,
    CACHE_SUBDIR,
    GITHUB_CACHE_HOST,
    coordinates.owner,
    coordinates.owner,
    coordinates.repo,
    commit,
  );
}

export interface GitHubSnapshotMarker {
  readonly version: 1;
  readonly method: 'tarball';
  readonly ref: string;
  readonly commit: string;
  readonly storedAt: string;
}

export interface GitHubSnapshot {
  readonly dir: string;
  readonly method: 'tarball';
  readonly ref: string;
  readonly commit: string;
  readonly fetched: boolean;
}

async function readMarker(dir: string): Promise<GitHubSnapshotMarker | undefined> {
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
  if (marker.version !== 1 || marker.method !== 'tarball') return undefined;
  if (typeof marker.commit !== 'string' || typeof marker.ref !== 'string') return undefined;
  if (typeof marker.storedAt !== 'string') return undefined;
  return {
    version: 1,
    method: 'tarball',
    ref: marker.ref,
    commit: marker.commit,
    storedAt: marker.storedAt,
  };
}

export interface GitHubSnapshotOptions extends GitHubRequestOptions {
  readonly cacheDir: string;
  readonly fetchImpl?: GitHubFetch;
}

/**
 * Fetch (or reuse) a snapshot of `coordinates` at `resolved.commit`.
 *
 * A complete entry is returned with no network call at all — the property `--frozen` relies on.
 * The download is pinned by SHA (C-E09-042), so a push between resolve and download cannot change
 * what lands in the cache.
 */
export async function snapshotGitHubRepo(
  coordinates: GitHubRepoCoordinates,
  resolved: ResolvedGitHubRef,
  options: GitHubSnapshotOptions,
): Promise<GitHubSnapshot> {
  const dir = githubRepoCacheDir(options.cacheDir, coordinates, resolved.commit);
  const existing = await readMarker(dir);
  if (existing !== undefined && existing.commit === resolved.commit) {
    return {
      dir,
      method: 'tarball',
      ref: existing.ref,
      commit: existing.commit,
      fetched: false,
    };
  }

  const credential: GitHubCredential =
    options.credential ?? (await resolveGitHubCredential(options));

  await mkdir(dir, { recursive: true });
  try {
    const archive = await fetchGitHubTarball(coordinates.owner, coordinates.repo, resolved.commit, {
      ...options,
      credential,
    });
    await writeFile(join(dir, 'snapshot.tar.gz'), Buffer.from(await archive.body.arrayBuffer()));
  } catch (error) {
    // Never leave a marker-less directory that looks like a snapshot.
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  const marker: GitHubSnapshotMarker = {
    version: 1,
    method: 'tarball',
    ref: resolved.ref,
    commit: resolved.commit,
    storedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, SNAPSHOT_MARKER), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  return { dir, method: 'tarball', ref: resolved.ref, commit: resolved.commit, fetched: true };
}

/** Read a cached snapshot without fetching — the `--frozen` entry point. */
export async function readCachedGitHubSnapshot(
  cacheDir: string,
  coordinates: GitHubRepoCoordinates,
  commit: string,
): Promise<GitHubSnapshot | undefined> {
  const dir = githubRepoCacheDir(cacheDir, coordinates, commit);
  const marker = await readMarker(dir);
  if (marker === undefined || marker.commit !== commit) return undefined;
  return { dir, method: 'tarball', ref: marker.ref, commit: marker.commit, fetched: false };
}
