// Nightly re-expansion + convert smoke (E11-S03-T01) — the L3 drift detector.
//
// The corpus's oracle pairs are the evidence behind a large part of this repo: the golden harness
// emits from them, the expansion validator is written against them, and dozens of claims cite them.
// They were fetched once. This harness re-asks the service the same questions on a schedule, so a
// change on their side surfaces as a failed job within a day instead of as a mystery months later.
//
// Two phases, and they answer different questions:
//
//   A. **Expansion byte-stability.** Re-`preview` every corpus entry's `pipeline.yml` and compare
//      the result to the committed `fixtures/oracle/<entry>.final.yml`. Any difference is service
//      drift by construction: the input is committed and unchanged (ordinary CI's
//      `test/corpus.test.ts` fails if a fixture was edited without re-fetching), so the only free
//      variable left is the service.
//
//   B. **Convert smoke.** Convert each entry and run the generated project. This is a smoke test,
//      not a parity oracle: it asserts `convert` succeeds and the generated `run.sh` executes,
//      **not** that each fixture reproduces a pinned exit code. Several corpus entries drive tasks
//      whose tools (`helm`, `kubectl`, `pwsh`) are absent from a GitHub runner, so a pinned
//      per-entry exit code would encode the runner's toolset rather than the emitter's behaviour,
//      and would go red for a reason that has nothing to do with drift. The narrowing is recorded
//      as docs/06 §5 decision 75.
//
// **Redaction is part of the comparison, not a formatting step.** `scripts/corpus-oracle.ts`'s
// header states it: the committed pairs passed through `redact()`, so a fresh response must be
// redacted before it is diffed or every entry whose expansion names the organization would diff
// forever. The same applies to what this harness *writes*: the report is uploaded as a CI artifact
// and the organization is a real one, so every line of it goes through `redact()` too.
//
// This harness is read-only against the org. It does not push the corpus into the oracle
// repository the way `corpus-oracle.ts` does — an edited fixture is ordinary CI's business, and a
// scheduled job that writes to the repository could mask the very drift it is looking for.
//
// Run: node scripts/drift.ts              both phases, report to .drift-report/
//      node scripts/drift.ts --expansion  phase A only (no build required)
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  configFromEnv,
  preview,
  redact,
  type FetchLike,
  type OracleConfig,
} from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { oraclePairPath, readCorpus, type CorpusEntry } from './corpus.ts';
import { readFile } from 'node:fs/promises';

export const REPORT_DIR = '.drift-report';

export interface ExpansionCheck {
  readonly entry: string;
  readonly status: 'stable' | 'drifted' | 'rejected';
  /** A unified-ish excerpt of what moved, already redacted. Empty when stable. */
  readonly diff: string;
  /** Why the service refused, when it did. Already redacted. */
  readonly message?: string;
}

/**
 * A compact diff of two documents: the common prefix and suffix are elided and the changed middle
 * is shown from both sides.
 *
 * Not a Myers diff — for drift the question is "what moved", and a service that reformats one key
 * produces a readable answer this way without pulling in a diff library for a nightly job.
 */
export function diffExcerpt(committed: string, fresh: string, context = 3, limit = 60): string {
  const a = committed.split('\n');
  const b = fresh.split('\n');

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const from = Math.max(0, head - context);
  const lines: string[] = [`@@ committed -${head + 1} / fresh +${head + 1} @@`];
  for (let i = from; i < head; i += 1) lines.push(`  ${a[i]}`);
  for (const line of a.slice(head, a.length - tail).slice(0, limit)) lines.push(`- ${line}`);
  for (const line of b.slice(head, b.length - tail).slice(0, limit)) lines.push(`+ ${line}`);
  const after = a.slice(a.length - tail, a.length - tail + context);
  for (const line of after) lines.push(`  ${line}`);
  return lines.join('\n');
}

/**
 * Re-expand one entry and compare against its committed pair.
 *
 * The fresh response is redacted *before* the comparison, with the same config the committed pair
 * was produced under — otherwise every entry naming the organization drifts on every run.
 */
export async function checkEntry(
  config: OracleConfig,
  entry: CorpusEntry,
  committed: string,
  fetchImpl?: FetchLike,
): Promise<ExpansionCheck> {
  const outcome =
    fetchImpl === undefined
      ? await preview(config, { yamlOverride: entry.rootYaml })
      : await preview(config, { yamlOverride: entry.rootYaml }, fetchImpl);

  if (outcome.kind !== 'expanded') {
    const message = 'message' in outcome ? outcome.message : `status ${outcome.status}`;
    return { entry: entry.name, status: 'rejected', diff: '', message: redact(message, config) };
  }

  const fresh = redact(outcome.finalYaml, config);
  if (fresh === committed) return { entry: entry.name, status: 'stable', diff: '' };
  return {
    entry: entry.name,
    status: 'drifted',
    diff: redact(diffExcerpt(committed, fresh), config),
  };
}

/** Phase A over the whole corpus. */
export async function checkExpansions(
  config: OracleConfig,
  root = '.',
  fetchImpl?: FetchLike,
): Promise<readonly ExpansionCheck[]> {
  const checks: ExpansionCheck[] = [];
  for (const entry of await readCorpus(root)) {
    const committed = await readFile(path.join(root, oraclePairPath(entry.name)), 'utf8');
    checks.push(await checkEntry(config, entry, committed, fetchImpl));
  }
  return checks;
}

export interface SmokeResult {
  readonly entry: string;
  readonly status: 'ok' | 'convert-failed' | 'run-failed';
  /** Combined output, already redacted, kept only when something failed. */
  readonly log: string;
}

/** How a single entry is converted and run. Injected so the smoke phase is testable offline. */
export type Runner = (
  entry: CorpusEntry,
  outDir: string,
) =>
  | Promise<{ step: 'convert' | 'run'; status: number; output: string }>
  | {
      step: 'convert' | 'run';
      status: number;
      output: string;
    };

/**
 * The real runner: the built `convert`, then the generated project's own entry point.
 *
 * `convert` is called as a **library** rather than through `azdo-emu convert`, because the CLI
 * never assembles an `OracleConfig` — `--org` and `--project` are parsed but nothing turns them
 * (plus a pipeline id, which has no flag at all) into the `ConvertDeps.oracle` the service arm
 * needs, so from the command line that arm is unreachable and every entry fails with
 * `ExpansionConfigMissingError`. Recorded as a gap against E10-S02-T01, with a follow-up task; the
 * nightly does not paper over it by falling back to `--offline-expand`, which would smoke the
 * degraded local engine and report it as the service path.
 *
 * The import is dynamic so this module stays loadable without a build — `test/drift.test.ts`
 * injects its own runner and must not need `dist`.
 */
export function cliRunner(root: string, config: OracleConfig): Runner {
  return async (entry, outDir) => {
    const { convert } = (await import(
      pathToFileURL(path.join(root, 'packages/cli/dist/index.js')).href
    )) as {
      convert: (
        file: string,
        flags: Record<string, unknown>,
        deps: Record<string, unknown>,
      ) => Promise<unknown>;
    };

    try {
      await convert(path.join(entry.dir, 'pipeline.yml'), { out: outDir }, { oracle: config });
    } catch (error) {
      return { step: 'convert', status: 1, output: String(error) };
    }
    // What a user does after `convert`: fill in the secrets file. Empty is right here — the corpus
    // pipelines declare no service connection whose absence would change the smoke's answer.
    await writeFile(path.join(outDir, '.env'), '', 'utf8');
    const run = spawnSync('bash', ['run.sh'], { encoding: 'utf8', cwd: outDir });
    return { step: 'run', status: run.status ?? 1, output: run.stdout + run.stderr };
  };
}

/**
 * Phase B over the whole corpus.
 *
 * A non-zero `run.sh` is recorded, not failed on: see the header — a runner without `helm` is not
 * drift. `convert` failing *is* a failure, because that is our code refusing a document the
 * service accepted.
 */
export async function smokeConvert(
  config: OracleConfig,
  root = '.',
  runner: Runner = cliRunner(root, config),
  outBase = path.join(REPORT_DIR, 'projects'),
): Promise<readonly SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const entry of await readCorpus(root)) {
    // Absolute: the runner sets `cwd` to this directory, so a relative path would double up.
    const outDir = path.resolve(root, outBase, entry.name);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const outcome = await runner(entry, outDir);
    if (outcome.step === 'convert' && outcome.status !== 0) {
      results.push({
        entry: entry.name,
        status: 'convert-failed',
        log: redact(outcome.output, config),
      });
      continue;
    }
    results.push(
      outcome.status === 0
        ? { entry: entry.name, status: 'ok', log: '' }
        : { entry: entry.name, status: 'run-failed', log: redact(outcome.output, config) },
    );
  }
  return results;
}

export interface DriftReport {
  readonly checkedAt: string;
  readonly expansions: readonly ExpansionCheck[];
  readonly smoke: readonly SmokeResult[];
}

/**
 * True when the run must fail the job: any drift, any rejection, any `convert` failure — and the
 * case where the smoke ran but *nothing* came out clean.
 *
 * A single `run-failed` entry is not a failure (see the header: a runner without `helm` is not
 * drift), but "no entry ran clean" cannot be explained that way — the plain script fixtures need
 * nothing beyond bash. That is the one non-vacuous assertion the smoke phase can make without
 * pinning per-entry exit codes to the runner's toolset.
 */
export function isFailure(report: DriftReport): boolean {
  const smokeRan = report.smoke.length > 0;
  return (
    report.expansions.some((check) => check.status !== 'stable') ||
    report.smoke.some((result) => result.status === 'convert-failed') ||
    (smokeRan && !report.smoke.some((result) => result.status === 'ok'))
  );
}

/** The uploaded artifact. Every field is already redacted by the phase that produced it. */
export function renderReport(report: DriftReport): string {
  const lines = [`# Drift report — ${report.checkedAt}`, '', '## Expansion byte-stability', ''];
  for (const check of report.expansions) {
    lines.push(
      `- **${check.entry}** — ${check.status}${check.message ? `: ${check.message}` : ''}`,
    );
    if (check.diff !== '') lines.push('', '```diff', check.diff, '```', '');
  }
  lines.push('', '## Convert smoke', '');
  for (const result of report.smoke) {
    lines.push(`- **${result.entry}** — ${result.status}`);
    if (result.log !== '') lines.push('', '```', result.log.slice(0, 4000), '```', '');
  }
  return `${lines.join('\n')}\n`;
}

export async function writeReport(report: DriftReport, root = '.'): Promise<string> {
  const dir = path.join(root, REPORT_DIR);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'report.md');
  await writeFile(file, renderReport(report), 'utf8');
  await writeFile(path.join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

export async function main(argv: readonly string[], root = '.'): Promise<number> {
  const env = await loadEnvFile(path.join(root, '.env.oracle'));
  const config = configFromEnv(env); // loadEnvFile already merges process.env, so CI needs no file

  const expansions = await checkExpansions(config, root);
  const smoke = argv.includes('--expansion') ? [] : await smokeConvert(config, root);
  const report: DriftReport = { checkedAt: new Date().toISOString(), expansions, smoke };

  const file = await writeReport(report, root);
  process.stdout.write(renderReport(report));
  process.stdout.write(`\nreport written to ${file}\n`);

  if (isFailure(report)) {
    process.stderr.write(
      '\nDrift detected. Classify it before changing any fixture: research/drift-runbook.md ' +
        '(E11-S03-T02) — a service change and a bug in our request look identical from here.\n',
    );
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
