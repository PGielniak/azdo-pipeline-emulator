import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALIAS_ENDPOINT_SUBSTITUTED,
  ALIAS_FETCH_FAILED,
  ALIAS_LOCAL_OVERRIDE,
  ALIAS_UNKNOWN_TYPE,
  ALIAS_UNSUPPORTED_TYPE,
  DEFAULT_REPOSITORY_REF,
  adoCoordinatesFor,
  githubCoordinatesFor,
  normalizeRef,
  resolveRepositoryAliases,
  type AliasResolutionOptions,
} from '../src/repo/alias.js';
import type { RepoFetch } from '../src/repo/ado-git.js';
import type { GitHubFetch } from '../src/auth/github.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';
import { adoZip, githubTarball } from './helpers/archives.js';

const ORG = { orgUrl: 'https://dev.azure.com/example-org', project: 'Example' };
const CREDENTIAL: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG.orgUrl,
  mode: 'pat',
  token: 'fake-pat-for-alias-tests',
};
const COMMIT = 'fa03743821b7e01caa17f4387b30338c43fac4df';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-alias-'));
  tempDirs.push(directory);
  return directory;
}

async function baseOptions(
  extra: Partial<AliasResolutionOptions> = {},
): Promise<AliasResolutionOptions> {
  return {
    self: { path: '/work/app' },
    organization: ORG,
    cacheDir: await scratch(),
    ...extra,
  };
}

/** Answers the ADO ref lookup, then the zip download. */
function adoFetchStub(): RepoFetch {
  return (url) =>
    Promise.resolve(
      url.includes('/refs?')
        ? new Response(
            JSON.stringify({ value: [{ name: DEFAULT_REPOSITORY_REF, objectId: COMMIT }] }),
            { status: 200 },
          )
        : new Response(adoZip(), { status: 200 }),
    );
}

/** Answers the GitHub commit lookup, then the tarball redirect and its storage GET. */
function githubFetchStub(): GitHubFetch {
  return (url) => {
    if (url.includes('/commits/')) {
      return Promise.resolve(new Response(JSON.stringify({ sha: COMMIT }), { status: 200 }));
    }
    if (url.includes('/tarball/')) {
      return Promise.resolve(
        new Response('', { status: 302, headers: { location: 'https://codeload.invalid/a' } }),
      );
    }
    return Promise.resolve(
      new Response(githubTarball('Contoso-CommonTools-fa03743'), { status: 200 }),
    );
  };
}

const noteFor = (
  notes: readonly { code: string; alias: string; message: string }[],
  code: string,
): { code: string; alias: string; message: string } | undefined =>
  notes.find((note) => note.code === code);

describe('normalizeRef (C-E09-044/047)', () => {
  it('defaults to the literal refs/heads/main, not the repo default branch', () => {
    // The schema says "defaults to 'refs/heads/main'" — a constant. A repo whose default is
    // `master` still gets `main` here, and failing loudly beats silently using something else.
    expect(normalizeRef(undefined)).toBe('refs/heads/main');
    expect(normalizeRef('')).toBe('refs/heads/main');
    expect(normalizeRef('   ')).toBe('refs/heads/main');
  });

  it('promotes a bare name and a namespaced shorthand, as the schema example writes them', () => {
    expect(normalizeRef('main')).toBe('refs/heads/main');
    expect(normalizeRef('heads/dev')).toBe('refs/heads/dev');
    expect(normalizeRef('tags/v1')).toBe('refs/tags/v1');
    expect(normalizeRef('refs/heads/dev')).toBe('refs/heads/dev');
  });
});

describe('name parsing (C-E09-046)', () => {
  it('reads one slash as project/repo under git', () => {
    expect(adoCoordinatesFor('tools', ORG)).toEqual({ ...ORG, repository: 'tools' });
    expect(adoCoordinatesFor('ToolsProject/tools', ORG)).toEqual({
      orgUrl: ORG.orgUrl,
      project: 'ToolsProject',
      repository: 'tools',
    });
  });

  it('reads the same one slash as owner/repo under github', () => {
    // The identical text `A/b` means two different things; only `type` disambiguates it.
    expect(githubCoordinatesFor('Microsoft/vscode')).toEqual({
      owner: 'Microsoft',
      repo: 'vscode',
    });
    expect(githubCoordinatesFor('vscode')).toBeUndefined();
    expect(githubCoordinatesFor('a/b/c')).toBeUndefined();
  });
});

describe('resolveRepositoryAliases', () => {
  it('always answers self from the working copy, without fetching it (C-E03-197)', async () => {
    const result = await resolveRepositoryAliases([], await baseOptions());
    expect(result.repositories).toEqual([
      {
        alias: 'self',
        origin: 'self',
        url: 'file:///work/app',
        ref: DEFAULT_REPOSITORY_REF,
        commit: '0'.repeat(40),
        dir: '/work/app',
        treeDir: '/work/app',
        method: 'working-copy',
      },
    ]);
  });

  it('ignores an attempt to redeclare self', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'Self', type: 'git', name: 'other' }],
      await baseOptions(),
    );
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.origin).toBe('self');
  });

  it('resolves a type: git alias through the ADO fetcher', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'azdo-emu-templates' }],
      await baseOptions({ azureCredential: CREDENTIAL, adoFetch: adoFetchStub() }),
    );
    const repo = result.repositories.find((entry) => entry.alias === 'templates');
    expect(repo).toMatchObject({
      origin: 'ado',
      ref: DEFAULT_REPOSITORY_REF,
      commit: COMMIT,
      url: 'https://dev.azure.com/example-org/Example/_git/azdo-emu-templates',
    });
    expect(result.unresolved).toEqual([]);
  });

  it('resolves a type: github alias through the GitHub fetcher', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'common', type: 'github', name: 'Contoso/CommonTools', ref: 'main' }],
      await baseOptions({ githubFetch: githubFetchStub() }),
    );
    expect(result.repositories.find((entry) => entry.alias === 'common')).toMatchObject({
      origin: 'github',
      url: 'https://github.com/Contoso/CommonTools',
      ref: DEFAULT_REPOSITORY_REF,
      commit: COMMIT,
      method: 'tarball',
    });
  });

  it('lets a config override win before the type is even consulted (docs/05 §3 item 1)', async () => {
    // The killer feature: point `templates` at a working copy while debugging the templates
    // themselves. No credential and no fetch impl are supplied, so any fetch would fail the test.
    const result = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'azdo-emu-templates' }],
      await baseOptions({ overrides: { templates: { path: '/work/templates' } } }),
    );

    expect(result.repositories.find((entry) => entry.alias === 'templates')).toMatchObject({
      origin: 'local-override',
      url: 'file:///work/templates',
      dir: '/work/templates',
      method: 'working-copy',
    });
    expect(noteFor(result.notes, ALIAS_LOCAL_OVERRIDE)?.message).toContain('/work/templates');
    expect(result.unresolved).toEqual([]);
  });

  it('folds alias case when matching an override (C-E03-213)', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'Templates', type: 'githubenterprise', name: 'x/y' }],
      await baseOptions({ overrides: { TEMPLATES: { path: '/work/t' } } }),
    );
    expect(result.repositories.find((entry) => entry.alias === 'Templates')?.origin).toBe(
      'local-override',
    );
    // The override also rescues a type we have no fetcher for.
    expect(noteFor(result.notes, ALIAS_UNSUPPORTED_TYPE)).toBeUndefined();
  });

  it('records an endpoint substitution rather than ignoring it silently (C-E09-048)', async () => {
    const result = await resolveRepositoryAliases(
      [
        {
          alias: 'common',
          type: 'github',
          name: 'Contoso/CommonTools',
          endpoint: 'MyContosoServiceConnection',
        },
      ],
      await baseOptions({ githubFetch: githubFetchStub() }),
    );
    const note = noteFor(result.notes, ALIAS_ENDPOINT_SUBSTITUTED);
    expect(note?.alias).toBe('common');
    expect(note?.message).toContain('MyContosoServiceConnection');
    expect(note?.message).toContain('your own credentials');
    // The substitution is a note, not a failure: the repository still resolves.
    expect(result.unresolved).toEqual([]);
  });

  it('reports githubenterprise and bitbucket rather than throwing (C-E09-045, PLAN D10)', async () => {
    const result = await resolveRepositoryAliases(
      [
        { alias: 'ghe', type: 'githubenterprise', name: 'org/repo' },
        { alias: 'bb', type: 'bitbucket', name: 'org/repo' },
      ],
      await baseOptions(),
    );
    expect(result.unresolved).toEqual(['ghe', 'bb']);
    expect(result.notes.filter((note) => note.code === ALIAS_UNSUPPORTED_TYPE)).toHaveLength(2);
    expect(noteFor(result.notes, ALIAS_UNSUPPORTED_TYPE)?.message).toContain('azdo-emu.yaml');
    // Conversion continues: `self` is still resolved.
    expect(result.repositories).toHaveLength(1);
  });

  it('reports a missing, unknown, or nameless type', async () => {
    const result = await resolveRepositoryAliases(
      [
        { alias: 'notype', name: 'x' },
        { alias: 'weird', type: 'svn', name: 'x' },
        { alias: 'noname', type: 'git' },
      ],
      await baseOptions({ azureCredential: CREDENTIAL }),
    );
    expect(result.unresolved).toEqual(['notype', 'weird', 'noname']);
    expect(result.notes.filter((note) => note.code === ALIAS_UNKNOWN_TYPE)).toHaveLength(3);
    const messages = result.notes.map((note) => note.message).join('\n');
    expect(messages).toContain('no `type`');
    expect(messages).toContain('`type: svn`');
    expect(messages).toContain('but no `name`');
  });

  it('turns a fetch failure into a note and keeps converting (PLAN D10)', async () => {
    const failing: RepoFetch = () => Promise.resolve(new Response('', { status: 403 }));
    const result = await resolveRepositoryAliases(
      [
        { alias: 'templates', type: 'git', name: 'templates' },
        { alias: 'common', type: 'github', name: 'Contoso/CommonTools' },
      ],
      await baseOptions({
        azureCredential: CREDENTIAL,
        adoFetch: failing,
        githubFetch: githubFetchStub(),
      }),
    );

    expect(result.unresolved).toEqual(['templates']);
    expect(noteFor(result.notes, ALIAS_FETCH_FAILED)?.message).toContain('HTTP 403');
    // The other alias still resolved — one unreachable repository does not stop the conversion.
    expect(result.repositories.map((entry) => entry.alias)).toEqual(['self', 'common']);
  });

  it('reports a missing Azure credential as a fetch failure, not a crash', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'templates' }],
      await baseOptions(),
    );
    expect(result.unresolved).toEqual(['templates']);
    expect(noteFor(result.notes, ALIAS_FETCH_FAILED)?.message).toContain('auth login');
  });

  it('reports a github name that is not owner/repo (C-E09-046)', async () => {
    const result = await resolveRepositoryAliases(
      [{ alias: 'common', type: 'github', name: 'CommonTools' }],
      await baseOptions({ githubFetch: githubFetchStub() }),
    );
    expect(result.unresolved).toEqual(['common']);
    expect(noteFor(result.notes, ALIAS_FETCH_FAILED)?.message).toContain('owner/repo pair');
  });

  it('carries a self repository that is already pinned', async () => {
    const result = await resolveRepositoryAliases(
      [],
      await baseOptions({
        self: {
          path: '/work/app',
          url: 'https://dev.azure.com/example-org/Example/_git/app',
          ref: 'develop',
          commit: COMMIT,
        },
      }),
    );
    expect(result.repositories[0]).toMatchObject({
      url: 'https://dev.azure.com/example-org/Example/_git/app',
      ref: 'refs/heads/develop',
      commit: COMMIT,
    });
  });
});
