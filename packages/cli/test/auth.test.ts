// E10-S03-T01 — `auth login` / `auth status` UX.
//
// Every test drives the real command through `run()` with the network and the `az`/`gh` CLIs
// replaced at the `AuthDeps` seam, so the assertions are about *rendered output* rather than about
// internal shapes: the deliverable of this task is what a user reads.
import { describe, expect, it } from 'vitest';
import type { AuthSelection, AzureAuthStatus, GitHubCredential } from '@azdo-emu/fetch';

import {
  githubStatusReport,
  hintFor,
  loginReport,
  requireOrg,
  statusReport,
  type AuthDeps,
  type AuthFlags,
} from '../src/auth/index.js';

const ORG = 'https://dev.azure.com/contoso';

const flags = (extra: Partial<AuthFlags> = {}): AuthFlags => ({
  github: false,
  json: false,
  org: ORG,
  ...extra,
});

const pat: AuthSelection = {
  kind: 'selected',
  mode: 'pat',
  credential: { version: 1, orgUrl: ORG, mode: 'pat', token: 'tok' },
  source: 'AZDO_PAT',
  skipped: [],
};

const authenticated: AzureAuthStatus = {
  kind: 'authenticated',
  orgUrl: ORG,
  mode: 'pat',
  expiresAt: null,
  identity: { id: '1', displayName: 'Ada Lovelace', emailAddress: 'ada@example.com' },
};

const deps = (over: Partial<AuthDeps> = {}): AuthDeps =>
  ({
    selectAzureCredential: async () => pat,
    authStatus: async () => authenticated,
    resolveGitHubCredential: async () => ({ source: 'anonymous' }) as GitHubCredential,
    env: {},
    ...over,
  }) as AuthDeps;

describe('auth status', () => {
  it('reports the mode, where it came from, and the identity', async () => {
    const report = await statusReport(flags(), deps());
    expect(report.lines.join('\n')).toContain('mode        pat (from AZDO_PAT)');
    expect(report.lines.join('\n')).toContain('identity    Ada Lovelace <ada@example.com>');
    expect(report.failure).toBeUndefined();
  });

  it('says the expiry is not known locally rather than claiming "never"', async () => {
    // A PAT's lifetime lives in Azure DevOps, not in the token value. Printing "never expires"
    // would be a comforting lie right up to the morning it stops working.
    expect((await statusReport(flags(), deps())).lines.join('\n')).toContain(
      'expires     not known locally',
    );
  });

  it('marks an expiry in the past as expired', async () => {
    const expired = {
      ...pat,
      credential: { ...pat.credential, expiresAt: '2020-01-01T00:00:00.000Z' },
    } as AuthSelection;
    const report = await statusReport(
      flags(),
      deps({ selectAzureCredential: async () => expired }),
    );
    expect(report.lines.join('\n')).toContain('(expired)');
  });

  it('lists the arms that declined, so "why not az" is answered without a second command', async () => {
    const withSkips = {
      ...pat,
      skipped: [
        {
          mode: 'interactive',
          reason: 'not-implemented',
          detail: 'the device-code flow is not built yet',
        },
        { mode: 'az', reason: 'cli-unavailable', detail: 'az is not on PATH' },
      ],
    } as AuthSelection;
    const lines = (
      await statusReport(flags(), deps({ selectAzureCredential: async () => withSkips }))
    ).lines.join('\n');
    expect(lines).toContain('interactive unavailable — the device-code flow is not built yet');
    expect(lines).toContain('az          unavailable — az is not on PATH');
  });

  it('separates a transport failure from a credential failure', async () => {
    // A proxy or a firewall is not a credential problem, and telling the user to get a new token
    // would waste their afternoon.
    const transport: AzureAuthStatus = {
      kind: 'transport',
      orgUrl: ORG,
      mode: 'pat',
      expiresAt: null,
      status: undefined,
      message: 'getaddrinfo ENOTFOUND',
    };
    const report = await statusReport(
      flags(),
      deps({ authStatus: async () => transport, selectAzureCredential: async () => pat }),
    );
    expect(report.lines.join('\n')).toContain('could not reach the organization');
    expect(report.lines.join('\n')).toContain('firewall or conditional access');
  });

  it('requires an organization rather than guessing one', async () => {
    // Probing the wrong org would report "not signed in" for an account that is signed in fine.
    await expect(statusReport({ github: false, json: false }, deps())).rejects.toThrow(
      'no organization to check',
    );
    expect(requireOrg({ github: false, json: false }, { AZDO_ORG_URL: ORG })).toBe(ORG);
  });
});

describe('the remediation C-E09-023 asked this command for', () => {
  it('never offers `az login` to a user whose organization rejected an acquired token', async () => {
    // The whole point of the claim: on a Microsoft-account-backed organization the `az` arm mints a
    // token and every endpoint answers 302, so "sign in again" is a loop that cannot terminate.
    const hint = hintFor({ mode: 'az', reason: 'acquired-but-rejected', detail: '' });
    expect(hint).toContain('Microsoft-account-backed');
    expect(hint).toContain('AZDO_PAT');
    expect(hint).not.toContain('az login');
  });

  it('names the mode that does work when the auto chain picked one that does not (C-E10-032)', async () => {
    // Reproduced from the live test organization: `az` wins selection, the org refuses it, and the
    // `AZDO_PAT` in the same environment authenticates on the same URL.
    const az: AuthSelection = {
      kind: 'selected',
      mode: 'az',
      credential: { version: 1, orgUrl: ORG, mode: 'az', token: 'tok' },
      skipped: [],
    };
    const rejected: AzureAuthStatus = {
      kind: 'unauthenticated',
      orgUrl: ORG,
      mode: 'az',
      expiresAt: null,
      status: 302,
    };
    const report = await statusReport(
      flags(),
      deps({
        selectAzureCredential: async (_org, options) =>
          options?.mode === 'pat'
            ? pat
            : options?.mode === undefined
              ? az
              : { kind: 'unavailable', attempts: [] },
        authStatus: async (_org, options) =>
          options?.credential?.mode === 'pat' ? authenticated : rejected,
      }),
    );
    expect(report.lines.join('\n')).toContain('works       --mode pat authenticates');
    expect(report.failure?.hint).toContain('--mode pat');
  });

  it('falls back to the last arm’s own remediation when nothing works', async () => {
    const report = await statusReport(
      flags(),
      deps({
        selectAzureCredential: async () => ({
          kind: 'unavailable',
          attempts: [{ mode: 'pat', reason: 'no-credential', detail: 'no PAT in the environment' }],
        }),
      }),
    );
    expect(report.lines.join('\n')).toContain('status      not authenticated');
    expect(report.failure?.message).toContain('no authentication mode works');
    expect(report.failure?.hint).not.toBe('');
  });

  it('says so when no arm was even attempted', async () => {
    const report = await statusReport(
      flags(),
      deps({ selectAzureCredential: async () => ({ kind: 'unavailable', attempts: [] }) }),
    );
    expect(report.failure?.hint).toContain('no authentication mode was attempted');
  });
});

describe('auth login: the two Do-field clauses that describe surfaces which do not exist', () => {
  it('refuses --mode interactive and names the task it waits on (E09-S01-T01)', async () => {
    // Deferred, not wrong: the protocol is grounded in E09-S01-T01's research note and the flow
    // needs a person at a browser. Those claims are deliberately *not* cited here — this test
    // exercises the refusal, not the device-code flow, and the coverage gate is right to keep
    // them counted as gaps until something implements them.
    await expect(loginReport(flags({ mode: 'interactive' }), deps())).rejects.toThrow(
      'device-code flow is not built yet',
    );
  });

  it('refuses --github, because there is no GitHub sign-in to front (C-E10-033)', async () => {
    // `resolveGitHubCredential` has three arms and its header defers the OAuth device flow "until
    // demand". An invented surface, corrected rather than implemented.
    await expect(loginReport(flags({ github: true }), deps())).rejects.toThrow('does not exist');
  });

  it('states plainly that it cached nothing (C-E10-031)', async () => {
    // Nothing in this repo calls AzureCredentialStore.save(), and for `pat` caching would persist a
    // secret the user chose to keep in their environment.
    const report = await loginReport(flags(), deps());
    expect(report.lines.join('\n')).toContain('Nothing was cached');
  });

  it('carries the failure through, so login and status agree on the verdict', async () => {
    const report = await loginReport(
      flags(),
      deps({ selectAzureCredential: async () => ({ kind: 'unavailable', attempts: [] }) }),
    );
    expect(report.failure).toBeDefined();
  });
});

describe('auth status --github', () => {
  it.each([
    ['gh-cli', 'GitHub CLI'],
    ['env', 'token from the environment'],
    ['anonymous', 'rate-limited to 60/hour'],
  ] as const)('names the %s source', async (source, expected) => {
    const report = await githubStatusReport(
      deps({ resolveGitHubCredential: async () => ({ source }) as GitHubCredential }),
    );
    expect(report.lines.join('\n')).toContain(expected);
  });

  it('does not fail the command when anonymous — that is a working state', async () => {
    // Public templates resolve fine without a token; exiting non-zero would break a CI check that
    // is behaving correctly.
    expect((await githubStatusReport(deps())).failure).toBeUndefined();
  });
});

describe('the wired commands, through run() (E10-S03-T01)', async () => {
  const { run } = await import('../src/index.js');
  const cli = async (
    argv: string[],
    env: Record<string, string | undefined>,
  ): Promise<{ code: number; out: string; err: string }> => {
    let out = '';
    let err = '';
    const previous = { ...process.env };
    Object.assign(process.env, env);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
    }
    try {
      const code = await run(argv, {
        out: (t) => (out += t),
        err: (t) => (err += t),
        helpWidth: 80,
        colors: false,
      });
      return { code, out, err };
    } finally {
      for (const key of Object.keys(process.env)) delete process.env[key];
      Object.assign(process.env, previous);
    }
  };

  it('exits 1 with the diagnosis on stderr and the table on stdout', async () => {
    // The split is the contract: `azdo-emu auth status | grep mode` keeps working while the reason
    // still reaches a human.
    const result = await cli(['auth', 'status', '--org', ORG], { AZDO_PAT: undefined, PATH: '' });
    expect(result.code).toBe(1);
    expect(result.out).toContain(ORG);
    expect(result.err).toContain('azdo-emu:');
  });

  it('emits no ANSI escape and no spinner, on a TTY or off it (C-E10-034)', async () => {
    // "Non-tty behaviour defined": this command has *no* terminal-dependent output at all. The one
    // thing that would have needed a spinner is the device-code poll, and that flow does not exist
    // (E09-S01-T01) — so the definition is "plain lines always", not "plain lines when piped".
    const result = await cli(['auth', 'status', '--org', ORG], { AZDO_PAT: undefined, PATH: '' });
    expect(`${result.out}${result.err}`).not.toContain(String.fromCharCode(27));
    expect(result.out).not.toContain('\r');
  });

  it('--json prints a versioned document carrying the verdict, not just the table', async () => {
    // A tool that had to scrape the table to learn whether auth worked would be no better off.
    const result = await cli(['--json', 'auth', 'status', '--org', ORG], {
      AZDO_PAT: undefined,
      PATH: '',
    });
    const parsed = JSON.parse(result.out) as { version: number; lines: string[]; failure: unknown };
    expect(parsed.version).toBe(1);
    expect(parsed.failure).not.toBeNull();
    expect(Array.isArray(parsed.lines)).toBe(true);
  });

  it('`auth login --github` is refused by the command, not by the report', async () => {
    const result = await cli(['auth', 'login', '--github'], {});
    expect(result.code).toBe(1);
    expect(result.err).toContain('does not exist');
    expect(result.err).toContain('auth status --github');
  });

  it('`auth status --github` answers without an organization', async () => {
    // GitHub credentials are not org-scoped, so `--org` must not be required on this path.
    const result = await cli(['auth', 'status', '--github'], { GITHUB_TOKEN: undefined, PATH: '' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('github.com');
  });

  it('`--mode` is accepted on status as well as login', async () => {
    const result = await cli(['auth', 'status', '--org', ORG, '--mode', 'pat'], {
      AZDO_PAT: undefined,
    });
    // Not a usage error: commander would exit 1 with "invalid argument" before any probe ran.
    expect(result.err).not.toContain('--mode');
  });
});
