// The runtime-project golden harness (E11-S02-T02) — emit, digest, and the freshness gate.
//
// A golden here is **one digest per corpus entry** over the emitted project's script tree, pinned
// in `fixtures/golden/MANIFEST.json` beside the `finalYaml` it was produced from. "Script tree"
// means the step scripts **and** the entry points since E11-S04-T05 (decision 89); it meant the
// step scripts alone before that, which is why every defect the L5 tier found in generated bash —
// C-E12-036/038/042 in `run-job.sh`, C-E12-041/043 in `conditions.sh` — was in a file no golden
// had ever hashed (C-E12-047). Digests rather
// than a committed tree of ~200 `.sh` files: the snapshot's job is to make an emitter change
// *visible*, and `__snapshots__/step.test.ts.snap` already pins the shape of each emitted kind.
// Two suites committing the same bytes would drift apart, not reinforce each other.
//
// **Why a module and not just the test file:** the assertions and the `--update` flow must compute
// the tree the same way, or the golden confirms itself — the test would re-derive the emitter's
// own output and compare it against a manifest written by that same re-derivation. One function,
// two callers, is the whole point of the file.
//
// **Why it lives here and not in `scripts/`:** the package sources import each other with `.js`
// specifiers, which bare `node` cannot resolve to `.ts`, and the built bundle beside each package
// may lag `src`. A golden pinned to a stale build would go green over a broken emitter, so
// the harness emits from **source** and runs under vitest, the repo's TypeScript runner.
// `scripts/golden.ts` is the `--update` CLI and drives this module through it.
//
// **On "the `--update` path must re-fetch `finalYaml` via the preview endpoint" (the Ground
// field):** this module deliberately *requires* that a re-fetch happened rather than performing
// one. `scripts/corpus.ts`'s header states the contract — `scripts/corpus-oracle.ts` is the only
// thing in the repo that talks to the service — and a second network caller would give the corpus
// two ways to go stale. So `--update` refuses unless every entry's oracle pair is present and
// matches *both* hashes in `fixtures/oracle/MANIFEST.json`: the pair's own content hash, and the
// hash of the corpus input it was produced from. A never-fetched pair, a hand-edited pair, and an
// edited fixture all fail the same way, naming `pnpm corpus-oracle` as the fix. The gate is on the
// freshness of the fetched artefact, which is what the criterion is about: a golden recording an
// expansion the service never returned cannot be written.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildPipeline, parsePipelineYaml, type Diagnostic } from '@azdo-emu/engine';

import { emitEntrypoints } from '../src/entrypoints.js';
import { emitStepScript } from '../src/step.js';
import { scaffold } from '../src/scaffold.js';
import { oraclePairPath, readCorpus, readManifest, sha256 } from '../../../scripts/corpus.ts';
import type { CorpusEntry } from '../../../scripts/corpus.ts';

export const GOLDEN_DIR = path.join('fixtures', 'golden');
export const GOLDEN_MANIFEST_PATH = path.join(GOLDEN_DIR, 'MANIFEST.json');

export interface GoldenEntry {
  /** The expansion this golden was produced from — binds it to one `fixtures/oracle/*.final.yml`. */
  readonly finalYamlSha256: string;
  /** How many step scripts the project has; a structural change shows here, not only in the digest. */
  readonly stepCount: number;
  /**
   * Every file in the tree — step scripts **plus** the entry points (E11-S04-T05).
   *
   * Recorded separately from `stepCount` rather than replacing it. They answer different questions:
   * a job that lost its steps moves `stepCount`, a stage that lost its `conditions.sh` moves only
   * this. Before T05 the tree *was* the step scripts, so one number served both — and
   * `tree.size === stepCount` was an assertion that quietly became a tautology.
   */
  readonly fileCount: number;
  /** sha256 over every emitted path and body. */
  readonly treeDigest: string;
}

export interface GoldenManifest {
  readonly entries: Readonly<Record<string, GoldenEntry>>;
}

/** Raised when a golden would be recorded against an expansion the service did not just return. */
export class StaleOracleError extends Error {
  readonly entry: string;

  constructor(entry: string, reason: string) {
    super(
      `golden for "${entry}" cannot be recorded: ${reason}. Re-fetch the expansion first — ` +
        `\`pnpm corpus-oracle ${entry}\` — then re-run with --update.`,
    );
    this.name = 'StaleOracleError';
    this.entry = entry;
  }
}

/**
 * Emit a project from a pinned expansion: `path -> script body`.
 *
 * Nothing here re-expands. An emitted project built from *our* expansion would be a golden the
 * service never saw, which is the failure mode E11-S01-T02's pairing rule exists to prevent.
 */
export function emitGoldenTree(
  finalYaml: string,
  file = 'pipeline.expanded.yml',
): Map<string, string> {
  const { pipeline, diagnostics } = buildPipeline(parsePipelineYaml(finalYaml, file));
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0 || pipeline === undefined) {
    throw new Error(`${file} does not build: ${errors.map((d) => d.message).join('; ')}`);
  }

  const plan = scaffold(pipeline);
  const tree = new Map<string, string>();
  for (const stage of plan.stages) {
    for (const job of stage.jobs) {
      for (const step of job.steps) {
        tree.set(step.path, emitStepScript(step.step, step.number));
      }
    }
  }

  // The entry points, added by E11-S04-T05 (C-E12-047). Until then the tree was the step scripts
  // alone, and the hole was not theoretical: **every** defect the L5 tier has found in generated
  // bash lived in a file no golden had ever hashed — C-E12-036/038 and C-E12-042 in `run-job.sh`,
  // C-E12-041 and C-E12-043 in `conditions.sh`. Five emitter changes shipped over them with the
  // goldens green, because the goldens were not looking. The emit-time diagnostics are collected
  // and discarded rather than passed out: a corpus entry that produces an emit *error* has already
  // failed `buildPipeline` above, and a golden's job is to pin bytes, not to re-adjudicate the
  // model. Warnings are deliberately not requested — they are manifest content, not a script.
  const entrypointDiagnostics: Diagnostic[] = [];
  for (const [entryPath, content] of emitEntrypoints(pipeline, plan, file, entrypointDiagnostics)) {
    tree.set(entryPath, content);
  }
  return tree;
}

/** The step scripts in a tree, which is no longer all of it (E11-S04-T05). */
export function countSteps(tree: ReadonlyMap<string, string>): number {
  return [...tree.keys()].filter((entryPath) => entryPath.includes('/steps/')).length;
}

/**
 * One digest over the whole tree.
 *
 * Paths and bodies are NUL-separated so content cannot move between two files unobserved:
 * `{a: 'xy', b: ''}` and `{a: 'x', b: 'y'}` would otherwise hash alike.
 */
export function treeDigest(tree: ReadonlyMap<string, string>): string {
  const hash = createHash('sha256');
  for (const file of [...tree.keys()].sort()) {
    hash.update(file).update('\0').update(tree.get(file)!).update('\0');
  }
  return hash.digest('hex');
}

/**
 * The pinned expansion for one corpus entry, or a `StaleOracleError` naming which of the three
 * ways it is stale applies.
 */
export async function freshFinalYaml(entry: CorpusEntry, root = '.'): Promise<string> {
  const row = (await readManifest(root)).entries[entry.name];
  if (row === undefined) {
    throw new StaleOracleError(entry.name, 'it has no row in fixtures/oracle/MANIFEST.json');
  }

  let pair: string;
  try {
    pair = await readFile(path.join(root, oraclePairPath(entry.name)), 'utf8');
  } catch {
    throw new StaleOracleError(entry.name, `${oraclePairPath(entry.name)} does not exist`);
  }

  if (sha256(pair) !== row.finalYamlSha256) {
    throw new StaleOracleError(entry.name, 'the committed pair does not match its manifest hash');
  }
  if (entry.inputSha256 !== row.inputSha256) {
    throw new StaleOracleError(
      entry.name,
      'the corpus input changed after the pair was fetched, so the expansion is for older YAML',
    );
  }
  return pair;
}

/** The golden every corpus entry should have, computed from its committed expansion. */
export async function computeGoldens(root = '.'): Promise<GoldenManifest> {
  const entries: Record<string, GoldenEntry> = {};
  for (const entry of await readCorpus(root)) {
    const finalYaml = await freshFinalYaml(entry, root);
    const tree = emitGoldenTree(finalYaml, `${entry.name}.final.yml`);
    entries[entry.name] = {
      finalYamlSha256: sha256(finalYaml),
      stepCount: countSteps(tree),
      fileCount: tree.size,
      treeDigest: treeDigest(tree),
    };
  }
  return { entries };
}

export async function readGoldenManifest(root = '.'): Promise<GoldenManifest> {
  try {
    const text = await readFile(path.join(root, GOLDEN_MANIFEST_PATH), 'utf8');
    return JSON.parse(text) as GoldenManifest;
  } catch {
    return { entries: {} };
  }
}

/** Sorted keys, so re-running the update produces no spurious diff. */
export async function writeGoldenManifest(manifest: GoldenManifest, root = '.'): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(manifest.entries).sort(([a], [b]) => a.localeCompare(b)),
  );
  await mkdir(path.join(root, GOLDEN_DIR), { recursive: true });
  await writeFile(
    path.join(root, GOLDEN_MANIFEST_PATH),
    `${JSON.stringify({ entries: sorted }, null, 2)}\n`,
    'utf8',
  );
}

export interface GoldenDrift {
  readonly entry: string;
  readonly field: 'missing' | 'unexpected' | keyof GoldenEntry;
  readonly committed: string | number | undefined;
  readonly emitted: string | number | undefined;
}

/** Every way the committed manifest disagrees with what the emitter produces today. */
export async function verifyGoldens(root = '.'): Promise<readonly GoldenDrift[]> {
  const committed = await readGoldenManifest(root);
  const emitted = await computeGoldens(root);
  const drift: GoldenDrift[] = [];

  for (const [name, row] of Object.entries(emitted.entries)) {
    const was = committed.entries[name];
    if (was === undefined) {
      drift.push({ entry: name, field: 'missing', committed: undefined, emitted: row.treeDigest });
      continue;
    }
    for (const field of ['finalYamlSha256', 'stepCount', 'fileCount', 'treeDigest'] as const) {
      if (was[field] !== row[field]) {
        drift.push({ entry: name, field, committed: was[field], emitted: row[field] });
      }
    }
  }
  for (const name of Object.keys(committed.entries)) {
    if (emitted.entries[name] === undefined) {
      drift.push({ entry: name, field: 'unexpected', committed: name, emitted: undefined });
    }
  }
  return drift;
}

/** `--update`: recompute and write. Refuses outright if any entry's pair is stale or missing. */
export async function updateGoldens(root = '.'): Promise<GoldenManifest> {
  const manifest = await computeGoldens(root);
  await writeGoldenManifest(manifest, root);
  return manifest;
}
