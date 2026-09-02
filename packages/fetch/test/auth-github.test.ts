import { describe, expect, it } from 'vitest';
import {
  GITHUB_ACCEPT,
  GITHUB_API_VERSION,
  GitHubFetchError,
  contentsUrl,
  createGhCliTokenReader,
  readGhCliToken,
  fetchGitHubContents,
  fetchGitHubTarball,
  githubHeaders,
  resolveGitHubCredential,
  tarballUrl,
  type GhExec,
  type GhTokenReader,
  type GitHubFetch,
} from '../src/auth/github.js';

const GH_TOKEN = 'fake-gh-cli-token-for-tests';
const ENV_TOKEN = 'fake-env-token-for-tests';

const noGhToken: GhTokenReader = () => Promise.resolve(undefined);
const withGhToken =
  (token: string | undefined): GhTokenReader =>
  () =>
    Promise.resolve(token);

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

const headerOf = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string> | undefined)?.[name];

describe('resolveGitHubCredential', () => {
  it('prefers the gh CLI token over GITHUB_TOKEN (docs/05 §1 order, C-E09-012)', async () => {
    await expect(
      resolveGitHubCredential({ ghToken: withGhToken(GH_TOKEN), env: { GITHUB_TOKEN: ENV_TOKEN } }),
    ).resolves.toEqual({ source: 'gh-cli', token: GH_TOKEN });
  });

  it('falls back to GITHUB_TOKEN when gh yields no token', async () => {
    await expect(
      resolveGitHubCredential({ ghToken: noGhToken, env: { GITHUB_TOKEN: ENV_TOKEN } }),
    ).resolves.toEqual({ source: 'env', token: ENV_TOKEN });
  });

  it('falls back to anonymous rather than failing when no credential exists (C-E09-014)', async () => {
    await expect(resolveGitHubCredential({ ghToken: noGhToken, env: {} })).resolves.toEqual({
      source: 'anonymous',
    });
  });

  it('treats blank gh output and a blank GITHUB_TOKEN as absent (C-E09-012)', async () => {
    await expect(
      resolveGitHubCredential({ ghToken: withGhToken('   \n'), env: { GITHUB_TOKEN: '  ' } }),
    ).resolves.toEqual({ source: 'anonymous' });
  });

  it('passes the selected hostname to the gh reader (C-E09-012)', async () => {
    const seen: string[] = [];
    await resolveGitHubCredential({
      hostname: 'github.example.com',
      env: {},
      ghToken: (hostname) => {
        seen.push(hostname);
        return Promise.resolve(undefined);
      },
    });
    expect(seen).toEqual(['github.example.com']);
  });
});

describe('createGhCliTokenReader', () => {
  const argvOf = (): { seen: { file: string; args: readonly string[] }[]; exec: GhExec } => {
    const seen: { file: string; args: readonly string[] }[] = [];
    const exec: GhExec = (file, args, done) => {
      seen.push({ file, args });
      done(null, `${GH_TOKEN}\n`);
    };
    return { seen, exec };
  };

  it('invokes gh with an argv array and returns the trimmed token (C-E09-012)', async () => {
    const { seen, exec } = argvOf();
    await expect(createGhCliTokenReader(exec)('github.com')).resolves.toBe(GH_TOKEN);
    expect(seen).toEqual([{ file: 'gh', args: ['auth', 'token', '--hostname', 'github.com'] }]);
  });

  it('treats a failed gh — including a missing binary — as no credential (C-E09-012)', async () => {
    const enoent: GhExec = (_file, _args, done) => {
      done(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }), '');
    };
    await expect(createGhCliTokenReader(enoent)('github.com')).resolves.toBeUndefined();
  });

  it('treats empty stdout on a zero exit as no credential (C-E09-012)', async () => {
    const blank: GhExec = (_file, _args, done) => {
      done(null, '\n');
    };
    await expect(createGhCliTokenReader(blank)('github.com')).resolves.toBeUndefined();
  });
});

describe('readGhCliToken (real process)', () => {
  it('yields no credential for a host nobody is signed in to (C-E09-012)', async () => {
    // Portable in both directions: with `gh` installed this exits non-zero for an unknown host,
    // and without it the spawn fails with ENOENT. Both are "no credential", and neither reaches
    // a real account, so no token can enter the transcript.
    await expect(readGhCliToken('gh-auth-token-no-such-host.invalid')).resolves.toBeUndefined();
  });
});

describe('githubHeaders', () => {
  it('pins the accept and version headers and omits Authorization when anonymous (C-E09-013)', () => {
    expect(githubHeaders({ source: 'anonymous' })).toEqual({
      Accept: GITHUB_ACCEPT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    });
    expect(githubHeaders({ source: 'gh-cli', token: GH_TOKEN })).toEqual({
      Accept: GITHUB_ACCEPT,
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      Authorization: `Bearer ${GH_TOKEN}`,
    });
  });
});

describe('url builders', () => {
  it('encodes owner, repo, ref and each path segment', () => {
    expect(contentsUrl('octocat', 'Hello-World', 'README', 'master')).toBe(
      'https://api.github.com/repos/octocat/Hello-World/contents/README?ref=master',
    );
    expect(contentsUrl('o w', 'r/e', '/a b/c.yml', 'feature/x')).toBe(
      'https://api.github.com/repos/o%20w/r%2Fe/contents/a%20b/c.yml?ref=feature%2Fx',
    );
    expect(contentsUrl('octocat', 'Hello-World', 'README')).toBe(
      'https://api.github.com/repos/octocat/Hello-World/contents/README',
    );
    expect(tarballUrl('octocat', 'Hello-World', 'master')).toBe(
      'https://api.github.com/repos/octocat/Hello-World/tarball/master',
    );
  });
});

describe('fetchGitHubContents', () => {
  it('fetches a public path anonymously with manual redirect handling (C-E09-014/016)', async () => {
    const { calls, fetchImpl } = recorder([
      new Response(JSON.stringify({ type: 'file', size: 13 }), { status: 200 }),
    ]);
    const result = await fetchGitHubContents('octocat', 'Hello-World', 'README', 'master', {
      ghToken: noGhToken,
      env: {},
      fetchImpl,
    });

    expect(result.credentialSource).toBe('anonymous');
    expect(result.payload).toEqual({ type: 'file', size: 13 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      'https://api.github.com/repos/octocat/Hello-World/contents/README?ref=master',
    );
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBeUndefined();
  });

  it('sends the gh CLI token as a bearer for a private path (C-E09-013/016)', async () => {
    const { calls, fetchImpl } = recorder([
      new Response(JSON.stringify({ type: 'file', size: 75 }), { status: 200 }),
    ]);
    const result = await fetchGitHubContents('owner', 'private-repo', 'azure/tpl.yml', 'main', {
      ghToken: withGhToken(GH_TOKEN),
      env: {},
      fetchImpl,
    });

    expect(result.credentialSource).toBe('gh-cli');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe(`Bearer ${GH_TOKEN}`);
    expect(headerOf(calls[0]!.init, 'X-GitHub-Api-Version')).toBe(GITHUB_API_VERSION);
  });

  it('does not report an anonymous 404 as a missing repository (C-E09-014/016)', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    const error = await fetchGitHubContents('owner', 'private-repo', 'azure/tpl.yml', 'main', {
      ghToken: noGhToken,
      env: {},
      fetchImpl,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubFetchError);
    const failure = error as GitHubFetchError;
    expect(failure.status).toBe(404);
    expect(failure.credentialSource).toBe('anonymous');
    expect(failure.message).toContain('private and this request was unauthenticated');
  });

  it('keeps the token out of rejection messages (C-E09-012)', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 401 })]);
    const error = (await fetchGitHubContents('owner', 'repo', 'f.yml', 'main', {
      ghToken: withGhToken(GH_TOKEN),
      env: {},
      fetchImpl,
    }).catch((caught: unknown) => caught)) as GitHubFetchError;

    expect(error.status).toBe(401);
    expect(error.message).not.toContain(GH_TOKEN);
    expect(error.message).toContain('the gh-cli credential was rejected');
  });

  it('wraps a transport failure without leaking the token (C-E09-012)', async () => {
    const fetchImpl: GitHubFetch = () => Promise.reject(new Error('ECONNRESET'));
    const error = (await fetchGitHubContents('owner', 'repo', 'f.yml', 'main', {
      ghToken: withGhToken(GH_TOKEN),
      env: {},
      fetchImpl,
    }).catch((caught: unknown) => caught)) as GitHubFetchError;

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.status).toBeUndefined();
    expect(error.credentialSource).toBe('gh-cli');
    expect(error.message).toBe('GitHub contents request failed');
    expect(error.message).not.toContain(GH_TOKEN);
  });

  it('distinguishes an authenticated 404 from an anonymous one (C-E09-014)', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    const error = (await fetchGitHubContents('owner', 'repo', 'missing.yml', 'main', {
      ghToken: withGhToken(GH_TOKEN),
      env: {},
      fetchImpl,
    }).catch((caught: unknown) => caught)) as GitHubFetchError;

    expect(error.message).toContain('not visible to the gh-cli credential');
    expect(error.message).not.toContain('unauthenticated');
  });

  it('reports an unclassified status verbatim', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 500 })]);
    await expect(
      fetchGitHubContents('octocat', 'Hello-World', 'README', 'master', {
        ghToken: noGhToken,
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow('GitHub contents request returned HTTP 500');
  });

  it('reports a non-JSON body without swallowing the status', async () => {
    const { fetchImpl } = recorder([new Response('<html>', { status: 200 })]);
    await expect(
      fetchGitHubContents('octocat', 'Hello-World', 'README', 'master', {
        ghToken: noGhToken,
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow(/not JSON/);
  });
});

describe('fetchGitHubTarball', () => {
  it('never forwards the bearer token to the redirect target (C-E09-015)', async () => {
    const { calls, fetchImpl } = recorder([
      new Response('', {
        status: 302,
        headers: { location: 'https://codeload.example.invalid/archive/abc' },
      }),
      new Response('tar-bytes', { status: 200 }),
    ]);
    const result = await fetchGitHubTarball('owner', 'private-repo', 'main', {
      ghToken: withGhToken(GH_TOKEN),
      env: {},
      fetchImpl,
    });

    expect(result.status).toBe(302);
    expect(result.credentialSource).toBe('gh-cli');
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBe(`Bearer ${GH_TOKEN}`);

    expect(calls[1]?.url).toBe('https://codeload.example.invalid/archive/abc');
    expect(headerOf(calls[1]!.init, 'Authorization')).toBeUndefined();
    expect(Object.keys((calls[1]!.init.headers ?? {}) as Record<string, string>)).toEqual([]);
    await expect(result.body.text()).resolves.toBe('tar-bytes');
  });

  it('downloads a public archive anonymously (C-E09-016)', async () => {
    const { calls, fetchImpl } = recorder([
      new Response('', {
        status: 302,
        headers: { location: 'https://codeload.example.invalid/public/abc' },
      }),
      new Response('tar-bytes', { status: 200 }),
    ]);
    const result = await fetchGitHubTarball('octocat', 'Hello-World', 'master', {
      ghToken: noGhToken,
      env: {},
      fetchImpl,
    });

    expect(result.credentialSource).toBe('anonymous');
    expect(headerOf(calls[0]!.init, 'Authorization')).toBeUndefined();
  });

  it('rejects a redirect without a Location header', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 302 })]);
    await expect(
      fetchGitHubTarball('octocat', 'Hello-World', 'master', {
        ghToken: noGhToken,
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow(/without a Location header/);
  });

  it('rejects a non-redirect status from the API origin (C-E09-015)', async () => {
    const { fetchImpl } = recorder([new Response('', { status: 404 })]);
    const error = (await fetchGitHubTarball('owner', 'private-repo', 'main', {
      ghToken: noGhToken,
      env: {},
      fetchImpl,
    }).catch((caught: unknown) => caught)) as GitHubFetchError;

    expect(error.status).toBe(404);
    expect(error.message).toContain('private and this request was unauthenticated');
  });

  it('wraps a transport failure at the API origin', async () => {
    const fetchImpl: GitHubFetch = () => Promise.reject(new Error('ECONNRESET'));
    await expect(
      fetchGitHubTarball('octocat', 'Hello-World', 'master', {
        ghToken: noGhToken,
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow('GitHub tarball request failed');
  });

  it('wraps a transport failure at the storage origin (C-E09-015)', async () => {
    let call = 0;
    const fetchImpl: GitHubFetch = () => {
      call += 1;
      return call === 1
        ? Promise.resolve(
            new Response('', {
              status: 302,
              headers: { location: 'https://codeload.example.invalid/gone' },
            }),
          )
        : Promise.reject(new Error('ETIMEDOUT'));
    };
    await expect(
      fetchGitHubTarball('owner', 'private-repo', 'main', {
        ghToken: withGhToken(GH_TOKEN),
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow('GitHub tarball storage request failed');
  });

  it('surfaces a failed storage fetch separately from the API call', async () => {
    const { fetchImpl } = recorder([
      new Response('', {
        status: 302,
        headers: { location: 'https://codeload.example.invalid/expired' },
      }),
      new Response('', { status: 403 }),
    ]);
    await expect(
      fetchGitHubTarball('owner', 'private-repo', 'main', {
        ghToken: withGhToken(GH_TOKEN),
        env: {},
        fetchImpl,
      }),
    ).rejects.toThrow(/storage request returned HTTP 403/);
  });
});
