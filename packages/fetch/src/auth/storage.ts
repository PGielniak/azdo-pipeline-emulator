import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const AZDO_KEYRING_SERVICE = 'azdo-emu';
export const TOKEN_FILE_VERSION = 1 as const;

export type AzureAuthMode = 'interactive' | 'az' | 'pat';
export type CredentialBackend = 'keyring' | 'file';

/**
 * The secret-bearing record shared by the E09 auth producers.
 *
 * `token` is an access token for interactive/az and the PAT itself for pat mode. A device-code
 * producer may additionally persist its refresh token. Nothing in this record is safe to log as a
 * whole, so errors name only the organization and field that failed validation.
 */
export interface StoredAzureCredential {
  readonly version: typeof TOKEN_FILE_VERSION;
  readonly orgUrl: string;
  readonly mode: AzureAuthMode;
  readonly token: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
}

export interface LoadedAzureCredential {
  readonly backend: CredentialBackend;
  readonly credential: StoredAzureCredential;
}

interface TokenFile {
  readonly version: typeof TOKEN_FILE_VERSION;
  readonly credentials: Readonly<Record<string, StoredAzureCredential>>;
}

export interface KeyringEntry {
  setPassword(password: string): Promise<void>;
  getPassword(): Promise<string | undefined>;
  deleteCredential(): Promise<boolean>;
}

export interface KeyringModule {
  readonly AsyncEntry: new (service: string, username: string) => KeyringEntry;
}

export type KeyringLoader = () => Promise<KeyringModule>;

export interface CredentialStoreOptions {
  /** Test/config override; the product default is `~/.azdo-emu/tokens.json`. */
  readonly fallbackPath?: string;
  /** Injectable because a native keyring can be installed but inaccessible in a headless session. */
  readonly keyringLoader?: KeyringLoader;
}

export class CredentialStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CredentialStoreError';
  }
}

/** Package-local export so the installed native binding is verified without touching a keychain. */
export const loadDefaultKeyring: KeyringLoader = () => import('@napi-rs/keyring');

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/** Canonical storage key: HTTPS URL, no query/fragment, and no trailing slash. */
export function normalizeAzureOrgUrl(orgUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(orgUrl);
  } catch (error) {
    throw new CredentialStoreError(`invalid Azure DevOps organization URL`, { cause: error });
  }
  if (parsed.protocol !== 'https:') {
    throw new CredentialStoreError(`Azure DevOps organization URL must use https`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CredentialStoreError(
      `Azure DevOps organization URL must not contain credentials, a query, or a fragment`,
    );
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  return `https://${parsed.host.toLowerCase()}${pathname}`;
}

function normalizeCredential(credential: StoredAzureCredential): StoredAzureCredential {
  const orgUrl = normalizeAzureOrgUrl(credential.orgUrl);
  if (credential.version !== TOKEN_FILE_VERSION) {
    throw new CredentialStoreError(`unsupported credential version for ${orgUrl}`);
  }
  if (!['interactive', 'az', 'pat'].includes(credential.mode)) {
    throw new CredentialStoreError(`invalid authentication mode for ${orgUrl}`);
  }
  if (typeof credential.token !== 'string' || credential.token.length === 0) {
    throw new CredentialStoreError(`credential token is empty for ${orgUrl}`);
  }
  if (credential.refreshToken !== undefined && credential.refreshToken.length === 0) {
    throw new CredentialStoreError(`credential refresh token is empty for ${orgUrl}`);
  }
  if (credential.expiresAt !== undefined && !Number.isFinite(Date.parse(credential.expiresAt))) {
    throw new CredentialStoreError(`credential expiry is invalid for ${orgUrl}`);
  }
  return { ...credential, orgUrl };
}

function parseCredential(serialized: string, expectedOrgUrl: string): StoredAzureCredential {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new CredentialStoreError(`stored credential is not valid JSON for ${expectedOrgUrl}`, {
      cause: error,
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialStoreError(`stored credential has an invalid shape for ${expectedOrgUrl}`);
  }

  const record = value as Partial<StoredAzureCredential>;
  if (
    typeof record.orgUrl !== 'string' ||
    typeof record.mode !== 'string' ||
    typeof record.token !== 'string'
  ) {
    throw new CredentialStoreError(`stored credential has an invalid shape for ${expectedOrgUrl}`);
  }
  const credential = normalizeCredential(record as StoredAzureCredential);
  if (credential.orgUrl !== expectedOrgUrl) {
    throw new CredentialStoreError(
      `stored credential organization does not match ${expectedOrgUrl}`,
    );
  }
  return credential;
}

function parseTokenFile(serialized: string, path: string): TokenFile {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new CredentialStoreError(`credential fallback file is not valid JSON: ${path}`, {
      cause: error,
    });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new CredentialStoreError(`credential fallback file has an invalid shape: ${path}`);
  }
  const record = value as { version?: unknown; credentials?: unknown };
  if (
    record.version !== TOKEN_FILE_VERSION ||
    record.credentials === null ||
    typeof record.credentials !== 'object' ||
    Array.isArray(record.credentials)
  ) {
    throw new CredentialStoreError(`credential fallback file has an invalid shape: ${path}`);
  }
  return record as TokenFile;
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error;
  }
}

/** OS keyring first; protected JSON fallback when the native store is absent or inaccessible. */
export class AzureCredentialStore {
  readonly fallbackPath: string;
  readonly #keyringLoader: KeyringLoader;

  constructor(options: CredentialStoreOptions = {}) {
    this.fallbackPath = options.fallbackPath ?? join(homedir(), '.azdo-emu', 'tokens.json');
    this.#keyringLoader = options.keyringLoader ?? loadDefaultKeyring;
  }

  async load(orgUrl: string): Promise<LoadedAzureCredential | undefined> {
    const key = normalizeAzureOrgUrl(orgUrl);
    try {
      const entry = await this.#keyringEntry(key);
      const serialized = await entry.getPassword();
      if (serialized !== undefined) {
        return { backend: 'keyring', credential: parseCredential(serialized, key) };
      }
    } catch (error) {
      // C-E09-008: native lookup errors (including NoEntry) cross into the 0600 fallback.
      if (error instanceof CredentialStoreError) throw error;
    }

    const credential = await this.#loadFromFile(key);
    return credential === undefined ? undefined : { backend: 'file', credential };
  }

  async save(credential: StoredAzureCredential): Promise<CredentialBackend> {
    const normalized = normalizeCredential(credential);
    try {
      const entry = await this.#keyringEntry(normalized.orgUrl);
      await entry.setPassword(JSON.stringify(normalized));
      await this.#removeFromFile(normalized.orgUrl);
      return 'keyring';
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      await this.#saveToFile(normalized);
      return 'file';
    }
  }

  async delete(orgUrl: string): Promise<boolean> {
    const key = normalizeAzureOrgUrl(orgUrl);
    let deletedFromKeyring = false;
    try {
      const entry = await this.#keyringEntry(key);
      deletedFromKeyring = await entry.deleteCredential();
    } catch {
      // The fallback remains usable when the keyring is unavailable; delete it below.
    }
    return (await this.#removeFromFile(key)) || deletedFromKeyring;
  }

  async #keyringEntry(orgUrl: string): Promise<KeyringEntry> {
    const { AsyncEntry } = await this.#keyringLoader();
    return new AsyncEntry(AZDO_KEYRING_SERVICE, orgUrl);
  }

  async #readTokenFile(): Promise<TokenFile | undefined> {
    try {
      // C-E09-011: creation mode alone cannot repair an existing permissive file.
      await chmod(this.fallbackPath, 0o600);
      return parseTokenFile(await readFile(this.fallbackPath, 'utf8'), this.fallbackPath);
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      throw error;
    }
  }

  async #loadFromFile(orgUrl: string): Promise<StoredAzureCredential | undefined> {
    const file = await this.#readTokenFile();
    const credential = file?.credentials[orgUrl];
    return credential === undefined
      ? undefined
      : parseCredential(JSON.stringify(credential), orgUrl);
  }

  async #saveToFile(credential: StoredAzureCredential): Promise<void> {
    const existing = await this.#readTokenFile();
    const next: TokenFile = {
      version: TOKEN_FILE_VERSION,
      credentials: { ...existing?.credentials, [credential.orgUrl]: credential },
    };
    await this.#writeTokenFile(next);
  }

  async #removeFromFile(orgUrl: string): Promise<boolean> {
    const existing = await this.#readTokenFile();
    if (existing?.credentials[orgUrl] === undefined) return false;

    const credentials = { ...existing.credentials };
    delete credentials[orgUrl];
    if (Object.keys(credentials).length === 0) {
      await removeIfPresent(this.fallbackPath);
    } else {
      await this.#writeTokenFile({ version: TOKEN_FILE_VERSION, credentials });
    }
    return true;
  }

  async #writeTokenFile(file: TokenFile): Promise<void> {
    const directory = dirname(this.fallbackPath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);

    const temporary = `${this.fallbackPath}.${process.pid}-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      await chmod(temporary, 0o600);
      await rename(temporary, this.fallbackPath);
      await chmod(this.fallbackPath, 0o600);
    } finally {
      await removeIfPresent(temporary);
    }
  }
}
