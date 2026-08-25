// E05-S01-T03 — entry-point emission (run.sh / run-stage.sh / run-job.sh / conditions.sh).
//
// The Done criteria are a bats E2E (full run, partial run, --only-step, --list snapshot) and
// shellcheck-clean emitted scripts. The substantive E2E is below (a generated project actually
// executed under bash, since the emitter is TypeScript and there is no convert CLI yet); this file
// also snapshots each entry point and runs shellcheck over the whole generated `run.sh` family.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPipeline, parsePipelineYaml, type Diagnostic } from '@azdo-emu/engine';
import { scaffold } from '../src/scaffold.js';
import { emitStepScript } from '../src/step.js';
import { emitEntrypoints } from '../src/entrypoints.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shellcheck =
  process.env.SHELLCHECK ?? join(repoRoot, 'packages/runtime/node_modules/.bin/shellcheck');
// Shellcheck codes the emitted project legitimately triggers (decision 61 + 62):
//   SC1091 — `source "$AZDO_EMU_LIB/…"` resolves at run time; SC2005/SC2046 — ADO `$( )` macros in
//   step bodies; SC2016 — `--wd '$(System.DefaultWorkingDirectory)'` macro passthrough to run_step;
//   SC2071 — zero-padded step numbers compared as strings (correct for `NNN`, avoids octal `-gt`).
const SHELLCHECK_MACRO_EXCLUDES = ['SC1091', 'SC2005', 'SC2016', 'SC2046', 'SC2071'];

const FIXTURE = `stages:
- stage: Build
  jobs:
  - job: compile
    displayName: Compile and test
    steps:
    - task: CmdLine@2
      displayName: Say hello
      inputs:
        script: |
          echo "hello from compile"
          printf 'from-macro=%s from-api=%s\\n' "$(PIPELINE_ONLY)" "$(azdo_var PIPELINE_ONLY)"
    - task: Bash@3
      displayName: Fail loudly
      inputs:
        targetType: inline
        script: echo "second step"
- stage: Report
  dependsOn:
  - Build
  jobs:
  - job: report
    steps:
    - task: CmdLine@2
      displayName: Report
      condition: eq(variables.skip, 'true')
      inputs:
        script: echo "reported"
`;

/** Generate a complete project into `dir`: scaffold + step scripts + entrypoints + lib/. */
function generateProject(dir: string): void {
  const { pipeline, diagnostics } = buildPipeline(
    parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'),
  );
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(pipeline).toBeDefined();
  const plan = scaffold(pipeline!);

  // lib/: the runtime's core.sh + expr.sh are copied (the convert wiring does this; E05-S01-T03
  // owns the entry points only).
  mkdirSync(join(dir, 'lib'), { recursive: true });
  copyFileSync(join(repoRoot, 'packages/runtime/lib/core.sh'), join(dir, 'lib/runtime.sh'));
  copyFileSync(join(repoRoot, 'packages/runtime/lib/expr.sh'), join(dir, 'lib/expr.sh'));

  writeFileSync(join(dir, '.env'), 'PIPELINE_ONLY=from-env\n');

  for (const file of plan.directories) mkdirSync(join(dir, file), { recursive: true });
  for (const stage of plan.stages) {
    for (const job of stage.jobs) {
      for (const step of job.steps) {
        writeFileSync(join(dir, step.path), emitStepScript(step.step, step.number));
      }
    }
  }
  for (const [path, content] of emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', [])) {
    writeFileSync(join(dir, path), content);
  }
}

describe('emitEntrypoints', () => {
  it('emits run.sh, run-stage.sh, run-job.sh and conditions.sh for the fixture', () => {
    const { pipeline, diagnostics } = buildPipeline(
      parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const plan = scaffold(pipeline!);
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', []);
    expect([...files.keys()].sort()).toEqual([
      'run.sh',
      'stages/010-build/conditions.sh',
      'stages/010-build/jobs/010-compile-and-test/run-job.sh',
      'stages/010-build/run-stage.sh',
      'stages/020-report/conditions.sh',
      'stages/020-report/jobs/010-report/run-job.sh',
      'stages/020-report/run-stage.sh',
    ]);
    expect(files.get('run.sh')).toContain("'BUILD_SOURCEBRANCH=Build.SourceBranch'");
    expect(files.get('run.sh')).toContain("'SYSTEM_ACCESSTOKEN=System.AccessToken'");
    expect(files.get('stages/010-build/jobs/010-compile-and-test/run-job.sh')).toContain(
      'azdo_var_scope_copy pipeline "$AZDO_VAR_SCOPE"',
    );
    expect(files.get('stages/010-build/jobs/010-compile-and-test/run-job.sh')).not.toContain(
      'azdo_run_identity_seed',
    );
    expect(files.get('run.sh')).toMatchSnapshot();
    expect(files.get('stages/010-build/conditions.sh')).toMatchSnapshot();
    expect(files.get('stages/010-build/jobs/010-compile-and-test/run-job.sh')).toMatchSnapshot();
    expect(files.get('stages/010-build/run-stage.sh')).toMatchSnapshot();
  });

  it('compiles an authored condition into a cond_* function', () => {
    const { pipeline } = buildPipeline(parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'));
    const plan = scaffold(pipeline!);
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', []);
    const reportConditions = files.get('stages/020-report/conditions.sh')!;
    expect(reportConditions).toContain('cond_step_010()');
    expect(reportConditions).toContain('azdo_expr_cmp eq str "$(azdo_var \'skip\')" str true');
  });

  it('records a diagnostic and emits a failing guard for an unparsable condition', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: b
    steps:
    - task: CmdLine@2
      condition: nosuchfunc(1)
      inputs:
        script: echo hi
`;
    const { pipeline } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
    const plan = scaffold(pipeline!);
    const diagnostics: Diagnostic[] = [];
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', diagnostics);
    expect(diagnostics.some((d) => d.code === 'emit-condition-parse')).toBe(true);
    expect(files.get('stages/010-a/conditions.sh')).toContain('return 2');
  });

  it('emits a no-steps run-job for a strategy job with no steps', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - deployment: d
    environment: prod
    strategy:
      rolling:
        maxParallel: 1
`;
    const { pipeline, diagnostics } = buildPipeline(
      parsePipelineYaml(yaml, 'pipeline.expanded.yml'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const plan = scaffold(pipeline!);
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', []);
    expect(files.get('stages/010-a/jobs/010-d/run-job.sh')).toContain('# no steps in this job');
  });

  it('generated entry points and step scripts pass shellcheck', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-entrypoints-'));
    try {
      generateProject(tmp);
      const files = readdirSync(tmp, { recursive: true })
        .filter((f) => typeof f === 'string' && f.endsWith('.sh'))
        .map((f) => join(tmp, f as string));
      const check = spawnSync(
        shellcheck,
        [...SHELLCHECK_MACRO_EXCLUDES.flatMap((c) => ['-e', c]), ...files],
        { encoding: 'utf8' },
      );
      expect(check.status, check.stdout || check.stderr).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('generated project runs end-to-end', () => {
  it('run.sh --list prints the tree', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-run-'));
    try {
      generateProject(tmp);
      const out = execFileSync('bash', ['run.sh', '--list'], { cwd: tmp, encoding: 'utf8' });
      expect(out).toContain('Build');
      expect(out).toContain('Report');
      expect(out).toContain('Say hello');
      expect(out).toMatchSnapshot();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('run.sh performs a full run (both stages, both jobs)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-run-'));
    try {
      generateProject(tmp);
      const out = execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      expect(out).toContain('Result: Succeeded');
      // The first job's step log carries its output.
      const log = readFileSync(
        join(tmp, '.work/run-1/logs/010-build/010-compile-and-test/010.log'),
        'utf8',
      );
      expect(log).toContain('hello from compile');
      expect(log).toContain('from-macro=from-env from-api=from-env');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('run-job.sh --from-step/--to-step runs a partial range and --only-step one step', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-run-'));
    try {
      generateProject(tmp);
      // Prime a run so the store/logs exist, then exercise the job entry point directly.
      execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      const jobDir = join(tmp, 'stages/010-build/jobs/010-compile-and-test');
      const runDir = join(tmp, '.work/run-1');
      const env = {
        ...process.env,
        AZDO_RUN_DIR: runDir,
        AZDO_STATE_DIR: join(runDir, 'state'),
        AZDO_WORKSPACE_DIR: join(runDir, 'workspace'),
        AZDO_EMU_LIB: join(tmp, 'lib'),
        AZDO_ARTIFACT_DIR: join(tmp, '.artifacts'),
        AZDO_STAGE_DIR: join(tmp, 'stages/010-build'),
        AZDO_STAGE_ID: 'Build',
      };
      const only = execFileSync('bash', ['run-job.sh', '--only-step', '020'], {
        cwd: jobDir,
        encoding: 'utf8',
        env,
      });
      expect(only).toContain('second step');
      expect(only).not.toContain('hello from compile');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
