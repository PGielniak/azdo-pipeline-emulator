// E05-S03-T01 — the run-number (`name:`) formatter.
//
// The Done criteria are "formatter tests per token" and "runtime integration test shows
// `Build.BuildNumber` set before first step", so the suite is in two halves:
//
//   1. **Per token** — every row of the run-number table (C-E05-005) is parsed and emitted, plus the
//      two constructs the page does *not* document (`$(Rev:.r)` and unmapped `Date:` specifiers),
//      which must warn and render literally rather than be guessed at (C-E05-024/025).
//   2. **End to end** — a generated project is run for real, and the first step's log is read back:
//      it echoes `$(Build.BuildNumber)`, so a value in that log is proof the number was set before
//      the step ran, not merely present in the store afterwards. The same project is re-run to pin
//      the `Rev` increment (C-E05-009) and re-generated with a different format to pin the reset
//      (C-E05-010).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPipeline, parsePipelineYaml, type ManifestWarning } from '@azdo-emu/engine';

import { emitEntrypoints } from '../src/entrypoints.js';
import {
  DEFAULT_RUN_NUMBER_FORMAT,
  emitRunNumberInit,
  parseRunNumberFormat,
  type RunNumberToken,
} from '../src/run-number.js';
import { scaffold } from '../src/scaffold.js';
import { emitStepScript } from '../src/step.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const parse = (format: string): readonly RunNumberToken[] => parseRunNumberFormat(format).tokens;

describe('parseRunNumberFormat — tokens', () => {
  it('parses the documented default format (C-E05-001)', () => {
    expect(parse(DEFAULT_RUN_NUMBER_FORMAT)).toEqual([
      { kind: 'date', format: '%Y%m%d' },
      { kind: 'literal', text: '.' },
      { kind: 'rev', width: 1 },
    ]);
  });

  it('parses `$(Date:…)` formats, including the page`s second example `MMddyy` (C-E05-007)', () => {
    expect(parse('$(Date:MMddyy)')).toEqual([{ kind: 'date', format: '%m%d%y' }]);
    expect(parse('$(Date:yyyy-MM-dd)')).toEqual([{ kind: 'date', format: '%Y-%m-%d' }]);
    expect(parse('$(Date:HHmmss)')).toEqual([{ kind: 'date', format: '%H%M%S' }]);
  });

  it('parses both `$(Year:…)` spellings (C-E05-005)', () => {
    expect(parse('$(Year:yy)')).toEqual([{ kind: 'date', format: '%y' }]);
    expect(parse('$(Year:yyyy)')).toEqual([{ kind: 'date', format: '%Y' }]);
  });

  it('parses every standalone numeric token (C-E05-005)', () => {
    expect(parse('$(DayOfMonth)')).toEqual([{ kind: 'number', conversion: '%d' }]);
    expect(parse('$(DayOfYear)')).toEqual([{ kind: 'number', conversion: '%j' }]);
    expect(parse('$(Hours)')).toEqual([{ kind: 'number', conversion: '%H' }]);
    expect(parse('$(Minutes)')).toEqual([{ kind: 'number', conversion: '%M' }]);
    expect(parse('$(Month)')).toEqual([{ kind: 'number', conversion: '%m' }]);
    expect(parse('$(Seconds)')).toEqual([{ kind: 'number', conversion: '%S' }]);
  });

  it('parses `$(Rev:r)` and its zero-padded widths (C-E05-011)', () => {
    expect(parse('$(Rev:r)')).toEqual([{ kind: 'rev', width: 1 }]);
    expect(parse('$(Rev:rr)')).toEqual([{ kind: 'rev', width: 2 }]);
    expect(parse('$(Rev:rrrr)')).toEqual([{ kind: 'rev', width: 4 }]);
  });

  it('maps the run-number-only aliases onto the variables that hold them (C-E05-005)', () => {
    expect(parse('$(SourceBranchName)')).toEqual([
      { kind: 'variable', name: 'Build.SourceBranchName' },
    ]);
    expect(parse('$(TeamProject)')).toEqual([{ kind: 'variable', name: 'System.TeamProject' }]);
  });

  it('treats every other token as a predefined or user-defined variable read (C-E05-012)', () => {
    expect(parse('$(Build.DefinitionName)')).toEqual([
      { kind: 'variable', name: 'Build.DefinitionName' },
    ]);
    expect(parse('$(Build.BuildId)')).toEqual([{ kind: 'variable', name: 'Build.BuildId' }]);
    expect(parse('$(My.Variable)')).toEqual([{ kind: 'variable', name: 'My.Variable' }]);
  });

  it('keeps literal text, and merges adjacent literal runs', () => {
    expect(parse('1.0.$(Rev:r)')).toEqual([
      { kind: 'literal', text: '1.0.' },
      { kind: 'rev', width: 1 },
    ]);
    expect(parse('plain-name')).toEqual([{ kind: 'literal', text: 'plain-name' }]);
    expect(parse('')).toEqual([]);
  });

  it('renders an unterminated `$(` as text', () => {
    expect(parse('build-$(Date')).toEqual([{ kind: 'literal', text: 'build-$(Date' }]);
  });

  it('parses the page`s full worked example (C-E05-005)', () => {
    expect(
      parse('$(TeamProject)_$(Build.DefinitionName)_$(SourceBranchName)_$(Date:yyyyMMdd).$(Rev:r)'),
    ).toEqual([
      { kind: 'variable', name: 'System.TeamProject' },
      { kind: 'literal', text: '_' },
      { kind: 'variable', name: 'Build.DefinitionName' },
      { kind: 'literal', text: '_' },
      { kind: 'variable', name: 'Build.SourceBranchName' },
      { kind: 'literal', text: '_' },
      { kind: 'date', format: '%Y%m%d' },
      { kind: 'literal', text: '.' },
      { kind: 'rev', width: 1 },
    ]);
  });
});

describe('parseRunNumberFormat — undocumented constructs warn instead of guessing', () => {
  const warnings = (format: string): readonly ManifestWarning[] =>
    parseRunNumberFormat(format, 'p.yml').warnings;

  it('refuses `$(Rev:.r)`, the Classic spelling the page never documents (C-E05-025)', () => {
    const parsed = parseRunNumberFormat('1.0$(Rev:.r)', 'p.yml');
    expect(parsed.tokens).toEqual([{ kind: 'literal', text: '1.0$(Rev:.r)' }]);
    expect(parsed.warnings).toEqual([
      {
        code: 'E05-RUN-NUMBER-REV',
        message:
          "run number: '$(Rev:.r)' is not a documented `Rev` spelling (only `$(Rev:r)`, `$(Rev:rr)`, … are); rendered literally",
        location: { file: 'p.yml', line: 1 },
      },
    ]);
  });

  it('refuses a bare `$(Rev)` and other non-`r` arguments (C-E05-025)', () => {
    expect(warnings('$(Rev)')).toHaveLength(1);
    expect(warnings('$(Rev:x)')).toHaveLength(1);
  });

  it('refuses a `Date:` specifier outside the documented subset (C-E05-024)', () => {
    const parsed = parseRunNumberFormat('$(Date:yyyyMMddTHHmmss)', 'p.yml');
    expect(parsed.tokens).toEqual([{ kind: 'literal', text: '$(Date:yyyyMMddTHHmmss)' }]);
    expect(parsed.warnings[0]?.code).toBe('E05-RUN-NUMBER-DATE');
    expect(parsed.warnings[0]?.message).toContain("specifier 'T'");
  });

  it('keeps non-letter separators inside a date format, and escapes a literal percent', () => {
    expect(parse('$(Date:yyyy/MM/dd)')).toEqual([{ kind: 'date', format: '%Y/%m/%d' }]);
    expect(parse('$(Date:yyyy%MM)')).toEqual([{ kind: 'date', format: '%Y%%%m' }]);
  });
});

describe('emitRunNumberInit', () => {
  it('renders the head, keys the revision on the rest of the number, and splices it back', () => {
    const { lines } = emitRunNumberInit('1.0.$(Rev:rr)-$(Build.DefinitionName)');
    const text = lines.join('\n');
    expect(text).toContain("azdo__run_number_head=('1.0.')");
    expect(text).toContain(`azdo__run_number_tail=('-' "$(azdo_var 'Build.DefinitionName')")`);
    expect(text).toContain('azdo_rev "$azdo__run_number_key" 2');
    expect(text).toContain('azdo_run_identity_seed "$azdo_build_number" "$run_number"');
    expect(text).not.toContain('AZDO_BUILD_NUMBER');
  });

  it('skips the revision machinery entirely when the format has no `Rev` token', () => {
    const text = emitRunNumberInit('$(Year:yyyy)').lines.join('\n');
    expect(text).not.toContain('azdo_rev');
    expect(text).not.toContain('azdo__run_number_tail');
    expect(text).toContain('azdo_build_number="$(azdo__join_parts');
  });

  it('emits UTC date reads and strips the padding of the standalone numeric tokens (C-E05-006/013)', () => {
    const text = emitRunNumberInit('$(Date:yyyyMMdd)-$(DayOfMonth)').lines.join('\n');
    expect(text).toContain(`"$(date -u +'%Y%m%d')"`);
    expect(text).toContain(`"$((10#$(date -u +'%d')))"`);
  });

  it('hands its warnings back to the caller', () => {
    expect(emitRunNumberInit('$(Rev:.r)').warnings).toHaveLength(1);
  });

  it('defaults the format of a bare `$(Date)` / `$(Year)` token', () => {
    expect(parse('$(Date)')).toEqual([{ kind: 'date', format: '%Y%m%d' }]);
    expect(parse('$(Year)')).toEqual([{ kind: 'date', format: '%Y' }]);
  });

  it('collects run-number warnings into the sink `emitEntrypoints` is given', () => {
    const yaml = pipelineYaml('1.0$(Rev:.r)');
    const { pipeline } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
    const warnings: ManifestWarning[] = [];
    emitEntrypoints(pipeline!, scaffold(pipeline!), 'pipeline.expanded.yml', [], warnings);
    expect(warnings.map((w) => w.code)).toEqual(['E05-RUN-NUMBER-REV']);
  });
});

// ── end-to-end ────────────────────────────────────────────────────────────────────────────────

function pipelineYaml(name: string): string {
  return `name: ${name}
stages:
  - stage: Build
    jobs:
      - job: BuildJob
        steps:
          - task: CmdLine@2
            displayName: Echo the run number
            inputs:
              script: echo "number=$(Build.BuildNumber) id=$(Build.BuildId)"
`;
}

/** Generate a complete, runnable project for `yaml` into `dir`. */
function generateProject(dir: string, yaml: string): void {
  const { pipeline, diagnostics } = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const model = pipeline!;
  const plan = scaffold(model);

  mkdirSync(join(dir, 'lib'), { recursive: true });
  copyFileSync(join(repoRoot, 'packages/runtime/lib/core.sh'), join(dir, 'lib/runtime.sh'));
  copyFileSync(join(repoRoot, 'packages/runtime/lib/expr.sh'), join(dir, 'lib/expr.sh'));
  writeFileSync(join(dir, '.env'), 'BUILD_SOURCEBRANCH=refs/heads/main\n');

  for (const file of plan.directories) mkdirSync(join(dir, file), { recursive: true });
  for (const stage of plan.stages)
    for (const job of stage.jobs)
      for (const step of job.steps)
        writeFileSync(join(dir, step.path), emitStepScript(step.step, step.number));
  for (const [path, content] of emitEntrypoints(model, plan, 'pipeline.expanded.yml', []))
    writeFileSync(join(dir, path), content);
}

/** Run the project and return the first step's log — written *by* the step, so it proves ordering. */
function runAndReadFirstStepLog(dir: string, run: number): string {
  execFileSync('bash', ['run.sh'], { cwd: dir, encoding: 'utf8' });
  return readFileSync(join(dir, `.work/run-${run}/logs/010-build/010-buildjob/010.log`), 'utf8');
}

describe('generated project — Build.BuildNumber is set before the first step', () => {
  it('renders the default format and the first step reads it (C-E05-001)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-runnum-'));
    try {
      generateProject(tmp, pipelineYaml(DEFAULT_RUN_NUMBER_FORMAT));
      const log = runAndReadFirstStepLog(tmp, 1);
      // `yyyyMMdd.Rev` — the value, not a placeholder, and `Build.BuildId` is the run counter.
      expect(log).toMatch(/number=\d{8}\.1 id=1/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);

  it('increments Rev on the next run and resets it when another part changes (C-E05-009/010)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-runnum-'));
    try {
      generateProject(tmp, pipelineYaml('1.0.$(Rev:rr)'));
      expect(runAndReadFirstStepLog(tmp, 1)).toContain('number=1.0.01 id=1');
      expect(runAndReadFirstStepLog(tmp, 2)).toContain('number=1.0.02 id=2');

      // Same project directory, new version in the format: the series restarts at 1 (C-E05-010).
      generateProject(tmp, pipelineYaml('1.1.$(Rev:rr)'));
      expect(runAndReadFirstStepLog(tmp, 3)).toContain('number=1.1.01 id=3');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 120_000);

  it('renders variable tokens from `.env`-supplied run identity (C-E05-005/012)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'azdo-emit-runnum-'));
    try {
      generateProject(tmp, pipelineYaml('$(SourceBranchName)_$(Rev:r)'));
      expect(runAndReadFirstStepLog(tmp, 1)).toContain('number=main_1');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
