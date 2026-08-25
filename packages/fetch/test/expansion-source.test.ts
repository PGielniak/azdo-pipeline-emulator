// E12-S01-T01 — the gate: the service expands by default, the retained local engine only when the
// user explicitly asks, and never silently (PLAN D3/D4/D6, docs/07 §6).
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ExpansionConfigMissingError,
  OFFLINE_EXPANSION_WARNING,
  OfflineExpansionUnavailableError,
  resolveExpansion,
  type OfflineExpander,
} from '../src/expansion-source.js';
import { ExpansionCacheMissError, cacheExpansion, finalYamlHash } from '../src/expansion-cache.js';
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
const SERVICE_YAML = 'stages:\n- stage: __default\n  jobs:\n  - job: Job\n';
const OFFLINE_YAML = 'stages:\n- stage: __default\n  jobs:\n  - job: OfflineJob\n';

let tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'azdo-emu-expansion-source-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true })));
  tempDirs = [];
});

/** The service answering with a `finalYaml`, and a spy on whether it was called at all. */
function serviceFetch(finalYaml = SERVICE_YAML) {
  return vi.fn(async () =>
    Promise.resolve(
      new Response(JSON.stringify({ finalYaml }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
}

/** Stand-in for the retained local engine; the real binding is the convert wiring's (E10-S02-T01). */
const offlineExpander: OfflineExpander = () => ({ finalYaml: OFFLINE_YAML });

describe('resolveExpansion — default (service) path', () => {
  it('never invokes the local engine, even when one is bound', async () => {
    const cacheDir = await makeTempDir();
    const fetchImpl = serviceFetch();
    const local = vi.fn(offlineExpander);

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      config: CONFIG,
      fetchImpl,
      offlineExpander: local,
    });

    expect(local).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolved.mode).toBe('service');
    expect(resolved.finalYaml).toBe(SERVICE_YAML);
    expect(resolved.warnings).toEqual([]);
  });

  it('is unchanged by `offlineExpand: false` — the flag is opt-in, not a tri-state', async () => {
    const cacheDir = await makeTempDir();
    const local = vi.fn(offlineExpander);

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      config: CONFIG,
      fetchImpl: serviceFetch(),
      offlineExpander: local,
      offlineExpand: false,
    });

    expect(local).not.toHaveBeenCalled();
    expect(resolved.mode).toBe('service');
  });

  it('records service provenance in the manifest entry and pins the lockfile', async () => {
    const cacheDir = await makeTempDir();
    const lockfilePath = join(cacheDir, 'azdo-emu.lock.json');

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      lockfilePath,
      config: CONFIG,
      fetchImpl: serviceFetch(),
    });

    expect(resolved.manifest).toEqual({
      mode: 'service',
      degraded: false,
      requestHash: expansionRequestHash(REQUEST),
      finalYamlHash: finalYamlHash(SERVICE_YAML),
      apiVersion: '7.1',
      pipelineId: 19,
      fromCache: false,
    });

    const lockfile = JSON.parse(await readFile(lockfilePath, 'utf8')) as Record<string, unknown>;
    expect(lockfile.expansion).toMatchObject({ finalYamlHash: finalYamlHash(SERVICE_YAML) });
  });

  it('still resolves from cache under --frozen, without the network', async () => {
    const cacheDir = await makeTempDir();
    await cacheExpansion(cacheDir, CONFIG, REQUEST, SERVICE_YAML);
    const fetchImpl = serviceFetch();

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      config: CONFIG,
      frozen: true,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolved.finalYaml).toBe(SERVICE_YAML);
    expect(resolved.manifest).toMatchObject({ mode: 'service', fromCache: true });
  });

  it('does not fall back to the local engine when the service path fails', async () => {
    const cacheDir = await makeTempDir();
    const local = vi.fn(offlineExpander);

    await expect(
      resolveExpansion(REQUEST, { cacheDir, config: CONFIG, frozen: true, offlineExpander: local }),
    ).rejects.toBeInstanceOf(ExpansionCacheMissError);
    expect(local).not.toHaveBeenCalled();
  });

  it('refuses the service path without organization/pipeline context', async () => {
    const cacheDir = await makeTempDir();
    await expect(resolveExpansion(REQUEST, { cacheDir })).rejects.toBeInstanceOf(
      ExpansionConfigMissingError,
    );
  });
});

describe('resolveExpansion — `--offline-expand` fallback', () => {
  it('uses the local engine and never calls the service', async () => {
    const cacheDir = await makeTempDir();
    const fetchImpl = serviceFetch();

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      config: CONFIG,
      fetchImpl,
      offlineExpand: true,
      offlineExpander,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(resolved.mode).toBe('offline');
    expect(resolved.finalYaml).toBe(OFFLINE_YAML);
  });

  it('always warns that the expansion is degraded, keeping the engine’s own warnings', async () => {
    const cacheDir = await makeTempDir();

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      offlineExpand: true,
      offlineExpander: () => ({ finalYaml: OFFLINE_YAML, warnings: ['unsupported: extends'] }),
    });

    expect(resolved.warnings[0]).toBe(OFFLINE_EXPANSION_WARNING);
    expect(resolved.warnings[0]).toMatch(/degraded/);
    expect(resolved.warnings).toContain('unsupported: extends');
  });

  it('marks the manifest entry degraded and claims no service provenance', async () => {
    const cacheDir = await makeTempDir();

    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      config: CONFIG,
      offlineExpand: true,
      offlineExpander,
    });

    expect(resolved.manifest).toEqual({
      mode: 'offline',
      degraded: true,
      requestHash: expansionRequestHash(REQUEST),
      finalYamlHash: finalYamlHash(OFFLINE_YAML),
    });
  });

  it('writes neither the expansion cache nor the lockfile — the YAML is not the service’s', async () => {
    const cacheDir = await makeTempDir();
    const lockfilePath = join(cacheDir, 'azdo-emu.lock.json');

    await resolveExpansion(REQUEST, {
      cacheDir,
      lockfilePath,
      config: CONFIG,
      offlineExpand: true,
      offlineExpander,
    });

    await expect(readFile(lockfilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(
        join(cacheDir, '.cache/expansion', expansionRequestHash(REQUEST), 'final.yml'),
        'utf8',
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses, pointing at the wiring task, when no local expander is bound', async () => {
    const cacheDir = await makeTempDir();
    await expect(
      resolveExpansion(REQUEST, { cacheDir, config: CONFIG, offlineExpand: true }),
    ).rejects.toBeInstanceOf(OfflineExpansionUnavailableError);
  });

  it('awaits an asynchronous local engine', async () => {
    const cacheDir = await makeTempDir();
    const resolved = await resolveExpansion(REQUEST, {
      cacheDir,
      offlineExpand: true,
      offlineExpander: () => Promise.resolve({ finalYaml: OFFLINE_YAML }),
    });
    expect(resolved.finalYaml).toBe(OFFLINE_YAML);
  });
});
