import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARTIFACT_EXPAND_SIGNED_CONTENT,
  artifactCacheDir,
  downloadArtifact,
  getArtifact,
  getRun,
  listRuns,
  resolveRun,
} from '../src/rest/runs.js';
import { AzureDevOpsClient, RestError, type RestFetch, type Sleeper } from '../src/rest/client.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';
import { adoZip } from './helpers/archives.js';

const ORG = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG,
  mode: 'pat',
  token: 'fake-pat-for-runs-tests',
};

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-runs-'));
  tempDirs.push(directory);
  return directory;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; api-version=7.1' },
  });

interface Harness {
  readonly client: AzureDevOpsClient;
  readonly urls: string[];
  readonly authHeaders: (string | undefined)[];
}

/** Routes by URL so a test states what each endpoint returns rather than counting calls. */
function harness(routes: readonly [RegExp, () => Response][]): Harness {
  const urls: string[] = [];
  const authHeaders: (string | undefined)[] = [];
  const fetchImpl: RestFetch = (url, init) => {
    urls.push(url);
    authHeaders.push((init.headers as Record<string, string> | undefined)?.Authorization);
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
    authHeaders,
  };
}

/** The exact key set a live Runs-List item carries — note: no `resources` (C-E09-068). */
const listItem = (id: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  _links: {},
  createdDate: '2026-08-12T06:55:19.17Z',
  finishedDate: '2026-08-12T06:55:30.33Z',
  id,
  name: `20260812.${id}`,
  pipeline: { id: 20, name: 'oracle-anchor' },
  result: 'succeeded',
  state: 'completed',
  templateParameters: {},
  url: `${ORG}/Example/_apis/pipelines/20/runs/${id}`,
  ...extra,
});

const runDetail = (
  id: number,
  refName: string,
  tags: string[] = [],
  result = 'succeeded',
): Record<string, unknown> => ({
  ...listItem(id, { result }),
  resources: {
    repositories: {
      self: { refName, version: 'ddef690f'.padEnd(40, '0'), repository: { type: 'azureReposGit' } },
    },
  },
  tags,
  yamlDetails: {},
});

describe('listRuns (C-E09-067)', () => {
  it('lists runs and, per the docs, passes no filter parameters', async () => {
    const { client, urls } = harness([
      [/\/runs\?/, () => json({ count: 2, value: [listItem(527), listItem(526)] })],
    ]);
    const runs = await listRuns(client, 20);

    expect(runs.map((run) => run.id)).toEqual([527, 526]);
    expect(runs[0]).toMatchObject({
      name: '20260812.527',
      state: 'completed',
      result: 'succeeded',
    });
    // The endpoint accepts only pipelineId + api-version; a branch filter has nowhere to go.
    const query = new URL(urls[0]!).searchParams;
    expect([...query.keys()]).toEqual(['api-version']);
  });

  it('tolerates a body with no value array and skips malformed rows', async () => {
    const empty = harness([[/./, () => json({ count: 0 })]]);
    await expect(listRuns(empty.client, 20)).resolves.toEqual([]);

    const junk = harness([[/./, () => json({ value: [null, 7, { name: 'no id' }, listItem(1)] })]]);
    await expect(listRuns(junk.client, 20)).resolves.toHaveLength(1);
  });
});

describe('getRun (C-E09-068/069)', () => {
  it('reads the branch out of resources, which the list item does not carry', async () => {
    const { client } = harness([[/./, () => json(runDetail(527, 'refs/heads/main', ['nightly']))]]);
    const run = await getRun(client, 20, 527);

    expect(run).toMatchObject({
      id: 527,
      refName: 'refs/heads/main',
      repositoryType: 'azureReposGit',
      // `tags` is present on the live response but absent from the documented `Run` definition.
      tags: ['nightly'],
    });
    expect(run.sourceVersion?.startsWith('ddef690f')).toBe(true);
  });

  it('falls back to the only repository when it is not spelled `self`', async () => {
    const { client } = harness([
      [
        /./,
        () =>
          json({
            ...listItem(1),
            resources: { repositories: { app: { refName: 'refs/heads/dev' } } },
          }),
      ],
    ]);
    await expect(getRun(client, 20, 1)).resolves.toMatchObject({ refName: 'refs/heads/dev' });
  });

  it('returns no branch and no tags when resources are absent', async () => {
    const { client } = harness([[/./, () => json(listItem(1))]]);
    const run = await getRun(client, 20, 1);
    // The key is absent rather than present-and-undefined, so a caller can `in`-check it.
    expect('refName' in run).toBe(false);
    expect(run.tags).toEqual([]);
  });

  it('reports a body with no id rather than inventing one', async () => {
    const { client } = harness([[/./, () => json({ name: 'no id' })]]);
    await expect(getRun(client, 20, 1)).rejects.toThrow('returned no id');
  });
});

describe('resolveRun', () => {
  it('filters by branch client-side, newest first, stopping at the first match (C-E09-067/068)', async () => {
    const details: Record<number, Record<string, unknown>> = {
      527: runDetail(527, 'refs/heads/feature'),
      526: runDetail(526, 'refs/heads/main'),
      525: runDetail(525, 'refs/heads/main'),
    };
    const { client, urls } = harness([
      [/\/runs\/(\d+)\?/, () => json(details[Number(/runs\/(\d+)/.exec(lastUrl(urls))![1])]!)],
      [/\/runs\?/, () => json({ value: [listItem(527), listItem(526), listItem(525)] })],
    ]);

    const run = await resolveRun(client, 20, { branch: 'refs/heads/main' });
    expect(run?.id).toBe(526);
    // One list call + two detail calls: it stopped at 526 instead of walking to 525.
    expect(urls).toHaveLength(3);
  });

  it('skips the per-run call entirely when no branch or tag was asked for', async () => {
    const { client, urls } = harness([
      [/\/runs\?/, () => json({ value: [listItem(527), listItem(526)] })],
    ]);
    const run = await resolveRun(client, 20, {});
    expect(run?.id).toBe(527);
    expect(urls).toHaveLength(1);
  });

  it('requires every requested tag to be present (C-E09-069)', async () => {
    const details: Record<number, Record<string, unknown>> = {
      527: runDetail(527, 'refs/heads/main', ['nightly']),
      526: runDetail(526, 'refs/heads/main', ['nightly', 'release']),
    };
    const { client, urls } = harness([
      [/\/runs\/(\d+)\?/, () => json(details[Number(/runs\/(\d+)/.exec(lastUrl(urls))![1])]!)],
      [/\/runs\?/, () => json({ value: [listItem(527), listItem(526)] })],
    ]);
    await expect(resolveRun(client, 20, { tags: ['nightly', 'release'] })).resolves.toMatchObject({
      id: 526,
    });
  });

  it('ignores runs that are not in the requested state, and filters by result', async () => {
    const { client } = harness([
      [
        /\/runs\?/,
        () =>
          json({
            value: [
              listItem(528, { state: 'inProgress' }),
              listItem(527, { result: 'failed' }),
              listItem(526),
            ],
          }),
      ],
    ]);
    await expect(resolveRun(client, 20, { result: 'succeeded' })).resolves.toMatchObject({
      id: 526,
    });
  });

  it('returns undefined and stops after maxCandidates rather than walking 10,000 runs', async () => {
    const { client, urls } = harness([
      [/\/runs\/(\d+)\?/, () => json(runDetail(1, 'refs/heads/other'))],
      [/\/runs\?/, () => json({ value: [listItem(3), listItem(2), listItem(1)] })],
    ]);
    await expect(
      resolveRun(client, 20, { branch: 'refs/heads/main', maxCandidates: 2 }),
    ).resolves.toBeUndefined();
    expect(urls).toHaveLength(3); // one list + exactly two details
  });
});

describe('getArtifact (C-E09-070/072)', () => {
  it('asks for the one documented expansion and reads the signed content', async () => {
    const { client, urls } = harness([
      [
        /./,
        () =>
          json({
            name: 'drop',
            url: `${ORG}/Example/_apis/pipelines/20/runs/527/artifacts?artifactName=drop`,
            signedContent: {
              url: 'https://artprodeus.artifacts.visualstudio.com/signed?sig=abc',
              signatureExpires: '2026-09-02T13:00:00Z',
            },
          }),
      ],
    ]);
    const artifact = await getArtifact(client, 20, 527, 'drop');

    expect(artifact.signedUrl).toContain('signed?sig=abc');
    expect(artifact.signatureExpires).toBe('2026-09-02T13:00:00Z');
    const query = new URL(urls[0]!).searchParams;
    expect(query.get('$expand')).toBe(ARTIFACT_EXPAND_SIGNED_CONTENT);
    expect(query.get('artifactName')).toBe('drop');
  });

  it('surfaces the service ArtifactNotFoundException verbatim', async () => {
    const { client } = harness([
      [
        /./,
        () =>
          json(
            {
              message: 'An Artifact with name "drop" was not found.',
              typeKey: 'ArtifactNotFoundException',
            },
            404,
          ),
      ],
    ]);
    const error = (await getArtifact(client, 20, 527, 'drop').catch(
      (caught: unknown) => caught,
    )) as RestError;
    expect(error.status).toBe(404);
    expect(error.typeKey).toBe('ArtifactNotFoundException');
    expect(error.serviceMessage).toBe('An Artifact with name "drop" was not found.');
  });
});

describe('artifactCacheDir (docs/05 §4)', () => {
  it('keys by alias, run and artifact name', () => {
    expect(artifactCacheDir('/out', 'upstream', 1234, 'drop')).toBe(
      join('/out', '.cache/artifacts', 'upstream', '1234', 'drop'),
    );
  });
});

describe('downloadArtifact (C-E09-071)', () => {
  const metadata = () =>
    json({
      name: 'drop',
      signedContent: {
        url: 'https://artprodeus.artifacts.visualstudio.com/signed?sig=abc',
        signatureExpires: '2026-09-02T13:00:00Z',
      },
    });

  it('downloads with NO Authorization header and unpacks into the cache', async () => {
    // The signed url grants "limited-time anonymous access"; forwarding our credential to a
    // storage origin would be gratuitous — the same rule as GitHub's tarball storage url.
    const cacheDir = await scratch();
    const seen: { url: string; auth: string | undefined }[] = [];
    const download: RestFetch = (url, init) => {
      seen.push({
        url,
        auth: (init.headers as Record<string, string> | undefined)?.Authorization,
      });
      return Promise.resolve(
        new Response(adoZip([{ name: 'app/build.txt', body: 'artifact contents\n' }]), {
          status: 200,
        }),
      );
    };
    const { client } = harness([[/./, metadata]]);

    const result = await downloadArtifact(client, {
      cacheDir,
      alias: 'upstream',
      pipelineId: 20,
      runId: 527,
      artifactName: 'drop',
      fetchImpl: download,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.auth).toBeUndefined();
    expect(result.dir).toBe(artifactCacheDir(cacheDir, 'upstream', 527, 'drop'));
    expect(result.files).toBe(1);
    await expect(stat(join(result.dir, 'artifact.zip'))).resolves.toBeTruthy();
    await expect(readFile(join(result.dir, 'tree', 'app', 'build.txt'), 'utf8')).resolves.toBe(
      'artifact contents\n',
    );
  });

  it('never persists the signed url, because signatureExpires makes it worthless later', async () => {
    const cacheDir = await scratch();
    const download: RestFetch = () =>
      Promise.resolve(new Response(adoZip([{ name: 'a.txt', body: 'x' }]), { status: 200 }));
    const { client } = harness([[/./, metadata]]);
    const result = await downloadArtifact(client, {
      cacheDir,
      alias: 'upstream',
      pipelineId: 20,
      runId: 527,
      artifactName: 'drop',
      fetchImpl: download,
    });
    // The download result carries what the lockfile pins — a run id and a name, no url.
    expect(result).toMatchObject({ runId: 527, artifactName: 'drop' });
    expect(JSON.stringify(result)).not.toContain('sig=abc');
  });

  it('reports missing signed content, a failed download and a transport error distinctly', async () => {
    const cacheDir = await scratch();
    const noSigned = harness([[/./, () => json({ name: 'drop' })]]);
    await expect(
      downloadArtifact(noSigned.client, {
        cacheDir,
        alias: 'a',
        pipelineId: 20,
        runId: 1,
        artifactName: 'drop',
      }),
    ).rejects.toThrow('no signed content url');

    const { client } = harness([[/./, metadata]]);
    await expect(
      downloadArtifact(client, {
        cacheDir,
        alias: 'a',
        pipelineId: 20,
        runId: 1,
        artifactName: 'drop',
        fetchImpl: () => Promise.resolve(new Response('', { status: 403 })),
      }),
    ).rejects.toThrow('download returned HTTP 403');

    const again = harness([[/./, metadata]]);
    await expect(
      downloadArtifact(again.client, {
        cacheDir,
        alias: 'a',
        pipelineId: 20,
        runId: 1,
        artifactName: 'drop',
        fetchImpl: () => Promise.reject(new Error('ECONNRESET')),
      }),
    ).rejects.toThrow('download failed');
  });
});

function lastUrl(urls: readonly string[]): string {
  return urls[urls.length - 1]!;
}
