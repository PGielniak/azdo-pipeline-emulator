/**
 * `auth login` / `auth status` — the UX layer over E09's selection and probe (E10-S03-T01).
 *
 * **Two clauses of this task's Do field describe surfaces that do not exist, and neither is built
 * here.** They are different failures and get different answers:
 *
 *  - *"device-code display flow (code + URL + spinner)"* — **deferred, not wrong.** The Azure DevOps
 *    device-code flow is E09-S01-T01: fully grounded (C-E09-001..006) and `[!]` because a
 *    device-code sign-in needs a person at a browser typing a user code, which no agent can produce.
 *    `--mode interactive` therefore fails with a message naming that task rather than displaying a
 *    code no arm will ever mint.
 *  - *"`--github` variant"* of **login** — **an invented surface.** `resolveGitHubCredential` has
 *    three arms — `gh-cli`, `env`, `anonymous` — and its own header records that the OAuth device
 *    flow is deferred "until demand". There is no GitHub sign-in to front, and none is planned, so
 *    `auth login --github` is refused with what to do instead. The clause survives on **status**,
 *    where reporting which of the three arms supplied the credential is real and testable.
 *
 * The third correction is the command's own description. `auth login` said "sign in and cache a
 * refresh token"; **nothing in this repo calls `AzureCredentialStore.save()`** — only the unbuilt
 * device-code arm would — and for the `pat` arm caching would be actively wrong: writing a token to
 * disk that the user chose to supply through the environment persists a secret they never asked to
 * persist. What `login` honestly does is *select, probe, and report*: which mode works, which
 * declined and why, and what to do about each.
 *
 * The failure hints are the part another epic already wrote a requirement for. C-E09-023 exists so
 * this command "never offers `az login` to a user for whom it is a dead end": the hint branches on
 * `no-credential` (nothing was acquired → sign in) versus `acquired-but-rejected` (a token *was*
 * acquired and the organization refused it → this org is Microsoft-account-backed, use a PAT).
 */

import {
  AUTH_MODE_ORDER,
  authStatus,
  remediationFor,
  resolveGitHubCredential,
  selectAzureCredential,
  type AuthArmUnavailable,
  type AuthSelection,
  type AzureAuthStatus,
  type GitHubCredential,
  type StoredAzureCredential,
} from '@azdo-emu/fetch';

import { CliError } from '../exit.js';

/** What the command needs from the world, injected so tests are hermetic. */
export interface AuthDeps {
  readonly selectAzureCredential: typeof selectAzureCredential;
  readonly authStatus: typeof authStatus;
  readonly resolveGitHubCredential: typeof resolveGitHubCredential;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export const defaultAuthDeps: AuthDeps = {
  selectAzureCredential,
  authStatus,
  resolveGitHubCredential,
  env: process.env,
};

export interface AuthFlags {
  readonly org?: string | undefined;
  readonly mode?: 'interactive' | 'az' | 'pat' | undefined;
  readonly github: boolean;
  readonly json: boolean;
}

/**
 * What the command prints, split by stream.
 *
 * `lines` is the table — data, on stdout, useful whatever the verdict. `failure` is the diagnosis:
 * present exactly when the organization cannot be reached with any credential, and rendered on
 * stderr through the CLI's one error path (`CliError`), so this command needs no exit path of its
 * own. The split is deliberate: `azdo-emu auth status | grep mode` keeps working while the reason
 * still reaches a human.
 */
export interface AuthReport {
  readonly lines: readonly string[];
  readonly failure?: { readonly message: string; readonly hint: string };
}

/**
 * The organization to act on.
 *
 * Required and not guessed: probing the wrong organization would report "not signed in" for an
 * account that is signed in perfectly well, which is the single most misleading thing this command
 * could say.
 */
export function requireOrg(
  flags: AuthFlags,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const org = flags.org ?? env.AZDO_ORG_URL;
  if (org === undefined || org.trim().length === 0) {
    throw new CliError('no organization to check', {
      hint: 'pass --org https://dev.azure.com/<name>, or set AZDO_ORG_URL',
    });
  }
  return org.trim();
}

/** C-E09-023: the remediation must distinguish "sign in" from "this org will never accept that". */
export function hintFor(arm: AuthArmUnavailable): string {
  if (arm.reason === 'acquired-but-rejected') {
    // The measured case (C-E09-022): a token is minted and every org endpoint answers 302. Telling
    // this user to sign in again sends them round a loop that cannot terminate.
    return (
      'a token was acquired and the organization rejected it — this organization is ' +
      'Microsoft-account-backed, so set AZDO_PAT instead (C-E09-023)'
    );
  }
  return remediationFor(arm);
}

/** One line per arm that declined, in the order selection tried them. */
function armLines(arms: readonly AuthArmUnavailable[]): string[] {
  return arms.map((arm) => `  ${arm.mode.padEnd(11)} unavailable — ${arm.detail}`);
}

function expiryLine(credential: StoredAzureCredential): string {
  if (credential.expiresAt === undefined) {
    // A PAT's lifetime lives in Azure DevOps, not in the value; claiming "never" would be a lie.
    return '  expires     not known locally';
  }
  const at = new Date(credential.expiresAt);
  const suffix = at.getTime() < Date.now() ? ' (expired)' : '';
  return `  expires     ${credential.expiresAt}${suffix}`;
}

/** The identity/status half, once a credential has been selected and probed. */
function statusLines(status: AzureAuthStatus): string[] {
  switch (status.kind) {
    case 'authenticated':
      return [
        `  identity    ${status.identity.displayName}` +
          (status.identity.emailAddress === undefined ? '' : ` <${status.identity.emailAddress}>`),
      ];
    case 'unauthenticated':
      // No hint line here: the caller knows whether another mode works and writes a better one.
      return [`  identity    the organization rejected this credential (HTTP ${status.status})`];
    case 'transport':
      // Kept separate from `unauthenticated` on purpose: a proxy or a firewall is not a credential
      // problem, and telling the user to get a new token would waste their afternoon.
      return [
        `  identity    could not reach the organization — ${status.message}`,
        '  hint        check a proxy, a firewall or conditional access before changing credentials',
      ];
    /* istanbul ignore next -- `signed-out` cannot occur: a credential is always passed in. */
    default:
      return ['  identity    unknown'];
  }
}

const GITHUB_SOURCE_LINES: Readonly<Record<GitHubCredential['source'], string>> = {
  'gh-cli': 'signed in through the GitHub CLI (`gh auth status` to inspect)',
  env: 'using a token from the environment',
  anonymous:
    'not signed in — requests go out anonymously and are rate-limited to 60/hour; ' +
    'run `gh auth login` or set GITHUB_TOKEN',
};

/** `auth status --github`: which of the three arms supplies the credential, and what that costs. */
export async function githubStatusReport(deps: AuthDeps): Promise<AuthReport> {
  const credential = await deps.resolveGitHubCredential({ env: deps.env });
  // Anonymous is a working state, not a failure: public templates resolve fine without a token, so
  // this never carries a `failure` — exiting non-zero would break a CI check that is behaving.
  return { lines: ['github.com', `  source      ${GITHUB_SOURCE_LINES[credential.source]}`] };
}

/** Select a credential for `orgUrl`, or render why no arm could. */
async function selectOrExplain(
  orgUrl: string,
  flags: AuthFlags,
  deps: AuthDeps,
): Promise<AuthSelection> {
  return deps.selectAzureCredential(orgUrl, {
    env: deps.env,
    ...(flags.mode === undefined ? {} : { mode: flags.mode }),
  });
}

function unavailableReport(orgUrl: string, attempts: readonly AuthArmUnavailable[]): AuthReport {
  const lines = [orgUrl, '  status      not authenticated', ...armLines(attempts)];
  // The hint comes from the *last* arm tried, which is the one closest to working: selection walks
  // interactive → az → pat (AUTH_MODE_ORDER), so `pat` is last and its remediation is the actionable
  // one — and on a Microsoft-account organization it is the only arm that can ever work (C-E09-023).
  const last = attempts[attempts.length - 1];
  return {
    lines,
    failure: {
      message: `no authentication mode works for ${orgUrl}`,
      hint: last === undefined ? 'no authentication mode was attempted' : hintFor(last),
    },
  };
}

/** `auth status`: what the converter would use for this organization, right now. */
export async function statusReport(flags: AuthFlags, deps: AuthDeps): Promise<AuthReport> {
  if (flags.github) return githubStatusReport(deps);

  const orgUrl = requireOrg(flags, deps.env);
  const selection = await selectOrExplain(orgUrl, flags, deps);
  if (selection.kind === 'unavailable') return unavailableReport(orgUrl, selection.attempts);

  const status = await deps.authStatus(orgUrl, { credential: selection.credential });
  const lines = [
    orgUrl,
    `  mode        ${selection.mode}` +
      (selection.source === undefined ? '' : ` (from ${selection.source})`),
    ...statusLines(status),
    expiryLine(selection.credential),
    ...armLines(selection.skipped),
  ];
  if (status.kind === 'authenticated') return { lines };

  // The auto chain picked a mode the organization refuses. Before reporting a dead end, find out
  // whether a *different* mode would have worked — because on this org one always does, and the
  // chain cannot reach it. Measured on the test organization (C-E10-032): `AUTH_MODE_ORDER` is
  // interactive → az → pat, so an existing `az` session wins selection, and on a
  // Microsoft-account-backed organization that token is rejected with 302 while the `AZDO_PAT` in
  // the same environment returns 200 on the same URL (C-E09-022). Reporting only the refusal would
  // tell a user who *can* authenticate that they cannot.
  const rescue = await workingAlternative(orgUrl, selection.mode, deps);
  if (rescue !== undefined) {
    lines.push(`  works       --mode ${rescue} authenticates against this organization`);
  }
  return {
    lines,
    failure: {
      message: `signed in as ${selection.mode}, but ${orgUrl} did not accept the credential`,
      hint:
        rescue === undefined
          ? hintFor({ mode: selection.mode, reason: 'acquired-but-rejected', detail: '' })
          : `run with \`--mode ${rescue}\`; the automatic chain tries ${selection.mode} first and ` +
            'this organization refuses it (C-E09-023)',
    },
  };
}

/**
 * The first mode *other than* `chosen` that the organization actually accepts, if any.
 *
 * Deliberately a probe and not a change to selection: what `convert` will use is
 * `selectAzureCredential`'s answer, so reporting a different mode as "your mode" would make this
 * command disagree with the tool it exists to explain. The alternative is offered as an
 * instruction (`--mode pat`) rather than applied silently.
 */
async function workingAlternative(
  orgUrl: string,
  chosen: AuthFlags['mode'],
  deps: AuthDeps,
): Promise<Exclude<AuthFlags['mode'], undefined> | undefined> {
  for (const mode of AUTH_MODE_ORDER) {
    if (mode === chosen) continue;
    const attempt = await deps.selectAzureCredential(orgUrl, { env: deps.env, mode });
    if (attempt.kind !== 'selected') continue;
    const probe = await deps.authStatus(orgUrl, { credential: attempt.credential });
    if (probe.kind === 'authenticated') return mode;
  }
  return undefined;
}

/**
 * `auth login`: select, probe, and report — it does not cache anything.
 *
 * See the module header: no implemented arm writes the credential store, and for the `pat` arm
 * writing one would persist a secret the user chose to keep in their environment.
 */
export async function loginReport(flags: AuthFlags, deps: AuthDeps): Promise<AuthReport> {
  if (flags.github) {
    throw new CliError('`auth login --github` does not exist', {
      hint:
        'there is no GitHub sign-in to front — credentials come from `gh auth login` or ' +
        'GITHUB_TOKEN. Run `azdo-emu auth status --github` to see which one is in use.',
    });
  }
  if (flags.mode === 'interactive') {
    throw new CliError('the interactive device-code flow is not built yet', {
      hint:
        'it lands in E09-S01-T01, which needs a person at a browser to complete once. Use ' +
        '`--mode az` or `--mode pat` — see BACKLOG.md.',
    });
  }

  const report = await statusReport(flags, deps);
  return {
    ...report,
    lines: [
      ...report.lines,
      '',
      'Nothing was cached: `login` reports which mode works, it does not store a token.',
    ],
  };
}
