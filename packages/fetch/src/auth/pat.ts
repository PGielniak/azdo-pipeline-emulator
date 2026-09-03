/**
 * The `pat` arm of the Azure DevOps sign-in chain (E09-S01-T02, docs/05 §1).
 *
 * On a Microsoft-account-backed organization this is the *only* arm that authenticates
 * (C-E09-022/023), so it is load-bearing rather than the CI convenience docs/05 §1 calls it.
 */
import { authorizationHeader } from '../oracle.js';
import { TOKEN_FILE_VERSION, normalizeAzureOrgUrl, type StoredAzureCredential } from './storage.js';

/**
 * Checked in order. `AZDO_PAT` is this project's own variable; `AZURE_DEVOPS_EXT_PAT` is the one
 * the `az devops` CLI extension reads. Both are **project policy**, not a documented Azure DevOps
 * API behavior (C-E09-024).
 */
export const PAT_ENV_VARS = ['AZDO_PAT', 'AZURE_DEVOPS_EXT_PAT'] as const;

export type PatEnvVar = (typeof PAT_ENV_VARS)[number];

export interface PatCredentialSource {
  readonly pat: string;
  readonly variable: PatEnvVar;
}

/** First non-empty `PAT_ENV_VARS` entry, or `undefined` when the environment carries no PAT. */
export function readPatFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): PatCredentialSource | undefined {
  for (const variable of PAT_ENV_VARS) {
    const value = env[variable];
    if (typeof value === 'string' && value.trim().length > 0) {
      return { pat: value.trim(), variable };
    }
  }
  return undefined;
}

/**
 * Basic with an **empty username** and the PAT in the password position (C-E09-020). Delegates to
 * the existing `authorizationHeader()` so the construction has exactly one implementation.
 */
export function patAuthorizationHeader(pat: string): string {
  return authorizationHeader(pat);
}

export function patCredential(orgUrl: string, pat: string): StoredAzureCredential {
  return {
    version: TOKEN_FILE_VERSION,
    orgUrl: normalizeAzureOrgUrl(orgUrl),
    mode: 'pat',
    token: pat,
  };
}
