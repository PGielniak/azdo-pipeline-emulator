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
import { compileCondition, emitEntrypoints, transitiveDependencies } from '../src/entrypoints.js';

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
function generateProject(dir: string, yaml: string = FIXTURE): void {
  const { pipeline, diagnostics } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
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
    // Qualified by job since C-E12-041: step numbers restart per job and `conditions.sh` is one
    // file per stage, so the number alone collided.
    expect(reportConditions).toContain('cond_step_report_010()');
    expect(reportConditions).toContain('azdo_expr_cmp eq str "$(azdo_var \'skip\')" str true');
  });

  it('compiles dependency result contexts to the matching runtime reader (C-E02-092..094)', () => {
    const diagnostics: Diagnostic[] = [];
    expect(
      compileCondition(
        'stage',
        'Report',
        "eq(dependencies.Build.result, 'Skipped')",
        diagnostics,
        'pipeline.expanded.yml',
      ).body,
    ).toContain("azdo_stage_result 'Build'");
    expect(
      compileCondition(
        'job',
        'Report',
        "eq(dependencies.Build.result, 'Succeeded')",
        diagnostics,
        'pipeline.expanded.yml',
      ).body,
    ).toContain('azdo_job_result "$AZDO_STAGE_ID" \'Build\'');
    expect(
      compileCondition(
        'job',
        'Report',
        "eq(stageDependencies.Build.Compile.result, 'SucceededWithIssues')",
        diagnostics,
        'pipeline.expanded.yml',
      ).body,
    ).toContain("azdo_job_result 'Build' 'Compile'");
    expect(diagnostics).toEqual([]);
  });

  it('records skipped stage and job results for later dependency conditions', () => {
    const { pipeline } = buildPipeline(parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'));
    const plan = scaffold(pipeline!);
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', []);
    const buildStage = files.get('stages/010-build/run-stage.sh')!;
    const buildJob = files.get('stages/010-build/jobs/010-compile-and-test/run-job.sh')!;

    expect(buildStage).toContain('azdo_stage_result_set "$AZDO_STAGE_ID" Skipped');
    expect(buildStage).toContain('azdo_job_result_set "$AZDO_STAGE_ID" \'compile\' Skipped');
    expect(buildJob).toContain("AZDO_RESULT_DIR=\"$(azdo_result_dir 'Build' 'compile')\"");
  });

  it('keeps an authored empty job identifier in a distinct result directory (C-E04-004)', () => {
    const yaml = `stages:
- stage: Build
  jobs:
  - job: ''
    steps: []
`;
    const { pipeline } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
    const plan = scaffold(pipeline!);
    const files = emitEntrypoints(pipeline!, plan, 'pipeline.expanded.yml', []);
    const job = [...files.entries()].find(([path]) => path.endsWith('/run-job.sh'))?.[1];

    expect(job).toContain("AZDO_RESULT_DIR=\"$(azdo_result_dir 'Build' '')\"");
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

describe('the variables a real tool-lib task needs (E08-S02-T03)', () => {
  it('seeds Agent.ToolsDirectory and System.HostType, and does not seed Agent.Version', () => {
    // C-E08-068: tool-lib's `_getCacheRoot` throws `Agent.ToolsDirectory is not set` before doing
    // anything else — measured before *and* after against the real `KubectlInstaller@0`.
    // C-E08-072: `System.HostType` is dereferenced at module load, unguarded.
    // C-E08-071: `assertAgent` passes when `Agent.Version` is *unset*, so seeding one would flip
    // every other assertAgent gate in every task to a number we chose.
    const { pipeline } = buildPipeline(parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'));
    const files = emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
    const runJob = [...files.entries()].find(([name]) => name.endsWith('run-job.sh'))?.[1] ?? '';
    expect(runJob).toContain(`azdo_var_set 'Agent.ToolsDirectory' "$AZDO_WORKSPACE_DIR/tools"`);
    expect(runJob).toContain(`azdo_var_set 'System.HostType' build`);
    expect(runJob).not.toContain('Agent.Version');
    // The directory has to exist before a task caches into it.
    expect(files.get('run.sh')).toContain('"$AZDO_WORKSPACE_DIR/tools"');
  });
});

describe('the variables and flags a generated project needs to run (E11-S04-T01)', () => {
  const emit = (): Map<string, string> => {
    const { pipeline } = buildPipeline(parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'));
    return emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
  };

  it('seeds the agent’s a/b/TestResults siblings of s (C-E12-031)', () => {
    // Their absence was invisible until an L5 sample used `$(Build.ArtifactStagingDirectory)` — the
    // commonest idiom in real pipelines — and the macro survived into the step body, where bash
    // read `$(…)` as a command substitution.
    const files = emit();
    const runJob = [...files.entries()].find(([name]) => name.endsWith('run-job.sh'))?.[1] ?? '';
    expect(runJob).toContain(
      `azdo_var_set 'Build.ArtifactStagingDirectory' "$AZDO_WORKSPACE_DIR/a"`,
    );
    expect(runJob).toContain(`azdo_var_set 'Build.BinariesDirectory' "$AZDO_WORKSPACE_DIR/b"`);
    expect(runJob).toContain(
      `azdo_var_set 'Common.TestResultsDirectory' "$AZDO_WORKSPACE_DIR/TestResults"`,
    );
    // "Build.ArtifactStagingDirectory and Build.StagingDirectory are interchangeable" — an alias,
    // not a second directory.
    expect(runJob).toContain(`azdo_var_set 'Build.StagingDirectory' "$AZDO_WORKSPACE_DIR/a"`);
    // And the directories must exist before a step writes into them.
    expect(files.get('run.sh')).toContain('"$AZDO_WORKSPACE_DIR/a" "$AZDO_WORKSPACE_DIR/b"');
  });

  it('passes a step’s authored name to run_step, and only when it has one (C-E12-032)', () => {
    // Without it `azdo_var_set … output=true` refuses, so *every* `isOutput=true` write in a
    // generated project failed — while the runtime implemented output variables correctly.
    const yaml = [
      'stages:',
      '- stage: s',
      '  jobs:',
      '  - job: j',
      '    steps:',
      '    - script: echo hi',
      '      name: producer',
      '    - script: echo bye',
    ].join('\n');
    const { pipeline } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
    const files = emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
    const runJob = [...files.entries()].find(([name]) => name.endsWith('run-job.sh'))?.[1] ?? '';
    expect(runJob).toContain("--name 'producer'");
    // The unnamed step gets no flag at all: most steps have none, and an empty one would be noise.
    expect(runJob.match(/--name /g)).toHaveLength(1);
  });

  it('lets a failing stage reach the summary and the verdict (C-E12-035)', () => {
    // `set -euo pipefail` aborted the parent before `azdo_run_summary` and
    // `exit "$(azdo_run_exit_code)"`, so a failing pipeline printed no summary and exited with the
    // failing step's raw status. The `|| :` is what keeps those two lines reachable.
    const files = emit();
    const run = files.get('run.sh') ?? '';
    expect(run).toContain('run-stage.sh" "$@" || :');
    expect(run).toContain('azdo_run_summary');
    expect(run).toContain('exit "$(azdo_run_exit_code)"');
    const stage = [...files.entries()].find(([name]) => name.endsWith('run-stage.sh'))?.[1] ?? '';
    expect(stage).toContain('run-job.sh" "$@" || :');
  });
});

describe('step conditions are actually evaluated (C-E12-036/038, E11-S04-T03)', () => {
  // The open finding E11-S04-T01 filed was a *symptom*: a `condition: failed()` step ran after a
  // tolerated failure. The cause is one character class: `${name:+word}` substitutes when `name` is
  // **non-empty**, and `no_condition=false` is a non-empty string — so every generated `run_step`
  // was passed `--no-condition` and no step condition in any generated project was ever evaluated
  // (C-E12-038). Both halves are pinned here: the emitted text, and a real run.
  // Expanded form, as the service returns it: the model builder rejects a step with no `task:`
  // (C-E04-002), so the `script:` shorthand is already desugared to `CmdLine@2`.
  const CONDITION_FIXTURE = [
    'stages:',
    '- stage: s',
    '  jobs:',
    '  - job: j',
    '    steps:',
    '    - task: CmdLine@2',
    '      displayName: Succeed',
    '      inputs:',
    '        script: echo "MARK ran-first"',
    '    - task: CmdLine@2',
    '      displayName: Fail but continue',
    '      continueOnError: true',
    '      inputs:',
    '        script: |',
    '          echo "MARK tolerated"',
    '          exit 1',
    '    - task: CmdLine@2',
    '      displayName: Runs because the failure was tolerated',
    '      inputs:',
    '        script: echo "MARK after-tolerated"',
    '    - task: CmdLine@2',
    '      displayName: Must not run',
    '      condition: failed()',
    '      inputs:',
    '        script: echo "MARK failed-cond"',
    '    - task: CmdLine@2',
    '      displayName: Runs anyway',
    '      condition: always()',
    '      inputs:',
    '        script: echo "MARK always-cond"',
  ].join('\n');

  it('carries the flag in its own variable, not in the boolean (C-E12-038)', () => {
    const { pipeline } = buildPipeline(parsePipelineYaml(FIXTURE, 'pipeline.expanded.yml'));
    const files = emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
    const runJob = [...files.entries()].find(([name]) => name.endsWith('run-job.sh'))?.[1] ?? '';
    // The defect, spelled exactly: a `:+` test against the boolean is always true.
    expect(runJob).not.toContain('${no_condition:+--no-condition}');
    expect(runJob).toContain('condition_flag=""');
    expect(runJob).toContain('[[ "$no_condition" != true ]] || condition_flag=--no-condition');
    expect(runJob).toContain('${condition_flag:+--no-condition}');
  });

  it('skips a failed() step after a tolerated failure and runs always() (C-E06-040)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-cond-'));
    try {
      generateProject(tmp, CONDITION_FIXTURE);
      const out = execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      const logs = join(tmp, '.work/run-1/logs/010-s/010-j');
      // `continueOnError` downgrades the failure to SucceededWithIssues *before* it is merged into
      // the job status, so `succeeded()` still runs and `failed()` does not (C-E06-036/040).
      expect(readFileSync(join(logs, '030.log'), 'utf8')).toContain('MARK after-tolerated');
      expect(readFileSync(join(logs, '040.log'), 'utf8')).toContain(
        'Skipping step due to condition evaluation.',
      );
      expect(readFileSync(join(logs, '040.log'), 'utf8')).not.toContain('MARK failed-cond');
      expect(readFileSync(join(logs, '050.log'), 'utf8')).toContain('MARK always-cond');
      expect(out).toContain('SucceededWithIssues');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('skips a step whose compiled condition is a constant False (checkout: none)', () => {
    // The same defect made `checkout: none` — whose desugaring synthesizes `condition: false`
    // (C-E03-260) — run and report `Succeeded` instead of `Skipped`.
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-cond-'));
    try {
      generateProject(
        tmp,
        [
          'stages:',
          '- stage: s',
          '  jobs:',
          '  - job: j',
          '    steps:',
          // What `checkout: none` expands to: the checkout GUID with a constant-False condition.
          '    - task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1',
          '      condition: false',
          '      inputs:',
          '        repository: none',
        ].join('\n'),
      );
      execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      const result = readFileSync(join(tmp, '.work/run-1/state/results/s/j/010'), 'utf8').trim();
      expect(result).toBe('Skipped');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('pipeline/stage/job variables are seeded (C-E12-033, E11-S04-T03)', () => {
  const VARIABLE_FIXTURE = [
    'variables:',
    '- name: a',
    '  value: pipeline-value',
    '- name: rootOnly',
    '  value: root',
    '- group: shared-secrets',
    '- name: locked',
    '  value: fixed',
    '  readonly: true',
    'stages:',
    '- stage: s',
    '  variables:',
    '  - name: a',
    '    value: stage-value',
    '  jobs:',
    '  - job: j',
    '    variables:',
    '    - name: a',
    '      value: job-value',
    '    steps:',
    '    - task: CmdLine@2',
    '      displayName: Read',
    '      inputs:',
    '        script: echo "a=$(a) rootOnly=$(rootOnly) locked=$(locked)"',
    '  - job: sibling',
    '    steps:',
    '    - task: CmdLine@2',
    '      displayName: Sibling',
    '      inputs:',
    '        script: echo "a=$(a)"',
  ].join('\n');

  const emit = (yaml = VARIABLE_FIXTURE): Map<string, string> => {
    const { pipeline } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
    return emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
  };

  it('seeds the root block into run.sh after the .env load (C-E12-039)', () => {
    // Order is the assertion, not decoration: a YAML `variables:` entry outranks queue time and the
    // settings UI, the two things `.env` stands in for, so seeding before the load would invert the
    // documented precedence.
    const run = emit().get('run.sh')!;
    const envAt = run.indexOf('azdo_env_load');
    const seedAt = run.indexOf(`azdo_var_set 'a' 'pipeline-value'`);
    expect(envAt).toBeGreaterThan(-1);
    expect(seedAt).toBeGreaterThan(envAt);
    // And before the run-number init, whose format may read a user-defined variable (C-E05-012).
    expect(run.indexOf('azdo_run_identity_seed')).toBeGreaterThan(seedAt);
  });

  it('passes readonly through and never invents a secret flag', () => {
    const run = emit().get('run.sh')!;
    expect(run).toContain(`azdo_var_set 'locked' 'fixed' false false true`);
    // A YAML block cannot declare a secret; secrets arrive through `.env` (C-E06-013).
    expect(run).not.toContain(`azdo_var_set 'locked' 'fixed' true`);
  });

  it('skips a `- group:` entry, which names a group and not a variable', () => {
    const run = emit().get('run.sh')!;
    expect(run).not.toContain('shared-secrets');
  });

  it('seeds stage then job into the job scope, inside the --resume guard', () => {
    const runJob = emit().get('stages/010-s/jobs/010-j/run-job.sh')!;
    const copyAt = runJob.indexOf('azdo_var_scope_copy');
    const stageAt = runJob.indexOf(`azdo_var_set 'a' 'stage-value'`);
    const jobAt = runJob.indexOf(`azdo_var_set 'a' 'job-value'`);
    const guardEnd = runJob.indexOf('\nfi\n', copyAt);
    expect(copyAt).toBeLessThan(stageAt);
    expect(stageAt).toBeLessThan(jobAt);
    // Inside the guard: on `--resume` this job's store already holds the earlier run's values.
    expect(jobAt).toBeLessThan(guardEnd);
  });

  it('gives a sibling job the stage block but not the other job’s (C-E04-083)', () => {
    const sibling = emit().get('stages/010-s/jobs/020-sibling/run-job.sh')!;
    expect(sibling).toContain(`azdo_var_set 'a' 'stage-value'`);
    expect(sibling).not.toContain('job-value');
  });

  it('emits nothing at all for a pipeline with no variables', () => {
    const files = emit(
      ['stages:', '- stage: s', '  jobs:', '  - job: j', '    steps: []'].join('\n'),
    );
    expect(files.get('run.sh')).not.toContain('variables (C-E12-033)');
    expect(files.get('stages/010-s/jobs/010-j/run-job.sh')).not.toContain('variables (C-E12-033)');
  });

  it('resolves all three levels in a real run, job winning (C-E12-039)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-vars-'));
    try {
      generateProject(tmp, VARIABLE_FIXTURE);
      execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      // This is the doc page's own example: `a` is set at pipeline, stage and job level, and the
      // job's value is what the step reads.
      expect(readFileSync(join(tmp, '.work/run-1/logs/010-s/010-j/010.log'), 'utf8')).toContain(
        'a=job-value rootOnly=root locked=fixed',
      );
      expect(
        readFileSync(join(tmp, '.work/run-1/logs/010-s/020-sibling/010.log'), 'utf8'),
      ).toContain('a=stage-value');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('does not let a .env value outrank a YAML variable (C-E12-039)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-vars-'));
    try {
      generateProject(tmp, VARIABLE_FIXTURE);
      // `.env` stands in for queue time, which the doc ranks *below* every YAML level.
      writeFileSync(join(tmp, '.env'), 'ROOTONLY=from-env\n');
      execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      const log = readFileSync(join(tmp, '.work/run-1/logs/010-s/010-j/010.log'), 'utf8');
      expect(log).toContain('rootOnly=root');
      expect(log).not.toContain('from-env');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('stores a value raw so one variable can refer to another', () => {
    const run = emit(
      [
        'variables:',
        '- name: base',
        '  value: root',
        '- name: derived',
        '  value: from-$(base)',
        'stages:',
        '- stage: s',
        '  jobs:',
        '  - job: j',
        '    steps: []',
      ].join('\n'),
    ).get('run.sh')!;
    // Expanded on read, not on write — otherwise a forward reference could never work.
    expect(run).toContain(`azdo_var_set 'derived' 'from-$(base)'`);
  });
});

describe('one stage, many jobs: conditions and failures (C-E12-041/042, E11-S04-T03)', () => {
  // Both defects below were invisible until C-E12-038 made step conditions run at all, and both
  // need a *multi-job stage with a failure* to show up — which is why running an L5 sample found
  // them and 2,900 unit tests did not.
  const MULTI_JOB = [
    'stages:',
    '- stage: s',
    '  jobs:',
    '  - job: first',
    '    steps:',
    '    - task: CmdLine@2',
    '      displayName: Runs',
    '      inputs:',
    '        script: echo "MARK first-step-of-first-job"',
    '  - job: second',
    '    steps:',
    // A constant-False first step, exactly as `checkout: none` desugars (C-E03-260). Its condition
    // function used to redefine `first`'s step 010.
    '    - task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1',
    '      condition: false',
    '      inputs:',
    '        repository: none',
    '    - task: CmdLine@2',
    '      displayName: Also runs',
    '      inputs:',
    '        script: echo "MARK second-step-of-second-job"',
  ].join('\n');

  it('qualifies a step condition function by its job (C-E12-041)', () => {
    const { pipeline } = buildPipeline(parsePipelineYaml(MULTI_JOB, 'pipeline.expanded.yml'));
    const files = emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
    const conditions = files.get('stages/010-s/conditions.sh')!;
    // One definition per job per number — never two functions of the same name in one file.
    expect(conditions).toContain('cond_step_first_010()');
    expect(conditions).toContain('cond_step_second_010()');
    const names = [...conditions.matchAll(/^(cond_\S+?)\(\)/gm)].map((m) => m[1]);
    expect(new Set(names).size).toBe(names.length);
    // And the sequencer calls the qualified name.
    expect(files.get('stages/010-s/jobs/010-first/run-job.sh')).toContain(
      '--cond cond_step_first_010',
    );
  });

  it('does not let one job’s false condition skip another job’s first step (C-E12-041)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-multi-'));
    try {
      generateProject(tmp, MULTI_JOB);
      execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      expect(readFileSync(join(tmp, '.work/run-1/logs/010-s/010-first/010.log'), 'utf8')).toContain(
        'MARK first-step-of-first-job',
      );
      expect(readFileSync(join(tmp, '.work/run-1/state/results/s/first/010'), 'utf8').trim()).toBe(
        'Succeeded',
      );
      // The job that really does start with a False condition still skips its own step.
      expect(readFileSync(join(tmp, '.work/run-1/state/results/s/second/010'), 'utf8').trim()).toBe(
        'Skipped',
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('records later steps as Skipped after a failure instead of not running them (C-E12-042)', () => {
    const FAILING = [
      'stages:',
      '- stage: s',
      '  jobs:',
      '  - job: j',
      '    steps:',
      '    - task: CmdLine@2',
      '      displayName: Fail for real',
      '      inputs:',
      '        script: exit 4',
      '    - task: CmdLine@2',
      '      displayName: Never reached',
      '      inputs:',
      '        script: echo "MARK must-not-run"',
      '    - task: CmdLine@2',
      '      displayName: Runs because the job failed',
      '      condition: failed()',
      '      inputs:',
      '        script: echo "MARK failed-cond-ran"',
    ].join('\n');
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-fail-'));
    try {
      generateProject(tmp, FAILING);
      // `run.sh` exits with the run's verdict, so a failing pipeline is expected to be non-zero.
      let out = '';
      try {
        out = execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      } catch (error) {
        out = String((error as { stdout?: string }).stdout ?? '');
      }
      const results = join(tmp, '.work/run-1/state/results/s/j');
      expect(readFileSync(join(results, '010'), 'utf8').trim()).toBe('Failed');
      // Recorded, not absent: before the fix the sequencer aborted and these two never happened.
      expect(readFileSync(join(results, '020'), 'utf8').trim()).toBe('Skipped');
      expect(readFileSync(join(results, '030'), 'utf8').trim()).toBe('Succeeded');
      expect(out).toContain('MARK failed-cond-ran');
      expect(out).not.toContain('MARK must-not-run');
      // The summary must list every step, including the ones after the failure (C-E12-035).
      expect(out).toContain('Never reached');
      expect(out).toContain('Result: Failed');

      // Not aborting is not the same as not reporting: `run-job.sh` still exits with the failing
      // step's status, which is what a developer running `--only-step NNN` by hand depends on.
      let onlyStepStatus = 0;
      try {
        execFileSync('bash', ['stages/010-s/jobs/010-j/run-job.sh', '--only-step', '010'], {
          cwd: tmp,
          encoding: 'utf8',
          env: {
            ...process.env,
            AZDO_RUN_DIR: join(tmp, '.work/run-1'),
            AZDO_STATE_DIR: join(tmp, '.work/run-1/state'),
            AZDO_WORKSPACE_DIR: join(tmp, '.work/run-1/workspace'),
            AZDO_EMU_LIB: join(tmp, 'lib'),
            AZDO_ARTIFACT_DIR: join(tmp, '.artifacts'),
            AZDO_STAGE_DIR: join(tmp, 'stages/010-s'),
            AZDO_STAGE_ID: 's',
          },
        });
      } catch (error) {
        onlyStepStatus = Number((error as { status?: number }).status ?? 0);
      }
      expect(onlyStepStatus).toBe(4);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('stage- and job-scope status functions (C-E12-043, E11-S04-T04)', () => {
  // `succeeded()` in a stage or job slot used to compile to the *step*-scope helper, which folds
  // this job's step results through `AZDO_RESULT_DIR` — a variable `run-job.sh` exports in a child
  // process. At the moment `run-stage.sh` evaluates a condition it is unset, so every status
  // function at those two scopes answered `Succeeded`, including the implicit default that decides
  // whether a stage runs at all.
  const step = (script: string, displayName: string): string[] => [
    '    - task: CmdLine@2',
    `      displayName: ${displayName}`,
    '      inputs:',
    `        script: ${script}`,
  ];

  const CHAIN = [
    'stages:',
    '- stage: one',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo one', 'One'),
    '- stage: two',
    '  dependsOn: one',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo two', 'Two'),
    '- stage: three',
    '  dependsOn: two',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo three', 'Three'),
  ].join('\n');

  function conditionsFor(yaml: string, stageDir: string): string {
    const { pipeline, diagnostics } = buildPipeline(
      parsePipelineYaml(yaml, 'pipeline.expanded.yml'),
    );
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const files = emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', []);
    return files.get(`stages/${stageDir}/conditions.sh`)!;
  }

  it('compiles the implicit default to the graph-scope helper, not the step one (C-E02-063)', () => {
    // The default condition **is** `succeeded()` (the agent's parser is
    // `CreateTree(condition, …) ?? new SucceededNode()`), and at stage scope that call reads the
    // dependency graph. Short-circuiting it is what made a default-condition stage after a failed
    // one run anyway.
    const conditions = conditionsFor(CHAIN, '020-two');
    expect(conditions).toContain('cond_stage() {\n  azdo_status_stage_succeeded one\n}');
    // A job with no `dependsOn` has an empty set, which is True — the parallel default (C-E04-124).
    expect(conditions).toContain('cond_job_j() {\n  azdo_status_job_succeeded\n}');
    // The step slot is untouched: same helper, same body as before this task.
    expect(conditions).toContain('cond_step_j_010() {\n  azdo_status_succeeded\n}');
  });

  it('ranges over the transitive dependency graph, not the direct dependsOn set (C-E12-044)', () => {
    // "The dependency requirement applies to direct dependencies and to their indirect
    // dependencies, computed recursively" — stage three names `two` only, and gets both.
    expect(conditionsFor(CHAIN, '030-three')).toContain(
      'cond_stage() {\n  azdo_status_stage_succeeded one two\n}',
    );
  });

  it('gives always() and canceled() no dependency names, and canceled() run-level scope (C-E02-062/064)', () => {
    const yaml = CHAIN.replace(
      '- stage: three\n  dependsOn: two',
      '- stage: three\n  dependsOn: two\n  condition: always()',
    );
    expect(conditionsFor(yaml, '030-three')).toContain('cond_stage() {\n  azdo_status_always\n}');
    const canceled = CHAIN.replace(
      '- stage: three\n  dependsOn: two',
      '- stage: three\n  dependsOn: two\n  condition: canceled()',
    );
    // Not a fold over dependency results: at job/stage scope this reads whether the *run* was
    // canceled, and the step-scope spelling reading the job's own status is the asymmetry.
    expect(conditionsFor(canceled, '030-three')).toContain(
      'cond_stage() {\n  azdo_status_run_canceled\n}',
    );
  });

  it('lets written arguments replace the default set (C-E02-067)', () => {
    const yaml = CHAIN.replace(
      '- stage: three\n  dependsOn: two',
      "- stage: three\n  dependsOn: two\n  condition: succeeded('one')",
    );
    expect(conditionsFor(yaml, '030-three')).toContain(
      'cond_stage() {\n  azdo_status_stage_succeeded one\n}',
    );
  });

  it('computes a transitive set in authored order and tolerates a diamond', () => {
    const nodes = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ];
    expect(transitiveDependencies(nodes, 'd')).toEqual(['a', 'b', 'c']);
    expect(transitiveDependencies(nodes, 'a')).toEqual([]);
    expect(transitiveDependencies(nodes, 'unknown')).toEqual([]);
  });

  const FAILING_GRAPH = [
    'stages:',
    '- stage: one',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('exit 4', 'Fail for real'),
    // Three readings of the same failed stage: the one that should run, the one that should be
    // skipped, and the dependency-result form that already worked before this task.
    '- stage: on_failure',
    '  dependsOn: one',
    '  condition: failed()',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK on-failure-stage', 'Runs'),
    '- stage: defaulted',
    '  dependsOn: one',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK must-not-run-stage', 'Skipped'),
    '- stage: by_result',
    '  dependsOn: one',
    "  condition: eq(dependencies.one.result, 'Failed')",
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK by-result-stage', 'Runs'),
    // `dependsOn: []` detaches this stage from the sequential default (C-E04-125) so the job-scope
    // half is not decided by stage `one` before a single job condition is evaluated.
    '- stage: job_scope',
    '  dependsOn: []',
    '  jobs:',
    '  - job: failing',
    '    steps:',
    ...step('exit 4', 'Fail for real'),
    '  - job: on_failure',
    '    dependsOn: failing',
    '    condition: failed()',
    '    steps:',
    ...step('echo MARK on-failure-job', 'Runs'),
    '  - job: defaulted',
    '    dependsOn: failing',
    '    steps:',
    ...step('echo MARK must-not-run-job', 'Skipped'),
    '  - job: by_result',
    '    dependsOn: failing',
    "    condition: eq(dependencies.failing.result, 'Failed')",
    '    steps:',
    ...step('echo MARK by-result-job', 'Runs'),
  ].join('\n');

  it('pins all three directions at both scopes against a real failing run (C-E12-043)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-status-'));
    try {
      generateProject(tmp, FAILING_GRAPH);
      let out = '';
      try {
        out = execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      } catch (error) {
        out = (error as { stdout?: string }).stdout ?? '';
      }
      const results = join(tmp, '.work/run-1/state/results');
      const read = (path: string): string => readFileSync(join(results, path), 'utf8').trim();

      // Stage scope. A one-sided fix — everything False — would pass only the middle assertion,
      // so all three are here.
      expect(read('on_failure/j/010')).toBe('Succeeded');
      expect(read('defaulted/.stage-result')).toBe('Skipped');
      expect(read('by_result/j/010')).toBe('Succeeded');
      expect(out).toContain('MARK on-failure-stage');
      expect(out).toContain('MARK by-result-stage');
      expect(out).not.toContain('MARK must-not-run-stage');

      // Job scope, inside one stage, against a failed sibling job.
      expect(read('job_scope/on_failure/010')).toBe('Succeeded');
      expect(read('job_scope/defaulted/.job-result')).toBe('Skipped');
      expect(read('job_scope/by_result/010')).toBe('Succeeded');
      expect(out).toContain('MARK on-failure-job');
      expect(out).toContain('MARK by-result-job');
      expect(out).not.toContain('MARK must-not-run-job');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('a condition that errors abandons its node (C-E12-048, E11-S04-T06)', () => {
  // A compiled condition is 0 True / 1 False / **2 evaluation error**, and `if cond_stage` sent 1
  // and 2 down the same branch — so a stage whose condition *errored* was recorded `Skipped`,
  // byte-identical to one the author had conditioned out. On the service that node completes
  // `Abandoned`, a sixth result no status function except `always()` matches (C-E02-071).
  //
  // `gt(1, 'not-a-number')` is the erroring condition the live measurement itself used: `gt`
  // errors rather than returning False on an unconvertible operand (C-E02-022).
  const step = (script: string, displayName: string): string[] => [
    '    - task: CmdLine@2',
    `      displayName: ${displayName}`,
    '      inputs:',
    `        script: ${script}`,
  ];

  const ERRORING = [
    'stages:',
    // The discriminating pair: same shape, same empty dependency set, conditions that differ only
    // in erroring vs. evaluating False.
    '- stage: bad_stage',
    '  dependsOn: []',
    "  condition: gt(1, 'not-a-number')",
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK abandoned-stage-ran', 'Must not run'),
    '- stage: skipped_stage',
    '  dependsOn: []',
    '  condition: false',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK skipped-stage-ran', 'Must not run'),
    // What an abandoned stage looks like to whatever depends on it (C-E02-071): nothing catches it
    // but `always()`, so the defaulted stage must be skipped and the `always()` one must run.
    '- stage: after_bad',
    '  dependsOn: bad_stage',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK after-bad-defaulted-ran', 'Must not run'),
    '- stage: after_bad_always',
    '  dependsOn: bad_stage',
    '  condition: always()',
    '  jobs:',
    '  - job: j',
    '    steps:',
    ...step('echo MARK after-bad-always-ran', 'Runs'),
    // Job scope, detached from the sequential stage default so the stage condition decides nothing.
    '- stage: job_scope',
    '  dependsOn: []',
    '  jobs:',
    '  - job: bad',
    "    condition: gt(1, 'not-a-number')",
    '    steps:',
    ...step('echo MARK abandoned-job-ran', 'Must not run'),
    '  - job: skipped',
    '    dependsOn: []',
    '    condition: false',
    '    steps:',
    ...step('echo MARK skipped-job-ran', 'Must not run'),
    '  - job: ok',
    '    dependsOn: []',
    '    steps:',
    ...step('echo MARK ok-job-ran', 'Runs'),
  ].join('\n');

  it('records Abandoned, not Skipped, at stage and job scope against a real run', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-abandon-'));
    try {
      generateProject(tmp, ERRORING);
      let out = '';
      let exitCode = 0;
      try {
        out = execFileSync('bash', ['run.sh'], { cwd: tmp, encoding: 'utf8' });
      } catch (error) {
        out = (error as { stdout?: string }).stdout ?? '';
        exitCode = (error as { status?: number }).status ?? 0;
      }
      const results = join(tmp, '.work/run-1/state/results');
      const read = (path: string): string => readFileSync(join(results, path), 'utf8').trim();

      // The whole point of the task: these two were the same string before it.
      expect(read('bad_stage/.stage-result')).toBe('Abandoned');
      expect(read('skipped_stage/.stage-result')).toBe('Skipped');
      // A stage that never ran marks its jobs too, and with its own result.
      expect(read('bad_stage/j/.job-result')).toBe('Abandoned');

      // Job scope, inside a stage that did run — so this is the fold, not the stage marker.
      expect(read('job_scope/bad/.job-result')).toBe('Abandoned');
      expect(read('job_scope/skipped/.job-result')).toBe('Skipped');
      expect(read('job_scope/ok/010')).toBe('Succeeded');

      // Neither abandoned node executed anything.
      expect(out).not.toContain('MARK abandoned-stage-ran');
      expect(out).not.toContain('MARK abandoned-job-ran');
      expect(out).not.toContain('MARK skipped-stage-ran');
      expect(out).not.toContain('MARK skipped-job-ran');
      expect(out).toContain('MARK ok-job-ran');

      // C-E02-071 downstream: `always()` is the only thing that catches an abandoned dependency.
      expect(out).toContain('MARK after-bad-always-ran');
      expect(out).not.toContain('MARK after-bad-defaulted-ran');
      expect(read('after_bad/.stage-result')).toBe('Skipped');

      // The run summary is the other half of "distinguishable": a step table alone says nothing
      // about a node that ran no steps, and both of these rows would otherwise be absent.
      expect(out).toContain('stage bad_stage: Abandoned');
      expect(out).toContain('stage skipped_stage: Skipped');
      expect(out).toContain('job job_scope/bad: Abandoned');
      expect(out).toContain('job job_scope/skipped: Skipped');

      // E11-S04-T07, measured against the service (run 552): an abandoned node fails the run.
      // Every step this pipeline actually ran succeeded, so a run aggregate that ignored the node
      // markers would say `Succeeded` here and exit 0 — which is what it did before.
      expect(out).toContain('Result: Failed');
      expect(exitCode).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});
