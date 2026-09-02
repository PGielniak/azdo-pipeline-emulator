import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadTemplate, resolveReference, type TemplateLocation } from '@azdo-emu/engine';
import { resolveRepositoryAliases, type RepoFetch } from '@azdo-emu/fetch';
import { adoZip } from '../../fetch/test/helpers/archives.js';
import { readFromMirror, repositoryFetcher } from '../src/convert/repositories.js';

const ORG = { orgUrl: 'https://dev.azure.com/example-org', project: 'Example' };
const COMMIT = 'fa03743821b7e01caa17f4387b30338c43fac4df';
const RANGE = { line: 1, col: 1, endLine: 1, endCol: 1 };

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-repos-'));
  tempDirs.push(directory);
  return directory;
}

const locationIn = (
  alias: string,
  filePath: string,
  fetcher: ReturnType<typeof repositoryFetcher>,
) =>
  ({
    repository: fetcher.fetcher.repository(alias)!,
    path: filePath,
  }) satisfies TemplateLocation;

describe('repositoryFetcher — the local-override integration path (docs/05 §3 item 1)', () => {
  it('resolves a cross-repo template reference out of a redirected working copy', async () => {
    // The killer feature end to end: `templates` is declared as a `type: git` resource, but the
    // user pointed it at a working copy, so E03's reference resolution reads the *uncommitted*
    // file — with no credential and no network anywhere in the path.
    const self = await scratch();
    const templates = await scratch();
    await writeFile(join(self, 'azure-pipelines.yml'), 'steps: []\n', 'utf8');
    await mkdir(join(templates, 'ci'), { recursive: true });
    await writeFile(join(templates, 'ci', 'build.yml'), 'steps:\n- script: echo built\n', 'utf8');

    const resolution = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'pipeline-templates' }],
      {
        self: { path: self },
        organization: ORG,
        cacheDir: await scratch(),
        overrides: { templates: { path: templates } },
      },
    );
    const built = repositoryFetcher(resolution);

    const from = locationIn('self', '/azure-pipelines.yml', built);
    const resolved = resolveReference('ci/build.yml@templates', from, built.fetcher);
    expect(resolved.kind).toBe('resolved');
    if (resolved.kind !== 'resolved') return;
    expect(resolved.location.repository.alias).toBe('templates');
    expect(resolved.location.path).toBe('/ci/build.yml');

    const loaded = loadTemplate('ci/build.yml@templates', from, built.fetcher, RANGE);
    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') return;
    expect(loaded.text).toContain('echo built');
    expect(built.unreadable).toEqual([]);
  });

  it('still reports a genuinely missing file as not-found, not as unreadable', async () => {
    const self = await scratch();
    const templates = await scratch();
    const resolution = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'x' }],
      {
        self: { path: self },
        organization: ORG,
        cacheDir: await scratch(),
        overrides: { templates: { path: templates } },
      },
    );
    const built = repositoryFetcher(resolution);
    const loaded = loadTemplate(
      'ci/missing.yml@templates',
      locationIn('self', '/azure-pipelines.yml', built),
      built.fetcher,
      RANGE,
    );
    // A missing file is a `failed` load carrying the service's own not-found sentence — not the
    // silent `undefined` an unreadable archive would produce.
    expect(loaded.kind).toBe('failed');
    if (loaded.kind !== 'failed') return;
    expect(loaded.diagnostic.code).toBe('template-reference-not-found');
  });

  it('folds alias case the way the service does (C-E03-213)', async () => {
    const self = await scratch();
    const templates = await scratch();
    await writeFile(join(templates, 't.yml'), 'steps: []\n', 'utf8');
    const resolution = await resolveRepositoryAliases(
      [{ alias: 'Templates', type: 'git', name: 'x' }],
      {
        self: { path: self },
        organization: ORG,
        cacheDir: await scratch(),
        overrides: { templates: { path: templates } },
      },
    );
    const built = repositoryFetcher(resolution);
    expect(built.fetcher.repository('TEMPLATES')?.alias).toBe('Templates');
    expect(
      built.fetcher.read({ repository: built.fetcher.repository('templates')!, path: '/t.yml' }),
    ).toContain('steps');
  });
});

describe('readFromMirror — reading a bare mirror without extracting it', () => {
  it('reads a file at the pinned commit and reports a missing path as undefined', async () => {
    const work = await scratch();
    execFileSync('git', ['init', '-q', work], { stdio: 'ignore' });
    await mkdir(join(work, 'ci'), { recursive: true });
    await writeFile(join(work, 'ci', 'build.yml'), 'steps:\n- script: from-mirror\n', 'utf8');
    for (const args of [
      ['-C', work, 'config', 'user.email', 't@e'],
      ['-C', work, 'config', 'user.name', 't'],
      ['-C', work, 'add', '.'],
      ['-C', work, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'c1'],
    ]) {
      execFileSync('git', args, { stdio: 'ignore' });
    }
    const commit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    const mirror = join(await scratch(), 'mirror.git');
    execFileSync('git', ['clone', '--bare', '-q', work, mirror], { stdio: 'ignore' });

    expect(readFromMirror(mirror, commit, '/ci/build.yml')).toContain('from-mirror');
    // Leading slash is optional; both spellings address the same object.
    expect(readFromMirror(mirror, commit, 'ci/build.yml')).toContain('from-mirror');
    expect(readFromMirror(mirror, commit, '/ci/missing.yml')).toBeUndefined();
    expect(readFromMirror(mirror, '0'.repeat(40), '/ci/build.yml')).toBeUndefined();
    expect(readFromMirror(join(mirror, 'nope'), commit, '/ci/build.yml')).toBeUndefined();
  });
});

describe('repositoryFetcher — archive snapshots (E09-S02-T04)', () => {
  it('resolves a cross-repo template out of an extracted ADO zip', async () => {
    // Before T04 this alias pinned correctly but was reported `unreadable`. The archive is now
    // unpacked at fetch time, so it reads through the same working-copy path as everything else.
    const zipFetch: RepoFetch = (url) =>
      Promise.resolve(
        url.includes('/refs?')
          ? new Response(
              JSON.stringify({ value: [{ name: 'refs/heads/main', objectId: COMMIT }] }),
              { status: 200 },
            )
          : new Response(
              adoZip([
                { name: 'README.md', body: '# templates\n' },
                { name: 'ci/build.yml', body: 'steps:\n- script: from-zip\n' },
              ]),
              { status: 200 },
            ),
      );

    const self = await scratch();
    const resolution = await resolveRepositoryAliases(
      [{ alias: 'templates', type: 'git', name: 'pipeline-templates' }],
      {
        self: { path: self },
        organization: ORG,
        cacheDir: await scratch(),
        azureCredential: {
          version: 1,
          orgUrl: ORG.orgUrl,
          mode: 'pat',
          token: 'fake-pat-for-cli-tests',
        },
        adoFetch: zipFetch,
        // Force the archive route rather than depending on the host's git version.
        snapshotMethod: 'items-zip',
      },
    );

    const templates = resolution.repositories.find((entry) => entry.alias === 'templates');
    expect(templates).toMatchObject({ method: 'items-zip', commit: COMMIT });

    const built = repositoryFetcher(resolution);
    expect(built.unreadable).toEqual([]);

    const loaded = loadTemplate(
      'ci/build.yml@templates',
      locationIn('self', '/azure-pipelines.yml', built),
      built.fetcher,
      RANGE,
    );
    expect(loaded.kind).toBe('loaded');
    if (loaded.kind !== 'loaded') return;
    expect(loaded.text).toContain('from-zip');
  });

  it('reports a repository with neither a tree nor a mirror as unreadable, not as missing', () => {
    // The honest answer for a snapshot shape we cannot open: "we cannot read this", never
    // "no such template" — the latter sends someone chasing the wrong bug.
    const built = repositoryFetcher({
      repositories: [
        {
          alias: 'opaque',
          origin: 'ado',
          url: 'https://dev.azure.com/example-org/Example/_git/opaque',
          ref: 'refs/heads/main',
          commit: COMMIT,
          dir: '/nowhere',
        },
      ],
      notes: [],
      unresolved: [],
    });

    expect(built.unreadable).toEqual(['opaque']);
    expect(
      built.fetcher.read({ repository: built.fetcher.repository('opaque')!, path: '/a.yml' }),
    ).toBeUndefined();
  });
});
