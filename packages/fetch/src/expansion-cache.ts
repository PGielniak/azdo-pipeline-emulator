/**
 * Expansion cache & lockfile (E00-S04-T02).
 *
 * Persists a `finalYaml` keyed by the content hash of the request that produced it, so a
 * `--frozen` re-convert resolves the expansion from cache and never calls the service (PLAN D5,
 * docs/05 §4). The cache layout is:
 *
 *   <out>/.cache/expansion/<requestHash>/final.yml        # raw expansion (functional)
 *   <out>/.cache/expansion/<requestHash>/provenance.json  # requestHash, finalYamlHash, api-version, pipelineId
 *
 * and the lockfile gains one field:
 *
 *   azdo-emu.lock.json  { ..., "expansion": { requestHash, finalYamlHash, apiVersion, pipelineId, storedAt } }
 *
 * Secret hygiene (D7 / rule 4): the cached `finalYaml` is stored **raw** because re-conversion
 * needs the exact expansion and the document carries no secret *values* (D8 — secrets live in
 * `.env`, never in YAML). The PAT is auth-only and never touches disk; `.cache/` is gitignored
 * (docs/04 §1), so the local org name in pipeline metadata is not a shared secret. Transcripts
 * shared outside the repo go through `redact()` (oracle.ts) as before.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  expand,
  expansionRequestHash,
  type ExpansionOutcome,
  type ExpansionRequest,
  type FetchLike,
} from './expand.js';
import type { OracleConfig } from './oracle.js';

const CACHE_SUBDIR = '.cache/expansion';
const FINAL_YAML_FILE = 'final.yml';
const PROVENANCE_FILE = 'provenance.json';

/** The lockfile field this module owns; pinned by request + response hash for reproducible re-runs. */
export interface ExpansionLockEntry {
  readonly requestHash: string;
  readonly finalYamlHash: string;
  readonly apiVersion: string;
  readonly pipelineId: number;
  readonly storedAt: string;
}

/** Thrown when `--frozen` resolves an expansion that is not in cache. */
export class ExpansionCacheMissError extends Error {
  constructor(requestHash: string) {
    super(
      `expansion cache miss for request ${requestHash}: run convert without --frozen to fetch it first`,
    );
    this.name = 'ExpansionCacheMissError';
  }
}

/** Thrown when the service did not return an expansion (rejected / unauthenticated / transport). */
export class ExpansionError extends Error {
  constructor(readonly outcome: ExpansionOutcome) {
    const detail = outcome.kind === 'rejected' ? outcome.message : outcome.kind;
    super(`pipeline expansion failed (${detail})`);
    this.name = 'ExpansionError';
  }
}

export function expansionCacheDir(cacheDir: string): string {
  return join(cacheDir, CACHE_SUBDIR);
}

function entryDir(cacheDir: string, requestHash: string): string {
  return join(expansionCacheDir(cacheDir), requestHash);
}

/** SHA-256 of a final expansion, for the lockfile's integrity pin. */
export function finalYamlHash(finalYaml: string): string {
  return createHash('sha256').update(finalYaml, 'utf8').digest('hex');
}

export async function cacheExpansion(
  cacheDir: string,
  config: OracleConfig,
  request: ExpansionRequest,
  finalYaml: string,
): Promise<ExpansionLockEntry> {
  const requestHash = expansionRequestHash(request);
  const dir = entryDir(cacheDir, requestHash);
  await mkdir(dir, { recursive: true });

  const entry: ExpansionLockEntry = {
    requestHash,
    finalYamlHash: finalYamlHash(finalYaml),
    apiVersion: config.apiVersion,
    pipelineId: config.pipelineId,
    storedAt: new Date().toISOString(),
  };

  await Promise.all([
    writeFile(join(dir, FINAL_YAML_FILE), finalYaml, 'utf8'),
    writeFile(join(dir, PROVENANCE_FILE), `${JSON.stringify(entry, null, 2)}\n`, 'utf8'),
  ]);

  return entry;
}

export async function readCachedExpansion(
  cacheDir: string,
  requestHash: string,
): Promise<{ finalYaml: string; entry: ExpansionLockEntry } | undefined> {
  const dir = entryDir(cacheDir, requestHash);
  try {
    const [finalYaml, entryRaw] = await Promise.all([
      readFile(join(dir, FINAL_YAML_FILE), 'utf8'),
      readFile(join(dir, PROVENANCE_FILE), 'utf8'),
    ]);
    return { finalYaml, entry: JSON.parse(entryRaw) as ExpansionLockEntry };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Merge an `expansion` entry into `azdo-emu.lock.json`, preserving every other field. */
export async function writeExpansionLockfileEntry(
  lockfilePath: string,
  entry: ExpansionLockEntry,
): Promise<void> {
  let lockfile: Record<string, unknown>;
  try {
    lockfile = JSON.parse(await readFile(lockfilePath, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      lockfile = { version: 1 };
    } else {
      throw error;
    }
  }

  lockfile.expansion = entry;
  await mkdir(dirname(lockfilePath), { recursive: true });
  await writeFile(lockfilePath, `${JSON.stringify(lockfile, null, 2)}\n`, 'utf8');
}

export interface ExpandCachedOptions {
  readonly cacheDir: string;
  readonly lockfilePath?: string;
  readonly frozen?: boolean;
  readonly fetchImpl?: FetchLike;
}

export interface CachedExpansion {
  readonly finalYaml: string;
  readonly entry: ExpansionLockEntry;
  readonly fromCache: boolean;
}

/**
 * Expand a pipeline with cache + lockfile discipline. `frozen` resolves strictly from cache and
 * throws {@link ExpansionCacheMissError} on a miss; otherwise it fetches, caches and pins.
 */
export async function expandCached(
  config: OracleConfig,
  request: ExpansionRequest,
  options: ExpandCachedOptions,
): Promise<CachedExpansion> {
  const requestHash = expansionRequestHash(request);

  if (options.frozen) {
    const cached = await readCachedExpansion(options.cacheDir, requestHash);
    if (cached === undefined) {
      throw new ExpansionCacheMissError(requestHash);
    }
    return { finalYaml: cached.finalYaml, entry: cached.entry, fromCache: true };
  }

  const outcome = await expand(config, request, options.fetchImpl);
  if (outcome.kind !== 'expanded') {
    throw new ExpansionError(outcome);
  }

  const entry = await cacheExpansion(options.cacheDir, config, request, outcome.finalYaml);
  if (options.lockfilePath !== undefined) {
    await writeExpansionLockfileEntry(options.lockfilePath, entry);
  }

  return { finalYaml: outcome.finalYaml, entry, fromCache: false };
}
