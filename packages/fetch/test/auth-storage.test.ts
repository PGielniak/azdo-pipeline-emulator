import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AZDO_KEYRING_SERVICE,
  AzureCredentialStore,
  CredentialStoreError,
  loadDefaultKeyring,
  normalizeAzureOrgUrl,
  type KeyringLoader,
  type StoredAzureCredential,
} from '../src/auth/storage.js';

const PAT: StoredAzureCredential = {
  version: 1,
  orgUrl: 'https://dev.azure.com/Example/',
  mode: 'pat',
  token: 'fake-pat-for-tests',
};

let tempDirs: string[] = [];
async function makeFallbackPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'azdo-emu-token-store-'));
  tempDirs.push(directory);
  return join(directory, 'config', 'tokens.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })));
  tempDirs = [];
});

function unavailableKeyring(): KeyringLoader {
  return () => Promise.reject(new Error('headless keyring'));
}

function memoryKeyring(initial: Readonly<Record<string, string>> = {}) {
  const values = new Map(Object.entries(initial));
  const calls: Array<{ service: string; username: string }> = [];
  const loader: KeyringLoader = async () => ({
    AsyncEntry: class {
      readonly #username: string;

      constructor(service: string, username: string) {
        calls.push({ service, username });
        this.#username = username;
      }

      async setPassword(password: string): Promise<void> {
        values.set(this.#username, password);
      }

      async getPassword(): Promise<string | undefined> {
        return values.get(this.#username);
      }

      async deleteCredential(): Promise<boolean> {
        return values.delete(this.#username);
      }
    },
  });
  return { calls, loader, values };
}

describe('AzureCredentialStore', () => {
  it('loads the installed optional native module without touching the user keychain', async () => {
    await expect(loadDefaultKeyring()).resolves.toMatchObject({ AsyncEntry: expect.any(Function) });
  });

  it('stores by normalized organization in the OS keyring (C-E09-007)', async () => {
    const fallbackPath = await makeFallbackPath();
    const keyring = memoryKeyring();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: keyring.loader });

    expect(await store.save(PAT)).toBe('keyring');
    expect(await store.load('https://dev.azure.com/Example')).toEqual({
      backend: 'keyring',
      credential: { ...PAT, orgUrl: 'https://dev.azure.com/Example' },
    });
    expect(keyring.calls[0]).toEqual({
      service: AZDO_KEYRING_SERVICE,
      username: 'https://dev.azure.com/Example',
    });
    await expect(stat(fallbackPath)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await store.delete(PAT.orgUrl)).toBe(true);
    expect(await store.load(PAT.orgUrl)).toBeUndefined();
  });

  it('falls back atomically to an owner-only file when the keyring is inaccessible (C-E09-008/011)', async () => {
    const fallbackPath = await makeFallbackPath();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: unavailableKeyring() });

    expect(await store.save(PAT)).toBe('file');
    expect((await stat(fallbackPath)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(fallbackPath))).mode & 0o777).toBe(0o700);
    expect(await store.load(PAT.orgUrl)).toEqual({
      backend: 'file',
      credential: { ...PAT, orgUrl: 'https://dev.azure.com/Example' },
    });

    const serialized = await readFile(fallbackPath, 'utf8');
    expect(serialized).toContain('fake-pat-for-tests');
    expect(serialized).not.toContain('.tmp');
  });

  it('repairs an existing fallback file that became world-readable (C-E09-011)', async () => {
    const fallbackPath = await makeFallbackPath();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: unavailableKeyring() });
    await store.save(PAT);
    await chmod(fallbackPath, 0o644);

    await store.load(PAT.orgUrl);

    expect((await stat(fallbackPath)).mode & 0o777).toBe(0o600);
  });

  it('preserves other organizations and removes the file after its final credential is deleted', async () => {
    const fallbackPath = await makeFallbackPath();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: unavailableKeyring() });
    const second: StoredAzureCredential = {
      version: 1,
      orgUrl: 'https://other.visualstudio.com',
      mode: 'az',
      token: 'fake-entra-token',
      expiresAt: '2026-08-29T00:00:00.000Z',
    };
    await store.save(PAT);
    await store.save(second);

    expect(await store.delete(PAT.orgUrl)).toBe(true);
    expect(await store.load(PAT.orgUrl)).toBeUndefined();
    expect((await store.load(second.orgUrl))?.credential).toEqual(second);
    expect(await store.delete(second.orgUrl)).toBe(true);
    await expect(stat(fallbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('migrates away from the fallback after a later keyring save succeeds', async () => {
    const fallbackPath = await makeFallbackPath();
    await new AzureCredentialStore({
      fallbackPath,
      keyringLoader: unavailableKeyring(),
    }).save(PAT);
    const keyring = memoryKeyring();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: keyring.loader });

    expect(await store.save(PAT)).toBe('keyring');
    await expect(stat(fallbackPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.load(PAT.orgUrl))?.backend).toBe('keyring');
  });

  it('does not reinterpret corrupt keyring data as an absent entry (C-E09-008)', async () => {
    const fallbackPath = await makeFallbackPath();
    await new AzureCredentialStore({
      fallbackPath,
      keyringLoader: unavailableKeyring(),
    }).save(PAT);
    const keyring = memoryKeyring({ 'https://dev.azure.com/Example': '{not json' });
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: keyring.loader });

    await expect(store.load(PAT.orgUrl)).rejects.toThrow(CredentialStoreError);
  });

  it('consults the file fallback when an installed keyring reports a native lookup error (C-E09-008)', async () => {
    const fallbackPath = await makeFallbackPath();
    await new AzureCredentialStore({
      fallbackPath,
      keyringLoader: unavailableKeyring(),
    }).save(PAT);
    const nativeError: KeyringLoader = async () => ({
      AsyncEntry: class {
        async setPassword(): Promise<void> {}
        async getPassword(): Promise<string | undefined> {
          throw new Error('NoEntry');
        }
        async deleteCredential(): Promise<boolean> {
          return false;
        }
      },
    });

    await expect(
      new AzureCredentialStore({ fallbackPath, keyringLoader: nativeError }).load(PAT.orgUrl),
    ).resolves.toMatchObject({ backend: 'file', credential: { mode: 'pat' } });
  });

  it('validates URLs and expiry without including credential values in errors', async () => {
    expect(normalizeAzureOrgUrl('https://dev.azure.com/acme///')).toBe(
      'https://dev.azure.com/acme',
    );
    expect(() => normalizeAzureOrgUrl('http://dev.azure.com/acme')).toThrow(/must use https/);
    expect(() => normalizeAzureOrgUrl('not a URL')).toThrow(/invalid Azure DevOps/);
    expect(() => normalizeAzureOrgUrl('https://dev.azure.com/acme?token=no')).toThrow(
      /must not contain/,
    );

    const fallbackPath = await makeFallbackPath();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: unavailableKeyring() });
    const secret = 'do-not-echo-this-secret';
    await expect(
      store.save({ ...PAT, token: secret, expiresAt: 'not-a-date' }),
    ).rejects.not.toThrow(secret);

    const invalidRecords: StoredAzureCredential[] = [
      { ...PAT, version: 2 as 1 },
      { ...PAT, mode: 'other' as 'pat' },
      { ...PAT, token: '' },
      { ...PAT, refreshToken: '' },
    ];
    for (const credential of invalidRecords) {
      await expect(store.save(credential)).rejects.toThrow(CredentialStoreError);
    }
  });

  it('rejects malformed keyring records without exposing their values', async () => {
    const fallbackPath = await makeFallbackPath();
    const key = 'https://dev.azure.com/Example';
    const malformed = [
      'null',
      '{}',
      JSON.stringify({ ...PAT, orgUrl: 'https://dev.azure.com/different' }),
    ];

    for (const value of malformed) {
      const store = new AzureCredentialStore({
        fallbackPath,
        keyringLoader: memoryKeyring({ [key]: value }).loader,
      });
      await expect(store.load(PAT.orgUrl)).rejects.toThrow(CredentialStoreError);
    }
  });

  it('rejects malformed fallback documents and propagates non-missing filesystem errors', async () => {
    const fallbackPath = await makeFallbackPath();
    const store = new AzureCredentialStore({ fallbackPath, keyringLoader: unavailableKeyring() });
    await store.save(PAT);

    for (const value of ['not-json', '[]', '{"version":2,"credentials":{}}']) {
      await writeFile(fallbackPath, value, 'utf8');
      await expect(store.load(PAT.orgUrl)).rejects.toThrow(CredentialStoreError);
    }

    const directoryPath = await makeFallbackPath();
    await mkdir(directoryPath, { recursive: true });
    await expect(
      new AzureCredentialStore({
        fallbackPath: directoryPath,
        keyringLoader: unavailableKeyring(),
      }).load(PAT.orgUrl),
    ).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
