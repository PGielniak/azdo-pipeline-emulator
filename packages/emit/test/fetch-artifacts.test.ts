/**
 * E09-S03-T06 — the emitted `fetch-artifacts.sh`.
 *
 * The script is short, so the temptation is to assert on its text. Most of these run it instead:
 * its two branches are "delegate" and "explain", and a string match would pass on a script that
 * does neither.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { emitFetchArtifactsScript } from '../src/fetch-artifacts.js';

const script = emitFetchArtifactsScript();

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'azdo-emu-fa-'));
  writeFileSync(join(dir, 'fetch-artifacts.sh'), script);
  return dir;
}

/** Run the script with a PATH we control, so "is azdo-emu installed" is a property of the test. */
function run(dir: string, pathDirs: readonly string[], args: readonly string[] = []) {
  return spawnSync('bash', [join(dir, 'fetch-artifacts.sh'), ...args], {
    encoding: 'utf8',
    env: {
      PATH: pathDirs.join(':'),
      // If the heredoc were unquoted, this value would be printed instead of the variable's name.
      SYSTEM_ACCESSTOKEN: 'TOKEN-THAT-MUST-NOT-BE-PRINTED',
      AZDO_ORG_URL: 'https://dev.azure.com/example',
    },
  });
}

describe('fetch-artifacts.sh (E09-S03-T06)', () => {
  it('is shellcheck-clean, like every emitted script', () => {
    const dir = project();
    const shellcheck =
      process.env.SHELLCHECK ??
      join(import.meta.dirname, '../../runtime/node_modules/.bin/shellcheck');
    const result = spawnSync(shellcheck, [join(dir, 'fetch-artifacts.sh')], { encoding: 'utf8' });
    expect(result.error, 'shellcheck is not on PATH').toBeUndefined();
    expect(result.status, result.stdout || result.stderr).toBe(0);
  });

  it('delegates to azdo-emu when it is installed, forwarding the project and the flags', () => {
    const dir = project();
    const bin = mkdtempSync(join(tmpdir(), 'azdo-emu-bin-'));
    // A stand-in that records how it was called. `exec` means the script's own exit status is
    // this one's, which is what the last assertion checks.
    const fake = join(bin, 'azdo-emu');
    writeFileSync(fake, '#!/usr/bin/env bash\necho "CALLED $*"\nexit 7\n');
    chmodSync(fake, 0o755);

    const result = run(dir, [bin, '/usr/bin', '/bin'], ['--refresh', '--latest']);
    expect(result.stdout).toContain(`CALLED fetch-artifacts ${dir} --refresh --latest`);
    expect(result.status).toBe(7);
  });

  it('resolves the project from its own location, not the working directory', () => {
    // `fetch-artifacts.sh` is run from anywhere — `bash /path/to/out/fetch-artifacts.sh` must
    // fetch into that project, not into `$PWD`.
    const dir = project();
    const bin = mkdtempSync(join(tmpdir(), 'azdo-emu-bin-'));
    const fake = join(bin, 'azdo-emu');
    writeFileSync(fake, '#!/usr/bin/env bash\necho "CALLED $*"\n');
    chmodSync(fake, 0o755);
    const elsewhere = mkdtempSync(join(tmpdir(), 'azdo-emu-cwd-'));

    const result = spawnSync('bash', [join(dir, 'fetch-artifacts.sh')], {
      encoding: 'utf8',
      cwd: elsewhere,
      env: { PATH: [bin, '/usr/bin', '/bin'].join(':') },
    });
    expect(result.stdout).toContain(`CALLED fetch-artifacts ${dir}`);
    expect(result.stdout).not.toContain(elsewhere);
  });

  describe('without azdo-emu on PATH', () => {
    const empty = mkdtempSync(join(tmpdir(), 'azdo-emu-empty-'));
    mkdirSync(empty, { recursive: true });

    it('never prints the operator’s token — the heredoc is quoted for exactly this', () => {
      // The one assertion here that is about a secret rather than a message. An unquoted heredoc
      // is a one-character mistake that turns a help text into a credential disclosure.
      const result = run(project(), [empty, '/usr/bin', '/bin']);
      expect(result.stderr).not.toContain('TOKEN-THAT-MUST-NOT-BE-PRINTED');
      expect(result.stderr).toContain('$SYSTEM_ACCESSTOKEN');
    });

    it('explains the two requests, and fails rather than exiting 0 having done nothing', () => {
      const result = run(project(), [empty, '/usr/bin', '/bin']);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('$expand=signedContent');
      expect(result.stderr).toContain('.cache/artifacts/<alias>/<runId>/<artifactName>');
      // C-E00-020: Basic with an *empty* username. A fallback that documented `-u user:PAT`
      // would 401 and read like a bad token.
      expect(result.stderr).toContain('curl -sS -u ":$SYSTEM_ACCESSTOKEN"');
    });

    it('warns that the signed URL is a credential whose path decodes to the org (C-E09-094)', () => {
      const result = run(project(), [empty, '/usr/bin', '/bin']);
      expect(result.stderr).toContain('bearer credential');
      expect(result.stderr).toContain('base64');
    });

    it('writes the fallback to stderr, so a caller piping stdout gets nothing misleading', () => {
      const result = run(project(), [empty, '/usr/bin', '/bin']);
      expect(result.stdout).toBe('');
    });
  });
});
