import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  GitHubRepoError,
  commitRefFor,
  commitUrl,
  githubRepoCacheDir,
  readCachedGitHubSnapshot,
  resolveGitHubRef,
  snapshotGitHubRepo,
  type GitHubRepoCoordinates,
  type ResolvedGitHubRef,
} from '../src/repo/github.js';
import { GITHUB_API_VERSION, type GitHubFetch } from '../src/auth/github.js';

const COORDS: GitHubRepoCoordinates = { owner: 'octocat', repo: 'Hello-World' };
const COMMIT = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d';
const TOKEN = 'fake-gh-token-for-repo-tests';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-gh-repo-'));
  tempDirs.push(directory);
  return directory;
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function recorder(responses: Response[]): { calls: Call[]; fetchImpl: GitHubFetch } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: GitHubFetch = (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected request to ${url}`);
    return Promise.resolve(next);
  };
  return { calls, fetchImpl };
}

/** Any use of this proves the path reached the network. */
const forbiddenFetch: GitHubFetch = (url) => {
  throw new Error(`offline path made a request to ${url}`);
};

const anonymous = { credential: { source: 'anonymous' } } as const;
const authenticated = { credential: { source: 'gh-cli', token: TOKEN } } as const;

describe('commitRefFor (C-E09-040)', () => {
  it('promotes a namespaced shorthand to the full refs/ form', () => {
    // The docs name `tags/TAG_NAME`, but that exact form is the one the service answers 422 to.
    expect(commitRefFor('tags/v1.0.0')).toBe('refs/tags/v1.0.0');
    expect(commitRefFor('heads/main')).toBe('refs/heads/main');
  });

  it('leaves a full ref and a bare name alone', () => {
    expect(commitRefFor('refs/tags/v1.0.0')).toBe('refs/tags/v1.0.0');
    expect(commitRefFor(COMMIT)).toBe(COMMIT);
    expect(commitRefFor('main')).toBe('main');
  });
});

describe('commitUrl', () => {
  it('builds the Get-a-commit route with each ref segment encoded', () => {
    expect(commitUrl(COORDS, 'refs/heads/main')).toBe(
      'https://api.github.com/repos/octocat/Hello-World/commits/refs/heads/main',
    );
    expect(commitUrl(COORDS, 'tags/v1.0.0')).toBe(
      'https://api.github.com/repos/octocat/Hello-World/commits/refs/tags/v1.0.0',
    );
    expect(commitUrl({ owner: 'o w', repo: 'r p' }, 'feature/a b')).toBe(
      'https://api.github.com/repos/o%20w/r%20p/commits/feature/a%20b',
    );
  });
});

describe('resolveGitHubRef', () => {
  it('returns the commit sha and normalizes the ref (C-E09-039)', async () => {
    const { calls, fetchImpl } = recorder([
      new Response(JSON.stringify({ sha: COMMIT, commit: { message: 'first' } }), { status: 200 }),
    ]);
    await expect(
      resolveGitHubRef(COORDS, 'heads/main', { ...anonymous, fetchImpl }),
    ).resolves.toEqual({ ref: 'refs/heads/main', commit: COMMIT });
    expect(calls[0]?.url).toContain('/commits/refs/heads/main');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect((calls[0]?.init.headers as Record<string, string>)['X-GitHub-Api-Version']).toBe(
      GITHUB_API_VERSION,
    );
  });

  it('takes an annotated tag sha as given — GitHub already peeled it (C-E09-041)', async () => {
    // The Git-refs endpoint would report the tag object here; the commits endpoint reports the
    // commit, which is why this fetcher has no peeling step where ado-git.ts needs one.
    const { fetchImpl } = recorder([
      new Response(JSON.stringify({ sha: COMMIT }), { status: 200 }),
    ]);
    await expect(
      resolveGitHubRef(COORDS, 'refs/tags/v2.43.0', { ...anonymous, fetchImpl }),
    ).resolves.toEqual({ ref: 'refs/tags/v2.43.0', commit: COMMIT });
  });

  it('sends the bearer token when the chain produced one', async () => {
    const { calls, fetchImpl } = recorder([
      new Response(JSON.stringify({ sha: COMMIT }), { status: 200 }),
    ]);
    await resolveGitHubRef(COORDS, 'refs/heads/main', { ...authenticated, fetchImpl });
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
  });

  it('reads an anonymous 404 as "not found, or private" (C-E09-014)', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    const error = (await resolveGitHubRef(COORDS, 'refs/heads/main', {
      ...anonymous,
      fetchImpl,
    }).catch((caught: unknown) => caught)) as GitHubRepoError;

    expect(error).toBeInstanceOf(GitHubRepoError);
    expect(error.status).toBe(404);
    expect(error.message).toContain('private and this request was unauthenticated');
  });

  it('does not add that hint to an authenticated 404', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    await expect(
      resolveGitHubRef(COORDS, 'refs/heads/main', { ...authenticated, fetchImpl }),
    ).rejects.toThrow(/returned HTTP 404$/);
  });

  it('rejects a 422, a non-JSON body and a sha-less payload without leaking the token', async () => {
    // 422 is what the documented `tags/…` shorthand returns; the message must stay useful.
    const unprocessable = recorder([new Response('', { status: 422 })]);
    await expect(
      resolveGitHubRef(COORDS, 'refs/tags/v1', {
        ...authenticated,
        fetchImpl: unprocessable.fetchImpl,
      }),
    ).rejects.toThrow('returned HTTP 422');

    const notJson = recorder([new Response('<html>', { status: 200 })]);
    await expect(
      resolveGitHubRef(COORDS, 'refs/heads/main', { ...anonymous, fetchImpl: notJson.fetchImpl }),
    ).rejects.toThrow('invalid JSON');

    for (const body of [JSON.stringify({}), JSON.stringify({ sha: '' }), JSON.stringify([1])]) {
      const shaless = recorder([new Response(body, { status: 200 })]);
      await expect(
        resolveGitHubRef(COORDS, 'refs/heads/main', { ...anonymous, fetchImpl: shaless.fetchImpl }),
      ).rejects.toThrow('returned no commit sha');
    }

    const boom: GitHubFetch = () => Promise.reject(new Error('ECONNRESET'));
    const failure = (await resolveGitHubRef(COORDS, 'refs/heads/main', {
      ...authenticated,
      fetchImpl: boom,
    }).catch((caught: unknown) => caught)) as GitHubRepoError;
    expect(failure.message).toBe('ref resolution for refs/heads/main failed');
    expect(failure.message).not.toContain(TOKEN);
  });
});

describe('githubRepoCacheDir (docs/05 §4)', () => {
  it('lays the entry out under the github.com host', () => {
    expect(githubRepoCacheDir('/out', COORDS, COMMIT)).toBe(
      join('/out', '.cache/repos', 'github.com', 'octocat', 'octocat', 'Hello-World', COMMIT),
    );
  });

  it('keeps two owners and two commits apart', () => {
    expect(githubRepoCacheDir('/out', { owner: 'other', repo: 'Hello-World' }, COMMIT)).not.toBe(
      githubRepoCacheDir('/out', COORDS, COMMIT),
    );
    expect(githubRepoCacheDir('/out', COORDS, 'a'.repeat(40))).not.toBe(
      githubRepoCacheDir('/out', COORDS, COMMIT),
    );
  });
});

describe('snapshotGitHubRepo', () => {
  const resolved: ResolvedGitHubRef = { ref: 'refs/heads/main', commit: COMMIT };

  const tarballPair = (): Response[] => [
    new Response('', {
      status: 302,
      headers: { location: 'https://codeload.example.invalid/archive/abc' },
    }),
    new Response('tar-bytes', { status: 200 }),
  ];

  it('downloads pinned by SHA and never sends the token to the storage origin (C-E09-042/015)', async () => {
    const cacheDir = await scratch();
    const { calls, fetchImpl } = recorder(tarballPair());

    const snapshot = await snapshotGitHubRepo(COORDS, resolved, {
      ...authenticated,
      cacheDir,
      fetchImpl,
    });

    expect(snapshot.fetched).toBe(true);
    expect(snapshot.method).toBe('tarball');
    // Pinned by SHA, so a push between resolve and download cannot change what lands in cache.
    expect(calls[0]?.url).toBe(
      `https://api.github.com/repos/octocat/Hello-World/tarball/${COMMIT}`,
    );
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );
    expect((calls[1]?.init.headers as Record<string, string>).Authorization).toBeUndefined();
    await expect(readFile(join(snapshot.dir, 'snapshot.tar.gz'), 'utf8')).resolves.toBe(
      'tar-bytes',
    );
  });

  it('returns a complete entry with no network call at all (cache hit, offline)', async () => {
    const cacheDir = await scratch();
    const first = await snapshotGitHubRepo(COORDS, resolved, {
      ...anonymous,
      cacheDir,
      fetchImpl: recorder(tarballPair()).fetchImpl,
    });
    expect(first.fetched).toBe(true);

    // A fetch impl that throws on any use: this passes only if nothing was requested.
    const second = await snapshotGitHubRepo(COORDS, resolved, {
      ...anonymous,
      cacheDir,
      fetchImpl: forbiddenFetch,
    });
    expect(second).toEqual({ ...first, fetched: false });
  });

  it('writes a marker naming the method and the ref it came from', async () => {
    const cacheDir = await scratch();
    const snapshot = await snapshotGitHubRepo(COORDS, resolved, {
      ...anonymous,
      cacheDir,
      fetchImpl: recorder(tarballPair()).fetchImpl,
    });
    const marker = JSON.parse(
      await readFile(join(snapshot.dir, 'snapshot.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(marker).toMatchObject({
      version: 1,
      method: 'tarball',
      ref: 'refs/heads/main',
      commit: COMMIT,
    });
    expect(typeof marker.storedAt).toBe('string');
  });

  it('treats a different commit as a miss', async () => {
    const cacheDir = await scratch();
    await snapshotGitHubRepo(COORDS, resolved, {
      ...anonymous,
      cacheDir,
      fetchImpl: recorder(tarballPair()).fetchImpl,
    });
    const other = await snapshotGitHubRepo(
      COORDS,
      { ref: 'refs/heads/main', commit: 'b'.repeat(40) },
      { ...anonymous, cacheDir, fetchImpl: recorder(tarballPair()).fetchImpl },
    );
    expect(other.fetched).toBe(true);
  });

  it('leaves no half-filled entry behind when the download fails', async () => {
    const cacheDir = await scratch();
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    await expect(
      snapshotGitHubRepo(COORDS, resolved, { ...anonymous, cacheDir, fetchImpl }),
    ).rejects.toThrow(/HTTP 404/);

    await expect(stat(githubRepoCacheDir(cacheDir, COORDS, COMMIT))).rejects.toThrow();
  });
});

describe('readCachedGitHubSnapshot (the --frozen entry point)', () => {
  const resolved: ResolvedGitHubRef = { ref: 'refs/heads/main', commit: COMMIT };

  it('returns the entry offline and undefined for an unknown commit', async () => {
    const cacheDir = await scratch();
    await snapshotGitHubRepo(COORDS, resolved, {
      ...anonymous,
      cacheDir,
      fetchImpl: recorder([
        new Response('', { status: 302, headers: { location: 'https://x.invalid/a' } }),
        new Response('tar', { status: 200 }),
      ]).fetchImpl,
    });

    await expect(readCachedGitHubSnapshot(cacheDir, COORDS, COMMIT)).resolves.toMatchObject({
      method: 'tarball',
      commit: COMMIT,
      ref: 'refs/heads/main',
      fetched: false,
    });
    await expect(
      readCachedGitHubSnapshot(cacheDir, COORDS, 'c'.repeat(40)),
    ).resolves.toBeUndefined();
  });

  it('treats a missing or malformed marker as a miss', async () => {
    const cacheDir = await scratch();
    await expect(readCachedGitHubSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();

    const { mkdir: makeDir } = await import('node:fs/promises');
    const dir = githubRepoCacheDir(cacheDir, COORDS, COMMIT);
    await makeDir(dir, { recursive: true });

    for (const body of [
      'not json',
      JSON.stringify([1]),
      JSON.stringify({ version: 2, method: 'tarball', ref: 'r', commit: COMMIT, storedAt: 's' }),
      JSON.stringify({ version: 1, method: 'zip', ref: 'r', commit: COMMIT, storedAt: 's' }),
      JSON.stringify({ version: 1, method: 'tarball', ref: 'r', commit: 7, storedAt: 's' }),
      JSON.stringify({ version: 1, method: 'tarball', ref: 'r', commit: COMMIT, storedAt: 1 }),
    ]) {
      await writeFile(join(dir, 'snapshot.json'), body, 'utf8');
      await expect(readCachedGitHubSnapshot(cacheDir, COORDS, COMMIT)).resolves.toBeUndefined();
    }
  });
});
