// E05-S01-T02 — step script emission.
//
// The Done criteria are "emitted corpus scripts pass shellcheck" and "headers snapshot-tested", so
// the suite does both:
//   1. Focused snapshot cases for each native kind + the stub fallback, built from the same
//      service-expanded shapes the corpus carries.
//   2. A whole-corpus pass that emits every step script from all ten captured `final.yml`s, writes
//      them to a temp tree, and runs shellcheck over them as one invocation — zero findings.
//
// The macro-preservation requirement (C-E06-018/024) is asserted directly: `$( )` in an input
// survives verbatim in the emitted body, because it is the runtime (`azdo_expand_macros`), not the
// emitter, that expands it just before the step runs.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPipeline, parsePipelineYaml, type Step } from '@azdo-emu/engine';
import { scaffold } from '../src/scaffold.js';
import {
  defaultFidelity,
  emitStepScript,
  hasMacro,
  isNativeScript,
  nativeScriptKind,
} from '../src/step.js';
import type { StepEmitOptions } from '../src/step.js';
import { loadVendoredTaskDefinitions } from '../src/vendor.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
// CI installs a system shellcheck and exports it as `$SHELLCHECK` (see the workflow); locally it
// falls back to the runtime package's npm wrapper (which lazily downloads the real binary).
const shellcheck =
  process.env.SHELLCHECK ?? join(repoRoot, 'packages/runtime/node_modules/.bin/shellcheck');
// The ADO-macro false positives (C-E06-018/024): `$(name)` is a macro the runtime expands, not a
// shell command substitution, so shellcheck's `echo "$(cmd)"` (SC2005) and "quote the unquoted
// `$(…)`" (SC2046) findings are by construction — the emitter must leave the macro verbatim.
const SHELLCHECK_MACRO_EXCLUDES = ['SC2005', 'SC2046', 'SC2016'];

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

/**
 * Run the emitted body's `printf`/`cat` lines and return what the step would print.
 *
 * The header and the `source runtime.sh` preamble are dropped — this is about the stub's own
 * output, and running it is the only way to see past the shell quoting.
 */
function runStubBody(script: string): string {
  const body = script
    .split('\n')
    .filter((line) => line.startsWith('printf ') || line.startsWith('cat <<') || true)
    .join('\n');
  const runnable = body
    .split('\n')
    .filter(
      (line) =>
        !line.startsWith('#') &&
        !line.startsWith('source ') &&
        !line.startsWith('set -euo') &&
        line.trim() !== 'exit 1',
    )
    .join('\n');
  return execFileSync('bash', ['-c', runnable], { encoding: 'utf8' });
}

/** Build a one-stage, one-job, one-step model and return the step plus its emitted script. */
function emitOne(yaml: string, options: StepEmitOptions = {}): { step: Step; output: string } {
  const { pipeline, diagnostics } = build(yaml);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  expect(pipeline).toBeDefined();
  const job = pipeline!.stages[0]!.jobs[0]!;
  const step = job.steps[0]!;
  return { step, output: emitStepScript(step, '030', options) };
}

/** Build a single step from a step-mapping body (one `task:`/`checkout:` entry). */
function stepOf(body: string): Step {
  const { pipeline, diagnostics } = build(
    `stages:\n- stage: A\n  jobs:\n  - job: b\n    steps:\n    - ${body}\n`,
  );
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return pipeline!.stages[0]!.jobs[0]!.steps[0]!;
}

describe('nativeScriptKind', () => {
  it('classifies the four native kinds by task name and the pwsh flag', () => {
    expect(nativeScriptKind(stepOf('task: CmdLine@2'))).toBe('script');
    expect(nativeScriptKind(stepOf('task: Bash@3'))).toBe('bash');
    // `pwsh` vs `powershell` is the `pwsh:` input (C-E04-037), not the reference.
    expect(nativeScriptKind(stepOf('task: PowerShell@2'))).toBe('powershell');
    expect(nativeScriptKind(stepOf('task: PublishTestResults@2'))).toBeUndefined();
    // The desugared checkout GUID is not a script step either.
    expect(
      nativeScriptKind(stepOf('task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1')),
    ).toBeUndefined();
  });
});

describe('defaultFidelity', () => {
  it('takes the registry answer: script/bash exact, powershell and real-task degraded', () => {
    // Updated by E07-S03-T01. This used to assert "everything else is stub", which was true only
    // while real-task mode did not exist — a non-script task now runs its real implementation, and
    // labelling it `stub` would have told the reader the step does nothing.
    expect(defaultFidelity(stepOf('task: CmdLine@2'))).toBe('exact');
    expect(defaultFidelity(stepOf('task: Bash@3'))).toBe('exact');
    expect(defaultFidelity(stepOf('task: PowerShell@2'))).toBe('degraded');
    expect(defaultFidelity(stepOf('task: PublishTestResults@2'))).toBe('degraded');
  });

  it('is stub only when the package is known to be unavailable', () => {
    expect(
      defaultFidelity(stepOf('task: PublishTestResults@2'), {
        packages: { 'PublishTestResults@2': { available: false, unavailableReason: 'offline' } },
      }),
    ).toBe('stub');
  });
});

describe('isNativeScript', () => {
  it('is true only for the four native kinds', () => {
    expect(isNativeScript(stepOf('task: CmdLine@2'))).toBe(true);
    expect(isNativeScript(stepOf('task: Bash@3'))).toBe(true);
    expect(isNativeScript(stepOf('task: PowerShell@2'))).toBe(true);
    expect(isNativeScript(stepOf('task: PublishTestResults@2'))).toBe(false);
  });
});

describe('hasMacro', () => {
  it('detects an ADO macro opener', () => {
    expect(hasMacro('$(buildConfiguration)')).toBe(true);
    expect(hasMacro('no macro here')).toBe(false);
    expect(hasMacro('$ErrorActionPreference')).toBe(false);
  });
});

describe('emitStepScript', () => {
  it('emits a script step with macros intact (C-E06-018/024)', () => {
    const { step, output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: CmdLine@2
      displayName: Build solution
      inputs:
        script: echo "config=$(buildConfiguration)"
`);
    expect(step).toBeDefined();
    expect(output).toContain('# ── Step 030 · "Build solution" · script ');
    expect(output).toContain(
      '# condition: succeeded()      continueOnError: false      timeout: job default',
    );
    expect(output).toContain('# fidelity: exact — script steps run verbatim; see README §fidelity');
    expect(output).toContain(
      '# NOTE: $(…) below is an ADO macro — run_step expands it just-in-time.',
    );
    expect(output).toContain('set -euo pipefail');
    expect(output).toContain('source "$AZDO_EMU_LIB/runtime.sh"');
    expect(output).toContain('echo "config=$(buildConfiguration)"');
    expect(output).toMatchSnapshot();
  });

  it('emits a bash step verbatim', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: Bash@3
      displayName: Lint
      inputs:
        targetType: inline
        script: |
          set -euo pipefail
          echo "hello"
`);
    expect(output).toContain('# ── Step 030 · "Lint" · bash ');
    expect(output).toContain('echo "hello"');
    expect(output).toMatchSnapshot();
  });

  it('emits a pwsh step through a quoted heredoc, reproducing errorActionPreference', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: PowerShell@2
      displayName: Cross-platform
      inputs:
        targetType: inline
        script: Write-Host "hi"
        errorActionPreference: stop
        pwsh: 'true'
`);
    expect(output).toContain('# ── Step 030 · "Cross-platform" · pwsh ');
    expect(output).toContain(
      '# fidelity: degraded — runs via pwsh on this host; see README §fidelity',
    );
    expect(output).toContain("pwsh -NoLogo -NoProfile -Command - <<'AZDO_EMU_PWSH'");
    expect(output).toContain("$ErrorActionPreference = 'stop'");
    expect(output).toContain('Write-Host "hi"');
    expect(output).toMatchSnapshot();
  });

  it('dispatches a non-script task to real-task mode, carrying its resolved inputs', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: PublishTestResults@2
      displayName: Publish tests
      inputs:
        testResultsFiles: '**/*.xml'
        failTaskOnFailedTests: true
`);
    expect(output).toContain('# ── Step 030 · "Publish tests" · PublishTestResults@2 ');
    expect(output).toContain(
      '# fidelity: degraded — runs the real task against the emulated task-lib; see README §fidelity',
    );
    expect(output).toContain('azdo_run_task');
    expect(output).toContain('task: PublishTestResults@2');
    expect(output).toContain('  testResultsFiles: **/*.xml');
    expect(output).toMatchSnapshot();
  });

  it('still emits a stub when the package is unavailable, saying why', () => {
    const { output } = emitOne(
      `stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: PublishTestResults@2
      inputs:
        testResultsFiles: '**/*.xml'
`,
      { packages: { 'PublishTestResults@2': { available: false, unavailableReason: 'HTTP 404' } } },
    );
    expect(output).toContain('# fidelity: stub —');
    // The reason rides in the header, so a reader who opens one script sees why this step degraded.
    expect(output).toContain('# warning: `PublishTestResults@2` runs as a stub: HTTP 404');
    // The wording is docs/03 §4's, quoted rather than paraphrased (E07-S02-T01). The assertion
    // runs the emitted line, because shell-quoting splits the apostrophes in the source text —
    // what matters is what the step prints, not how the script spells it.
    expect(runStubBody(output)).toContain(
      "##[warning] Task 'PublishTestResults@2' was stubbed — no runnable implementation locally",
    );
  });

  it('emits a native checkout for a desugared checkout step (E07-S03-T01)', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1
      inputs:
        repository: self
`);
    expect(output).toContain('· checkout ');
    // The runtime performs the checkout itself, so there is no package to run and nothing to stub.
    expect(output).toContain('# fidelity: exact — script steps run verbatim; see README §fidelity');
    expect(output).toContain("azdo_checkout --repository 'self'");
    expect(output).toMatchSnapshot();
  });

  it('surfaces a checkout input the runtime has no flag for, instead of dropping it', () => {
    // Silently ignoring an authored option is the failure mode PLAN D10 exists to prevent: the
    // script would look like it honoured the input while doing nothing with it.
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1
      inputs:
        repository: self
        workspaceRepo: 'true'
`);
    expect(output).toContain(
      "# note: checkout input 'workspaceRepo' has no runtime flag and is not applied",
    );
    // The mapped input is still passed.
    expect(output).toContain("--repository 'self'");
  });

  it('quotes a checkout value so a path with a space cannot become two arguments', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: 6d15af64-176c-496d-b583-fd2ae21d4df4@1
      inputs:
        path: 'my repo/src'
`);
    expect(output).toContain("--path 'my repo/src'");
  });

  it('leaves an authored condition and timeout in the header', () => {
    const { output } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: CmdLine@2
      displayName: Guarded
      condition: eq(variables.build, '1')
      timeoutInMinutes: 5
      continueOnError: true
      inputs:
        script: echo hi
`);
    expect(output).toContain(
      "# condition: eq(variables.build, '1')      continueOnError: true      timeout: 5 min",
    );
  });

  it('renders a step warning into the header', () => {
    const { step } = emitOne(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: CmdLine@2
      displayName: Build
      inputs:
        script: echo hi
`);
    const output = emitStepScript(
      { ...step, warnings: ['checkout needs a self repository'] },
      '030',
    );
    expect(output).toContain('# warning: checkout needs a self repository');
  });
});

describe('emitted corpus scripts pass shellcheck', () => {
  const corpusFinalYamls = (): { name: string; finalYaml: string }[] => {
    const oracleDir = join(repoRoot, 'fixtures', 'oracle');
    return readdirSync(oracleDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        name: e.name.slice(0, -'.final.yml'.length),
        finalYaml: readFileSync(join(oracleDir, e.name), 'utf8'),
      }));
  };

  it('emits every corpus step and runs shellcheck over all of them', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-shellcheck-'));
    try {
      const files: string[] = [];
      let emitted = 0;
      for (const { name, finalYaml } of corpusFinalYamls()) {
        const { pipeline, diagnostics } = build(finalYaml, `${name}.final.yml`);
        expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(pipeline).toBeDefined();
        for (const stage of scaffold(pipeline!).stages) {
          for (const job of stage.jobs) {
            for (const scaffoldStep of job.steps) {
              const content = emitStepScript(scaffoldStep.step, scaffoldStep.number);
              const file = join(tmp, scaffoldStep.path);
              mkdirSync(dirname(file), { recursive: true });
              writeFileSync(file, content);
              files.push(file);
              emitted += 1;
            }
          }
        }
      }
      expect(emitted).toBeGreaterThan(0);
      const check = spawnSync(
        shellcheck,
        [...SHELLCHECK_MACRO_EXCLUDES.flatMap((code) => ['-e', code]), ...files],
        { encoding: 'utf8' },
      );
      // Exit 0 is the "no findings" signal; the npm wrapper may print a download `[INFO]` line to
      // stdout on its first run, so an empty stdout is *not* the condition.
      expect(check.status, check.stdout || check.stderr).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('the stub emitter (E07-S02-T01)', () => {
  const unavailable = {
    packages: { 'PublishTestResults@2': { available: false, unavailableReason: 'offline' } },
  };
  const STUB_YAML = `stages:
- stage: A
  jobs:
  - job: build
    steps:
    - task: PublishTestResults@2
      inputs:
        testResultsFiles: '**/*.xml'
        failTaskOnFailedTests: true
`;

  it('uses the wording docs/03 §4 fixes, not a paraphrase', () => {
    // Reworded by E12-S02-T03: "no local handler" was transpiler-era vocabulary — under real-task
    // mode the reason is a missing *package*. Asserted by running the line, which also proves the
    // apostrophes survive shell quoting.
    const { output } = emitOne(STUB_YAML, unavailable);
    expect(runStubBody(output)).toContain(
      "##[warning] Task 'PublishTestResults@2' was stubbed — no runnable implementation locally",
    );
  });

  it('dumps the fully resolved inputs as JSON, key-sorted so the dump is diffable', () => {
    const { output } = emitOne(STUB_YAML, unavailable);
    expect(output).toContain('"failTaskOnFailedTests": "true"');
    expect(output).toContain('"testResultsFiles": "**/*.xml"');
    expect(output.indexOf('failTaskOnFailedTests')).toBeLessThan(
      output.indexOf('testResultsFiles'),
    );
  });

  it('defaults to the skip result — the step succeeds without doing the work', () => {
    const { output } = emitOne(STUB_YAML, unavailable);
    expect(output).toContain('tasks.unknown = stub (default)');
    expect(output).not.toContain('exit 1');
  });

  it('fails the step under tasks.unknown = fail', () => {
    // A pipeline that depends on this task should stop here rather than continue on a result the
    // task never produced.
    const { output } = emitOne(STUB_YAML, { ...unavailable, stubPolicy: 'fail' });
    expect(output).toContain('##vso[task.complete result=Failed;]');
    expect(output).toContain('exit 1');
  });

  it('prompts only when a terminal is attached, under tasks.unknown = prompt', () => {
    // A pipeline run with no terminal must not block forever, so the non-interactive arm skips.
    const { output } = emitOne(STUB_YAML, { ...unavailable, stubPolicy: 'prompt' });
    expect(output).toContain('if [[ -t 0 ]]; then');
    expect(output).toContain('read -r -p "Run PublishTestResults@2 manually');
    expect(output).toContain('no terminal to prompt on');
  });

  it('is still labelled stub in the header, whichever policy applies', () => {
    for (const stubPolicy of ['stub', 'fail', 'prompt'] as const) {
      expect(emitOne(STUB_YAML, { ...unavailable, stubPolicy }).output).toContain(
        '# fidelity: stub —',
      );
    }
  });

  it('matches its snapshot', () => {
    expect(emitOne(STUB_YAML, unavailable).output).toMatchSnapshot();
  });
});

describe('real-task steps preflight their service connection (E08-S02-T01)', () => {
  /** One step, built through the real model so it carries provenance like any other. */
  const azureStep = (inputs: Record<string, string>, task = 'AzureCLI@2'): Step => {
    const rendered = Object.entries(inputs)
      .map(([key, value]) => `        ${key}: ${value}`)
      .join('\n');
    const { pipeline } = buildPipeline(
      parsePipelineYaml(
        `stages:\n- stage: Deploy\n  jobs:\n  - job: deploy\n    steps:\n` +
          `    - task: ${task}\n      inputs:\n${rendered}\n`,
        'pipeline.expanded.yml',
      ),
    );
    return pipeline!.stages[0]!.jobs[0]!.steps[0]!;
  };

  const definitions = loadVendoredTaskDefinitions();

  it('emits the preflight before azdo_run_task, naming the connection', () => {
    // Ordering matters: the point is to fail with the .env lines named *before* the task throws
    // LIB_EndpointAuthNotExist, which names no variable at all.
    const script = emitStepScript(azureStep({ azureSubscription: 'my-prod-sub' }), '010', {
      taskDefinitions: definitions,
    });
    expect(script).toContain("azdo_sc_preflight 'my-prod-sub' 'AzureCLI@2'");
    expect(script.indexOf('azdo_sc_preflight')).toBeLessThan(script.indexOf('azdo_run_task'));
  });

  it('emits nothing extra when the connection is a macro (C-E08-031)', () => {
    const script = emitStepScript(azureStep({ azureSubscription: '$(sub)' }), '010', {
      taskDefinitions: definitions,
    });
    expect(script).not.toContain('azdo_sc_preflight');
  });

  it('emits nothing for a task whose auth behaviour has not been read', () => {
    // Only tasks in REAL_TASK_ENDPOINT_USE get a preflight; guessing would demand credentials for
    // a task that may not want any.
    const step = azureStep({ SourceFolder: 'src', Contents: '**' }, 'CopyFiles@2');
    expect(emitStepScript(step, '010', { taskDefinitions: definitions })).not.toContain(
      'azdo_sc_preflight',
    );
  });

  it('emits nothing when no definitions are supplied', () => {
    expect(emitStepScript(azureStep({ azureSubscription: 'prod' }), '010')).not.toContain(
      'azdo_sc_preflight',
    );
  });
});

describe('publish and download are emitted natively (C-E12-034/040, E11-S04-T03)', () => {
  const body = (yaml: string): string => emitStepScript(stepOf(yaml), '010');

  it('maps the publish keyword’s inputs to azdo_artifact_publish', () => {
    // `publish: out` / `artifact: drop` desugars to the GUID with `path` + `artifactName`.
    const script = body(
      'task: ecdc45f6-832d-4ad9-b52b-ee49e94659be@1\n      inputs:\n        path: out\n        artifactName: drop',
    );
    expect(script).toContain(`azdo_artifact_publish --path 'out' --artifact 'drop'`);
    // Never the runner: there is no handler to run (C-E12-040).
    expect(script).not.toContain('azdo_run_task');
  });

  it('accepts the catalogue task’s alias spellings (C-E06-091)', () => {
    // `targetPath` and `artifact` are aliases of `path` and `artifactName`, not extra inputs.
    const script = body(
      'task: PublishPipelineArtifact@1\n      inputs:\n        targetPath: bin\n        artifact: drop',
    );
    expect(script).toContain(`azdo_artifact_publish --path 'bin' --artifact 'drop'`);
    expect(script).not.toContain('has no runtime flag');
  });

  it('supplies the documented default path and reports a missing artifact name', () => {
    const script = body('task: PublishPipelineArtifact@1');
    expect(script).toContain(`azdo_artifact_publish --path '$(Pipeline.Workspace)'`);
    // The agent's fallback is a normalized `System.JobIdentifier` (C-E06-091) — a server-side value
    // we do not model, so the difference is stated rather than invented.
    expect(script).toContain('System.JobIdentifier');
  });

  it('notes a publishLocation it cannot emulate instead of dropping it', () => {
    const script = body(
      'task: PublishPipelineArtifact@1\n      inputs:\n        targetPath: bin\n        publishLocation: filepath\n        fileSharePath: //share/drop',
    );
    expect(script).toContain("publishLocation 'filepath' is not emulated");
    expect(script).toContain("publish input 'fileSharePath' has no runtime flag");
  });

  it('gives the download keyword the $(Pipeline.Workspace)/<name> layout (C-E06-084)', () => {
    // The keyword's layout is the *emitter's* to supply; the task's own default is the bare
    // workspace (C-E06-085), which is why the two spellings are not merged.
    const script = body(
      'task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1\n      inputs:\n        alias: current\n        artifact: drop',
    );
    expect(script).toContain(
      `azdo_artifact_download --artifact 'drop' --path '$(Pipeline.Workspace)/drop'`,
    );
  });

  it('falls back to the bare workspace for a keyword download with no artifact name', () => {
    const script = body(
      'task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1\n      inputs:\n        alias: current',
    );
    // The no-name form takes every artifact, one subdirectory each (C-E06-087).
    expect(script).toContain(`azdo_artifact_download --path '$(Pipeline.Workspace)'`);
  });

  it('passes a pipeline-resource alias through so the runtime can refuse it', () => {
    // Serving this run's artifacts for another pipeline's alias would be silently wrong; the
    // runtime already refuses `--source` other than `current` with its own message.
    const script = body(
      'task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1\n      inputs:\n        alias: upstream\n        artifact: drop',
    );
    expect(script).toContain(`--source 'upstream'`);
  });

  it('emits `download: none` as a no-op (C-E06-096)', () => {
    const script = body(
      'task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1\n      inputs:\n        alias: none',
    );
    expect(script).toContain('nothing to download');
    expect(script).not.toContain('azdo_artifact_download');
  });

  it('honors the task’s own path and patterns, and omits a redundant --source', () => {
    const script = body(
      'task: DownloadPipelineArtifact@2\n      inputs:\n        artifact: drop\n        path: /tmp/dl\n        itemPattern: "**/*.bin"\n        source: current',
    );
    expect(script).toContain(
      `azdo_artifact_download --artifact 'drop' --patterns '**/*.bin' --path '/tmp/dl'`,
    );
    // `current` is the runtime's default; spelling it would be noise.
    expect(script).not.toContain('--source');
  });

  it('passes a non-current `source` on the task form through to the runtime', () => {
    // `specific` needs a run id, a REST fetch and the lockfile-pinned `.cache/artifacts/` tree
    // (docs/04 §7). The runtime refuses it by name; serving this run's artifacts instead would be
    // silently wrong.
    const script = body(
      'task: DownloadPipelineArtifact@2\n      inputs:\n        artifact: drop\n        buildType: specific',
    );
    expect(script).toContain(`--source 'specific'`);
  });

  it('notes a download input it has no flag for rather than dropping it', () => {
    // The task declares thirteen inputs and the runtime implements four; the rest describe a
    // *specific run* and belong to the same deferred work as `--source specific`.
    const script = body(
      'task: DownloadPipelineArtifact@2\n      inputs:\n        artifact: drop\n        runId: "1234"',
    );
    expect(script).toContain("download input 'runId' has no runtime flag and is not applied");
  });

  it('labels both as exact rather than degraded', () => {
    // The runtime performs the documented work, as it does for `checkout` — it is not an
    // approximation of a task that could otherwise have run.
    expect(body('task: PublishPipelineArtifact@1')).toContain('exact');
    expect(body('task: DownloadPipelineArtifact@2')).toContain('exact');
  });
});
