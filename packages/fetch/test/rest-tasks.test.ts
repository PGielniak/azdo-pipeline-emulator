import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cacheTaskMetadata,
  downloadTaskZip,
  listInstalledTasks,
  parseInstalledTask,
  parseTaskReference,
  readCachedTask,
  selectTask,
  taskCacheDir,
  taskPin,
  versionString,
  type InstalledTask,
} from '../src/rest/tasks.js';
import { AzureDevOpsClient, RestError, type RestFetch, type Sleeper } from '../src/rest/client.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';
import { adoZip } from './helpers/archives.js';

const ORG = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG,
  mode: 'pat',
  token: 'fake-pat-for-task-tests',
};
/** The real GUID the test organization reports for the marketplace fixture (C-E09-089). */
const REPLACETOKENS_ID = 'a8515ec8-7254-4ffd-912c-86772e2b5962';

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

async function scratch(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-tasks-'));
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
    client: new AzureDevOpsClient({ orgUrl: ORG, credential: PAT, fetchImpl, sleep }),
    urls,
  };
}

const entry = (
  name: string,
  id: string,
  major: number,
  minor: number,
  patch: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  name,
  friendlyName: name,
  // C-E09-086: an object, never a string.
  version: { major, minor, patch, isTest: false },
  inputs: [{ name: 'script', type: 'multiLine' }],
  execution: { Node20_1: {} },
  instanceNameFormat: `${name} $(script)`,
  ...extra,
});

/** The org's real shape: five majors of the marketplace task, returned out of order. */
const replacetokensEntries = () =>
  [3, 4, 6, 7, 5].map((major) =>
    entry('replacetokens', REPLACETOKENS_ID, major, major === 7 ? 0 : 3, 1, {
      contributionIdentifier: 'qetza.replacetokens.replacetokens-task',
    }),
  );

const cmdLineEntries = () => [
  entry('CmdLine', 'd9bafed4-0b18-4f58-968d-86655b4d2ce9', 1, 1, 3, { serverOwned: true }),
  entry('CmdLine', 'd9bafed4-0b18-4f58-968d-86655b4d2ce9', 2, 279, 0, { serverOwned: true }),
];

describe('parseInstalledTask (C-E09-086/089)', () => {
  it('reads the object version and keeps the raw definition verbatim', () => {
    const task = parseInstalledTask(replacetokensEntries()[0])!;
    expect(task.version).toEqual({ major: 3, minor: 3, patch: 1, isTest: false });
    expect(task.contributionIdentifier).toBe('qetza.replacetokens.replacetokens-task');
    // Real-task mode must read exactly what the agent would, so nothing is dropped.
    expect(task.definition).toMatchObject({ inputs: expect.any(Array) as unknown[] });
  });

  it('distinguishes an in-box task by serverOwned', () => {
    const task = parseInstalledTask(cmdLineEntries()[1])!;
    expect(task.serverOwned).toBe(true);
    expect('contributionIdentifier' in task).toBe(false);
  });

  it('rejects an entry with no id, name, or usable version', () => {
    expect(parseInstalledTask(null)).toBeUndefined();
    expect(
      parseInstalledTask({ name: 'x', version: { major: 1, minor: 0, patch: 0 } }),
    ).toBeUndefined();
    expect(
      parseInstalledTask({ id: 'x', version: { major: 1, minor: 0, patch: 0 } }),
    ).toBeUndefined();
    // A string version would silently select nothing later, so it is refused here.
    expect(parseInstalledTask({ id: 'x', name: 'y', version: '2' })).toBeUndefined();
    expect(parseInstalledTask({ id: 'x', name: 'y', version: { major: 1 } })).toBeUndefined();
  });
});

describe('versionString and parseTaskReference', () => {
  it('renders the three-part version the zip route needs (C-E09-088)', () => {
    expect(versionString({ major: 6, minor: 3, patch: 1 })).toBe('6.3.1');
  });

  it('splits a YAML reference on the last @', () => {
    expect(parseTaskReference('replacetokens@6')).toEqual({ name: 'replacetokens', major: 6 });
    expect(parseTaskReference('CmdLine@2')).toEqual({ name: 'CmdLine', major: 2 });
    expect(parseTaskReference('CmdLine')).toEqual({ name: 'CmdLine' });
    // A non-numeric or malformed suffix is part of the name, not a version.
    expect(parseTaskReference('weird@latest')).toEqual({ name: 'weird@latest' });
    expect(parseTaskReference('@2')).toEqual({ name: '@2' });
  });
});

describe('selectTask (C-E09-086/087)', () => {
  const tasks = [...replacetokensEntries(), ...cmdLineEntries()].map((raw) =>
    parseInstalledTask(raw)!,
  );

  it('matches name@major on version.major, not on a string', () => {
    expect(selectTask(tasks, 'replacetokens', 6)?.version.major).toBe(6);
    expect(selectTask(tasks, 'CmdLine', 2)?.version).toMatchObject({ major: 2, minor: 279 });
  });

  it('computes the highest major, because the service returns them unordered', () => {
    // The org really returned [3, 4, 6, 7, 5]; taking the last element would pick 5.
    expect(tasks.slice(0, 5).map((t) => t.version.major)).toEqual([3, 4, 6, 7, 5]);
    expect(selectTask(tasks, 'replacetokens')?.version.major).toBe(7);
  });

  it('folds task-name case', () => {
    expect(selectTask(tasks, 'cmdline', 2)?.name).toBe('CmdLine');
    expect(selectTask(tasks, 'REPLACETOKENS')?.version.major).toBe(7);
  });

  it('returns undefined for an unknown name or an uninstalled major', () => {
    expect(selectTask(tasks, 'nope')).toBeUndefined();
    expect(selectTask(tasks, 'replacetokens', 99)).toBeUndefined();
    expect(selectTask([], 'CmdLine')).toBeUndefined();
  });
});

describe('listInstalledTasks (C-E09-085)', () => {
  it('is organization-scoped — no project segment in the route', async () => {
    const { client, urls } = harness([[/./, () => json({ count: 2, value: cmdLineEntries() })]]);
    await expect(listInstalledTasks(client)).resolves.toHaveLength(2);
    expect(new URL(urls[0]!).pathname).toBe('/example-org/_apis/distributedtask/tasks');
  });

  it('skips malformed entries and a body with no array', async () => {
    const junk = harness([
      [/./, () => json({ value: [null, 7, { id: 'a' }, cmdLineEntries()[0]] })],
    ]);
    await expect(listInstalledTasks(junk.client)).resolves.toHaveLength(1);
    const none = harness([[/./, () => json({ count: 0 })]]);
    await expect(listInstalledTasks(none.client)).resolves.toEqual([]);
  });
});

describe('cacheTaskMetadata (docs/05 §4)', () => {
  it('caches the marketplace fixture task.json under name@version', async () => {
    const cacheDir = await scratch();
    const { client, urls } = harness([
      [/./, () => json({ count: 5, value: replacetokensEntries() })],
    ]);

    const cached = await cacheTaskMetadata(client, { cacheDir, reference: 'replacetokens@6' });

    expect(cached.fetched).toBe(true);
    expect(cached.task.version.major).toBe(6);
    expect(cached.dir).toBe(
      taskCacheDir(cacheDir, 'replacetokens', { major: 6, minor: 3, patch: 1 }),
    );
    // One call: the list already carries the whole definition (C-E09-085).
    expect(urls).toHaveLength(1);

    const written = JSON.parse(await readFile(join(cached.dir, 'task.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(written).toMatchObject({
      id: REPLACETOKENS_ID,
      name: 'replacetokens',
      contributionIdentifier: 'qetza.replacetokens.replacetokens-task',
    });
    expect(written.inputs).toBeInstanceOf(Array);
  });

  it('defaults to the highest major when the reference names none', async () => {
    const cacheDir = await scratch();
    const { client } = harness([[/./, () => json({ value: replacetokensEntries() })]]);
    await expect(
      cacheTaskMetadata(client, { cacheDir, reference: 'replacetokens' }),
    ).resolves.toMatchObject({ task: { version: { major: 7 } } });
  });

  it('says which half of the reference failed', async () => {
    const cacheDir = await scratch();
    const { client } = harness([[/./, () => json({ value: replacetokensEntries() })]]);
    await expect(
      cacheTaskMetadata(client, { cacheDir, reference: 'replacetokens@99' }),
    ).rejects.toThrow('no version with major 99');
    await expect(
      cacheTaskMetadata(client, { cacheDir, reference: 'nosuchtask@1' }),
    ).rejects.toThrow('no installed task matches');
  });
});

describe('readCachedTask — the --frozen entry point', () => {
  it('reads the cached definition with no network call', async () => {
    const cacheDir = await scratch();
    const { client } = harness([[/./, () => json({ value: replacetokensEntries() })]]);
    await cacheTaskMetadata(client, { cacheDir, reference: 'replacetokens@6' });

    const cached = await readCachedTask(cacheDir, 'replacetokens', {
      major: 6,
      minor: 3,
      patch: 1,
    });
    expect(cached?.fetched).toBe(false);
    expect(cached?.task.id).toBe(REPLACETOKENS_ID);
  });

  it('treats a missing, unparseable or unusable file as a miss', async () => {
    const cacheDir = await scratch();
    const version = { major: 6, minor: 3, patch: 1 };
    await expect(readCachedTask(cacheDir, 'replacetokens', version)).resolves.toBeUndefined();

    const { mkdir: makeDir, writeFile: write } = await import('node:fs/promises');
    const dir = taskCacheDir(cacheDir, 'replacetokens', version);
    await makeDir(dir, { recursive: true });

    await write(join(dir, 'task.json'), 'not json', 'utf8');
    await expect(readCachedTask(cacheDir, 'replacetokens', version)).resolves.toBeUndefined();

    await write(join(dir, 'task.json'), JSON.stringify({ name: 'no id' }), 'utf8');
    await expect(readCachedTask(cacheDir, 'replacetokens', version)).resolves.toBeUndefined();
  });
});

describe('downloadTaskZip (C-E09-088)', () => {
  const task: InstalledTask = parseInstalledTask(
    entry('replacetokens', REPLACETOKENS_ID, 6, 3, 1, {
      contributionIdentifier: 'qetza.replacetokens.replacetokens-task',
    }),
  )!;

  it('addresses the exact major.minor.patch and unpacks beside task.json', async () => {
    // The route rejects a major alone: `.../6.4.0` (a version that does not exist) is a 404, so the
    // version has to come from the list call first.
    const cacheDir = await scratch();
    const zip = adoZip([{ name: 'exec-child.js', body: 'module.exports = {};\n' }]);
    const urls: string[] = [];
    const fetchImpl: RestFetch = (url) => {
      urls.push(url);
      return Promise.resolve(
        new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } }),
      );
    };
    const client = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    const result = await downloadTaskZip(client, task, cacheDir);

    expect(new URL(urls[0]!).pathname).toBe(
      `/example-org/_apis/distributedtask/tasks/${REPLACETOKENS_ID}/6.3.1`,
    );
    expect(result.files).toBe(1);
    await expect(stat(join(result.dir, 'task.zip'))).resolves.toBeTruthy();
    await expect(readFile(join(result.dir, 'tree', 'exec-child.js'), 'utf8')).resolves.toContain(
      'module.exports',
    );
  });

  it('surfaces the service TaskDefinitionNotFoundException', async () => {
    const cacheDir = await scratch();
    const fetchImpl: RestFetch = () =>
      Promise.resolve(
        json(
          {
            message:
              'No task definition found matching ID a8515ec8-… and version 6.4.0. You must register the task definition before uploading the package.',
            typeKey: 'TaskDefinitionNotFoundException',
          },
          404,
        ),
      );
    const client = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      fetchImpl,
      sleep: () => Promise.resolve(),
      maxRetries: 0,
    });

    const error = (await downloadTaskZip(client, task, cacheDir).catch(
      (caught: unknown) => caught,
    )) as RestError;
    expect(error.status).toBe(404);
    // The message talks about *uploading* when we only read — so the typeKey is the useful signal.
    expect(error.typeKey).toBe('TaskDefinitionNotFoundException');
  });
});

describe('E07-S01-T01 — the three gaps E09-S03-T05 left open', () => {
  const task: InstalledTask = parseInstalledTask(
    entry('replacetokens', REPLACETOKENS_ID, 6, 3, 1, {
      contributionIdentifier: 'qetza.replacetokens.replacetokens-task',
    }),
  )!;

  it('reuses an unpacked package with no request at all (offline-reproducible)', async () => {
    const cacheDir = await scratch();
    const zip = adoZip([{ name: 'exec-child.js', body: 'module.exports = {};\n' }]);
    let requests = 0;
    const fetchImpl: RestFetch = () => {
      requests += 1;
      return Promise.resolve(new Response(zip, { status: 200 }));
    };
    const client = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    const first = await downloadTaskZip(client, task, cacheDir);
    expect(first.fetched).toBe(true);
    expect(requests).toBe(1);

    // A fetch impl that throws: this passes only if nothing was requested.
    const offline = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      sleep: () => Promise.resolve(),
      fetchImpl: () => {
        throw new Error('cache hit made a network request');
      },
    });
    const second = await downloadTaskZip(offline, task, cacheDir);
    expect(second).toMatchObject({ dir: first.dir, files: first.files, fetched: false });
    expect(requests).toBe(1);
  });

  it('re-downloads when the zip is there but the tree is not', async () => {
    // A zip without a tree means an extraction that did not finish; reusing it would hand
    // real-task mode an entry with no files in it.
    const cacheDir = await scratch();
    const dir = taskCacheDir(cacheDir, task.name, task.version);
    const { mkdir: makeDir, writeFile: write } = await import('node:fs/promises');
    await makeDir(dir, { recursive: true });
    await write(join(dir, 'task.zip'), 'truncated');

    const zip = adoZip([{ name: 'exec-child.js', body: 'ok\n' }]);
    const client = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      sleep: () => Promise.resolve(),
      fetchImpl: () => Promise.resolve(new Response(zip, { status: 200 })),
    });
    await expect(downloadTaskZip(client, task, cacheDir)).resolves.toMatchObject({ fetched: true });
  });

  it('keys the lockfile pin by the authored reference and the exact three-part version', () => {
    // C-E09-088: pinning only the major would leave the download route unaddressable.
    expect(taskPin(task, 'replacetokens@6')).toEqual({
      key: 'replacetokens@6',
      id: REPLACETOKENS_ID,
      version: '6.3.1',
    });
    // With no authored reference, the key is reconstructed from name and major.
    expect(taskPin(task).key).toBe('replacetokens@6');
  });
});
