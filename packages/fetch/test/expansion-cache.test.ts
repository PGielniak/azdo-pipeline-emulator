import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ExpansionCacheMissError,
  ExpansionError,
  cacheExpansion,
  expandCached,
  finalYamlHash,
  readCachedExpansion,
  writeExpansionLockfileEntry,
} from '../src/expansion-cache.js';
import { expansionRequestHash, type ExpansionRequest } from '../src/expand.js';
import { DEFAULT_API_VERSION, type OracleConfig } from '../src/oracle.js';

const CONFIG: OracleConfig = {
  orgUrl: 'https://dev.azure.com/example-org',
  project: 'oracle',
  pipelineId: 19,
  pat: 'x'.repeat(75) + 'AZDO' + 'abcd',
  apiVersion: DEFAULT_API_VERSION,
};

const REQUEST: ExpansionRequest = { yamlOverride: 'steps:\n- script: echo probe\n' };
const FINAL_YAML = 'stages:\n- stage: __default\n  jobs:\n  - job: Job\n';

let tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'azdo-emu-expansion-cache-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs = [];
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('cacheExpansion / readCachedExpansion', () => {
  it('round-trips the finalYaml byte-identically and records provenance', async () => {
    const cacheDir = await makeTempDir();
    const entry = await cacheExpansion(cacheDir, CONFIG, REQUEST, FINAL_YAML);

    expect(entry.requestHash).toBe(expansionRequestHash(REQUEST.yamlOverride));
    expect(entry.finalYamlHash).toBe(finalYamlHash(FINAL_YAML));
    expect(entry.apiVersion).toBe('7.1');
    expect(entry.pipelineId).toBe(19);

    const cached = await readCachedExpansion(cacheDir, entry.requestHash);
    expect(cached).toBeDefined();
    expect(cached!.finalYaml).toBe(FINAL_YAML);
    expect(cached!.entry).toEqual(entry);
  });

  it('returns undefined for an unknown request hash', async () => {
    const cacheDir = await makeTempDir();
    expect(await readCachedExpansion(cacheDir, '0'.repeat(64))).toBeUndefined();
  });
});

describe('finalYamlHash', () => {
  it('is a deterministic sha256 of the expansion', () => {
    expect(finalYamlHash('a\n')).toMatch(/^[0-9a-f]{64}$/);
    expect(finalYamlHash('a\n')).toBe(finalYamlHash('a\n'));
    expect(finalYamlHash('a\n')).not.toBe(finalYamlHash('b\n'));
  });
});

describe('writeExpansionLockfileEntry', () => {
  it('creates a version-1 lockfile with the expansion field when none exists', async () => {
    const cacheDir = await makeTempDir();
    const lockfilePath = join(cacheDir, 'azdo-emu.lock.json');
    const entry = await cacheExpansion(cacheDir, CONFIG, REQUEST, FINAL_YAML);

    await writeExpansionLockfileEntry(lockfilePath, entry);

    const parsed = JSON.parse(await readFile(lockfilePath, 'utf8')) as Record<string, unknown>;
    expect(parsed.version).toBe(1);
    expect(parsed.expansion).toEqual(entry);
  });

  it('merges into an existing lockfile, preserving other fields', async () => {
    const cacheDir = await makeTempDir();
    const lockfilePath = join(cacheDir, 'azdo-emu.lock.json');
    await writeFile(
      lockfilePath,
      JSON.stringify({ version: 1, repositories: { self: { url: 'https://x' } } }),
      'utf8',
    );
    const entry = await cacheExpansion(cacheDir, CONFIG, REQUEST, FINAL_YAML);

    await writeExpansionLockfileEntry(lockfilePath, entry);

    const parsed = JSON.parse(await readFile(lockfilePath, 'utf8')) as Record<string, unknown>;
    expect(parsed.repositories).toEqual({ self: { url: 'https://x' } });
    expect(parsed.expansion).toEqual(entry);
  });
});

describe('expandCached', () => {
  function fetch200(calls: number[]) {
    return (): Promise<Response> => {
      calls.push(calls.length);
      return Promise.resolve(json(200, { finalYaml: FINAL_YAML }));
    };
  }

  it('fetches, caches, and re-resolves byte-identically from cache under --frozen', async () => {
    const cacheDir = await makeTempDir();
    const lockfilePath = join(cacheDir, 'azdo-emu.lock.json');
    const calls: number[] = [];

    const first = await expandCached(CONFIG, REQUEST, {
      cacheDir,
      lockfilePath,
      fetchImpl: fetch200(calls),
    });
    expect(first.fromCache).toBe(false);
    expect(first.finalYaml).toBe(FINAL_YAML);

    const second = await expandCached(CONFIG, REQUEST, { cacheDir, frozen: true });
    expect(second.fromCache).toBe(true);
    expect(second.finalYaml).toBe(FINAL_YAML); // byte-identical
    expect(second.entry).toEqual(first.entry);

    expect(calls).toHaveLength(1); // frozen path never hit the wire
  });

  it('throws ExpansionCacheMissError on a frozen cache miss', async () => {
    const cacheDir = await makeTempDir();
    await expect(expandCached(CONFIG, REQUEST, { cacheDir, frozen: true })).rejects.toThrow(
      ExpansionCacheMissError,
    );
    await expect(expandCached(CONFIG, REQUEST, { cacheDir, frozen: true })).rejects.toThrow(
      /run convert without --frozen/,
    );
  });

  it('throws ExpansionError on a rejected expansion', async () => {
    const cacheDir = await makeTempDir();
    const fetchImpl = (): Promise<Response> =>
      Promise.resolve(
        json(400, { message: 'bad pipeline', typeKey: 'PipelineValidationException' }),
      );

    await expect(
      expandCached(CONFIG, { yamlOverride: 'stepz: []\n' }, { cacheDir, fetchImpl }),
    ).rejects.toThrow(ExpansionError);
    await expect(
      expandCached(CONFIG, { yamlOverride: 'stepz: []\n' }, { cacheDir, fetchImpl }),
    ).rejects.toThrow(/bad pipeline/);
  });
});
