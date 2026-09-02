/**
 * E11-S02-T02 — the runtime-project golden harness (L2).
 *
 * Pinned `finalYaml` in, emitted project out, digest compared against `fixtures/golden/MANIFEST.json`.
 * Four properties are asserted, and each guards a different way the harness or the emitter can rot:
 *
 *  1. **The golden matches** — the emitted tree's digest equals the *committed* one. This is the
 *     snapshot; everything else exists to keep it honest.
 *  2. **Determinism** — emitting the same expansion twice is byte-identical, so a mismatch above
 *     always means the emitter changed rather than that it wobbles.
 *  3. **shellcheck-clean** — every emitted script, for real. A hard requirement for emitted
 *     templates (CLAUDE.md tech conventions).
 *  4. **A mutation is caught** — a one-line injected emitter bug must not match the committed
 *     digest. Both sides of that comparison must not be computed live, or it degrades into an
 *     assertion that sha256 is injective.
 *
 * **Goldens are only valid when their oracle pair exists** (E11-S01-T02's rule, restated in this
 * task's Ground field), so the golden is bound to its expansion in three places at once: the
 * oracle manifest's hash, the committed pair's own content, and the golden manifest's row. The
 * case that catches is a re-fetch that was never followed by a regeneration — the pair on disk
 * moved on while the golden still pins the expansion it replaced.
 *
 * `packages/emit/test/golden.ts` holds the emit-and-digest and the freshness gate, shared with the
 * `--update` CLI (`scripts/golden.ts`) so a golden cannot confirm itself.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  GOLDEN_MANIFEST_PATH,
  StaleOracleError,
  computeGoldens,
  emitGoldenTree,
  freshFinalYaml,
  readGoldenManifest,
  treeDigest,
  updateGoldens,
  verifyGoldens,
} from './golden.js';
import { oraclePairPath, readCorpus, readManifest, sha256 } from '../../../scripts/corpus.ts';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

// CI installs a system shellcheck and exports it as `$SHELLCHECK`; locally the runtime package's
// npm-vendored binary stands in. Same resolution as `step.test.ts` and `entrypoints.test.ts`.
const shellcheck =
  process.env.SHELLCHECK ?? join(repoRoot, 'packages/runtime/node_modules/.bin/shellcheck');

// The only findings a golden may carry, and both are by construction (docs/06 §5 decision 61): an
// ADO `$(name)` macro is expanded by the runtime's `azdo_expand_macros`, not by the shell
// (C-E06-018/024), so the emitter must leave it verbatim — and shellcheck then reads it as a
// command substitution. `SC2005` is `echo "$(cmd)"`, `SC2046` the unquoted one. Nothing else is
// excused; the guard below pins the list so a real finding cannot be silenced by appending a code.
const BY_CONSTRUCTION_EXCLUDES = ['SC2005', 'SC2046'];

const corpus = await readCorpus(repoRoot);
const oracleManifest = await readManifest(repoRoot);
const goldens = await readGoldenManifest(repoRoot);

const scratch: string[] = [];
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = 'azdo-emu-golden-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

describe('the committed goldens', () => {
  it('cover every corpus entry, and nothing that is not one', async () => {
    // A golden for a deleted entry is dead weight; a missing one is an entry nobody is watching.
    expect(Object.keys(goldens.entries).sort()).toEqual(corpus.map((entry) => entry.name).sort());
    expect(corpus.length).toBeGreaterThan(0);
  });

  it('match what the emitter produces today', async () => {
    // The snapshot itself. `verifyGoldens` is the same call `scripts/golden.ts` makes.
    expect(await verifyGoldens(repoRoot)).toEqual([]);
  });

  it('pin the same expansion the oracle manifest and the committed pair do', () => {
    // Three-way binding. Two of these agreeing is the normal state; the third catches the case the
    // other tests cannot see — someone re-ran `corpus-oracle` and never regenerated the goldens,
    // leaving a golden pinned to an expansion that is no longer on disk.
    for (const entry of corpus) {
      const pair = readFileSync(join(repoRoot, oraclePairPath(entry.name)), 'utf8');
      const oracleRow = oracleManifest.entries[entry.name];
      const goldenRow = goldens.entries[entry.name];
      expect(oracleRow?.finalYamlSha256, entry.name).toBe(sha256(pair));
      expect(goldenRow?.finalYamlSha256, entry.name).toBe(sha256(pair));
    }
  });

  it('record a step count that matches the tree the digest was taken over', async () => {
    const computed = await computeGoldens(repoRoot);
    for (const [name, row] of Object.entries(goldens.entries)) {
      expect(row.stepCount, name).toBe(computed.entries[name]?.stepCount);
      expect(row.stepCount, name).toBeGreaterThan(0);
    }
  });
});

describe.each(corpus.map((entry) => [entry.name] as const))('golden: %s', (name) => {
  const finalYaml = readFileSync(join(repoRoot, oraclePairPath(name)), 'utf8');
  const committed = goldens.entries[name]!;

  it('emits deterministically — the same expansion twice is byte-identical', () => {
    // Without this, a digest mismatch would be ambiguous between "the emitter changed" and "the
    // emitter wobbles", and every golden would be a coin toss.
    expect(treeDigest(emitGoldenTree(finalYaml))).toBe(treeDigest(emitGoldenTree(finalYaml)));
  });

  it('emits shellcheck-clean scripts', () => {
    const tree = emitGoldenTree(finalYaml, `${name}.final.yml`);
    expect(tree.size).toBe(committed.stepCount);

    const dir = tempDir();
    const files: string[] = [];
    for (const [file, content] of tree) {
      const full = join(dir, file);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, content);
      files.push(full);
    }

    const result = spawnSync(
      shellcheck,
      [...BY_CONSTRUCTION_EXCLUDES.flatMap((code) => ['-e', code]), ...files],
      { encoding: 'utf8' },
    );
    // A missing shellcheck must not silently pass — CI installs it, and the repo requires it.
    expect(result.error, 'shellcheck is not on PATH').toBeUndefined();
    // Exit 0 is the "no findings" signal: the npm wrapper may print a download `[INFO]` line on
    // its first run, so an empty stdout is *not* the condition.
    expect(result.status, `${name}: ${result.stdout || result.stderr}`).toBe(0);
  });

  it('a one-line emitter bug fails against the committed digest (mutation test)', () => {
    // The injected line is the smallest change a real emitter bug could make. Compared against the
    // *committed* digest, not a second live emission — otherwise this asserts nothing about the
    // golden, only that sha256 is injective.
    const corrupted = new Map(emitGoldenTree(finalYaml));
    const [first] = [...corrupted.keys()].sort();
    corrupted.set(first!, `${corrupted.get(first!)!}echo injected-emitter-bug\n`);
    expect(treeDigest(corrupted)).not.toBe(committed.treeDigest);
  });

  it('a renamed step path fails against the committed digest', () => {
    // The other half of a golden: the digest must observe *where* a script was written, not only
    // what is in it. A scaffolder that renumbered every step would otherwise pass.
    const tree = emitGoldenTree(finalYaml);
    const [first] = [...tree.keys()].sort();
    const moved = new Map(tree);
    moved.delete(first!);
    moved.set(`${first!}.moved`, tree.get(first!)!);
    expect(treeDigest(moved)).not.toBe(committed.treeDigest);
  });
});

describe('the --update gate (Ground: a golden without a fresh oracle pair is rejected)', () => {
  /** A scratch repo root holding one corpus entry, and whatever oracle state the test wants. */
  function scratchRoot(options: { pair?: string; manifest?: unknown }): string {
    const root = tempDir('azdo-emu-golden-root-');
    const entry = join(root, 'fixtures/corpus/99-scratch');
    mkdirSync(entry, { recursive: true });
    writeFileSync(join(entry, 'pipeline.yml'), 'steps:\n  - script: echo hi\n');
    writeFileSync(join(entry, 'README.md'), 'scratch entry for the update gate test\n');
    mkdirSync(join(root, 'fixtures/oracle'), { recursive: true });
    if (options.pair !== undefined) {
      writeFileSync(join(root, oraclePairPath('99-scratch')), options.pair);
    }
    if (options.manifest !== undefined) {
      writeFileSync(
        join(root, 'fixtures/oracle/MANIFEST.json'),
        JSON.stringify(options.manifest, null, 2),
      );
    }
    return root;
  }

  const EXPANSION =
    'stages:\n  - stage: default\n    jobs:\n      - job: a\n        steps:\n          - task: CmdLine@2\n            inputs:\n              script: echo hi\n';

  it('refuses an entry with no oracle pair at all, naming the entry and the fix', async () => {
    // The real update path, run against a real (temporary) repo root — not a doctored manifest
    // object, which would only prove this test's own arithmetic.
    const root = scratchRoot({});
    await expect(updateGoldens(root)).rejects.toThrow(StaleOracleError);
    await expect(updateGoldens(root)).rejects.toThrow(/99-scratch/);
    await expect(updateGoldens(root)).rejects.toThrow(/pnpm corpus-oracle/);
  });

  it('refuses a pair that exists but has no manifest row', async () => {
    const root = scratchRoot({ pair: EXPANSION });
    await expect(updateGoldens(root)).rejects.toThrow(/no row in fixtures\/oracle\/MANIFEST\.json/);
  });

  it('refuses a hand-edited pair', async () => {
    // The pair on disk no longer hashes to what the service returned, so it is not evidence about
    // the service any more.
    const root = scratchRoot({
      pair: `${EXPANSION}# hand-edited\n`,
      manifest: {
        entries: {
          '99-scratch': {
            inputSha256: (await readCorpus(scratchRoot({})))[0]!.inputSha256,
            finalYamlSha256: sha256(EXPANSION),
            fetchedAt: '2026-09-02',
          },
        },
      },
    });
    await expect(updateGoldens(root)).rejects.toThrow(/does not match its manifest hash/);
  });

  it('refuses when the corpus input moved on after the pair was fetched', async () => {
    // An edited fixture with an untouched pair: the expansion is for YAML that is no longer there.
    const root = scratchRoot({
      pair: EXPANSION,
      manifest: {
        entries: {
          '99-scratch': {
            inputSha256: 'stale'.repeat(12),
            finalYamlSha256: sha256(EXPANSION),
            fetchedAt: '2026-09-02',
          },
        },
      },
    });
    await expect(updateGoldens(root)).rejects.toThrow(/the expansion is for older YAML/);
  });

  it('writes nothing when it refuses', async () => {
    const root = scratchRoot({});
    await expect(updateGoldens(root)).rejects.toThrow(StaleOracleError);
    expect(await readGoldenManifest(root)).toEqual({ entries: {} });
  });

  it('accepts a fresh pair and round-trips through the manifest', async () => {
    const input = (await readCorpus(scratchRoot({})))[0]!;
    const root = scratchRoot({
      pair: EXPANSION,
      manifest: {
        entries: {
          '99-scratch': {
            inputSha256: input.inputSha256,
            finalYamlSha256: sha256(EXPANSION),
            fetchedAt: '2026-09-02',
          },
        },
      },
    });
    const written = await updateGoldens(root);
    expect(Object.keys(written.entries)).toEqual(['99-scratch']);
    // Written and read back, so the committed shape is the one the harness verifies against.
    expect(await readGoldenManifest(root)).toEqual(written);
    expect(await verifyGoldens(root)).toEqual([]);
  });

  it('re-fetching is `corpus-oracle`, not this harness — nothing here talks to the service', () => {
    // The Ground field asks for a mandatory re-fetch. The harness *requires* one to have happened
    // rather than performing it, so the corpus keeps exactly one way to go stale.
    const module = readFileSync(join(repoRoot, 'packages/emit/test/golden.ts'), 'utf8');
    expect(module).not.toMatch(/\bfetch\(|https?:\/\//);
    const catalogue = readFileSync(join(repoRoot, 'scripts/corpus.ts'), 'utf8');
    expect(catalogue).not.toMatch(/\bfetch\(|https?:\/\/dev\.azure\.com/);
  });
});

describe('verifyGoldens reports what moved', () => {
  it('names the entry, the field, and both values', async () => {
    const root = tempDir('azdo-emu-golden-drift-');
    mkdirSync(join(root, 'fixtures/corpus'), { recursive: true });
    mkdirSync(join(root, 'fixtures/golden'), { recursive: true });
    writeFileSync(
      join(root, GOLDEN_MANIFEST_PATH),
      JSON.stringify({
        entries: { ghost: { finalYamlSha256: 'x', stepCount: 1, treeDigest: 'y' } },
      }),
    );
    const drift = await verifyGoldens(root);
    // A golden whose corpus entry is gone must be reported, not silently ignored.
    expect(drift).toEqual([
      { entry: 'ghost', field: 'unexpected', committed: 'ghost', emitted: undefined },
    ]);
  });
});

describe('the digest', () => {
  it('observes a change in any file', () => {
    const a = new Map([
      ['a.sh', 'x'],
      ['b.sh', 'y'],
    ]);
    const b = new Map([
      ['a.sh', 'x'],
      ['b.sh', 'z'],
    ]);
    expect(treeDigest(a)).not.toBe(treeDigest(b));
  });

  it('is insensitive to map insertion order but sensitive to path names', () => {
    const forward = new Map([
      ['a.sh', 'x'],
      ['b.sh', 'y'],
    ]);
    const reversed = new Map([
      ['b.sh', 'y'],
      ['a.sh', 'x'],
    ]);
    expect(treeDigest(forward)).toBe(treeDigest(reversed));

    const renamed = new Map([
      ['a.sh', 'x'],
      ['c.sh', 'y'],
    ]);
    expect(treeDigest(renamed)).not.toBe(treeDigest(forward));
  });

  it('cannot be fooled by moving content between files', () => {
    // Without the NUL separators, `{a: 'xy', b: ''}` and `{a: 'x', b: 'y'}` would hash alike.
    const split = new Map([
      ['a.sh', 'x'],
      ['b.sh', 'y'],
    ]);
    const joined = new Map([
      ['a.sh', 'xy'],
      ['b.sh', ''],
    ]);
    expect(treeDigest(split)).not.toBe(treeDigest(joined));
  });
});

describe('emitGoldenTree refuses input it cannot build', () => {
  it('throws rather than recording a golden over a broken expansion', () => {
    // A golden over a pipeline that does not build would pin the emitter's behaviour on garbage.
    expect(() => emitGoldenTree('stages: 3\n', 'broken.yml')).toThrow(/broken\.yml does not build/);
  });
});

describe('freshFinalYaml over the real corpus', () => {
  it('returns the committed pair for every entry', async () => {
    for (const entry of corpus) {
      const pair = await freshFinalYaml(entry, repoRoot);
      expect(sha256(pair), entry.name).toBe(oracleManifest.entries[entry.name]?.finalYamlSha256);
    }
  });
});

describe('the shellcheck exclusions stay honest', () => {
  it('excuses exactly the two macro false positives and nothing else', () => {
    // Growing this list is how a golden suite stops finding bugs. A new code needs its own
    // decision entry, not an append here.
    expect(BY_CONSTRUCTION_EXCLUDES).toEqual(['SC2005', 'SC2046']);
  });
});

describe('shellcheck is genuinely available to this suite', () => {
  it('runs, so the clean assertions above mean something', () => {
    // If shellcheck were missing, every "clean" assertion would be vacuous.
    expect(execFileSync(shellcheck, ['--version'], { encoding: 'utf8' })).toContain('ShellCheck');
  });
});
