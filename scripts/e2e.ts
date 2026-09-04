// L5 end-to-end: convert and run sample pipelines inside a container (E11-S04-T01).
//
// The tiers below L5 all stop short of one question. L1/L2 test modules, L4 tests the runtime's
// helpers directly, and `drift.ts` Phase B converts every corpus entry and runs it — but
// **deliberately records exit codes rather than pinning them** (decision 75), because on a hosted
// GitHub runner the toolset decides them and several corpus entries drive tasks whose tools are
// absent there.
//
// Inside a controlled image the toolset *is* controlled. That is the whole value of this tier: the
// exit code, the artifacts on disk and the log markers become facts about the emitter and the
// runtime, and can be asserted rather than reported. `fixtures/e2e/MANIFEST.json` holds them.
//
// **This is not PLAN D9's sandbox.** D9 defers the *converter* wrapping each step in a container,
// and `convert` refuses `--exec-env sandbox` for exactly that reason (decision 69). Here the
// container is the harness's own environment: `convert` and `bash run.sh` run inside it in ordinary
// host mode. The config key `output.execution.dockerSocket` governs the deferred sandbox, not this.
//
// Run: `pnpm test:e2e [--sample <name>] [--keep]`
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const FIXTURE_DIR = path.join('fixtures', 'e2e');
export const IMAGE_PREFIX = 'azdo-emu-e2e';

/** What one sample must do. Mirrors `fixtures/e2e/MANIFEST.json`. */
export interface SampleExpectation {
  readonly image: 'base' | 'node';
  readonly exitCode: number;
  /** Paths under the run's artifact directory that must exist and be non-empty. */
  readonly artifacts: readonly string[];
  /** Substrings that must appear in the combined run log. */
  readonly markers: readonly string[];
  /** Substrings that must **not** appear — the half a green-only assertion cannot check. */
  readonly absentMarkers: readonly string[];
}

export interface SampleResult {
  readonly sample: string;
  readonly status: 'ok' | 'failed';
  readonly problems: readonly string[];
  readonly exitCode: number;
  readonly log: string;
}

export function readExpectations(root = '.'): Readonly<Record<string, SampleExpectation>> {
  const file = path.join(root, FIXTURE_DIR, 'MANIFEST.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    samples: Record<string, SampleExpectation>;
  };
  return parsed.samples;
}

/** How a sample's image is built. `node` is layered on `base` so they cannot drift apart. */
export function imageTag(kind: string): string {
  return `${IMAGE_PREFIX}-${kind}:latest`;
}

export type Exec = (
  command: string,
  args: readonly string[],
  options?: { cwd?: string },
) => { status: number | null; stdout: string; stderr: string };

const realExec: Exec = (command, args, options = {}) => {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

/**
 * Build the two images.
 *
 * Built in-job from official bases rather than pulled from a registry: publishing images would be
 * an outward-facing write under the owner's account, and "minimal images approximating hosted
 * toolsets" does not require one. The layering means the node image cannot disagree with the base
 * about the runtime's own requirements.
 */
export function buildImages(root = '.', exec: Exec = realExec): readonly string[] {
  const problems: string[] = [];
  for (const kind of ['base', 'node'] as const) {
    const args = [
      'build',
      '-f',
      path.join('docker', 'e2e', `Dockerfile.${kind}`),
      '-t',
      imageTag(kind),
      ...(kind === 'node' ? ['--build-arg', `BASE=${imageTag('base')}`] : []),
      '.',
    ];
    const built = exec('docker', args, { cwd: root });
    if (built.status !== 0) {
      problems.push(`docker build ${kind} failed: ${built.stderr.slice(-2000)}`);
      // The node image is FROM the base, so a failed base cannot produce a usable node image.
      break;
    }
  }
  return problems;
}

/**
 * The script the container runs, once the project has already been converted **on the host**.
 *
 * The split is the sharpest thing this tier asserts, and the first run found it. The base image has
 * no Node — and the converter is a Node program — so converting inside the container would have
 * forced Node into every image, including the one whose whole purpose is to be minimal. Converting
 * outside and running inside is both more faithful (a developer converts on their machine and runs
 * the result wherever) and a **stronger** assertion: it proves the generated project is the
 * dependency-free bash PLAN promises, since the base image contains no Node, no pnpm and nothing
 * this repository built (C-E12-030).
 *
 * `run.sh`'s exit code is what the harness pins, so it is captured rather than allowed to end the
 * script — otherwise sample 03, whose pinned code is non-zero, could not report anything after it.
 */
export function containerScript(): string {
  return [
    'set -u',
    // A writable copy: the converted project is mounted read-only, so a run cannot make itself pass
    // by editing its own scripts, and the host's copy stays pristine for inspection.
    'cp -r /project /work/out',
    // The sample's own source, as `checkout: self` will find it. `AZDO_SELF_REPO` is the runtime's
    // documented fallback for `self` (and *only* for `self`), and the generated runner exports it
    // beside the project — but the harness converts on the host, where the path differs from the
    // container's, so it is set here. A writable copy, because `azdo_checkout` needs a real repo
    // and the mount is read-only.
    'cp -r /source /work/source',
    'cd /work/source && git init -q . && git add -A',
    'git -c user.email=e2e@example.com -c user.name=e2e commit -qm e2e',
    'export AZDO_SELF_REPO=/work/source',
    'cd /work/out',
    // The generated README's own quick start: `cp .env.example .env`, then `./run.sh`. The harness
    // follows it rather than inventing a shortcut, because the first thing L5 should catch is a
    // documented first step that does not work. `run.sh` refuses to start without the file.
    'cp .env.example .env',
    'bash run.sh; run_status=$?',
    'echo "E2E-EXIT $run_status"',
    // The whole run tree is listed, each line prefixed, so a missing artifact names what *was*
    // produced instead of leaving the reader to guess — and so the assertion matches a marked line
    // rather than anything that happens to mention the path.
    'find /work/out/.work -type f 2>/dev/null | sed -e "s|^/work/out/.work/run-[0-9]*/|E2E-FILE |" | sort -u || true',
    'exit 0',
  ].join('\n');
}

/**
 * Convert one sample on the host, into `outdir`.
 *
 * `--offline-expand` is deliberate: every sample is template-free, so the offline expander and the
 * service produce the same document, and this suite needs no credentials at all (C-E12-028). A
 * lapsed PAT must never turn the E2E job red for a reason unrelated to E2E.
 */
export function convertSample(
  sample: string,
  outdir: string,
  root = '.',
  exec: Exec = realExec,
): { ok: boolean; log: string } {
  const source = path.join(path.resolve(root), FIXTURE_DIR, sample);
  const cli = path.join(path.resolve(root), 'packages', 'cli', 'dist', 'bin.js');
  const converted = exec(
    'node',
    [cli, 'convert', path.join(source, 'azure-pipelines.yml'), '-o', outdir, '--offline-expand'],
    { cwd: source },
  );
  return {
    ok: converted.status === 0,
    log: `${converted.stdout}\n${converted.stderr}`,
  };
}

/** Everything the harness asserts about one finished run. */
export function checkSample(
  expectation: SampleExpectation,
  log: string,
  exitCode: number,
): readonly string[] {
  const problems: string[] = [];
  if (exitCode !== expectation.exitCode) {
    problems.push(`exit code ${exitCode}, expected ${expectation.exitCode}`);
  }
  for (const marker of expectation.markers) {
    if (!log.includes(marker)) problems.push(`missing log marker: ${marker}`);
  }
  for (const marker of expectation.absentMarkers) {
    // The assertion a green-only suite cannot make: a step that must *not* have run.
    if (log.includes(marker)) problems.push(`marker present but must not be: ${marker}`);
  }
  for (const artifact of expectation.artifacts) {
    // Matched against the marked listing, not the raw log: a step that merely *printed* the path
    // would otherwise satisfy an assertion about the file existing.
    if (!log.includes(`E2E-FILE ${artifact}`)) {
      problems.push(`artifact not found in the run tree: ${artifact}`);
    }
  }
  return problems;
}

/** Parse `E2E-EXIT <n>` back out of the container log. */
export function parseExitCode(log: string): number {
  const match = /^E2E-EXIT (\d+)$/m.exec(log);
  return match === undefined || match === null ? -1 : Number(match[1]);
}

export async function runSample(
  sample: string,
  expectation: SampleExpectation,
  root = '.',
  exec: Exec = realExec,
): Promise<SampleResult> {
  const scratch = await mkdtemp(path.join(tmpdir(), 'azdo-e2e-'));
  try {
    const outdir = path.join(scratch, 'out');
    const converted = convertSample(sample, outdir, root, exec);
    if (!converted.ok) {
      return {
        sample,
        status: 'failed',
        problems: ['convert failed on the host'],
        exitCode: -1,
        log: converted.log,
      };
    }

    const run = exec('docker', [
      'run',
      '--rm',
      // Read-only: a run that could edit its own scripts could make itself pass.
      '-v',
      `${outdir}:/project:ro`,
      '-v',
      `${path.join(path.resolve(root), FIXTURE_DIR, sample)}:/source:ro`,
      '-w',
      '/work',
      imageTag(expectation.image),
      'bash',
      '-c',
      containerScript(),
    ]);
    const log = `${converted.log}\n${run.stdout}\n${run.stderr}`;
    const exitCode = parseExitCode(log);
    const problems = [...checkSample(expectation, log, exitCode)];
    if (run.status !== 0) problems.push(`the container itself exited ${String(run.status)}`);
    return {
      sample,
      status: problems.length === 0 ? 'ok' : 'failed',
      problems,
      exitCode,
      log,
    };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export function renderResults(results: readonly SampleResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    lines.push(
      `${result.status === 'ok' ? 'ok  ' : 'FAIL'} ${result.sample} (exit ${result.exitCode})`,
    );
    for (const problem of result.problems) lines.push(`       ${problem}`);
    if (result.status === 'failed') {
      lines.push('       --- container log (tail) ---');
      // The file listing is diagnostic noise once the artifact assertions have already reported;
      // dropping it here keeps the *cause* in view rather than pushing it off the top.
      const interesting = result.log
        .trimEnd()
        .split('\n')
        .filter((line) => !line.startsWith('E2E-FILE '));
      for (const line of interesting.slice(-25)) lines.push(`       ${line}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function main(argv: readonly string[], root = '.'): Promise<number> {
  const expectations = readExpectations(root);
  const only = argv[argv.indexOf('--sample') + 1];
  const samples = argv.includes('--sample')
    ? Object.keys(expectations).filter((name) => name === only)
    : Object.keys(expectations);
  if (samples.length === 0) {
    process.stderr.write(`no such sample: ${String(only)}\n`);
    return 2;
  }

  const buildProblems = buildImages(root);
  if (buildProblems.length > 0) {
    process.stderr.write(`${buildProblems.join('\n')}\n`);
    return 1;
  }

  const results: SampleResult[] = [];
  for (const sample of samples) {
    results.push(await runSample(sample, expectations[sample]!, root));
  }
  process.stdout.write(renderResults(results));
  const failed = results.filter((result) => result.status === 'failed').length;
  process.stdout.write(
    failed === 0
      ? `\nAll ${results.length} L5 samples behaved as pinned.\n`
      : `\n${failed} of ${results.length} L5 samples did not.\n`,
  );
  return failed === 0 ? 0 : 1;
}

/* istanbul ignore next -- the CLI arm; the exported functions above are what tests drive. */
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
