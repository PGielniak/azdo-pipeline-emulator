/**
 * Repository alias resolution (E09-S02-T03).
 *
 * Turns the `resources.repositories` entries of a pipeline, plus the user's `azdo-emu.yaml`
 * `repositories:` overrides, into one pinned repository per alias — dispatching to the ADO fetcher
 * (E09-S02-T01) or the GitHub fetcher (E09-S02-T02). docs/05 §3 fixes the order:
 *
 *   1. config override — redirect an alias at a local working copy
 *   2. `type: git`     → Azure DevOps, via the stored Azure credential
 *   3. `type: github`  → GitHub, via the `gh auth token` → `GITHUB_TOKEN` → anonymous chain
 *   4. ref default, and always pinned to a commit SHA in the lockfile
 *
 * `@self` is the repository the root YAML came from: it is answered from the local working copy and
 * is never fetched (C-E03-197).
 *
 * The pieces this module does *not* re-derive: alias case folding (C-E03-213), the once-per-
 * pipeline pinning that lets a resolved repository carry a commit rather than a ref (C-E03-196),
 * and everything about authentication (C-E09-012..017, C-E09-035). See C-E09-049.
 */

import {
  resolveAdoRef,
  snapshotAdoRepo,
  type AdoRepoCoordinates,
  type RepoFetch,
  type SnapshotMethod,
} from './ado-git.js';
import { resolveGitHubRef, snapshotGitHubRepo, type GitHubRepoCoordinates } from './github.js';
import type { GitHubFetch } from '../auth/github.js';
import type { StoredAzureCredential } from '../auth/storage.js';

/** C-E09-045: four types, and the page states no default for `type`. */
export const REPOSITORY_TYPES = ['git', 'github', 'githubenterprise', 'bitbucket'] as const;
export type RepositoryType = (typeof REPOSITORY_TYPES)[number];

/** C-E09-045: the two we have no fetcher for. Reported, never thrown (PLAN D10). */
export const UNSUPPORTED_REPOSITORY_TYPES: readonly RepositoryType[] = [
  'githubenterprise',
  'bitbucket',
];

/** C-E09-044: a constant, not the repository's own default branch. */
export const DEFAULT_REPOSITORY_REF = 'refs/heads/main';

export const ALIAS_UNSUPPORTED_TYPE = 'repository-type-unsupported';
export const ALIAS_UNKNOWN_TYPE = 'repository-type-unknown';
export const ALIAS_ENDPOINT_SUBSTITUTED = 'repository-endpoint-substituted';
export const ALIAS_LOCAL_OVERRIDE = 'repository-local-override';
export const ALIAS_FETCH_FAILED = 'repository-fetch-failed';

/** One `resources.repositories[]` entry, already parsed out of the YAML. */
export interface RepositoryResourceSpec {
  readonly alias: string;
  readonly type?: string;
  readonly name?: string;
  readonly ref?: string;
  /** C-E09-048: a service-connection id, meaningless locally. */
  readonly endpoint?: string;
}

/** docs/05 §3 item 1 — redirect an alias at a working copy while debugging templates. */
export interface LocalRepositoryOverride {
  readonly path: string;
}

export type RepositoryOrigin = 'self' | 'local-override' | 'ado' | 'github';

export interface ResolvedRepository {
  readonly alias: string;
  readonly origin: RepositoryOrigin;
  /** Clone URL, or a `file://` URL for a local working copy. */
  readonly url: string;
  /** Full ref name; `refs/heads/main` when the resource omitted one (C-E09-044). */
  readonly ref: string;
  /** 40-hex commit, or 40 zeroes for a working copy that is not pinned. */
  readonly commit: string;
  /** Where the bytes are: a cache entry, or the override path. */
  readonly dir: string;
  readonly method?: SnapshotMethod | 'tarball' | 'working-copy';
}

/** A note for the manifest's warnings/unsupported list (PLAN D10). */
export interface RepositoryNote {
  readonly code: string;
  readonly alias: string;
  readonly message: string;
}

export interface AliasResolutionResult {
  readonly repositories: readonly ResolvedRepository[];
  readonly notes: readonly RepositoryNote[];
  /** Aliases that could not be resolved; conversion continues without them (PLAN D10). */
  readonly unresolved: readonly string[];
}

export interface SelfRepository {
  /** Absolute path of the working copy the root YAML came from. */
  readonly path: string;
  readonly url?: string;
  readonly ref?: string;
  readonly commit?: string;
}

export interface AliasResolutionOptions {
  readonly self: SelfRepository;
  /** Organization and project of the pipeline being converted, for `type: git` name resolution. */
  readonly organization: { readonly orgUrl: string; readonly project: string };
  readonly cacheDir: string;
  /** Keyed by alias; compared case-insensitively (C-E03-213). */
  readonly overrides?: Readonly<Record<string, LocalRepositoryOverride>>;
  readonly azureCredential?: StoredAzureCredential;
  readonly adoFetch?: RepoFetch;
  readonly githubFetch?: GitHubFetch;
}

const UNPINNED_COMMIT = '0'.repeat(40);

function fold(alias: string): string {
  return alias.toLowerCase();
}

/** C-E09-047: the schema's own example writes `ref: main`, so a bare name is promoted, not rejected. */
export function normalizeRef(ref: string | undefined): string {
  if (ref === undefined || ref.trim().length === 0) return DEFAULT_REPOSITORY_REF;
  const trimmed = ref.trim();
  if (trimmed.startsWith('refs/')) return trimmed;
  if (trimmed.startsWith('heads/') || trimmed.startsWith('tags/')) return `refs/${trimmed}`;
  return `refs/heads/${trimmed}`;
}

/**
 * C-E09-046: one slash means *project/repo* under `git` and *owner/repo* under `github`. The same
 * text parses two ways and only `type` disambiguates it, so the split lives here rather than in
 * either fetcher.
 */
export function adoCoordinatesFor(
  name: string,
  organization: { readonly orgUrl: string; readonly project: string },
): AdoRepoCoordinates {
  const segments = name.split('/').filter((segment) => segment.length > 0);
  if (segments.length >= 2) {
    return {
      orgUrl: organization.orgUrl,
      project: segments[0]!,
      repository: segments.slice(1).join('/'),
    };
  }
  return {
    orgUrl: organization.orgUrl,
    project: organization.project,
    repository: segments[0] ?? name,
  };
}

export function githubCoordinatesFor(name: string): GitHubRepoCoordinates | undefined {
  const segments = name.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 2) return undefined;
  return { owner: segments[0]!, repo: segments[1]! };
}

function adoCloneUrl(coordinates: AdoRepoCoordinates): string {
  const org = coordinates.orgUrl.replace(/\/+$/, '');
  return `${org}/${encodeURIComponent(coordinates.project)}/_git/${encodeURIComponent(coordinates.repository)}`;
}

function selfRepository(self: SelfRepository): ResolvedRepository {
  return {
    alias: 'self',
    origin: 'self',
    url: self.url ?? `file://${self.path}`,
    ref: normalizeRef(self.ref),
    commit: self.commit ?? UNPINNED_COMMIT,
    dir: self.path,
    method: 'working-copy',
  };
}

interface Accumulator {
  readonly repositories: ResolvedRepository[];
  readonly notes: RepositoryNote[];
  readonly unresolved: string[];
}

/** docs/05 §3 item 1: the override wins before the type is even consulted. */
function applyOverride(
  spec: RepositoryResourceSpec,
  override: LocalRepositoryOverride,
  accumulator: Accumulator,
): void {
  accumulator.repositories.push({
    alias: spec.alias,
    origin: 'local-override',
    url: `file://${override.path}`,
    ref: normalizeRef(spec.ref),
    commit: UNPINNED_COMMIT,
    dir: override.path,
    method: 'working-copy',
  });
  accumulator.notes.push({
    code: ALIAS_LOCAL_OVERRIDE,
    alias: spec.alias,
    message:
      `\`${spec.alias}\` is redirected to the local working copy at ${override.path}; ` +
      'nothing is fetched for it and it is not pinned to a commit.',
  });
}

/**
 * Resolve every declared alias, plus `self`.
 *
 * Nothing here throws for a repository it cannot handle: an unknown type, an unsupported type, or a
 * fetch failure becomes a note plus an entry in `unresolved`, because a conversion that stops on one
 * unreachable template repository is less useful than one that converts what it can and says what
 * it could not (PLAN D10).
 */
export async function resolveRepositoryAliases(
  specs: readonly RepositoryResourceSpec[],
  options: AliasResolutionOptions,
): Promise<AliasResolutionResult> {
  const accumulator: Accumulator = {
    repositories: [selfRepository(options.self)],
    notes: [],
    unresolved: [],
  };

  const overrides = new Map<string, LocalRepositoryOverride>(
    Object.entries(options.overrides ?? {}).map(([alias, value]) => [fold(alias), value]),
  );

  for (const spec of specs) {
    if (fold(spec.alias) === 'self') continue; // `self` is not redeclarable.

    // C-E09-048: an endpoint is a service connection; our own credential substitutes for it, and
    // that substitution is recorded rather than silent.
    if (spec.endpoint !== undefined && spec.endpoint.length > 0) {
      accumulator.notes.push({
        code: ALIAS_ENDPOINT_SUBSTITUTED,
        alias: spec.alias,
        message:
          `\`${spec.alias}\` declares service endpoint \`${spec.endpoint}\`, which has no meaning ` +
          'locally; azdo-emu authenticated with your own credentials instead.',
      });
    }

    const override = overrides.get(fold(spec.alias));
    if (override !== undefined) {
      applyOverride(spec, override, accumulator);
      continue;
    }

    const type = spec.type?.trim().toLowerCase();
    if (type === undefined || type.length === 0 || !isRepositoryType(type)) {
      accumulator.notes.push({
        code: ALIAS_UNKNOWN_TYPE,
        alias: spec.alias,
        message:
          `\`${spec.alias}\` declares ${type === undefined || type.length === 0 ? 'no `type`' : `an unrecognized \`type: ${type}\``}; ` +
          `the schema allows ${REPOSITORY_TYPES.join(', ')}. It was not fetched.`,
      });
      accumulator.unresolved.push(spec.alias);
      continue;
    }

    if (UNSUPPORTED_REPOSITORY_TYPES.includes(type)) {
      accumulator.notes.push({
        code: ALIAS_UNSUPPORTED_TYPE,
        alias: spec.alias,
        message:
          `\`${spec.alias}\` is a \`${type}\` repository, which azdo-emu has no fetcher for. ` +
          'Point the alias at a local working copy with `repositories:` in azdo-emu.yaml to convert it.',
      });
      accumulator.unresolved.push(spec.alias);
      continue;
    }

    const name = spec.name?.trim();
    if (name === undefined || name.length === 0) {
      accumulator.notes.push({
        code: ALIAS_UNKNOWN_TYPE,
        alias: spec.alias,
        message: `\`${spec.alias}\` declares \`type: ${type}\` but no \`name\`, so it was not fetched.`,
      });
      accumulator.unresolved.push(spec.alias);
      continue;
    }

    try {
      accumulator.repositories.push(
        type === 'git'
          ? await resolveAdo(spec, name, options)
          : await resolveGitHub(spec, name, options),
      );
    } catch (error) {
      accumulator.notes.push({
        code: ALIAS_FETCH_FAILED,
        alias: spec.alias,
        message:
          `\`${spec.alias}\` could not be fetched: ` +
          `${error instanceof Error ? error.message : 'unknown error'}`,
      });
      accumulator.unresolved.push(spec.alias);
    }
  }

  return {
    repositories: accumulator.repositories,
    notes: accumulator.notes,
    unresolved: accumulator.unresolved,
  };
}

function isRepositoryType(value: string): value is RepositoryType {
  return (REPOSITORY_TYPES as readonly string[]).includes(value);
}

async function resolveAdo(
  spec: RepositoryResourceSpec,
  name: string,
  options: AliasResolutionOptions,
): Promise<ResolvedRepository> {
  if (options.azureCredential === undefined) {
    throw new Error('no Azure DevOps credential is stored; run `azdo-emu auth login` first');
  }
  const coordinates = adoCoordinatesFor(name, options.organization);
  const ref = normalizeRef(spec.ref);
  const resolved = await resolveAdoRef(coordinates, ref, {
    credential: options.azureCredential,
    ...(options.adoFetch === undefined ? {} : { fetchImpl: options.adoFetch }),
  });
  const snapshot = await snapshotAdoRepo(coordinates, resolved, {
    credential: options.azureCredential,
    cacheDir: options.cacheDir,
    ...(options.adoFetch === undefined ? {} : { fetchImpl: options.adoFetch }),
  });
  return {
    alias: spec.alias,
    origin: 'ado',
    url: adoCloneUrl(coordinates),
    ref: resolved.ref,
    commit: resolved.commit,
    dir: snapshot.dir,
    method: snapshot.method,
  };
}

async function resolveGitHub(
  spec: RepositoryResourceSpec,
  name: string,
  options: AliasResolutionOptions,
): Promise<ResolvedRepository> {
  const coordinates = githubCoordinatesFor(name);
  if (coordinates === undefined) {
    // C-E09-046: a github `name` is `owner/repo`; anything else cannot be addressed.
    throw new Error(`\`name: ${name}\` is not a GitHub owner/repo pair`);
  }
  const ref = normalizeRef(spec.ref);
  const resolved = await resolveGitHubRef(coordinates, ref, {
    ...(options.githubFetch === undefined ? {} : { fetchImpl: options.githubFetch }),
  });
  const snapshot = await snapshotGitHubRepo(coordinates, resolved, {
    cacheDir: options.cacheDir,
    ...(options.githubFetch === undefined ? {} : { fetchImpl: options.githubFetch }),
  });
  return {
    alias: spec.alias,
    origin: 'github',
    url: `https://github.com/${coordinates.owner}/${coordinates.repo}`,
    ref: resolved.ref,
    commit: resolved.commit,
    dir: snapshot.dir,
    method: 'tarball',
  };
}
