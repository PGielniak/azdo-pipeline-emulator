import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AdoGitError,
  GIT_API_VERSION,
  extraHeaderValue,
  itemsZipUrl,
  parseGitVersion,
  readCachedSnapshot,
  readGitVersion,
  refFilterFor,
  runGit,
  refsUrl,
  repoCacheDir,
  resolveAdoRef,
  snapshotAdoRepo,
  supportsConfigEnv,
  type AdoRepoCoordinates,
  type GitRunner,
  type RepoFetch,
  type ResolvedRef,
} from '../src/repo/ado-git.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';

const COORDS: AdoRepoCoordinates = {
  orgUrl: 'https://dev.azure.com/example-org',
  project: 'Example Project',
  repository: 'templates',
};

const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: COORDS.orgUrl,
  mode: 'pat',
  token: 'fake-pat-for-repo-tests',
};
const BEARER: StoredAzureCredential = { ...PAT, mode: 'az', token: 'fake-access-token' };

const COMMIT = 'fa03743821b7e01caa17f4387b30338c43fac4df';
const TAG_OBJECT = '53b81d2d2211a0e90d06c1e1e23643f945dc8841';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-repo-'));
  tempDirs.push(directory);
  return directory;
}

const refsResponse = (values: unknown[]): Response =>
  new Response(JSON.stringify({ value: values, count: values.length }), { status: 200 });

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function recorder(responses: Response[]): { calls: Call[]; fetchImpl: RepoFetch } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: RepoFetch = (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return Promise.resolve(next);
  };
  return { calls, fetchImpl };
}

/** Any use of this proves the code path reached the network or a subprocess. */
const forbiddenFetch: RepoFetch = (url) => {
  throw new Error(`offline path made a request to ${url}`);
};
const forbiddenGit: GitRunner = (args) => {
  throw new Error(`offline path spawned git ${args.join(' ')}`);
};

describe('refsUrl (C-E09-030/031)', () => {
  it('strips the refs/ prefix into the filter and asks for peeled tags', () => {
    const url = new URL(refsUrl(COORDS, 'refs/heads/main'));
    expect(url.pathname).toBe(
      '/example-org/Example%20Project/_apis/git/repositories/templates/refs',
    );
    expect(url.searchParams.get('filter')).toBe('heads/main');
    expect(url.searchParams.get('peelTags')).toBe('true');
    expect(url.searchParams.get('api-version')).toBe(GIT_API_VERSION);
  });

  it('accepts a filter that is already prefix-free', () => {
    expect(refFilterFor('heads/main')).toBe('heads/main');
    expect(refFilterFor('refs/tags/v1')).toBe('tags/v1');
  });
});

describe('itemsZipUrl (C-E09-033/034)', () => {
  it('pins api-version alongside $format and asks for a full recursion', () => {
    const url = new URL(itemsZipUrl(COORDS, COMMIT, 'commit'));
    expect(url.searchParams.get('$format')).toBe('zip');
    // C-E09-033: "If $format is specified, then api-version should also be specified as a query parameter."
    expect(url.searchParams.get('api-version')).toBe(GIT_API_VERSION);
    expect(url.searchParams.get('recursionLevel')).toBe('full');
    expect(url.searchParams.get('versionDescriptor.version')).toBe(COMMIT);
    expect(url.searchParams.get('versionDescriptor.versionType')).toBe('commit');
    // C-E09-037: `scopePath`, not `path` — the service rejects `path` + a recursionLevel.
    expect(url.searchParams.get('scopePath')).toBe('/');
    expect(url.searchParams.get('path')).toBeNull();
  });
});

describe('resolveAdoRef', () => {
  it('takes the exact ref, not the first prefix match (C-E09-030)', async () => {
    const { fetchImpl } = recorder([
      refsResponse([
        { name: 'refs/heads/main-2', objectId: 'a'.repeat(40) },
        { name: 'refs/heads/mainline', objectId: 'b'.repeat(40) },
        { name: 'refs/heads/main', objectId: COMMIT },
      ]),
    ]);
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl }),
    ).resolves.toEqual({ ref: 'refs/heads/main', commit: COMMIT });
  });

  it('fails when only prefix matches come back, and says so (C-E09-030)', async () => {
    const { fetchImpl } = recorder([
      refsResponse([{ name: 'refs/heads/main-2', objectId: 'a'.repeat(40) }]),
    ]);
    const error = (await resolveAdoRef(COORDS, 'refs/heads/main', {
      credential: PAT,
      fetchImpl,
    }).catch((caught: unknown) => caught)) as AdoGitError;

    expect(error).toBeInstanceOf(AdoGitError);
    expect(error.message).toContain('1 prefix match(es), none exact');
  });

  it('distinguishes an empty result from a near miss', async () => {
    const { fetchImpl } = recorder([refsResponse([])]);
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/nope', { credential: PAT, fetchImpl }),
    ).rejects.toThrow('no refs matched');
  });

  it('prefers peeledObjectId for an annotated tag (C-E09-031/032)', async () => {
    const { fetchImpl } = recorder([
      refsResponse([{ name: 'refs/tags/v1', objectId: TAG_OBJECT, peeledObjectId: COMMIT }]),
    ]);
    // The commit — never the tag object — is what docs/05 §4 pins into the lockfile.
    await expect(
      resolveAdoRef(COORDS, 'refs/tags/v1', { credential: PAT, fetchImpl }),
    ).resolves.toEqual({ ref: 'refs/tags/v1', commit: COMMIT, tagObject: TAG_OBJECT });
  });

  it('takes objectId directly for a lightweight tag (C-E09-032)', async () => {
    const { fetchImpl } = recorder([refsResponse([{ name: 'refs/tags/v2', objectId: COMMIT }])]);
    await expect(
      resolveAdoRef(COORDS, 'refs/tags/v2', { credential: PAT, fetchImpl }),
    ).resolves.toEqual({ ref: 'refs/tags/v2', commit: COMMIT });
  });

  it('normalizes a ref given without its refs/ prefix', async () => {
    const { fetchImpl } = recorder([refsResponse([{ name: 'refs/heads/main', objectId: COMMIT }])]);
    await expect(
      resolveAdoRef(COORDS, 'heads/main', { credential: PAT, fetchImpl }),
    ).resolves.toMatchObject({ ref: 'refs/heads/main' });
  });

  it('sends Basic for a PAT and Bearer for an access token', async () => {
    const pat = recorder([refsResponse([{ name: 'refs/heads/main', objectId: COMMIT }])]);
    await resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl: pat.fetchImpl });
    const patHeader = (pat.calls[0]?.init.headers as Record<string, string>).Authorization ?? '';
    expect(patHeader.startsWith('Basic ')).toBe(true);

    const az = recorder([refsResponse([{ name: 'refs/heads/main', objectId: COMMIT }])]);
    await resolveAdoRef(COORDS, 'refs/heads/main', { credential: BEARER, fetchImpl: az.fetchImpl });
    expect((az.calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fake-access-token',
    );
  });

  it('reports HTTP and transport failures without leaking the credential', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 401 })]);
    const http = (await resolveAdoRef(COORDS, 'refs/heads/main', {
      credential: PAT,
      fetchImpl,
    }).catch((caught: unknown) => caught)) as AdoGitError;
    expect(http.status).toBe(401);
    expect(http.message).not.toContain(PAT.token);

    const boom: RepoFetch = () => Promise.reject(new Error('ECONNRESET'));
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl: boom }),
    ).rejects.toThrow('ref resolution for refs/heads/main failed');
  });

  it('rejects a non-JSON body and ignores malformed ref rows', async () => {
    const bad = recorder([new Response('<html>', { status: 200 })]);
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl: bad.fetchImpl }),
    ).rejects.toThrow('invalid JSON');

    const junk = recorder([
      new Response(JSON.stringify({ value: [null, 42, { name: 'refs/heads/main' }] }), {
        status: 200,
      }),
    ]);
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl: junk.fetchImpl }),
    ).rejects.toThrow('no refs matched');

    const notObject = recorder([new Response(JSON.stringify([1, 2]), { status: 200 })]);
    await expect(
      resolveAdoRef(COORDS, 'refs/heads/main', { credential: PAT, fetchImpl: notObject.fetchImpl }),
    ).rejects.toThrow('no refs matched');
  });
});

describe('git version gate (C-E09-035)', () => {
  it('parses a git version banner and rejects noise', () => {
    expect(parseGitVersion('git version 2.43.0\n')).toEqual({ major: 2, minor: 43 });
    expect(parseGitVersion('git version 2.31.1')).toEqual({ major: 2, minor: 31 });
    expect(parseGitVersion('not git')).toBeUndefined();
  });

  it('requires 2.31 or newer, the version that added --config-env', () => {
    expect(supportsConfigEnv({ major: 2, minor: 31 })).toBe(true);
    expect(supportsConfigEnv({ major: 2, minor: 43 })).toBe(true);
    expect(supportsConfigEnv({ major: 3, minor: 0 })).toBe(true);
    expect(supportsConfigEnv({ major: 2, minor: 30 })).toBe(false);
    expect(supportsConfigEnv({ major: 1, minor: 99 })).toBe(false);
    expect(supportsConfigEnv(undefined)).toBe(false);
  });

  it('reads the version through the runner and treats a failed spawn as unknown', async () => {
    const ok: GitRunner = () =>
      Promise.resolve({ code: 0, stdout: 'git version 2.40.1', stderr: '' });
    await expect(readGitVersion(ok)).resolves.toEqual({ major: 2, minor: 40 });

    const missing: GitRunner = () =>
      Promise.resolve({ code: 127, stdout: '', stderr: 'not found' });
    await expect(readGitVersion(missing)).resolves.toBeUndefined();
  });
});

describe('runGit (real process)', () => {
  it('reports stdout and a zero status for a harmless command', async () => {
    // `git --version` carries no credential and needs no repository, so this exercises the real
    // spawn wrapper without putting anything sensitive into a test.
    const { code, stdout } = await runGit(['--version'], {});
    expect(code).toBe(0);
    expect(parseGitVersion(stdout)).toMatchObject({ major: expect.any(Number) });
  });

  it('reports a non-zero status rather than throwing', async () => {
    const { code } = await runGit(['no-such-subcommand-for-this-test'], {});
    expect(code).not.toBe(0);
  });
});

describe('extraHeaderValue (C-E09-035)', () => {
  it('matches the agent GenerateAuthHeader shapes', () => {
    expect(extraHeaderValue(BEARER)).toBe('AUTHORIZATION: bearer fake-access-token');
    const basic = extraHeaderValue(PAT);
    expect(basic.startsWith('AUTHORIZATION: basic ')).toBe(true);
    // Basic is base64 of ":<pat>" — an empty username, as the PAT convention requires.
    const encoded = basic.slice('AUTHORIZATION: basic '.length);
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe(`:${PAT.token}`);
  });
});

describe('repoCacheDir (docs/05 §4)', () => {
  it('lays the entry out by host, org, project, repo and sha', () => {
    expect(repoCacheDir('/out', COORDS, COMMIT)).toBe(
      join(
        '/out',
        '.cache/repos',
        'dev.azure.com',
        'example-org',
        'Example Project',
        'templates',
        COMMIT,
      ),
    );
  });

  it('keeps two hosts apart', () => {
    const legacy = { ...COORDS, orgUrl: 'https://example-org.visualstudio.com' };
    expect(repoCacheDir('/out', legacy, COMMIT)).not.toBe(repoCacheDir('/out', COORDS, COMMIT));
  });
});

describe('snapshotAdoRepo', () => {
  const resolved: ResolvedRef = { ref: 'refs/heads/main', commit: COMMIT };

  it('clones a bare mirror with the header in the environment, never in argv (C-E09-035)', async () => {
    const cacheDir = await scratch();
    const seen: { args: readonly string[]; env: Readonly<Record<string, string>> }[] = [];
    const gitRunner: GitRunner = (args, env) => {
      seen.push({ args, env });
      return Promise.resolve({ code: 0, stdout: '', stderr: '' });
    };

    const snapshot = await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitRunner,
      gitVersion: { major: 2, minor: 43 },
      fetchImpl: forbiddenFetch,
    });

    expect(snapshot.method).toBe('bare-mirror');
    expect(snapshot.fetched).toBe(true);

    const call = seen[0]!;
    const argv = call.args.join(' ');
    // The three leak channels, asserted one by one.
    expect(argv).toContain('--config-env=http.extraheader=AZDO_EMU_GIT_EXTRAHEADER');
    expect(argv).not.toContain('AUTHORIZATION');
    expect(argv).not.toContain(PAT.token);
    expect(argv).not.toMatch(/@dev\.azure\.com/);
    expect(call.env.AZDO_EMU_GIT_EXTRAHEADER).toBe(extraHeaderValue(PAT));
  });

  it('falls back to the zip route rather than degrading to -c on old git (C-E09-035)', async () => {
    const cacheDir = await scratch();
    const { calls, fetchImpl } = recorder([
      new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 }),
    ]);

    const snapshot = await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitVersion: { major: 2, minor: 30 },
      gitRunner: forbiddenGit,
      fetchImpl,
    });

    expect(snapshot.method).toBe('items-zip');
    expect(new URL(calls[0]!.url).searchParams.get('$format')).toBe('zip');
    // Pinned by SHA, so a push between resolve and download cannot change what lands in cache.
    expect(new URL(calls[0]!.url).searchParams.get('versionDescriptor.versionType')).toBe('commit');
    await expect(stat(join(snapshot.dir, 'snapshot.zip'))).resolves.toBeTruthy();
  });

  it('returns a complete entry without any network or subprocess call (cache hit, offline)', async () => {
    const cacheDir = await scratch();
    const gitRunner: GitRunner = () => Promise.resolve({ code: 0, stdout: '', stderr: '' });
    const first = await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitRunner,
      gitVersion: { major: 2, minor: 43 },
    });
    expect(first.fetched).toBe(true);

    // Both impls throw on use, so a second fetch of any kind fails the test rather than passing it.
    const second = await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitRunner: forbiddenGit,
      fetchImpl: forbiddenFetch,
      gitVersion: { major: 2, minor: 43 },
    });
    expect(second).toEqual({ ...first, fetched: false });
  });

  it('records which method filled the entry, so --frozen does not assume a mirror', async () => {
    const cacheDir = await scratch();
    const { fetchImpl } = recorder([new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 })]);
    const snapshot = await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      method: 'items-zip',
      fetchImpl,
    });

    const marker = JSON.parse(
      await readFile(join(snapshot.dir, 'snapshot.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(marker).toMatchObject({
      version: 1,
      method: 'items-zip',
      ref: resolved.ref,
      commit: COMMIT,
    });
    expect(typeof marker.storedAt).toBe('string');
  });

  it('keys the entry by commit, so a second commit is a miss', async () => {
    const cacheDir = await scratch();
    const gitRunner: GitRunner = () => Promise.resolve({ code: 0, stdout: '', stderr: '' });
    await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitRunner,
      gitVersion: { major: 2, minor: 43 },
    });
    const other = await snapshotAdoRepo(
      COORDS,
      { ref: 'refs/heads/main', commit: 'c'.repeat(40) },
      { credential: PAT, cacheDir, gitRunner, gitVersion: { major: 2, minor: 43 } },
    );
    expect(other.fetched).toBe(true);
    expect(other.dir).not.toBe(repoCacheDir(cacheDir, COORDS, COMMIT));
  });

  it('leaves no half-filled entry behind when the clone fails', async () => {
    const cacheDir = await scratch();
    const failing: GitRunner = () =>
      Promise.resolve({ code: 128, stdout: '', stderr: 'fatal: repository not found' });

    await expect(
      snapshotAdoRepo(COORDS, resolved, {
        credential: PAT,
        cacheDir,
        gitRunner: failing,
        gitVersion: { major: 2, minor: 43 },
      }),
    ).rejects.toThrow('exited 128');

    await expect(stat(repoCacheDir(cacheDir, COORDS, COMMIT))).rejects.toThrow();
  });

  it('cleans up and reports when the zip download fails', async () => {
    const cacheDir = await scratch();
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    await expect(
      snapshotAdoRepo(COORDS, resolved, {
        credential: PAT,
        cacheDir,
        method: 'items-zip',
        fetchImpl,
      }),
    ).rejects.toThrow('returned HTTP 404');

    const boom: RepoFetch = () => Promise.reject(new Error('ETIMEDOUT'));
    await expect(
      snapshotAdoRepo(COORDS, resolved, {
        credential: PAT,
        cacheDir,
        method: 'items-zip',
        fetchImpl: boom,
      }),
    ).rejects.toThrow('snapshot download of templates failed');
  });
});

describe('readCachedSnapshot (the --frozen entry point)', () => {
  const resolved: ResolvedRef = { ref: 'refs/heads/main', commit: COMMIT };

  it('returns the entry offline and undefined for an unknown commit', async () => {
    const cacheDir = await scratch();
    const gitRunner: GitRunner = () => Promise.resolve({ code: 0, stdout: '', stderr: '' });
    await snapshotAdoRepo(COORDS, resolved, {
      credential: PAT,
      cacheDir,
      gitRunner,
      gitVersion: { major: 2, minor: 43 },
    });

    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toMatchObject({
      method: 'bare-mirror',
      commit: COMMIT,
      ref: 'refs/heads/main',
      fetched: false,
    });
    await expect(readCachedSnapshot(cacheDir, COORDS, 'd'.repeat(40))).resolves.toBeUndefined();
  });

  it('treats a missing, unparseable or wrong-version marker as a miss', async () => {
    const cacheDir = await scratch();
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    const { writeFile: write, mkdir: makeDir } = await import('node:fs/promises');
    const dir = repoCacheDir(cacheDir, COORDS, COMMIT);
    await makeDir(dir, { recursive: true });

    await write(join(dir, 'snapshot.json'), 'not json', 'utf8');
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    await write(join(dir, 'snapshot.json'), JSON.stringify([1]), 'utf8');
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    await write(join(dir, 'snapshot.json'), JSON.stringify({ version: 2 }), 'utf8');
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    await write(
      join(dir, 'snapshot.json'),
      JSON.stringify({ version: 1, method: 'rsync', ref: 'r', commit: COMMIT, storedAt: 's' }),
      'utf8',
    );
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    await write(
      join(dir, 'snapshot.json'),
      JSON.stringify({ version: 1, method: 'items-zip', ref: 'r', commit: 7, storedAt: 's' }),
      'utf8',
    );
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    await write(
      join(dir, 'snapshot.json'),
      JSON.stringify({ version: 1, method: 'items-zip', ref: 'r', commit: COMMIT, storedAt: 1 }),
      'utf8',
    );
    await expect(readCachedSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();
  });
});
