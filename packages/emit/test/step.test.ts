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
import { spawnSync } from 'node:child_process';
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
import type { DispositionOptions } from '../src/disposition.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
// CI installs a system shellcheck and exports it as `$SHELLCHECK` (see the workflow); locally it
// falls back to the runtime package's npm wrapper (which lazily downloads the real binary).
const shellcheck =
  process.env.SHELLCHECK ?? join(repoRoot, 'packages/runtime/node_modules/.bin/shellcheck');
// The ADO-macro false positives (C-E06-018/024): `$(name)` is a macro the runtime expands, not a
// shell command substitution, so shellcheck's `echo "$(cmd)"` (SC2005) and "quote the unquoted
// `$(…)`" (SC2046) findings are by construction — the emitter must leave the macro verbatim.
const SHELLCHECK_MACRO_EXCLUDES = ['SC2005', 'SC2046'];

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

/** Build a one-stage, one-job, one-step model and return the step plus its emitted script. */
function emitOne(yaml: string, options: DispositionOptions = {}): { step: Step; output: string } {
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
    expect(output).toContain('azdo-emu: stub — PublishTestResults@2');
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
