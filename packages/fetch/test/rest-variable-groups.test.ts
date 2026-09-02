import { describe, expect, it } from 'vitest';
import {
  envExampleBlock,
  getVariableGroup,
  getVariableGroups,
  parseVariableGroup,
} from '../src/rest/variable-groups.js';
import { AzureDevOpsClient, type RestFetch, type Sleeper } from '../src/rest/client.js';
import type { StoredAzureCredential } from '../src/auth/storage.js';

const ORG = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG,
  mode: 'pat',
  token: 'fake-pat-for-vg-tests',
};

/** The exact string the service would hand back for a non-secret member (C-E09-080). */
const PLAINTEXT = 'super-secret-looking-plaintext-value';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; api-version=7.1' },
  });

function harness(response: () => Response): { client: AzureDevOpsClient; urls: string[] } {
  const urls: string[] = [];
  const fetchImpl: RestFetch = (url) => {
    urls.push(url);
    return Promise.resolve(response());
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

/** Mirrors the live response: a plaintext member, a read-only member, a nulled secret. */
const liveShapedGroup = (name = 'azdo-emu-corpus-group') => ({
  id: 2,
  name,
  description: 'corpus fixture group',
  type: 'Vsts',
  isShared: false,
  createdBy: {},
  createdOn: '2026-08-01T00:00:00Z',
  modifiedBy: {},
  modifiedOn: '2026-08-01T00:00:00Z',
  variableGroupProjectReferences: [],
  variables: {
    // C-E09-081: no `isSecret` key at all on a non-secret variable.
    corpusPlainValue: { value: PLAINTEXT },
    corpusReadOnlyValue: { isReadOnly: true, value: PLAINTEXT },
    corpusSecret: { value: null, isSecret: true },
  },
});

describe('parseVariableGroup — the discard rule (C-E09-080/084)', () => {
  it('drops every value at the parse boundary, so there is nothing left to leak', () => {
    // The service volunteers non-secret values in plaintext; not persisting them is an act, not a
    // side effect of the API withholding them. The type has no value field at all.
    const group = parseVariableGroup(liveShapedGroup());

    expect(group).toBeDefined();
    expect(JSON.stringify(group)).not.toContain(PLAINTEXT);
    for (const variable of group!.variables) {
      expect('value' in variable).toBe(false);
    }
  });

  it('reads an absent isSecret as "not secret", never as false (C-E09-081)', () => {
    // `v.isSecret === false` is a check that never fires against a real response.
    const group = parseVariableGroup(liveShapedGroup())!;
    expect(group.variables).toEqual([
      { name: 'corpusPlainValue', isSecret: false, isReadOnly: false },
      { name: 'corpusReadOnlyValue', isSecret: false, isReadOnly: true },
      { name: 'corpusSecret', isSecret: true, isReadOnly: false },
    ]);
  });

  it('keeps the group metadata the emitter needs (C-E09-083)', () => {
    expect(parseVariableGroup(liveShapedGroup())).toMatchObject({
      id: 2,
      name: 'azdo-emu-corpus-group',
      description: 'corpus fixture group',
      type: 'Vsts',
      isShared: false,
    });
  });

  it('sorts members by name so a re-fetch produces the same block', () => {
    const group = parseVariableGroup({
      id: 1,
      name: 'g',
      variables: { zebra: {}, alpha: {}, middle: {} },
    })!;
    expect(group.variables.map((v) => v.name)).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('tolerates a group with no variables, or a malformed variables member', () => {
    expect(parseVariableGroup({ id: 1, name: 'g' })?.variables).toEqual([]);
    expect(parseVariableGroup({ id: 1, name: 'g', variables: [] })?.variables).toEqual([]);
    expect(parseVariableGroup({ id: 1, name: 'g', variables: null })?.variables).toEqual([]);
    expect(
      parseVariableGroup({ id: 1, name: 'g', variables: { a: null, b: 7 } })?.variables,
    ).toEqual([
      { name: 'a', isSecret: false, isReadOnly: false },
      { name: 'b', isSecret: false, isReadOnly: false },
    ]);
  });

  it('rejects a body that is not a group', () => {
    expect(parseVariableGroup(null)).toBeUndefined();
    expect(parseVariableGroup(7)).toBeUndefined();
    expect(parseVariableGroup({ name: 'no id' })).toBeUndefined();
    expect(parseVariableGroup({ id: 1 })).toBeUndefined();
  });
});

describe('getVariableGroup (C-E09-082)', () => {
  it('sends the name as a groupName filter and verifies what comes back', async () => {
    const { client, urls } = harness(() => json({ count: 1, value: [liveShapedGroup()] }));
    const group = await getVariableGroup(client, 'azdo-emu-corpus-group');

    expect(group?.id).toBe(2);
    expect(new URL(urls[0]!).searchParams.get('groupName')).toBe('azdo-emu-corpus-group');
  });

  it('matches case-insensitively', async () => {
    const { client } = harness(() => json({ value: [liveShapedGroup()] }));
    await expect(getVariableGroup(client, 'AZDO-EMU-CORPUS-GROUP')).resolves.toMatchObject({
      id: 2,
    });
  });

  it('does not send a name containing `*`, which the service would read as a wildcard', async () => {
    const { client, urls } = harness(() => json({ value: [liveShapedGroup('prod*west')] }));
    await expect(getVariableGroup(client, 'prod*west')).resolves.toMatchObject({ id: 2 });
    expect(new URL(urls[0]!).searchParams.has('groupName')).toBe(false);
  });

  it('does not trust the count when the returned name is a different group', async () => {
    const { client } = harness(() => json({ count: 1, value: [liveShapedGroup('other-group')] }));
    await expect(getVariableGroup(client, 'azdo-emu-corpus-group')).resolves.toBeUndefined();
  });

  it('returns undefined for an empty or malformed result', async () => {
    const empty = harness(() => json({ count: 0, value: [] }));
    await expect(getVariableGroup(empty.client, 'nope')).resolves.toBeUndefined();

    const noArray = harness(() => json({ count: 0 }));
    await expect(getVariableGroup(noArray.client, 'nope')).resolves.toBeUndefined();
  });

  it('never lets a plaintext value out through the request path either', async () => {
    const { client } = harness(() => json({ value: [liveShapedGroup()] }));
    const group = await getVariableGroup(client, 'azdo-emu-corpus-group');
    expect(JSON.stringify(group)).not.toContain(PLAINTEXT);
  });
});

describe('getVariableGroups', () => {
  it('reports missing groups rather than failing the whole fetch', async () => {
    const known = new Set(['azdo-emu-corpus-group']);
    const urls: string[] = [];
    const fetchImpl: RestFetch = (url) => {
      urls.push(url);
      const wanted = new URL(url).searchParams.get('groupName') ?? '';
      return Promise.resolve(json({ value: known.has(wanted) ? [liveShapedGroup(wanted)] : [] }));
    };
    const client = new AzureDevOpsClient({
      orgUrl: ORG,
      credential: PAT,
      project: 'Example',
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    const result = await getVariableGroups(client, ['azdo-emu-corpus-group', 'not-there']);
    expect(result.groups.map((g) => g.name)).toEqual(['azdo-emu-corpus-group']);
    expect(result.missing).toEqual(['not-there']);
  });
});

describe('envExampleBlock — the Done criterion', () => {
  it('lists names with secret and read-only annotations, and no values', () => {
    const block = envExampleBlock(parseVariableGroup(liveShapedGroup())!);

    expect(block[0]).toContain("Variable group 'azdo-emu-corpus-group' (id 2)");
    expect(block[0]).toContain('never fetches values');
    expect(block.slice(1)).toEqual([
      'corpusPlainValue=',
      'corpusReadOnlyValue=   # read-only',
      'corpusSecret=   # secret',
    ]);
    // The whole point: the value the API handed us appears nowhere in what we write to disk.
    expect(block.join('\n')).not.toContain(PLAINTEXT);
  });

  it('says so plainly when a group declares nothing', () => {
    const block = envExampleBlock(parseVariableGroup({ id: 9, name: 'empty' })!);
    expect(block).toHaveLength(2);
    expect(block[1]).toContain("group 'empty' declares no variables");
  });
});
