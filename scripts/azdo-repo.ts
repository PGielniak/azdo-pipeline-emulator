// Minimal Azure Repos client for the corpus harness (E12-S01-T02).
//
// Why this exists: the preview endpoint expands `template:` references by reading them from the
// pipeline's **repository**, not from the request body (C-E12-011). A corpus entry that uses
// templates can therefore only be oracle-verified if its template files are present in the
// oracle project's repo — so the harness pushes them, then previews the root file.
//
// Scope is deliberately tiny (list repo, read tree, read blob, push) and lives in `scripts/`
// rather than `packages/fetch`: E08 owns the production REST layer with its own auth and cache
// design, and nothing here may prejudge it.
//
// Grounding: C-E12-012 (push body shape), C-E12-013 (branch tip via refs), C-E12-014 (item read).
import { authorizationHeader, type OracleConfig } from '../packages/fetch/src/oracle.ts';

const API_VERSION = '7.1';

export interface RepoRef {
  readonly id: string;
  readonly name: string;
  readonly defaultBranch: string;
}

/** One file to place in the repo, keyed by repo-absolute path (`/corpus/…`). */
export interface FileSpec {
  readonly path: string;
  readonly content: string;
}

async function call(
  config: OracleConfig,
  route: string,
  init: RequestInit = {},
): Promise<{ status: number; text: string }> {
  const org = config.orgUrl.replace(/\/+$/, '');
  const url = `${org}/${encodeURIComponent(config.project)}/_apis/${route}`;
  const response = await fetch(url, {
    ...init,
    redirect: 'manual', // an invalid PAT answers 302 to a sign-in page, not 401 (C-E00-025)
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(config.pat),
      ...(init.headers ?? {}),
    },
  });
  return { status: response.status, text: await response.text() };
}

function ok(what: string, res: { status: number; text: string }, config: OracleConfig): unknown {
  if (res.status < 200 || res.status >= 300) {
    // The body can embed the org (clone URLs) — never let it reach a log unredacted.
    const safe = res.text.split(config.pat).join('{pat}').slice(0, 400);
    throw new Error(`${what} failed: HTTP ${res.status} ${safe}`);
  }
  return JSON.parse(res.text) as unknown;
}

/** The project's repository whose name matches the project (the default Azure Repos repo). */
export async function defaultRepository(config: OracleConfig): Promise<RepoRef> {
  const body = ok(
    'list repositories',
    await call(config, `git/repositories?api-version=${API_VERSION}`),
    config,
  ) as { value?: { id: string; name: string; defaultBranch?: string }[] };
  const repos = body.value ?? [];
  const repo = repos.find((r) => r.name === config.project) ?? repos[0];
  if (repo === undefined) throw new Error(`project has no git repository`);
  return { id: repo.id, name: repo.name, defaultBranch: repo.defaultBranch ?? 'refs/heads/main' };
}

/** Tip commit of `refName` (`refs/heads/main`), or undefined when the ref does not exist. */
export async function branchTip(
  config: OracleConfig,
  repo: RepoRef,
  refName: string,
): Promise<string | undefined> {
  const filter = refName.replace(/^refs\//, '');
  const body = ok(
    'list refs',
    await call(
      config,
      `git/repositories/${repo.id}/refs?filter=${encodeURIComponent(filter)}&api-version=${API_VERSION}`,
    ),
    config,
  ) as { value?: { name: string; objectId: string }[] };
  return (body.value ?? []).find((r) => r.name === refName)?.objectId;
}

/**
 * Existing file contents under `scopePath`, keyed by repo-absolute path. Used to decide
 * add-vs-edit per file and to skip a push entirely when nothing changed (the harness is run
 * repeatedly; an unchanged run must not create commits).
 */
export async function readTree(
  config: OracleConfig,
  repo: RepoRef,
  scopePath: string,
  refName: string,
): Promise<Map<string, string>> {
  const version = refName.replace(/^refs\/heads\//, '');
  const query =
    `git/repositories/${repo.id}/items?scopePath=${encodeURIComponent(scopePath)}` +
    `&recursionLevel=full&versionDescriptor.version=${encodeURIComponent(version)}` +
    `&api-version=${API_VERSION}`;
  const res = await call(config, query);
  // A scopePath that does not exist yet is a 404 — that is "no files", not an error.
  if (res.status === 404) return new Map();
  const body = ok('list items', res, config) as {
    value?: { path: string; isFolder?: boolean }[];
  };

  const files = new Map<string, string>();
  for (const item of body.value ?? []) {
    if (item.isFolder === true) continue;
    const raw = await call(
      config,
      `git/repositories/${repo.id}/items?path=${encodeURIComponent(item.path)}` +
        `&includeContent=true&versionDescriptor.version=${encodeURIComponent(version)}` +
        `&$format=json&api-version=${API_VERSION}`,
    );
    const content = ok('read item', raw, config) as { content?: string };
    files.set(item.path, content.content ?? '');
  }
  return files;
}

/**
 * Push `files` to `refName` in one commit, adding or editing as needed and **deleting** any
 * file under `scopePath` that `files` no longer contains, so the repo mirrors the fixture
 * directory exactly. Returns undefined when the tree already matches (no commit created).
 */
export async function syncFiles(
  config: OracleConfig,
  repo: RepoRef,
  refName: string,
  scopePath: string,
  files: readonly FileSpec[],
  comment: string,
): Promise<string | undefined> {
  const existing = await readTree(config, repo, scopePath, refName);
  const wanted = new Map(files.map((f) => [f.path, f.content]));

  const changes: unknown[] = [];
  for (const [path, content] of wanted) {
    const before = existing.get(path);
    if (before === content) continue;
    changes.push({
      changeType: before === undefined ? 'add' : 'edit',
      item: { path },
      newContent: { content, contentType: 'rawtext' },
    });
  }
  for (const path of existing.keys()) {
    if (!wanted.has(path)) changes.push({ changeType: 'delete', item: { path } });
  }
  if (changes.length === 0) return undefined;

  const tip = await branchTip(config, repo, refName);
  if (tip === undefined) throw new Error(`ref ${refName} does not exist`);

  const body = ok(
    'push',
    await call(config, `git/repositories/${repo.id}/pushes?api-version=${API_VERSION}`, {
      method: 'POST',
      body: JSON.stringify({
        refUpdates: [{ name: refName, oldObjectId: tip }],
        commits: [{ comment, changes }],
      }),
    }),
    config,
  ) as { commits?: { commitId: string }[] };
  return body.commits?.[0]?.commitId;
}
