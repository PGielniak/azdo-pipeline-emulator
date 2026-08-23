// E04-S01-T03 — common step fields, and the two that are not step fields at all.
//
// The Done field asks for "field defaulting tests incl. the verified auto-name scheme". The
// auto-name half is the interesting one: the scheme is that **there is none** (C-E04-063), so it is
// tested as an absence — across the captured corpus as well as in the unit cases, because an
// absence asserted on one hand-written document proves very little.
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const transcript = (probe: string): string =>
  readFileSync(join(repoRoot, 'research/experiments/E04-step-fields', probe, 'final.yml'), 'utf8');

const build = (yaml: string) => buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
const firstStep = (yaml: string) => build(yaml).pipeline?.stages[0]?.jobs[0]?.steps[0];
const stepOf = (probe: string) => firstStep(transcript(probe));

describe('the documented common properties (C-E04-060)', () => {
  it('reads every one of them off the captured expansion', () => {
    const step = stepOf('control-fields');
    expect(step?.name).toBe('myStep');
    expect(step?.displayName).toBe('Say hi');
    expect(step?.enabled).toBe(false);
    expect(step?.timeoutInMinutes).toBe(3);
    expect(step?.retryCountOnTaskFailure).toBe(2);
    expect(step?.continueOnError).toBe(true);
    expect(step?.condition).toBe('succeeded()');
  });
});

describe('the two that are inputs, not step fields (C-E04-061)', () => {
  it('finds `workingDirectory` and `failOnStderr` in the inputs of a script step', () => {
    const step = stepOf('script-inputs');
    expect(step?.workingDirectory).toBe('/w');
    expect(step?.failOnStderr).toBe(true);
    // And they really are inputs — this is what a model reading the step mapping would miss.
    expect(step?.inputs['workingDirectory']).toBe('/w');
  });

  it('does the same for the bash shorthand, whose task differs', () => {
    const step = stepOf('bash-inputs');
    expect(step?.task.name).toBe('Bash');
    expect(step?.workingDirectory).toBe('/w');
    expect(step?.failOnStderr).toBe(true);
  });

  it('carries the input the expansion added that the author never wrote (C-E04-067)', () => {
    expect(stepOf('bash-inputs')?.inputs['targetType']).toBe('inline');
  });

  it('defaults `failOnStderr` to false and leaves `workingDirectory` unset when absent', () => {
    const step = firstStep('steps:\n- task: A@1\n');
    expect(step?.failOnStderr).toBe(false);
    expect(step?.workingDirectory).toBeUndefined();
  });
});

describe('target (C-E04-062)', () => {
  it('reads the object form the service normalized a scalar into', () => {
    expect(stepOf('target-scalar')?.target).toStrictEqual({ container: 'host' });
  });

  it('keeps the command mode when the author set one', () => {
    expect(stepOf('target-object')?.target).toStrictEqual({
      container: 'c',
      commands: 'restricted',
    });
  });

  it('still reads a bare scalar, for the offline arm that does not normalize', () => {
    expect(firstStep('steps:\n- task: A@1\n  target: host\n')?.target).toStrictEqual({
      container: 'host',
    });
  });

  it('is unset when the step declares none', () => {
    expect(firstStep('steps:\n- task: A@1\n')?.target).toBeUndefined();
  });
});

describe('enabled (C-E04-064)', () => {
  it('defaults to true, because absence means "not disabled" and not "already removed"', () => {
    expect(firstStep('steps:\n- task: A@1\n')?.enabled).toBe(true);
  });

  it('is false when the author disabled the step, which the expansion keeps', () => {
    expect(firstStep('steps:\n- task: A@1\n  enabled: false\n')?.enabled).toBe(false);
    // The step is still present — skipping it is the runner's job.
    expect(
      build('steps:\n- task: A@1\n  enabled: false\n').pipeline?.stages[0]?.jobs[0]?.steps,
    ).toHaveLength(1);
  });
});

describe('the auto-name scheme: there is none (C-E04-063)', () => {
  it('leaves `name` unset for an unnamed step in the captured expansion', () => {
    const parsed = parsePipelineYaml(transcript('no-name'), 'final.yml');
    const steps = buildPipeline(parsed).pipeline?.stages[0]?.jobs[0]?.steps ?? [];
    expect(steps).toHaveLength(2);
    for (const step of steps) expect(step.name).toBeUndefined();
  });

  it('no captured expansion anywhere assigns a step name the author did not write', () => {
    // The corpus check, because an absence asserted on one document proves very little. Every
    // step-level `name:` in the tree must trace back to an authored one.
    const files = globSync('research/experiments/*/*/final.yml', { cwd: repoRoot });
    expect(files.length).toBeGreaterThan(100);

    let inspected = 0;
    for (const relative of files) {
      const text = readFileSync(join(repoRoot, relative), 'utf8');
      const probe = join(repoRoot, relative.replace(/final\.yml$/, 'probe.yml'));
      let authored: string;
      try {
        authored = readFileSync(probe, 'utf8');
      } catch {
        continue; // a transcript without its probe cannot be compared
      }
      const parsed = parsePipelineYaml(text, relative);
      for (const stage of buildPipeline(parsed).pipeline?.stages ?? []) {
        for (const job of stage.jobs) {
          for (const step of job.steps) {
            inspected += 1;
            if (step.name !== undefined) expect(authored).toContain(step.name);
          }
        }
      }
    }
    expect(inspected).toBeGreaterThan(100);
  });
});

describe('displayName defaulting is ours, not the service’s (C-E04-065)', () => {
  it('falls back to the task name when the author wrote none', () => {
    expect(firstStep('steps:\n- task: CmdLine@2\n')?.displayName).toBe('CmdLine');
  });

  it('falls back to the ordinal when there is not even a readable task', () => {
    expect(firstStep('steps:\n- script: echo raw\n')?.displayName).toBe('Step 1');
  });

  it('prefers the authored displayName over both', () => {
    expect(firstStep('steps:\n- task: CmdLine@2\n  displayName: Mine\n')?.displayName).toBe('Mine');
  });
});

describe('scalars are read as text, whatever their YAML kind (C-E04-066)', () => {
  it.each([
    ["enabled: 'false'", false],
    ['enabled: false', false],
    ["enabled: 'true'", true],
  ])('reads %s', (line, expected) => {
    expect(firstStep(`steps:\n- task: A@1\n  ${line}\n`)?.enabled).toBe(expected);
  });

  it('reads a quoted numeric the same as a bare one', () => {
    expect(firstStep("steps:\n- task: A@1\n  timeoutInMinutes: '7'\n")?.timeoutInMinutes).toBe(7);
    expect(firstStep('steps:\n- task: A@1\n  timeoutInMinutes: 7\n')?.timeoutInMinutes).toBe(7);
  });

  it('ignores a non-numeric where a number is expected rather than producing NaN', () => {
    expect(
      firstStep('steps:\n- task: A@1\n  timeoutInMinutes: soon\n')?.timeoutInMinutes,
    ).toBeUndefined();
  });
});
