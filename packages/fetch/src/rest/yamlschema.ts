/**
 * Organization YAML schema: fetch, cache, refresh (E09-S03-T07).
 *
 * The endpoint's *behavior* is E01-S02-T03's grounding (C-E01-029/033..036) and is not re-derived
 * here. What this module owns is the caching policy, and the policy is forced by one measurement:
 *
 * **Nothing in the document can tell you whether it is current** (C-E09-090/091). The live schema
 * and the snapshot committed months earlier are *both* 611,234 bytes and *both* report
 * `$comment: "v1.183.0"`, yet their digests differ — the `definitions.task.anyOf` alternatives
 * reorder between calls. So `$comment` is out, a length check is out, and a digest is out: it moves
 * for a reason unrelated to the schema being newer, and a *matching* digest only means two calls
 * happened to agree. Age is the only expiry left standing, exactly as docs/05 §4 concluded.
 *
 * One further choice is deliberate (C-E09-092): a fetch failure over a merely **stale** cache entry
 * falls back to that entry with a warning rather than failing. A validation schema a few days old
 * beats a conversion that will not run, and the consumer (`resolvePipelineSchema`) already degrades
 * to the vendored schema when a document is unusable.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureDevOpsClient, RestError } from './client.js';

const CACHE_SUBDIR = '.cache/schema';

/** docs/05 §4 says "expire by age"; a week is long enough to be useful and short enough to move. */
export const DEFAULT_SCHEMA_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SchemaOrigin = 'fetched' | 'cache-fresh' | 'cache-stale-fallback';

export interface OrgSchemaResult {
  readonly origin: SchemaOrigin;
  readonly path: string;
  /** The raw document text, as fetched or as cached. */
  readonly text: string;
  readonly ageMs?: number;
  /** Present on `cache-stale-fallback`: why the refresh did not happen. */
  readonly warning?: string;
}

/**
 * docs/05 §4: `.cache/schema/yamlschema-<org>.json`.
 *
 * The name is sanitized rather than interpolated: it comes from a URL the user supplied, and `..`
 * or a separator in it would put the cache file somewhere other than the cache.
 */
export function schemaCachePath(cacheDir: string, organization: string): string {
  const safe = organization.replace(/\.\.+/g, '_').replace(/[^A-Za-z0-9._-]+/g, '_');
  return join(cacheDir, CACHE_SUBDIR, `yamlschema-${safe}.json`);
}

/** Organization name out of either supported Azure DevOps cloud URL. */
export function organizationOf(orgUrl: string): string {
  const parsed = new URL(orgUrl);
  if (parsed.hostname.toLowerCase() === 'dev.azure.com') {
    return parsed.pathname.split('/').filter(Boolean)[0] ?? parsed.hostname;
  }
  return /^([^.]+)\.visualstudio\.com$/i.exec(parsed.hostname)?.[1] ?? parsed.hostname;
}

interface CacheEntry {
  readonly text: string;
  readonly ageMs: number;
}

async function readCache(path: string, now: number): Promise<CacheEntry | undefined> {
  try {
    const [text, stats] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, ageMs: Math.max(0, now - stats.mtimeMs) };
  } catch {
    return undefined;
  }
}

export interface OrgSchemaOptions {
  readonly cacheDir: string;
  /** Forces a re-fetch regardless of age — the `--refresh` flag (docs/05 §4). */
  readonly refresh?: boolean;
  readonly ttlMs?: number;
  /** Injected so expiry is testable without waiting a week. */
  readonly now?: () => number;
  /** `validateTaskNames=false` relaxes unknown-task rejection (C-E01-033). */
  readonly validateTaskNames?: boolean;
}

/**
 * Return the organization schema, from cache when it is fresh enough.
 *
 * The order is: `--refresh` → fetch; a cache entry younger than the TTL → use it, with no request
 * at all; otherwise fetch, and fall back to a stale entry if that fetch fails.
 */
export async function fetchOrgSchema(
  client: AzureDevOpsClient,
  orgUrl: string,
  options: OrgSchemaOptions,
): Promise<OrgSchemaResult> {
  const now = (options.now ?? Date.now)();
  const path = schemaCachePath(options.cacheDir, organizationOf(orgUrl));
  const ttl = options.ttlMs ?? DEFAULT_SCHEMA_TTL_MS;
  const cached = await readCache(path, now);

  if (options.refresh !== true && cached !== undefined && cached.ageMs < ttl) {
    return { origin: 'cache-fresh', path, text: cached.text, ageMs: cached.ageMs };
  }

  try {
    const response = await client.request<unknown>({
      path: 'distributedtask/yamlschema',
      area: 'distributedtask',
      // Organization-scoped: there is no project segment on this route (C-E01-029).
      project: null,
      ...(options.validateTaskNames === false ? { query: { validateTaskNames: false } } : {}),
    });
    const text = `${JSON.stringify(response.body, null, 2)}\n`;
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, text, 'utf8');
    return { origin: 'fetched', path, text };
  } catch (error) {
    if (cached === undefined) throw error;
    // C-E09-092: a stale schema beats no conversion. The consumer degrades further on its own.
    return {
      origin: 'cache-stale-fallback',
      path,
      text: cached.text,
      ageMs: cached.ageMs,
      warning: `could not refresh the organization YAML schema (${
        error instanceof RestError ? `HTTP ${String(error.status ?? 'error')}` : 'request failed'
      }); using the cached copy from ${Math.round(cached.ageMs / 3_600_000)}h ago`,
    };
  }
}

/** Read the cached schema without any network call — the `--frozen` entry point. */
export async function readCachedOrgSchema(
  cacheDir: string,
  orgUrl: string,
): Promise<string | undefined> {
  const cached = await readCache(schemaCachePath(cacheDir, organizationOf(orgUrl)), Date.now());
  return cached?.text;
}
