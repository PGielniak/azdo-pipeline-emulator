/**
 * Azure DevOps sign-in mode auto-selection (E09-S01-T02, docs/05 §1).
 *
 * The order is `interactive` → `az` → `pat`. Every arm reports itself *unavailable with a reason*
 * rather than throwing, because on a Microsoft-account-backed organization **two of the three arms
 * are permanently unavailable** — `interactive` by C-E09-002 and `az` by C-E09-022 — and that is
 * the configuration a solo developer converting their own pipelines actually has (C-E09-023).
 * A chain that threw on the first miss would make the common case look like a crash.
 */
import { AzCliError, azCredential, readAzAccessToken, type AzTokenOptions } from './azdo-cli.js';
import { patCredential, readPatFromEnv, type PatEnvVar } from './pat.js';
import {
  AzureCredentialStore,
  normalizeAzureOrgUrl,
  type AzureAuthMode,
  type StoredAzureCredential,
} from './storage.js';

/** docs/05 §1's table order, and the order `selectAzureCredential` walks. */
export const AUTH_MODE_ORDER: readonly AzureAuthMode[] = ['interactive', 'az', 'pat'];

/**
 * Why an arm did not produce a credential.
 *
 * `acquired-but-rejected` is never produced by selection itself — selection is deliberately cheap
 * and makes no network call. It exists so a caller that *has* probed (via `authStatus()`) can
 * record the distinction that drives remediation: "sign in" versus "this organization needs a PAT"
 * (C-E09-023). E10-S03-T01's failure hints consume it.
 */
export type UnavailableReason =
  'not-implemented' | 'no-credential' | 'cli-unavailable' | 'acquired-but-rejected';

export interface AuthArmUnavailable {
  readonly mode: AzureAuthMode;
  readonly reason: UnavailableReason;
  /** Safe to display: never contains a token. */
  readonly detail: string;
}

export type AuthSelection =
  | {
      readonly kind: 'selected';
      readonly mode: AzureAuthMode;
      readonly credential: StoredAzureCredential;
      /** Which `PAT_ENV_VARS` entry supplied a PAT, when the `pat` arm won. */
      readonly source?: PatEnvVar;
      /** The arms that were tried and declined, in order. */
      readonly skipped: readonly AuthArmUnavailable[];
    }
  | { readonly kind: 'unavailable'; readonly attempts: readonly AuthArmUnavailable[] };

export interface SelectAuthOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly store?: AzureCredentialStore;
  readonly az?: AzTokenOptions;
  /** Restrict selection to one mode — the configured (non-auto) path in docs/05 §1. */
  readonly mode?: AzureAuthMode;
}

async function tryInteractive(
  orgUrl: string,
  options: SelectAuthOptions,
): Promise<StoredAzureCredential | AuthArmUnavailable> {
  const store = options.store;
  if (store === undefined) {
    return {
      mode: 'interactive',
      reason: 'not-implemented',
      detail:
        'the device-code flow is not built yet (E09-S01-T01); no stored interactive credential was consulted',
    };
  }

  const loaded = await store.load(orgUrl);
  if (loaded === undefined || loaded.credential.mode !== 'interactive') {
    return {
      mode: 'interactive',
      reason: 'no-credential',
      detail: `no stored interactive credential for ${orgUrl}; run \`azdo-emu auth login\``,
    };
  }
  return loaded.credential;
}

async function tryAz(
  orgUrl: string,
  options: SelectAuthOptions,
): Promise<StoredAzureCredential | AuthArmUnavailable> {
  try {
    return azCredential(orgUrl, await readAzAccessToken(options.az ?? {}));
  } catch (error) {
    // An absent CLI and a signed-out CLI are the same remediation: establish an `az` session.
    const detail =
      error instanceof AzCliError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'az account get-access-token failed';
    return { mode: 'az', reason: 'cli-unavailable', detail };
  }
}

function tryPat(
  orgUrl: string,
  options: SelectAuthOptions,
): { credential: StoredAzureCredential; source: PatEnvVar } | AuthArmUnavailable {
  const found = readPatFromEnv(options.env ?? process.env);
  if (found === undefined) {
    return {
      mode: 'pat',
      reason: 'no-credential',
      detail: 'neither AZDO_PAT nor AZURE_DEVOPS_EXT_PAT is set',
    };
  }
  return { credential: patCredential(orgUrl, found.pat), source: found.variable };
}

function isUnavailable(value: unknown): value is AuthArmUnavailable {
  return typeof value === 'object' && value !== null && 'reason' in value;
}

/**
 * Walk the docs/05 §1 order and return the first arm that yields a credential.
 *
 * Makes **no network call**: it answers "which credential would we present", not "does the
 * organization accept it". Proving the credential is `authStatus()`'s job (C-E09-009/010), which
 * on an MSA-backed organization is the only place the `az` arm's 302 becomes visible (C-E09-022).
 */
export async function selectAzureCredential(
  orgUrl: string,
  options: SelectAuthOptions = {},
): Promise<AuthSelection> {
  const normalized = normalizeAzureOrgUrl(orgUrl);
  const order = options.mode !== undefined ? [options.mode] : AUTH_MODE_ORDER;
  const attempts: AuthArmUnavailable[] = [];

  for (const mode of order) {
    if (mode === 'interactive') {
      const result = await tryInteractive(normalized, options);
      if (isUnavailable(result)) {
        attempts.push(result);
        continue;
      }
      return { kind: 'selected', mode, credential: result, skipped: [...attempts] };
    }

    if (mode === 'az') {
      const result = await tryAz(normalized, options);
      if (isUnavailable(result)) {
        attempts.push(result);
        continue;
      }
      return { kind: 'selected', mode, credential: result, skipped: [...attempts] };
    }

    const result = tryPat(normalized, options);
    if (isUnavailable(result)) {
      attempts.push(result);
      continue;
    }
    return {
      kind: 'selected',
      mode,
      credential: result.credential,
      source: result.source,
      skipped: [...attempts],
    };
  }

  return { kind: 'unavailable', attempts };
}

/**
 * Remediation text per failure kind. The `acquired-but-rejected` case is the one that matters:
 * telling an MSA-organization user to "run `az login`" is the dead end this task measured
 * (C-E09-022), so that outcome points at a PAT instead.
 */
export function remediationFor(failure: AuthArmUnavailable): string {
  switch (failure.reason) {
    case 'not-implemented':
      return 'Interactive sign-in is not available yet; use `az login` or set AZDO_PAT.';
    case 'no-credential':
      return failure.mode === 'pat'
        ? 'Set AZDO_PAT to a personal access token for this organization.'
        : 'Run `azdo-emu auth login` to sign in to this organization.';
    case 'cli-unavailable':
      return 'Install the Azure CLI and run `az login`, or set AZDO_PAT instead.';
    case 'acquired-but-rejected':
      return (
        'The Azure CLI signed in, but this organization rejected the token — it is backed by a ' +
        'Microsoft account rather than a Microsoft Entra tenant, so no `az` token can match it. ' +
        'Set AZDO_PAT to a personal access token instead.'
      );
  }
}
