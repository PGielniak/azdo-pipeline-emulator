/**
 * The CLI's *shipped* shape (found by E11-S03-T01).
 *
 * Every other test in this package imports `../src/…`, so they all run from the source tree. That
 * is why nothing caught this: `convert` locates the bash runtime with
 * `require.resolve('@azdo-emu/runtime/lib/core.sh')`, falling back to a path relative to the
 * *module* — and the relative one was written for `src/convert/`, three levels under `packages/`.
 * The bundle lives at `dist/`, two levels under, so from the built package it pointed at a
 * directory that does not exist; and the package-name candidate could not resolve either, because
 * `@azdo-emu/runtime` was not a dependency of this package. The result was a green suite over a
 * binary that could not convert anything: `azdo-emu: cannot locate the runtime library (lib/core.sh)`.
 *
 * These tests assert the two facts that make the shipped artefact work, so neither can regress
 * without a red test rather than a bug report.
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages/cli/package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe('the runtime library is reachable from the shipped package', () => {
  it('declares @azdo-emu/runtime as a dependency', () => {
    // Without this the package-name candidate can never resolve, whatever the bundle's depth —
    // and it is the only candidate that is independent of where the bundle ends up.
    expect(manifest.dependencies?.['@azdo-emu/runtime']).toBeDefined();
  });

  it('resolves lib/core.sh by package name from inside this package', () => {
    const require = createRequire(join(repoRoot, 'packages/cli/src/convert/convert.ts'));
    const resolved = require.resolve('@azdo-emu/runtime/lib/core.sh');
    expect(existsSync(resolved)).toBe(true);
    expect(readFileSync(resolved, 'utf8')).toContain('azdo_');
  });
});

// The end-to-end proof. It needs `pnpm build`, which CI always runs before the tests; locally a
// tree with no `dist` skips rather than failing, because an unbuilt checkout is not a regression.
const bin = join(repoRoot, 'packages/cli/dist/bin.js');
const built = existsSync(bin);

describe.skipIf(!built)('the built CLI converts', () => {
  it('produces a project that runs, using the offline expander', () => {
    // `--offline-expand` keeps this hermetic: the service arm is the nightly's business
    // (E11-S03-T01), while what this guards — locating and copying the runtime library — is the
    // same code on both arms.
    const dir = mkdtempSync(join(tmpdir(), 'azdo-emu-packaging-'));
    scratch.push(dir);
    const source = join(dir, 'pipeline.yml');
    writeFileSync(source, 'steps:\n  - script: echo packaged\n');
    const out = join(dir, 'out');

    execFileSync('node', [bin, 'convert', source, '-o', out, '--offline-expand'], {
      encoding: 'utf8',
    });

    // The file whose absence was the bug.
    expect(existsSync(join(out, 'lib', 'runtime.sh'))).toBe(true);
    writeFileSync(join(out, '.env'), '');
    const stdout = execFileSync('bash', ['run.sh'], { cwd: out, encoding: 'utf8' });
    expect(stdout).toContain('Succeeded');
  }, 120_000);
});
