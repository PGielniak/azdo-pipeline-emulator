import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authStatus,
  credentialAuthorizationHeader,
  profileUrl,
  type StatusFetch,
} from '../src/auth/status.js';
import {
  AzureCredentialStore,
  type KeyringLoader,
  type StoredAzureCredential,
} from '../src/auth/storage.js';
import { authorizationHeader } from '../src/oracle.js';

const ORG_URL = 'https://dev.azure.com/example-org';
const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: ORG_URL,
  mode: 'pat',
  token: 'fake-pat-for-status-tests',
};

let tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

const unavailableKeyring: KeyringLoader = () => Promise.reject(new Error('no keyring'));

async function makeStore(
  credential: StoredAzureCredential | null = PAT,
): Promise<AzureCredentialStore> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-auth-status-'));
  tempDirs.push(directory);
  const store = new AzureCredentialStore({
    fallbackPath: join(directory, 'tokens.json'),
    keyringLoader: unavailableKeyring,
  });
  if (credential !== null) await store.save(credential);
  return store;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('profileUrl', () => {
  it('uses the deployment host for modern and legacy organization URLs (C-E09-010)', () => {
    expect(profileUrl('https://dev.azure.com/my-org/')).toBe(
      'https://vssps.dev.azure.com/my-org/_apis/profile/profiles/me?api-version=7.1',
    );
    expect(profileUrl('https://my-org.visualstudio.com')).toBe(
      'https://vssps.dev.azure.com/my-org/_apis/profile/profiles/me?api-version=7.1',
    );
    expect(() => profileUrl('https://example.com/my-org')).toThrow(/cannot derive/);
  });
});

describe('credentialAuthorizationHeader', () => {
  it('uses Basic for PAT and Bearer for interactive/az credentials', () => {
    expect(credentialAuthorizationHeader(PAT)).toBe(authorizationHeader(PAT.token));
    expect(credentialAuthorizationHeader({ ...PAT, mode: 'az' })).toBe(`Bearer ${PAT.token}`);
    expect(credentialAuthorizationHeader({ ...PAT, mode: 'interactive' })).toBe(
      `Bearer ${PAT.token}`,
    );
  });
});

describe('authStatus', () => {
  it('reports signed out without making a probe when no credential is stored', async () => {
    const store = await makeStore(null);
    let called = false;

    expect(
      await authStatus(ORG_URL, {
        store,
        fetchImpl: () => {
          called = true;
          return Promise.reject(new Error('must not run'));
        },
      }),
    ).toEqual({ kind: 'signed-out', orgUrl: ORG_URL });
    expect(called).toBe(false);
  });

  it('shows org, identity, mode, and expiry after the live-shaped Profile probe (C-E09-009/010)', async () => {
    const store = await makeStore();
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: StatusFetch = (url, init) => {
      requests.push({ url, init });
      return Promise.resolve(
        json(200, {
          displayName: 'Example Person',
          publicAlias: 'example-person',
          emailAddress: 'person@example.invalid',
          id: '00000000-0000-0000-0000-000000000001',
          revision: 1,
        }),
      );
    };

    const status = await authStatus(ORG_URL, { store, fetchImpl });

    expect(status).toEqual({
      kind: 'authenticated',
      orgUrl: ORG_URL,
      mode: 'pat',
      expiresAt: null,
      identity: {
        displayName: 'Example Person',
        publicAlias: 'example-person',
        emailAddress: 'person@example.invalid',
        id: '00000000-0000-0000-0000-000000000001',
      },
    });
    expect(requests).toEqual([
      {
        url: 'https://vssps.dev.azure.com/example-org/_apis/profile/profiles/me?api-version=7.1',
        init: {
          method: 'GET',
          redirect: 'manual',
          headers: {
            Accept: 'application/json',
            Authorization: authorizationHeader(PAT.token),
          },
        },
      },
    ]);
    expect(JSON.stringify(status)).not.toContain(PAT.token);
  });

  it('preserves mode and expiry while classifying an invalid token', async () => {
    const credential: StoredAzureCredential = {
      ...PAT,
      mode: 'az',
      expiresAt: '2026-08-29T00:00:00.000Z',
    };
    const store = await makeStore(credential);

    expect(
      await authStatus(ORG_URL, {
        store,
        fetchImpl: () => Promise.resolve(json(401, { message: 'unauthorized' })),
      }),
    ).toEqual({
      kind: 'unauthenticated',
      orgUrl: ORG_URL,
      mode: 'az',
      expiresAt: credential.expiresAt,
      status: 401,
    });

    await expect(
      authStatus(ORG_URL, {
        store,
        fetchImpl: () =>
          Promise.resolve(new Response(null, { status: 302, headers: { location: '/signin' } })),
      }),
    ).resolves.toMatchObject({ kind: 'unauthenticated', status: 302 });
  });

  it('classifies service errors, malformed profiles, and network failures without returning bodies', async () => {
    const store = await makeStore();

    await expect(
      authStatus(ORG_URL, { store, fetchImpl: () => Promise.resolve(json(500, { token: 'x' })) }),
    ).resolves.toMatchObject({ kind: 'transport', status: 500, message: /HTTP 500/ });
    await expect(
      authStatus(ORG_URL, {
        store,
        fetchImpl: () => Promise.resolve(json(200, { displayName: 'missing id' })),
      }),
    ).resolves.toMatchObject({ kind: 'transport', status: 200, message: /omitted/ });
    await expect(
      authStatus(ORG_URL, {
        store,
        fetchImpl: () => Promise.resolve(json(200, null)),
      }),
    ).resolves.toMatchObject({ kind: 'transport', status: 200, message: /omitted/ });
    await expect(
      authStatus(ORG_URL, {
        store,
        fetchImpl: () => Promise.resolve(new Response('not-json', { status: 200 })),
      }),
    ).resolves.toMatchObject({ kind: 'transport', status: 200, message: /invalid JSON/ });
    await expect(
      authStatus(ORG_URL, {
        store,
        fetchImpl: () => Promise.reject(new Error('offline')),
      }),
    ).resolves.toMatchObject({ kind: 'transport', status: undefined, message: 'offline' });
  });

  it('falls back from a missing display name to public alias and then id', async () => {
    const store = await makeStore();
    const alias = await authStatus(ORG_URL, {
      store,
      fetchImpl: () => Promise.resolve(json(200, { id: 'id-1', publicAlias: 'alias' })),
    });
    const id = await authStatus(ORG_URL, {
      store,
      fetchImpl: () => Promise.resolve(json(200, { id: 'id-2' })),
    });

    expect(alias).toMatchObject({ identity: { id: 'id-1', displayName: 'alias' } });
    expect(id).toMatchObject({ identity: { id: 'id-2', displayName: 'id-2' } });
  });
});
