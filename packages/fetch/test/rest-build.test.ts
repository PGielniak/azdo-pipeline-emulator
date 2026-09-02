import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_NOT_FOUND_TYPE_KEY,
  downloadBuildArtifact,
  findDefinitionByName,
  getBuildArtifact,
  getDefinition,
  listBuildArtifacts,
  resolveDefinition,
} from '../src/rest/build.js';
import { AzureDevOpsClient, RestError, type RestFetch, type Sleeper } from '../src/rest/client.js';
import { artifactCacheDir } from '../src/rest/runs.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';
import { adoZip } from './helpers/archives.js';

const ORG = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG,
  mode: 'pat',
  token: 'fake-pat-for-build-tests',
};

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-build-'));
  tempDirs.push(directory);
  return directory;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; api-version=7.1' },
  });

function harness(routes: readonly [RegExp, () => Response][]): {
  client: AzureDevOpsClient;
  urls: string[];
} {
  const urls: string[] = [];
  const fetchImpl: RestFetch = (url) => {
    urls.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (route === undefined) throw new Error(`unrouted request to ${url}`);
    return Promise.resolve(route[1]());
  };
  const sleep: Sleeper = () => Promise.resolve();
  return {
    client: new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      project: 'Example',
      fetchImpl,
      sleep,
    }),
    urls,
  };
}

/** The exact key set a live definitions *list* item carries — no `process`, no `repository`. */
const definitionListItem = (id: number, name: string) => ({
  _links: {},
  authoredBy: {},
  createdDate: '2026-08-12T06:00:00Z',
  drafts: [],
  id,
  name,
  path: '\\',
  project: {},
  quality: 'definition',
  queue: {},
  queueStatus: 'enabled',
  revision: 1,
  type: 'build',
  uri: `vstfs:///Build/Definition/${id}`,
  url: `${ORG}/Example/_apis/build/Definitions/${id}`,
});

const definitionDetail = (id: number, name: string) => ({
  ...definitionListItem(id, name),
  process: { yamlFilename: '/experiments/status-skipped.yml', type: 2 },
  repository: {
    id: '1e61703d-aab2-473a-9608-75bfd95d46e9',
    name: 'oracle',
    type: 'TfsGit',
    defaultBranch: 'refs/heads/main',
    url: `${ORG}/Example/_git/oracle`,
  },
  tags: [],
  triggers: [],
});

const notFound = (message: string) => json({ message, typeKey: ARTIFACT_NOT_FOUND_TYPE_KEY }, 404);

describe('findDefinitionByName (C-E09-077)', () => {
  it('sends the name as an exact filter, not a prefix', async () => {
    // Measured: `name=oracle-anch` returns 0 — the filter is exact, unlike the Git Refs
    // `filter`, which the docs describe as "(starts with)" (C-E09-030).
    const { client, urls } = harness([
      [/./, () => json({ count: 1, value: [definitionListItem(19, 'oracle-anchor')] })],
    ]);
    await expect(findDefinitionByName(client, 'oracle-anchor')).resolves.toMatchObject({
      id: 19,
      name: 'oracle-anchor',
    });
    expect(new URL(urls[0]!).searchParams.get('name')).toBe('oracle-anchor');
  });

  it('matches case-insensitively, as the service does', async () => {
    const { client } = harness([
      [/./, () => json({ value: [definitionListItem(19, 'oracle-anchor')] })],
    ]);
    await expect(findDefinitionByName(client, 'ORACLE-ANCHOR')).resolves.toMatchObject({ id: 19 });
  });

  it('does not send a name containing `*` as a filter, because it would become a pattern', async () => {
    // A definition legitimately named `build*release` must not be turned into a wildcard search.
    const { client, urls } = harness([
      [/./, () => json({ value: [definitionListItem(7, 'build*release')] })],
    ]);
    await expect(findDefinitionByName(client, 'build*release')).resolves.toMatchObject({ id: 7 });
    expect(new URL(urls[0]!).searchParams.has('name')).toBe(false);
  });

  it('does not trust the count: a wildcard-shaped hit that is not the name is rejected', async () => {
    const { client } = harness([
      [/./, () => json({ count: 1, value: [definitionListItem(19, 'oracle-anchor-2')] })],
    ]);
    await expect(findDefinitionByName(client, 'oracle-anchor')).resolves.toBeUndefined();
  });

  it('returns undefined for no results or a malformed body', async () => {
    const empty = harness([[/./, () => json({ count: 0, value: [] })]]);
    await expect(findDefinitionByName(empty.client, 'nope')).resolves.toBeUndefined();

    const junk = harness([[/./, () => json({ value: [null, { name: 'no id' }, 7] })]]);
    await expect(findDefinitionByName(junk.client, 'nope')).resolves.toBeUndefined();

    const noArray = harness([[/./, () => json({ count: 0 })]]);
    await expect(findDefinitionByName(noArray.client, 'nope')).resolves.toBeUndefined();
  });
});

describe('getDefinition (C-E09-078)', () => {
  it('reads the yaml path and repository, which the list item does not carry', async () => {
    const { client } = harness([[/./, () => json(definitionDetail(20, 'oracle-anchor'))]]);
    await expect(getDefinition(client, 20)).resolves.toMatchObject({
      id: 20,
      yamlFilename: '/experiments/status-skipped.yml',
      processType: 2,
      repository: { name: 'oracle', type: 'TfsGit', defaultBranch: 'refs/heads/main' },
    });
  });

  it('tolerates a classic definition with no yaml filename', async () => {
    const { client } = harness([
      [
        /./,
        () => json({ ...definitionListItem(21, 'classic'), process: { type: 1 }, repository: {} }),
      ],
    ]);
    const definition = await getDefinition(client, 21);
    expect(definition.processType).toBe(1);
    expect('yamlFilename' in definition).toBe(false);
    expect(definition.repository).toEqual({});
  });

  it('reports a body with no id rather than inventing one', async () => {
    const { client } = harness([[/./, () => json({ name: 'no id' })]]);
    await expect(getDefinition(client, 1)).rejects.toThrow('returned no id or name');
  });
});

describe('resolveDefinition', () => {
  it('takes two calls to get from a name to a yaml path (C-E09-078)', async () => {
    const { client, urls } = harness([
      [/definitions\/\d+\?/, () => json(definitionDetail(19, 'oracle-anchor'))],
      [/definitions\?/, () => json({ value: [definitionListItem(19, 'oracle-anchor')] })],
    ]);
    await expect(resolveDefinition(client, 'oracle-anchor')).resolves.toMatchObject({
      id: 19,
      yamlFilename: '/experiments/status-skipped.yml',
    });
    expect(urls).toHaveLength(2);
  });

  it('stops after one call when the name matches nothing', async () => {
    const { client, urls } = harness([[/definitions\?/, () => json({ value: [] })]]);
    await expect(resolveDefinition(client, 'nope')).resolves.toBeUndefined();
    expect(urls).toHaveLength(1);
  });
});

describe('listBuildArtifacts (C-E09-075)', () => {
  it('treats a build that published nothing as an empty list, not an error', async () => {
    // Measured: this is a 200 with {"count":0,"value":[]} — only a *named* miss is a 404.
    const { client } = harness([[/./, () => json({ count: 0, value: [] })]]);
    await expect(listBuildArtifacts(client, 527)).resolves.toEqual([]);
  });

  it('flattens the resource fields callers actually need', async () => {
    const { client } = harness([
      [
        /./,
        () =>
          json({
            count: 1,
            value: [
              {
                id: 1,
                name: 'drop',
                source: 'job-guid',
                resource: {
                  type: 'Container',
                  data: '#/1234/drop',
                  downloadUrl: `${ORG}/Example/_apis/build/builds/527/artifacts?artifactName=drop&$format=zip`,
                },
              },
            ],
          }),
      ],
    ]);
    await expect(listBuildArtifacts(client, 527)).resolves.toEqual([
      {
        id: 1,
        name: 'drop',
        type: 'Container',
        data: '#/1234/drop',
        downloadUrl: expect.stringContaining('$format=zip') as unknown as string,
      },
    ]);
  });

  it('skips malformed rows and a body with no array', async () => {
    const junk = harness([[/./, () => json({ value: [null, 7, { id: 1 }] })]]);
    await expect(listBuildArtifacts(junk.client, 1)).resolves.toEqual([]);
    const none = harness([[/./, () => json({})]]);
    await expect(listBuildArtifacts(none.client, 1)).resolves.toEqual([]);
  });
});

describe('getBuildArtifact (C-E09-076)', () => {
  it('reads a 404 as "no such artifact" via typeKey, not via the message text', async () => {
    // The Build API says "Artifact drop was not found for build 527." while Pipelines says
    // 'An Artifact with name "drop" was not found.' — same typeKey, different wording, so
    // matching on the message would work against one API and silently not the other.
    const { client } = harness([
      [/./, () => notFound('Artifact drop was not found for build 527.')],
    ]);
    await expect(getBuildArtifact(client, 527, 'drop')).resolves.toBeUndefined();
  });

  it('also recognizes the Pipelines wording, since only typeKey is compared', async () => {
    const { client } = harness([
      [/./, () => notFound('An Artifact with name "drop" was not found.')],
    ]);
    await expect(getBuildArtifact(client, 527, 'drop')).resolves.toBeUndefined();
  });

  it('rethrows any other failure rather than reporting it as absent', async () => {
    const { client } = harness([
      [
        /./,
        () => json({ message: 'unauthenticated', typeKey: 'UnauthorizedRequestException' }, 401),
      ],
    ]);
    const error = (await getBuildArtifact(client, 527, 'drop').catch(
      (caught: unknown) => caught,
    )) as RestError;
    expect(error).toBeInstanceOf(RestError);
    expect(error.status).toBe(401);
  });

  it('returns the flattened artifact on success', async () => {
    const { client, urls } = harness([
      [
        /./,
        () =>
          json({
            id: 1,
            name: 'drop',
            resource: { type: 'Container', downloadUrl: 'https://dev.azure.com/dl' },
          }),
      ],
    ]);
    await expect(getBuildArtifact(client, 527, 'drop')).resolves.toMatchObject({
      name: 'drop',
      type: 'Container',
    });
    expect(new URL(urls[0]!).searchParams.get('artifactName')).toBe('drop');
  });
});

describe('downloadBuildArtifact (C-E09-074)', () => {
  const containerArtifact = () =>
    json({
      id: 1,
      name: 'drop',
      resource: { type: 'Container', downloadUrl: 'https://dev.azure.com/dl?zip' },
    });

  it('downloads a container artifact WITH the credential and unpacks it', async () => {
    // Unlike the Pipelines signed url (C-E09-071), this is an ordinary org-scoped resource: the
    // credential is required, not gratuitous.
    const cacheDir = await scratch();
    const seen: (string | undefined)[] = [];
    const download: RestFetch = (_url, init) => {
      seen.push((init.headers as Record<string, string> | undefined)?.Authorization);
      return Promise.resolve(
        new Response(adoZip([{ name: 'out/app.txt', body: 'classic artifact\n' }]), {
          status: 200,
        }),
      );
    };
    const { client } = harness([[/./, containerArtifact]]);

    const result = await downloadBuildArtifact(client, {
      cacheDir,
      alias: 'upstream',
      buildId: 527,
      artifactName: 'drop',
      authorization: 'Basic redacted',
      fetchImpl: download,
    });

    expect(seen).toEqual(['Basic redacted']);
    expect(result.dir).toBe(artifactCacheDir(cacheDir, 'upstream', 527, 'drop'));
    expect(result.files).toBe(1);
    // The zip's own directory must survive — E09-S02-T04's wrapper stripping is tarball-only.
    await expect(readFile(join(result.dir, 'tree', 'out', 'app.txt'), 'utf8')).resolves.toBe(
      'classic artifact\n',
    );
  });

  it('refuses a resource type with no downloadUrl, naming the type (C-E09-074)', async () => {
    // A `FilePath` artifact names a UNC share that does not exist on this machine; saying so beats
    // attempting a fetch that fails obscurely.
    const cacheDir = await scratch();
    const { client } = harness([
      [
        /./,
        () => json({ name: 'drop', resource: { type: 'FilePath', data: '\\\\server\\share' } }),
      ],
    ]);
    await expect(
      downloadBuildArtifact(client, {
        cacheDir,
        alias: 'a',
        buildId: 1,
        artifactName: 'drop',
        authorization: 'Basic redacted',
      }),
    ).rejects.toThrow(/`FilePath` resource with no downloadUrl/);
  });

  it('reports an absent artifact, a failed download and a transport error distinctly', async () => {
    const cacheDir = await scratch();
    const missing = harness([[/./, () => notFound('Artifact drop was not found for build 1.')]]);
    await expect(
      downloadBuildArtifact(missing.client, {
        cacheDir,
        alias: 'a',
        buildId: 1,
        artifactName: 'drop',
        authorization: 'Basic redacted',
      }),
    ).rejects.toThrow('has no artifact named drop');

    const forbidden = harness([[/./, containerArtifact]]);
    await expect(
      downloadBuildArtifact(forbidden.client, {
        cacheDir,
        alias: 'a',
        buildId: 1,
        artifactName: 'drop',
        authorization: 'Basic redacted',
        fetchImpl: () => Promise.resolve(new Response('', { status: 403 })),
      }),
    ).rejects.toThrow('download returned HTTP 403');

    const broken = harness([[/./, containerArtifact]]);
    await expect(
      downloadBuildArtifact(broken.client, {
        cacheDir,
        alias: 'a',
        buildId: 1,
        artifactName: 'drop',
        authorization: 'Basic redacted',
        fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
      }),
    ).rejects.toThrow('download failed');
  });
});
