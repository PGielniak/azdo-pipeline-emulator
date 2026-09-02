import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEMA_TTL_MS,
  fetchOrgSchema,
  organizationOf,
  readCachedOrgSchema,
  schemaCachePath,
} from '../src/rest/yamlschema.js';
import { AzureDevOpsClient, type RestFetch, type Sleeper } from '../src/rest/client.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';

const ORG_URL = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG_URL,
  mode: 'pat',
  token: 'fake-pat-for-schema-tests',
};

/** The live document's shape: draft-07 with a `$comment` that does not track content. */
const SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $comment: 'v1.183.0',
  oneOf: [],
};

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-schema-'));
  tempDirs.push(directory);
  return directory;
}

function harness(body: unknown = SCHEMA): { client: AzureDevOpsClient; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: RestFetch = (url) => {
    urls.push(url);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json; api-version=7.1' },
      }),
    );
  };
  const sleep: Sleeper = () => Promise.resolve();
  return {
    client: new AzureDevOpsClient({ orgUrl: ORG_URL, credential: PAT, fetchImpl, sleep }),
    urls,
  };
}

/** A client whose every request fails, for the stale-fallback path. */
function failingClient(status = 503): AzureDevOpsClient {
  return new AzureDevOpsClient({
    orgUrl: ORG_URL,
    credential: PAT,
    maxRetries: 0,
    sleep: () => Promise.resolve(),
    fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ message: 'down' }), { status })),
  });
}

async function seedCache(cacheDir: string, text: string, ageMs: number): Promise<string> {
  const path = schemaCachePath(cacheDir, 'example-org');
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
  const when = new Date(Date.now() - ageMs);
  await utimes(path, when, when);
  return path;
}

describe('organizationOf and schemaCachePath (docs/05 §4)', () => {
  it('reads the org from both supported cloud URL forms', () => {
    expect(organizationOf('https://dev.azure.com/my-org/')).toBe('my-org');
    expect(organizationOf('https://my-org.visualstudio.com')).toBe('my-org');
  });

  it('lays the cache out as schema/yamlschema-<org>.json', () => {
    expect(schemaCachePath('/out', 'my-org')).toBe(
      join('/out', '.cache/schema', 'yamlschema-my-org.json'),
    );
  });

  it('sanitizes an org name that could escape the cache directory', () => {
    // The name comes from a user-supplied URL, so `..` and separators are collapsed rather than
    // interpolated — a cache file must land in the cache.
    expect(schemaCachePath('/out', '../evil')).toBe(
      join('/out', '.cache/schema', 'yamlschema-__evil.json'),
    );
    expect(schemaCachePath('/out', 'a/b')).toBe(
      join('/out', '.cache/schema', 'yamlschema-a_b.json'),
    );
  });
});

describe('fetchOrgSchema', () => {
  it('fetches organization-scoped, with no project segment (C-E01-029)', async () => {
    const cacheDir = await scratch();
    const { client, urls } = harness();
    const result = await fetchOrgSchema(client, ORG_URL, { cacheDir });

    expect(result.origin).toBe('fetched');
    expect(new URL(urls[0]!).pathname).toBe('/example-org/_apis/distributedtask/yamlschema');
    expect(JSON.parse(result.text)).toEqual(SCHEMA);
    await expect(readFile(result.path, 'utf8')).resolves.toBe(result.text);
  });

  it('passes validateTaskNames=false only when explicitly asked (C-E01-033)', async () => {
    const cacheDir = await scratch();
    const off = harness();
    await fetchOrgSchema(off.client, ORG_URL, { cacheDir, validateTaskNames: false });
    expect(new URL(off.urls[0]!).searchParams.get('validateTaskNames')).toBe('false');

    const on = harness();
    await fetchOrgSchema(on.client, ORG_URL, { cacheDir: await scratch() });
    expect(new URL(on.urls[0]!).searchParams.has('validateTaskNames')).toBe(false);
  });

  it('uses a fresh cache entry with no request at all', async () => {
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', 60_000);
    const { client, urls } = harness();

    const result = await fetchOrgSchema(client, ORG_URL, { cacheDir });
    expect(result.origin).toBe('cache-fresh');
    expect(result.text).toBe('{"cached":true}\n');
    // The point of the cache: nothing was requested.
    expect(urls).toEqual([]);
  });

  it('re-fetches once the entry is older than the TTL (age is the only workable expiry)', async () => {
    // C-E09-090/091: `$comment`, length and digest all fail to indicate staleness, so age is it.
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', DEFAULT_SCHEMA_TTL_MS + 60_000);
    const { client, urls } = harness();

    const result = await fetchOrgSchema(client, ORG_URL, { cacheDir });
    expect(result.origin).toBe('fetched');
    expect(urls).toHaveLength(1);
  });

  it('honors --refresh over a perfectly fresh entry', async () => {
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', 1_000);
    const { client, urls } = harness();

    const result = await fetchOrgSchema(client, ORG_URL, { cacheDir, refresh: true });
    expect(result.origin).toBe('fetched');
    expect(urls).toHaveLength(1);
    expect(JSON.parse(result.text)).toEqual(SCHEMA);
  });

  it('respects a custom ttl and an injected clock', async () => {
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', 5_000);
    const fresh = harness();
    await expect(
      fetchOrgSchema(fresh.client, ORG_URL, { cacheDir, ttlMs: 10_000 }),
    ).resolves.toMatchObject({ origin: 'cache-fresh' });

    const stale = harness();
    await expect(
      fetchOrgSchema(stale.client, ORG_URL, { cacheDir, ttlMs: 1_000 }),
    ).resolves.toMatchObject({ origin: 'fetched' });

    // An injected clock moves the entry into the past without touching the filesystem.
    const future = harness();
    await expect(
      fetchOrgSchema(future.client, ORG_URL, {
        cacheDir,
        now: () => Date.now() + DEFAULT_SCHEMA_TTL_MS * 2,
      }),
    ).resolves.toMatchObject({ origin: 'fetched' });
  });

  it('falls back to a stale entry when the refresh fails, with a warning (C-E09-092)', async () => {
    // A validation schema a few days old beats a conversion that will not run.
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', DEFAULT_SCHEMA_TTL_MS * 2);

    const result = await fetchOrgSchema(failingClient(), ORG_URL, { cacheDir });
    expect(result.origin).toBe('cache-stale-fallback');
    expect(result.text).toBe('{"cached":true}\n');
    expect(result.warning).toContain('could not refresh');
    expect(result.warning).toContain('HTTP 503');
    expect(result.warning).toMatch(/\d+h ago/);
  });

  it('throws when the fetch fails and there is no cache to fall back to', async () => {
    const cacheDir = await scratch();
    await expect(fetchOrgSchema(failingClient(), ORG_URL, { cacheDir })).rejects.toThrow(
      'returned HTTP 503',
    );
  });

  it('falls back even on --refresh, since refresh is a preference and not a demand', async () => {
    const cacheDir = await scratch();
    await seedCache(cacheDir, '{"cached":true}\n', 1_000);
    const result = await fetchOrgSchema(failingClient(), ORG_URL, { cacheDir, refresh: true });
    expect(result.origin).toBe('cache-stale-fallback');
  });
});

describe('readCachedOrgSchema — the --frozen entry point', () => {
  it('returns the cached text, or undefined when there is none', async () => {
    const cacheDir = await scratch();
    await expect(readCachedOrgSchema(cacheDir, ORG_URL)).resolves.toBeUndefined();

    await seedCache(cacheDir, '{"cached":true}\n', 0);
    await expect(readCachedOrgSchema(cacheDir, ORG_URL)).resolves.toBe('{"cached":true}\n');
  });
});
