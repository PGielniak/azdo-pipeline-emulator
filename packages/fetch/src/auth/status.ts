import { authorizationHeader } from '../oracle.js';
import {
  AzureCredentialStore,
  normalizeAzureOrgUrl,
  type AzureAuthMode,
  type StoredAzureCredential,
} from './storage.js';

export const PROFILE_API_VERSION = '7.1';

export type StatusFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface AuthIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly emailAddress?: string;
  readonly publicAlias?: string;
}

interface StoredStatusFields {
  readonly orgUrl: string;
  readonly mode: AzureAuthMode;
  readonly expiresAt: string | null;
}

export type AzureAuthStatus =
  | { readonly kind: 'signed-out'; readonly orgUrl: string }
  | (StoredStatusFields & {
      readonly kind: 'authenticated';
      readonly identity: AuthIdentity;
    })
  | (StoredStatusFields & {
      readonly kind: 'unauthenticated';
      readonly status: number;
    })
  | (StoredStatusFields & {
      readonly kind: 'transport';
      readonly status: number | undefined;
      readonly message: string;
    });

export interface AuthStatusOptions {
  readonly store?: AzureCredentialStore;
  readonly fetchImpl?: StatusFetch;
  /**
   * Probe **this** credential instead of loading one from the store (E10-S03-T01).
   *
   * Without it `authStatus` answers `signed-out` for the majority case. Nothing in this repo calls
   * `AzureCredentialStore.save()` — only the device-code arm would, and that is E09-S01-T01, still
   * unbuilt — so the store is empty for every user today, while a user with `AZDO_PAT` set is
   * perfectly well authenticated (C-E09-023: on a Microsoft-account-backed organization the PAT arm
   * is the *only* working one, i.e. the default case). `auth status` must report the credential the
   * converter would actually use, which is what `selectAzureCredential` returns; this is the seam
   * that lets it, without the CLI re-deriving the grounded 302/401/403 mapping below (C-E10-030).
   */
  readonly credential?: StoredAzureCredential;
}

/** Profile is deployment-scoped; derive its host from either supported Azure DevOps cloud URL. */
export function profileUrl(orgUrl: string): string {
  const normalized = normalizeAzureOrgUrl(orgUrl);
  const parsed = new URL(normalized);
  let organization: string | undefined;

  if (parsed.hostname.toLowerCase() === 'dev.azure.com') {
    organization = parsed.pathname.split('/').filter(Boolean)[0];
  } else {
    const match = /^([^.]+)\.visualstudio\.com$/i.exec(parsed.hostname);
    organization = match?.[1];
  }
  if (organization === undefined || organization.length === 0) {
    throw new Error(`cannot derive Azure DevOps Services organization from ${normalized}`);
  }
  return (
    `https://vssps.dev.azure.com/${encodeURIComponent(organization)}` +
    `/_apis/profile/profiles/me?api-version=${PROFILE_API_VERSION}`
  );
}

/** PAT is Basic with an empty username; Entra/Azure CLI access tokens are Bearer tokens. */
export function credentialAuthorizationHeader(credential: StoredAzureCredential): string {
  return credential.mode === 'pat'
    ? authorizationHeader(credential.token)
    : `Bearer ${credential.token}`;
}

function storedFields(credential: StoredAzureCredential): StoredStatusFields {
  return {
    orgUrl: credential.orgUrl,
    mode: credential.mode,
    expiresAt: credential.expiresAt ?? null,
  };
}

function parseIdentity(value: unknown): AuthIdentity | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const profile = value as Record<string, unknown>;
  if (typeof profile.id !== 'string') return undefined;

  const displayName =
    typeof profile.displayName === 'string'
      ? profile.displayName
      : typeof profile.publicAlias === 'string'
        ? profile.publicAlias
        : profile.id;
  return {
    id: profile.id,
    displayName,
    ...(typeof profile.emailAddress === 'string' ? { emailAddress: profile.emailAddress } : {}),
    ...(typeof profile.publicAlias === 'string' ? { publicAlias: profile.publicAlias } : {}),
  };
}

/**
 * Load the selected organization credential and prove it with the documented Profile `me` call.
 * Token payloads are never decoded or returned (C-E09-006/009/010).
 */
export async function authStatus(
  orgUrl: string,
  options: AuthStatusOptions = {},
): Promise<AzureAuthStatus> {
  const normalized = normalizeAzureOrgUrl(orgUrl);
  let credential = options.credential;
  if (credential === undefined) {
    const store = options.store ?? new AzureCredentialStore();
    const loaded = await store.load(normalized);
    if (loaded === undefined) return { kind: 'signed-out', orgUrl: normalized };
    credential = loaded.credential;
  }

  const fields = storedFields(credential);
  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(profileUrl(normalized), {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        Authorization: credentialAuthorizationHeader(credential),
      },
    });
  } catch (error) {
    return {
      kind: 'transport',
      ...fields,
      status: undefined,
      message: error instanceof Error ? error.message : 'profile probe failed',
    };
  }

  if (!response.ok) {
    if (
      response.status === 0 ||
      response.status === 401 ||
      response.status === 403 ||
      (response.status >= 300 && response.status < 400)
    ) {
      return { kind: 'unauthenticated', ...fields, status: response.status };
    }
    return {
      kind: 'transport',
      ...fields,
      status: response.status,
      message: `profile probe returned HTTP ${response.status}`,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(await response.text()) as unknown;
  } catch {
    return {
      kind: 'transport',
      ...fields,
      status: response.status,
      message: 'profile probe returned invalid JSON',
    };
  }
  const identity = parseIdentity(payload);
  if (identity === undefined) {
    return {
      kind: 'transport',
      ...fields,
      status: response.status,
      message: 'profile probe response omitted the authenticated identity',
    };
  }
  return { kind: 'authenticated', ...fields, identity };
}
