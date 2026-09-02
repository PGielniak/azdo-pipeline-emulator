import { execFile } from 'node:child_process';

/**
 * GitHub authentication for `resources.repositories` with `type: github` and github templates.
 *
 * docs/05 §1 fixes the chain: reuse the `gh` CLI token, then `GITHUB_TOKEN`, then anonymous. Our own
 * OAuth device flow is deferred there until demand, so this module has three arms and no more. The
 * order is project policy, not GitHub API behavior — only the individual arms are grounded
 * (C-E09-012..016).
 */

export const GITHUB_API_ORIGIN = 'https://api.github.com';
export const GITHUB_HOSTNAME = 'github.com';

/** docs/05 §2: api-versions live in one module. C-E09-013 pins the value the docs currently show. */
export const GITHUB_API_VERSION = '2026-03-10';
export const GITHUB_ACCEPT = 'application/vnd.github+json';

export type GitHubCredentialSource = 'gh-cli' | 'env' | 'anonymous';

export type GitHubCredential =
  { readonly source: 'anonymous' } | { readonly source: 'gh-cli' | 'env'; readonly token: string };

export type GitHubFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Injected so the chain is testable without a `gh` binary or a real environment. */
export type GhTokenReader = (hostname: string) => Promise<string | undefined>;

export interface GitHubAuthOptions {
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly ghToken?: GhTokenReader;
  readonly hostname?: string;
}

export interface GitHubRequestOptions extends GitHubAuthOptions {
  readonly credential?: GitHubCredential;
  readonly fetchImpl?: GitHubFetch;
}

export class GitHubFetchError extends Error {
  readonly status: number | undefined;
  readonly credentialSource: GitHubCredentialSource;

  constructor(
    message: string,
    details: { status?: number; credentialSource: GitHubCredentialSource; cause?: unknown },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'GitHubFetchError';
    this.status = details.status;
    this.credentialSource = details.credentialSource;
  }
}

/**
 * C-E09-012: `gh auth token --hostname <host>` prints the active account's token to stdout and
 * fails when none is available. Status zero plus non-empty trimmed stdout is the credential;
 * every diagnostic is discarded so a secret can never travel through our own error text. A missing
 * `gh` binary is "no credential", not a failure of the chain.
 */
export type GhExec = (
  file: string,
  args: readonly string[],
  done: (error: unknown, stdout: string) => void,
) => void;

/** Argv array, never a shell string, so a hostname can never become shell syntax. */
export function createGhCliTokenReader(exec: GhExec): GhTokenReader {
  return (hostname) =>
    new Promise((resolve) => {
      exec('gh', ['auth', 'token', '--hostname', hostname], (error, stdout) => {
        if (error !== null && error !== undefined) {
          resolve(undefined);
          return;
        }
        const token = stdout.trim();
        resolve(token.length === 0 ? undefined : token);
      });
    });
}

export const readGhCliToken: GhTokenReader = createGhCliTokenReader((file, args, done) => {
  execFile(file, [...args], { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
    done(error, stdout);
  });
});

/** docs/05 §1 order, first hit wins; anonymous is always reachable and never an error. */
export async function resolveGitHubCredential(
  options: GitHubAuthOptions = {},
): Promise<GitHubCredential> {
  const hostname = options.hostname ?? GITHUB_HOSTNAME;
  const ghToken = (await (options.ghToken ?? readGhCliToken)(hostname))?.trim();
  if (ghToken !== undefined && ghToken.length > 0) return { source: 'gh-cli', token: ghToken };

  const env = options.env ?? process.env;
  const fromEnv = env.GITHUB_TOKEN?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return { source: 'env', token: fromEnv };

  return { source: 'anonymous' };
}

/** C-E09-013: bearer auth plus the explicit version header; anonymous simply omits the bearer. */
export function githubHeaders(credential: GitHubCredential): Record<string, string> {
  return {
    Accept: GITHUB_ACCEPT,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    ...(credential.source === 'anonymous' ? {} : { Authorization: `Bearer ${credential.token}` }),
  };
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function contentsUrl(owner: string, repo: string, path: string, ref?: string): string {
  const base =
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/contents/${encodePath(path)}`;
  return ref === undefined ? base : `${base}?ref=${encodeURIComponent(ref)}`;
}

export function tarballUrl(owner: string, repo: string, ref: string): string {
  return (
    `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/tarball/${encodeURIComponent(ref)}`
  );
}

/**
 * C-E09-014/016: an anonymous request for a private resource is answered **404**, not 403 — GitHub
 * hides existence from an unauthorized caller. Reporting that as "does not exist" would bake a
 * misleading error into the fetchers built on top of this (E09-S02-T02), so the anonymous 404 is
 * reported as "not found, or private and this request was unauthenticated".
 */
function describeFailure(status: number, source: GitHubCredentialSource, what: string): string {
  if (status === 404 && source === 'anonymous') {
    return `${what} returned HTTP 404: not found, or private and this request was unauthenticated`;
  }
  if (status === 404) {
    return `${what} returned HTTP 404: not found, or not visible to the ${source} credential`;
  }
  if (status === 401 || status === 403) {
    return `${what} returned HTTP ${status}: the ${source} credential was rejected`;
  }
  return `${what} returned HTTP ${status}`;
}

export interface GitHubContentsResult {
  readonly credentialSource: GitHubCredentialSource;
  readonly status: number;
  readonly payload: unknown;
}

/** Fetch one repository path through the resolved chain. */
export async function fetchGitHubContents(
  owner: string,
  repo: string,
  path: string,
  ref: string | undefined,
  options: GitHubRequestOptions = {},
): Promise<GitHubContentsResult> {
  const credential = options.credential ?? (await resolveGitHubCredential(options));
  const url = contentsUrl(owner, repo, path, ref);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      headers: githubHeaders(credential),
    });
  } catch (error) {
    throw new GitHubFetchError('GitHub contents request failed', {
      credentialSource: credential.source,
      cause: error,
    });
  }

  if (!response.ok) {
    throw new GitHubFetchError(
      describeFailure(response.status, credential.source, 'GitHub contents request'),
      { status: response.status, credentialSource: credential.source },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch (error) {
    throw new GitHubFetchError('GitHub contents response was not JSON', {
      status: response.status,
      credentialSource: credential.source,
      cause: error,
    });
  }
  return { credentialSource: credential.source, status: response.status, payload };
}

export interface GitHubTarballResult {
  readonly credentialSource: GitHubCredentialSource;
  /** 302 from the API origin; the archive bytes live behind `location`. */
  readonly status: number;
  readonly location: string;
  readonly body: Response;
}

/**
 * C-E09-015: the tarball endpoint answers with a redirect to storage, and a private repository's
 * redirect URL is temporary. The API origin is the only origin that ever sees the bearer token:
 * the redirect is taken manually and the storage request is made with no `Authorization` header, so
 * a GitHub credential is never forwarded cross-origin.
 */
export async function fetchGitHubTarball(
  owner: string,
  repo: string,
  ref: string,
  options: GitHubRequestOptions = {},
): Promise<GitHubTarballResult> {
  const credential = options.credential ?? (await resolveGitHubCredential(options));
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  let redirect: Response;
  try {
    redirect = await fetchImpl(tarballUrl(owner, repo, ref), {
      method: 'GET',
      redirect: 'manual',
      headers: githubHeaders(credential),
    });
  } catch (error) {
    throw new GitHubFetchError('GitHub tarball request failed', {
      credentialSource: credential.source,
      cause: error,
    });
  }

  if (redirect.status < 300 || redirect.status >= 400) {
    throw new GitHubFetchError(
      describeFailure(redirect.status, credential.source, 'GitHub tarball request'),
      { status: redirect.status, credentialSource: credential.source },
    );
  }

  const location = redirect.headers.get('location');
  if (location === null || location.length === 0) {
    throw new GitHubFetchError(
      `GitHub tarball request returned HTTP ${redirect.status} without a Location header`,
      { status: redirect.status, credentialSource: credential.source },
    );
  }

  let archive: Response;
  try {
    // Unauthenticated by construction: the storage URL carries its own signed grant.
    archive = await fetchImpl(location, { method: 'GET', redirect: 'follow', headers: {} });
  } catch (error) {
    throw new GitHubFetchError('GitHub tarball storage request failed', {
      credentialSource: credential.source,
      cause: error,
    });
  }
  if (!archive.ok) {
    throw new GitHubFetchError(`GitHub tarball storage request returned HTTP ${archive.status}`, {
      status: archive.status,
      credentialSource: credential.source,
    });
  }

  return {
    credentialSource: credential.source,
    status: redirect.status,
    location,
    body: archive,
  };
}
