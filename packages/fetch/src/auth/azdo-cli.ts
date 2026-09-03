/**
 * The `az` arm of the Azure DevOps sign-in chain (E09-S01-T02, docs/05 §1).
 *
 * Reuses a session the user already established with `az login` by asking the Azure CLI for an
 * access token scoped to the Azure DevOps resource. Acquisition only — whether the organization
 * *accepts* that token is a separate question this module deliberately does not answer, because on
 * a Microsoft-account-backed organization it never will (C-E09-022) and the probe belongs in
 * `authStatus()` where it is paid for once.
 */
import { execFile } from 'node:child_process';

import { TOKEN_FILE_VERSION, normalizeAzureOrgUrl, type StoredAzureCredential } from './storage.js';

/**
 * Azure DevOps' Microsoft Entra resource identifier (C-E09-001). A v1.0 endpoint identifier, which
 * is why `--resource` and not `--scope` is the matching flag (C-E09-018).
 */
export const AZDO_ENTRA_RESOURCE = '499b84ac-1321-427f-aa17-267ca6975798';

export const AZ_TOKEN_ARGS: readonly string[] = [
  'account',
  'get-access-token',
  '--resource',
  AZDO_ENTRA_RESOURCE,
  '--output',
  'json',
];

/** Injectable so tests never shell out to a real Azure CLI. */
export type AzExec = (
  file: string,
  args: readonly string[],
) => Promise<{ readonly stdout: string; readonly stderr: string }>;

export interface AzTokenResult {
  readonly token: string;
  /** ISO-8601 UTC, derived from `expires_on` when present (C-E09-019). */
  readonly expiresAt?: string;
  readonly tenant?: string;
  readonly subscription?: string;
}

export class AzCliError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AzCliError';
  }
}

const defaultExec: AzExec = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new AzCliError(stderr.trim() || error.message, { cause: error }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

/**
 * Prefer `expires_on` (POSIX, UTC) over `expiresOn` (a **local** datetime with no offset and no
 * `Z`) — the reference page recommends exactly this, and parsing `expiresOn` as UTC would misdate
 * the credential by the host's offset (C-E09-019).
 */
export function expiryFrom(payload: Record<string, unknown>): string | undefined {
  const posix = payload.expires_on;
  if (typeof posix === 'number' && Number.isFinite(posix)) {
    return new Date(posix * 1000).toISOString();
  }
  // Some CLI versions render the POSIX field as a string; accept it before falling back.
  if (typeof posix === 'string' && /^\d+$/.test(posix.trim())) {
    return new Date(Number(posix.trim()) * 1000).toISOString();
  }

  const local = payload.expiresOn;
  if (typeof local !== 'string' || local.trim().length === 0) return undefined;
  // No offset in the string: let the platform read it in local time, which is what it denotes.
  const parsed = new Date(local.trim().replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function parseAzToken(stdout: string): AzTokenResult {
  let payload: unknown;
  try {
    payload = JSON.parse(stdout) as unknown;
  } catch (error) {
    throw new AzCliError('az account get-access-token did not return JSON', { cause: error });
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AzCliError('az account get-access-token returned an unexpected JSON shape');
  }

  const record = payload as Record<string, unknown>;
  const token = record.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    throw new AzCliError('az account get-access-token returned no accessToken');
  }

  const expiresAt = expiryFrom(record);
  return {
    token,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(typeof record.tenant === 'string' ? { tenant: record.tenant } : {}),
    ...(typeof record.subscription === 'string' ? { subscription: record.subscription } : {}),
  };
}

export interface AzTokenOptions {
  readonly exec?: AzExec;
  /** Override for tests and for a non-PATH install. */
  readonly azPath?: string;
}

/** Acquire an Azure DevOps access token from the Azure CLI. Throws `AzCliError` when unavailable. */
export async function readAzAccessToken(options: AzTokenOptions = {}): Promise<AzTokenResult> {
  const exec = options.exec ?? defaultExec;
  const { stdout } = await exec(options.azPath ?? 'az', AZ_TOKEN_ARGS);
  return parseAzToken(stdout);
}

/** Shape the acquired token as the record the credential store and `authStatus()` already speak. */
export function azCredential(orgUrl: string, token: AzTokenResult): StoredAzureCredential {
  return {
    version: TOKEN_FILE_VERSION,
    orgUrl: normalizeAzureOrgUrl(orgUrl),
    mode: 'az',
    token: token.token,
    ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
  };
}
