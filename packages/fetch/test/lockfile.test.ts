import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCKFILE_NAME,
  LOCKFILE_VERSION,
  LockfileError,
  canonicalizeLockfile,
  frozenFailureMessage,
  lockfileFingerprint,
  parseLockfile,
  readLockfile,
  serializeLockfile,
  verifyLockfile,
  writeLockfile,
  type Lockfile,
} from '../src/lockfile.js';
import { repoCacheDir } from '../src/repo/ado-git.js';
import { githubRepoCacheDir } from '../src/repo/github.js';
import { artifactCacheDir } from '../src/rest/runs.js';
import { taskCacheDir } from '../src/rest/tasks.js';

const ORG = { orgUrl: 'https://dev.azure.com/example-org', project: 'Example' };
const COMMIT = 'fa03743821b7e01caa17f4387b30338c43fac4df';
const OTHER = 'b'.repeat(40);

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-lock-'));
  tempDirs.push(directory);
  return directory;
}

const full = (): Lockfile => ({
  version: LOCKFILE_VERSION,
  convertedAt: '2026-09-02T12:00:00Z',
  root: { file: 'azure-pipelines.yml', sha256: 'a'.repeat(64) },
  parameters: { deployEnv: 'dev', region: 'weu' },
  repositories: {
    self: {
      url: 'https://dev.azure.com/example-org/Example/_git/app',
      ref: 'refs/heads/main',
      commit: '0'.repeat(40),
    },
    templates: {
      type: 'azdo',
      url: 'https://dev.azure.com/example-org/Example/_git/pipeline-templates',
      ref: 'refs/heads/main',
      commit: COMMIT,
    },
    common: {
      type: 'github',
      url: 'https://github.com/Contoso/CommonTools',
      ref: 'refs/heads/main',
      commit: OTHER,
    },
  },
  pipelines: {
    upstream: {
      projectName: 'Fabrikam',
      pipelineId: 42,
      pipelineName: 'SmartHotel-CI',
      runId: 1234,
      runName: '20260812.3',
      sourceBranch: 'refs/heads/main',
      artifacts: ['drop'],
    },
  },
  tasks: { 'replacetokens@6': { id: 'a8515ec8-7254-4ffd-912c-86772e2b5962', version: '6.3.1' } },
  expansion: {
    requestHash: '2a138e6a',
    finalYamlHash: 'c'.repeat(64),
    apiVersion: '7.1',
    pipelineId: 19,
    storedAt: '2026-09-02T12:00:00Z',
  },
});

describe('canonical form — the reproducibility guarantee', () => {
  it('sorts every map key, so insertion order cannot churn the committed file', () => {
    const shuffled: Lockfile = {
      ...full(),
      parameters: { region: 'weu', deployEnv: 'dev' },
      repositories: {
        templates: full().repositories!.templates!,
        common: full().repositories!.common!,
        self: full().repositories!.self!,
      },
    };
    expect(serializeLockfile(shuffled)).toBe(serializeLockfile(full()));
    expect(Object.keys(canonicalizeLockfile(shuffled).repositories as object)).toEqual([
      'common',
      'self',
      'templates',
    ]);
  });

  it('emits a fixed top-level field order regardless of the object literal', () => {
    expect(Object.keys(canonicalizeLockfile(full()))).toEqual([
      'version',
      'convertedAt',
      'root',
      'parameters',
      'repositories',
      'pipelines',
      'tasks',
      'expansion',
    ]);
  });

  it('omits absent sections rather than writing empty ones', () => {
    const minimal: Lockfile = { version: LOCKFILE_VERSION, convertedAt: '2026-09-02T12:00:00Z' };
    expect(Object.keys(canonicalizeLockfile(minimal))).toEqual(['version', 'convertedAt']);
  });

  it('excludes convertedAt from the fingerprint, since a timestamp cannot be reproducible', () => {
    const later: Lockfile = { ...full(), convertedAt: '2027-01-01T00:00:00Z' };
    expect(lockfileFingerprint(later)).toBe(lockfileFingerprint(full()));
    // Everything else does count.
    expect(lockfileFingerprint({ ...full(), tasks: {} })).not.toBe(lockfileFingerprint(full()));
  });
});

describe('round-trip: two converts from lock produce identical output (the Done criterion)', () => {
  it('write → read → write is byte-identical', async () => {
    const dir = await scratch();
    const path = join(dir, LOCKFILE_NAME);

    await writeLockfile(path, full());
    const first = await readFile(path, 'utf8');

    const reread = (await readLockfile(path))!;
    await writeLockfile(path, reread);
    const second = await readFile(path, 'utf8');

    expect(second).toBe(first);
    expect(lockfileFingerprint(reread)).toBe(lockfileFingerprint(full()));
  });

  it('a second convert with a new timestamp changes only that line', async () => {
    const dir = await scratch();
    const path = join(dir, LOCKFILE_NAME);
    await writeLockfile(path, full());
    const first = await readFile(path, 'utf8');

    await writeLockfile(path, { ...full(), convertedAt: '2026-09-03T09:00:00Z' });
    const second = await readFile(path, 'utf8');

    const differing = first
      .split('\n')
      .map((line, index) => [line, second.split('\n')[index]] as const)
      .filter(([a, b]) => a !== b);
    expect(differing).toHaveLength(1);
    expect(differing[0]?.[0]).toContain('convertedAt');
  });
});

describe('parseLockfile', () => {
  it('round-trips every documented section', () => {
    expect(parseLockfile(serializeLockfile(full()))).toEqual(full());
  });

  it('refuses a wrong version rather than half-reading it', () => {
    expect(() => parseLockfile(JSON.stringify({ version: 2 }))).toThrow(/version 2/);
    expect(() => parseLockfile(JSON.stringify({ version: 2 }))).toThrow(LockfileError);
  });

  it('refuses non-JSON and a non-object document', () => {
    expect(() => parseLockfile('not json')).toThrow(/not valid JSON/);
    expect(() => parseLockfile('[1,2]')).toThrow(/must be a JSON object/);
  });

  it('names the exact pin that is malformed', () => {
    const bad = (section: unknown, key: string) =>
      JSON.stringify({ version: 1, convertedAt: '', [key]: section });
    expect(() => parseLockfile(bad({ templates: { url: 'u' } }, 'repositories'))).toThrow(
      'repositories.templates must carry url, ref and commit',
    );
    expect(() => parseLockfile(bad({ upstream: { pipelineId: 1 } }, 'pipelines'))).toThrow(
      'pipelines.upstream must carry a numeric pipelineId and runId',
    );
    expect(() => parseLockfile(bad({ 'x@1': { id: 'g' } }, 'tasks'))).toThrow(
      "tasks['x@1'] must carry id and version",
    );
  });

  it('drops an unrecognized repository type rather than trusting it', () => {
    const parsed = parseLockfile(
      JSON.stringify({
        version: 1,
        convertedAt: '',
        repositories: { r: { type: 'svn', url: 'u', ref: 'r', commit: 'c' } },
      }),
    );
    expect('type' in parsed.repositories!.r!).toBe(false);
  });
});

describe('writeLockfile', () => {
  it('carries an unknown top-level field through instead of deleting it', async () => {
    // A field written by another part of the tool must survive: silently dropping it would break
    // --frozen in a way that looks like a cache miss.
    const dir = await scratch();
    const path = join(dir, LOCKFILE_NAME);
    await writeFile(
      path,
      JSON.stringify({ version: 1, convertedAt: '', futureSection: { a: 1 } }),
      'utf8',
    );

    await writeLockfile(path, full());
    const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    expect(written.futureSection).toEqual({ a: 1 });
    expect(written.tasks).toBeDefined();
  });

  it('creates the containing directory and tolerates an unreadable existing file', async () => {
    const dir = await scratch();
    const path = join(dir, 'nested', 'deeper', LOCKFILE_NAME);
    await writeLockfile(path, full());
    await expect(readLockfile(path)).resolves.toMatchObject({ version: 1 });

    await writeFile(path, 'garbage', 'utf8');
    await writeLockfile(path, full());
    await expect(readLockfile(path)).resolves.toMatchObject({ version: 1 });
  });
});

describe('readLockfile', () => {
  it('returns undefined when there is no lockfile yet', async () => {
    const dir = await scratch();
    await expect(readLockfile(join(dir, LOCKFILE_NAME))).resolves.toBeUndefined();
  });
});

describe('verifyLockfile — the --frozen guarantee', () => {
  const present = (paths: readonly string[]) => {
    const set = new Set(paths);
    return (path: string) => Promise.resolve(set.has(path));
  };

  const allPaths = (cacheDir: string): string[] => [
    join(
      repoCacheDir(cacheDir, { ...ORG, repository: 'pipeline-templates' }, COMMIT),
      'snapshot.json',
    ),
    join(
      githubRepoCacheDir(cacheDir, { owner: 'Contoso', repo: 'CommonTools' }, OTHER),
      'snapshot.json',
    ),
    artifactCacheDir(cacheDir, 'upstream', 1234, 'drop'),
    join(taskCacheDir(cacheDir, 'replacetokens', { major: 6, minor: 3, patch: 1 }), 'task.json'),
    join(cacheDir, '.cache/expansion', '2a138e6a', 'final.yml'),
  ];

  it('passes when every pin is in the cache', async () => {
    const cacheDir = '/cache';
    await expect(
      verifyLockfile(full(), {
        cacheDir,
        organization: ORG,
        exists: present(allPaths(cacheDir)),
      }),
    ).resolves.toEqual([]);
  });

  it('skips a working copy, which is pinned with an all-zero commit', async () => {
    // `self` has commit 0×40 and nothing in the cache; reporting it would be a false alarm.
    const cacheDir = '/cache';
    const missing = await verifyLockfile(full(), {
      cacheDir,
      organization: ORG,
      exists: present(allPaths(cacheDir)),
    });
    expect(missing.map((m) => m.key)).not.toContain('self');
  });

  it('reports every missing pin at once, not the first (the whole point of a pre-check)', async () => {
    const cacheDir = '/cache';
    const missing = await verifyLockfile(full(), {
      cacheDir,
      organization: ORG,
      exists: () => Promise.resolve(false),
    });

    expect(missing.map((pin) => `${pin.kind}:${pin.key}`)).toEqual([
      'repository:templates',
      'repository:common',
      'pipeline-artifact:upstream/drop',
      'task:replacetokens@6',
      'expansion:2a138e6a',
    ]);
    // Each names where it looked, so the user can see whether the cache dir itself is wrong.
    expect(missing.every((pin) => pin.expectedPath.startsWith(cacheDir))).toBe(true);
  });

  it('derives a github path from the url even without a type field', async () => {
    const lock: Lockfile = {
      version: 1,
      convertedAt: '',
      repositories: {
        common: {
          url: 'https://github.com/Contoso/CommonTools',
          ref: 'refs/heads/main',
          commit: OTHER,
        },
      },
    };
    const missing = await verifyLockfile(lock, {
      cacheDir: '/c',
      exists: () => Promise.resolve(false),
    });
    expect(missing[0]?.expectedPath).toBe(
      githubRepoCacheDir('/c', { owner: 'Contoso', repo: 'CommonTools' }, OTHER),
    );
  });

  it('still reports an unparseable ado url rather than skipping the pin', async () => {
    const lock: Lockfile = {
      version: 1,
      convertedAt: '',
      repositories: { odd: { url: 'https://example.invalid/weird', ref: 'r', commit: COMMIT } },
    };
    const missing = await verifyLockfile(lock, {
      cacheDir: '/c',
      organization: ORG,
      exists: () => Promise.resolve(false),
    });
    expect(missing).toHaveLength(1);
    expect(missing[0]?.kind).toBe('repository');
  });

  it('checks the real filesystem when no exists override is given', async () => {
    const cacheDir = await scratch();
    const lock: Lockfile = {
      version: 1,
      convertedAt: '',
      tasks: { 'replacetokens@6': { id: 'g', version: '6.3.1' } },
    };
    await expect(verifyLockfile(lock, { cacheDir })).resolves.toHaveLength(1);

    const dir = taskCacheDir(cacheDir, 'replacetokens', { major: 6, minor: 3, patch: 1 });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'task.json'), '{}', 'utf8');
    await expect(verifyLockfile(lock, { cacheDir })).resolves.toEqual([]);
  });

  it('tolerates a task pin whose version is not three parts', async () => {
    const lock: Lockfile = {
      version: 1,
      convertedAt: '',
      tasks: { bare: { id: 'g', version: '6' } },
    };
    const missing = await verifyLockfile(lock, {
      cacheDir: '/c',
      exists: () => Promise.resolve(false),
    });
    expect(missing[0]?.expectedPath).toBe(
      taskCacheDir('/c', 'bare', { major: 6, minor: 0, patch: 0 }),
    );
  });
});

describe('frozenFailureMessage', () => {
  it('lists every missing pin and says how to fix it', () => {
    const message = frozenFailureMessage([
      { kind: 'repository', key: 'templates', expectedPath: '/c/x' },
      { kind: 'task', key: 'replacetokens@6', expectedPath: '/c/y' },
    ]);
    expect(message).toContain('2 pinned items not in the cache');
    expect(message).toContain('repository templates');
    expect(message).toContain('task replacetokens@6');
    expect(message).toContain('without --frozen once');
  });

  it('gets the singular right for one missing pin', () => {
    expect(frozenFailureMessage([{ kind: 'expansion', key: 'h', expectedPath: '/c/z' }])).toContain(
      '1 pinned item not in the cache',
    );
  });
});

describe('the offline guarantee, proved rather than asserted', () => {
  it('verifies a warm cache with global fetch replaced by a throwing stub', async () => {
    // The Ground field asks for the offline guarantee to be *proven*. Swapping `globalThis.fetch`
    // for a function that throws means this test passes only if verification touched no network at
    // all — the same discipline the snapshot cache-hit tests use.
    const cacheDir = await scratch();
    const version = { major: 6, minor: 3, patch: 1 };
    const taskDir = taskCacheDir(cacheDir, 'replacetokens', version);
    const repoDir = repoCacheDir(cacheDir, { ...ORG, repository: 'pipeline-templates' }, COMMIT);
    const ghDir = githubRepoCacheDir(cacheDir, { owner: 'Contoso', repo: 'CommonTools' }, OTHER);
    const artDir = artifactCacheDir(cacheDir, 'upstream', 1234, 'drop');
    const expDir = join(cacheDir, '.cache/expansion', '2a138e6a');

    for (const [dir, file] of [
      [taskDir, 'task.json'],
      [repoDir, 'snapshot.json'],
      [ghDir, 'snapshot.json'],
      [expDir, 'final.yml'],
    ] as const) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, file), '{}', 'utf8');
    }
    await mkdir(artDir, { recursive: true });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('--frozen made a network request');
    }) as typeof globalThis.fetch;
    try {
      const path = join(cacheDir, LOCKFILE_NAME);
      await writeLockfile(path, full());
      const lock = (await readLockfile(path))!;
      await expect(verifyLockfile(lock, { cacheDir, organization: ORG })).resolves.toEqual([]);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
