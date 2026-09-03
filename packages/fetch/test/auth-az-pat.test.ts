import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AZDO_ENTRA_RESOURCE,
  AZ_TOKEN_ARGS,
  AzCliError,
  azCredential,
  expiryFrom,
  parseAzToken,
  readAzAccessToken,
  type AzExec,
} from '../src/auth/azdo-cli.js';
import {
  PAT_ENV_VARS,
  patAuthorizationHeader,
  patCredential,
  readPatFromEnv,
} from '../src/auth/pat.js';
import {
  AUTH_MODE_ORDER,
  remediationFor,
  selectAzureCredential,
  type AuthArmUnavailable,
} from '../src/auth/select.js';
import { AzureCredentialStore, TOKEN_FILE_VERSION } from '../src/auth/storage.js';

const ORG = 'https://dev.azure.com/contoso';

/** Records argv so the assembled command can be asserted without a real Azure CLI. */
function stubAz(stdout: string, fail?: string): { exec: AzExec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: AzExec = async (file, args) => {
    calls.push([file, ...args]);
    if (fail !== undefined) throw new AzCliError(fail);
    return { stdout, stderr: '' };
  };
  return { exec, calls };
}

const AZ_JSON = JSON.stringify({
  accessToken: 'az-access-token',
  expiresOn: '2026-09-03 09:04:33.000000',
  expires_on: 1_788_419_073,
  subscription: 'sub-id',
  tenant: 'tenant-id',
  tokenType: 'Bearer',
});

describe('az arm — command assembly (C-E09-018)', () => {
  it('asks for the Azure DevOps resource with --resource, not --scope', async () => {
    const { exec, calls } = stubAz(AZ_JSON);
    await readAzAccessToken({ exec });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe('az');
    expect(calls[0]).toContain('--resource');
    expect(calls[0]).toContain(AZDO_ENTRA_RESOURCE);
    // --scope is Entra v2.0 and takes a different argument shape; using it here would be a guess.
    expect(calls[0]).not.toContain('--scope');
  });

  it('pins the documented Azure DevOps resource GUID (C-E09-001)', () => {
    expect(AZDO_ENTRA_RESOURCE).toBe('499b84ac-1321-427f-aa17-267ca6975798');
    expect(AZ_TOKEN_ARGS).toEqual([
      'account',
      'get-access-token',
      '--resource',
      AZDO_ENTRA_RESOURCE,
      '--output',
      'json',
    ]);
  });

  it('honors an explicit az path', async () => {
    const { exec, calls } = stubAz(AZ_JSON);
    await readAzAccessToken({ exec, azPath: '/opt/az/bin/az' });
    expect(calls[0]?.[0]).toBe('/opt/az/bin/az');
  });
});

describe('az arm — expiry parsing (C-E09-019)', () => {
  it('prefers the POSIX expires_on over the timezone-less expiresOn', () => {
    // The two fields deliberately disagree: expires_on is the truth, expiresOn is local-time noise.
    const parsed = parseAzToken(AZ_JSON);
    expect(parsed.expiresAt).toBe(new Date(1_788_419_073 * 1000).toISOString());
  });

  it('does not read expiresOn as if it were UTC', () => {
    // Regression guard for the exact bug the reference page warns about: `expiresOn` carries no
    // offset and no `Z`, so treating it as UTC misdates the credential by the host's offset.
    const naive = Date.parse('2026-09-03T09:04:33.000Z');
    const actual = Date.parse(expiryFrom(JSON.parse(AZ_JSON) as Record<string, unknown>) ?? '');
    expect(actual).not.toBe(naive);
  });

  it('accepts a string-rendered expires_on', () => {
    expect(expiryFrom({ expires_on: ' 1788419073 ' })).toBe(
      new Date(1_788_419_073 * 1000).toISOString(),
    );
  });

  it('falls back to expiresOn only when expires_on is absent, reading it as local time', () => {
    const local = expiryFrom({ expiresOn: '2026-09-03 09:04:33.000000' });
    expect(local).toBe(new Date('2026-09-03T09:04:33.000000').toISOString());
  });

  it('reports no expiry rather than an invalid date', () => {
    expect(expiryFrom({})).toBeUndefined();
    expect(expiryFrom({ expiresOn: 'not-a-date' })).toBeUndefined();
    expect(expiryFrom({ expires_on: Number.NaN })).toBeUndefined();
  });
});

describe('az arm — failure surfaces', () => {
  it('raises AzCliError when the CLI fails', async () => {
    const { exec } = stubAz('', 'AADSTS700082: The refresh token has expired due to inactivity');
    await expect(readAzAccessToken({ exec })).rejects.toBeInstanceOf(AzCliError);
  });

  it.each([
    ['not JSON', 'totally not json'],
    ['a JSON array', '[]'],
    ['an object without accessToken', '{"expires_on":1}'],
    ['an empty accessToken', '{"accessToken":""}'],
  ])('rejects %s', async (_label, stdout) => {
    const { exec } = stubAz(stdout);
    await expect(readAzAccessToken({ exec })).rejects.toBeInstanceOf(AzCliError);
  });

  it('never puts the token in an error message', async () => {
    const { exec } = stubAz('{"accessToken":"secret-token","expires_on":"nope"}');
    const result = await readAzAccessToken({ exec });
    expect(result.token).toBe('secret-token');
    expect(result.expiresAt).toBeUndefined();
  });
});

describe('az arm — the real subprocess path', () => {
  // Everything above injects `exec`. These two drive the shipped `execFile` wrapper against a stub
  // executable, so the default path is proven rather than assumed.
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'azdo-emu-az-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function stubExecutable(name: string, body: string): Promise<string> {
    const path = join(dir, name);
    await writeFile(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    return path;
  }

  it('spawns the CLI and parses what it prints on stdout', async () => {
    const azPath = await stubExecutable('az-ok', `cat <<'JSON'\n${AZ_JSON}\nJSON`);
    const result = await readAzAccessToken({ azPath });
    expect(result.token).toBe('az-access-token');
    expect(result.expiresAt).toBe(new Date(1_788_419_073 * 1000).toISOString());
  });

  it('turns a non-zero exit into AzCliError carrying the CLI stderr', async () => {
    const azPath = await stubExecutable(
      'az-fail',
      'echo "ERROR: Please run \'az login\' to setup account." >&2\nexit 1',
    );
    await expect(readAzAccessToken({ azPath })).rejects.toThrow(/az login/);
    await expect(readAzAccessToken({ azPath })).rejects.toBeInstanceOf(AzCliError);
  });

  it('surfaces a missing executable as AzCliError, not a raw ENOENT', async () => {
    await expect(readAzAccessToken({ azPath: join(dir, 'does-not-exist') })).rejects.toBeInstanceOf(
      AzCliError,
    );
  });
});

describe('az arm — credential shape', () => {
  it('produces a store-compatible az credential', () => {
    const credential = azCredential(`${ORG}/`, parseAzToken(AZ_JSON));
    expect(credential).toMatchObject({
      version: TOKEN_FILE_VERSION,
      orgUrl: ORG,
      mode: 'az',
      token: 'az-access-token',
    });
    expect(credential.expiresAt).toBeDefined();
  });
});

describe('pat arm (C-E09-020, C-E09-024)', () => {
  it('builds Basic with an empty username, matching `curl -u :{PAT}`', () => {
    const header = patAuthorizationHeader('my-pat');
    expect(header).toBe(`Basic ${Buffer.from(':my-pat', 'utf8').toString('base64')}`);
    // Decoding it back must show nothing before the colon.
    const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
    expect(decoded).toBe(':my-pat');
    expect(decoded.startsWith(':')).toBe(true);
  });

  it('checks AZDO_PAT before AZURE_DEVOPS_EXT_PAT', () => {
    expect(PAT_ENV_VARS).toEqual(['AZDO_PAT', 'AZURE_DEVOPS_EXT_PAT']);
    expect(readPatFromEnv({ AZDO_PAT: 'a', AZURE_DEVOPS_EXT_PAT: 'b' })).toEqual({
      pat: 'a',
      variable: 'AZDO_PAT',
    });
  });

  it('falls through to AZURE_DEVOPS_EXT_PAT', () => {
    expect(readPatFromEnv({ AZURE_DEVOPS_EXT_PAT: 'b' })).toEqual({
      pat: 'b',
      variable: 'AZURE_DEVOPS_EXT_PAT',
    });
  });

  it.each([{}, { AZDO_PAT: '' }, { AZDO_PAT: '   ' }])(
    'treats a missing or blank value as absent (%o)',
    (env) => {
      expect(readPatFromEnv(env)).toBeUndefined();
    },
  );

  it('trims surrounding whitespace from a pasted PAT', () => {
    expect(readPatFromEnv({ AZDO_PAT: '  tok\n' })?.pat).toBe('tok');
  });

  it('produces a store-compatible pat credential', () => {
    expect(patCredential(ORG, 'p')).toEqual({
      version: TOKEN_FILE_VERSION,
      orgUrl: ORG,
      mode: 'pat',
      token: 'p',
    });
  });
});

describe('mode auto-selection (docs/05 §1, C-E09-023)', () => {
  it('walks interactive, then az, then pat', () => {
    expect(AUTH_MODE_ORDER).toEqual(['interactive', 'az', 'pat']);
  });

  it('prefers az over an available PAT', async () => {
    const { exec } = stubAz(AZ_JSON);
    const selection = await selectAzureCredential(ORG, {
      az: { exec },
      env: { AZDO_PAT: 'p' },
    });
    expect(selection.kind).toBe('selected');
    if (selection.kind !== 'selected') return;
    expect(selection.mode).toBe('az');
    expect(selection.skipped.map((s) => s.mode)).toEqual(['interactive']);
  });

  it('falls back to pat when az is unavailable — the MSA case (C-E09-022)', async () => {
    const { exec } = stubAz('', 'Please run "az login"');
    const selection = await selectAzureCredential(ORG, {
      az: { exec },
      env: { AZDO_PAT: 'p' },
    });
    expect(selection.kind).toBe('selected');
    if (selection.kind !== 'selected') return;
    expect(selection.mode).toBe('pat');
    expect(selection.source).toBe('AZDO_PAT');
    expect(selection.skipped.map((s) => s.reason)).toEqual(['not-implemented', 'cli-unavailable']);
  });

  it('reports every arm as unavailable rather than throwing', async () => {
    const { exec } = stubAz('', 'no az');
    const selection = await selectAzureCredential(ORG, { az: { exec }, env: {} });
    expect(selection.kind).toBe('unavailable');
    if (selection.kind !== 'unavailable') return;
    expect(selection.attempts.map((a) => a.mode)).toEqual(AUTH_MODE_ORDER);
    for (const attempt of selection.attempts) expect(attempt.detail).not.toContain('p');
  });

  it('honors an explicitly configured mode instead of auto-selecting', async () => {
    const { exec, calls } = stubAz(AZ_JSON);
    const selection = await selectAzureCredential(ORG, {
      mode: 'pat',
      az: { exec },
      env: { AZDO_PAT: 'p' },
    });
    expect(selection.kind).toBe('selected');
    if (selection.kind !== 'selected') return;
    expect(selection.mode).toBe('pat');
    // Selecting `pat` explicitly must not shell out to the Azure CLI at all.
    expect(calls).toHaveLength(0);
  });

  it('makes no network call during selection', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('selection must not touch the network');
    }) as typeof globalThis.fetch;
    try {
      const { exec } = stubAz(AZ_JSON);
      await expect(
        selectAzureCredential(ORG, { az: { exec }, env: { AZDO_PAT: 'p' } }),
      ).resolves.toMatchObject({ kind: 'selected' });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('uses a stored interactive credential when one exists', async () => {
    const store = {
      load: async () => ({
        backend: 'file' as const,
        credential: {
          version: TOKEN_FILE_VERSION,
          orgUrl: ORG,
          mode: 'interactive' as const,
          token: 'device-code-token',
        },
      }),
    } as unknown as AzureCredentialStore;

    const selection = await selectAzureCredential(ORG, { store, env: { AZDO_PAT: 'p' } });
    expect(selection.kind).toBe('selected');
    if (selection.kind !== 'selected') return;
    expect(selection.mode).toBe('interactive');
  });

  it('ignores a stored credential belonging to another mode', async () => {
    const store = {
      load: async () => ({
        backend: 'file' as const,
        credential: {
          version: TOKEN_FILE_VERSION,
          orgUrl: ORG,
          mode: 'pat' as const,
          token: 'stored-pat',
        },
      }),
    } as unknown as AzureCredentialStore;

    const { exec } = stubAz('', 'no az');
    const selection = await selectAzureCredential(ORG, {
      store,
      az: { exec },
      env: { AZDO_PAT: 'env-pat' },
    });
    expect(selection.kind).toBe('selected');
    if (selection.kind !== 'selected') return;
    expect(selection.mode).toBe('pat');
    expect(selection.credential.token).toBe('env-pat');
  });

  it('normalizes the organization URL onto the credential', async () => {
    const selection = await selectAzureCredential(`${ORG}/`, {
      mode: 'pat',
      env: { AZDO_PAT: 'p' },
    });
    if (selection.kind !== 'selected') throw new Error('expected a selection');
    expect(selection.credential.orgUrl).toBe(ORG);
  });
});

describe('remediation (C-E09-023)', () => {
  it('points an MSA-organization user at a PAT, not at `az login`', () => {
    const failure: AuthArmUnavailable = {
      mode: 'az',
      reason: 'acquired-but-rejected',
      detail: 'organization returned 302',
    };
    const text = remediationFor(failure);
    expect(text).toContain('AZDO_PAT');
    expect(text).toContain('Microsoft account');
    // The measured dead end: telling this user to sign in again is what C-E09-022 falsified.
    expect(text).not.toContain('az login');
  });

  it('does tell a signed-out user to run `az login`', () => {
    expect(remediationFor({ mode: 'az', reason: 'cli-unavailable', detail: '' })).toContain(
      'az login',
    );
  });

  it('has a remediation for every reason', () => {
    const reasons = [
      'not-implemented',
      'no-credential',
      'cli-unavailable',
      'acquired-but-rejected',
    ] as const;
    for (const reason of reasons) {
      expect(remediationFor({ mode: 'az', reason, detail: '' }).length).toBeGreaterThan(0);
      expect(remediationFor({ mode: 'pat', reason, detail: '' }).length).toBeGreaterThan(0);
    }
  });
});
