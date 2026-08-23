// E04-S01-T01 — model types & builder.
//
// The Done criterion is "shorthand forms produce identical models to explicit forms", and the first
// suite asserts exactly that: the three root shapes the service accepts build the same tree. What
// makes those assertions worth anything is that the expected tree is the one the **service** emits
// — C-E04-002/003 measured the wrapping, and the last suite rebuilds from a real captured
// `final.yml` rather than from a hand-written approximation of one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import {
  MODEL_BAD_TASK,
  MODEL_EMPTY,
  MODEL_NOT_A_MAPPING,
  MODEL_NO_STEPS_CONTAINER,
  SYNTHETIC_JOB_ID,
  SYNTHETIC_STAGE_ID,
  buildPipeline,
} from '../../src/model/build.js';
import type { Pipeline } from '../../src/model/types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

/** The model minus provenance, which is position data rather than semantics. */
const shape = (pipeline: Pipeline | undefined): unknown =>
  JSON.parse(JSON.stringify(pipeline, (key, value) => (key === 'provenance' ? undefined : value)));

describe('the three root shapes build the same tree (the Done criterion)', () => {
  const explicit = `stages:
- stage: ${SYNTHETIC_STAGE_ID}
  jobs:
  - job: ${SYNTHETIC_JOB_ID}
    steps:
    - task: CmdLine@2
      inputs:
        script: echo one
`;
  const rootJobs = `jobs:
- job: ${SYNTHETIC_JOB_ID}
  steps:
  - task: CmdLine@2
    inputs:
      script: echo one
`;
  const rootSteps = `steps:
- task: CmdLine@2
  inputs:
    script: echo one
`;

  it('root `jobs:` wraps into the synthetic stage (C-E04-003)', () => {
    expect(shape(build(rootJobs).pipeline)).toStrictEqual(shape(build(explicit).pipeline));
  });

  it('root `steps:` wraps into the synthetic stage and job (C-E04-002)', () => {
    expect(shape(build(rootSteps).pipeline)).toStrictEqual(shape(build(explicit).pipeline));
  });

  it('none of the three produces a diagnostic', () => {
    for (const yaml of [explicit, rootJobs, rootSteps]) {
      expect(build(yaml).diagnostics).toStrictEqual([]);
    }
  });
});

describe('job identity', () => {
  it('keeps the empty string for an authored but unnamed job (C-E04-004)', () => {
    // The measured case: the service prints `- job: ''`. Substituting `Job` here would hide from
    // E05 that it has to invent a filename.
    const pipeline = build("stages:\n- stage: s\n  jobs:\n  - job: ''\n    steps: []\n").pipeline;
    expect(pipeline?.stages[0]?.jobs[0]?.id).toBe('');
  });

  it('treats a valueless `job:` the same way', () => {
    const pipeline = build('stages:\n- stage: s\n  jobs:\n  - job:\n    steps: []\n').pipeline;
    expect(pipeline?.stages[0]?.jobs[0]?.id).toBe('');
  });

  it('only the service-invented job gets the synthetic name', () => {
    expect(build('steps:\n- task: A@1\n').pipeline?.stages[0]?.jobs[0]?.id).toBe(SYNTHETIC_JOB_ID);
  });
});

describe('job kind', () => {
  it.each([
    ['jobs:\n  - job: a\n    steps: []', 'agent'],
    ['jobs:\n  - job: a\n    pool: server\n    steps: []', 'server'],
    ['jobs:\n  - job: a\n    pool: SERVER\n    steps: []', 'server'],
    ['jobs:\n  - deployment: d\n    environment: prod', 'deployment'],
  ])('reads %j as %s', (jobs, kind) => {
    const pipeline = build(`stages:\n- stage: s\n  ${jobs}\n`).pipeline;
    expect(pipeline?.stages[0]?.jobs[0]?.kind).toBe(kind);
  });

  it('a deployment job carries no steps rather than borrowing its strategy’s', () => {
    const pipeline = build(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        deploy:
          steps:
          - task: A@1
`).pipeline;
    const job = pipeline?.stages[0]?.jobs[0];
    expect(job?.kind).toBe('deployment');
    expect(job?.steps).toStrictEqual([]);
  });
});

describe('steps', () => {
  const pipeline = build(`steps:
- task: CmdLine@2
  name: firstStep
  displayName: Say hello
  condition: succeeded()
  continueOnError: true
  timeoutInMinutes: 5
  retryCountOnTaskFailure: 2
  workingDirectory: /w
  env:
    A: '1'
  inputs:
    script: echo hi
- task: Other@3
`).pipeline;

  it('numbers steps by ordinal within the job, 1-based', () => {
    expect(pipeline?.stages[0]?.jobs[0]?.steps.map((step) => step.id)).toStrictEqual([1, 2]);
  });

  it('reads every common field', () => {
    const step = pipeline?.stages[0]?.jobs[0]?.steps[0];
    expect(step?.name).toBe('firstStep');
    expect(step?.displayName).toBe('Say hello');
    expect(step?.task).toStrictEqual({ name: 'CmdLine', version: '2' });
    expect(step?.inputs).toStrictEqual({ script: 'echo hi' });
    expect(step?.condition).toBe('succeeded()');
    expect(step?.env).toStrictEqual({ A: '1' });
    expect(step?.continueOnError).toBe(true);
    expect(step?.timeoutInMinutes).toBe(5);
    expect(step?.retryCountOnTaskFailure).toBe(2);
    expect(step?.workingDirectory).toBe('/w');
  });

  it('defaults the fields the author omitted', () => {
    const step = pipeline?.stages[0]?.jobs[0]?.steps[1];
    expect(step?.name).toBeUndefined();
    expect(step?.displayName).toBe('Other'); // the task name, not a placeholder ordinal
    expect(step?.continueOnError).toBe(false);
    expect(step?.retryCountOnTaskFailure).toBe(0);
    expect(step?.warnings).toStrictEqual([]);
  });

  it('leaves the fields later tasks own unset rather than guessing them', () => {
    const step = pipeline?.stages[0]?.jobs[0]?.steps[0];
    expect(step?.disposition).toBeUndefined(); // E07-S03-T01
    expect(step?.fidelity).toBeUndefined(); // E05-S02-T02
  });

  it('splits `Name@version` on the last `@`', () => {
    const step = build('steps:\n- task: my@weird@4\n').pipeline?.stages[0]?.jobs[0]?.steps[0];
    expect(step?.task).toStrictEqual({ name: 'my@weird', version: '4' });
  });

  it('preserves `timeoutInMinutes: 0`, which means "no limit" rather than "unset"', () => {
    const step = build('steps:\n- task: A@1\n  timeoutInMinutes: 0\n').pipeline?.stages[0]?.jobs[0]
      ?.steps[0];
    expect(step?.timeoutInMinutes).toBe(0);
  });

  it('reads a boolean written as a YAML string, as pipeline scalars are (C-E01-015)', () => {
    const step = build("steps:\n- task: A@1\n  continueOnError: 'true'\n").pipeline?.stages[0]
      ?.jobs[0]?.steps[0];
    expect(step?.continueOnError).toBe(true);
  });
});

describe('dependsOn, variables and parameters', () => {
  it('normalizes a scalar and a sequence `dependsOn` to the same list shape', () => {
    const one = build('stages:\n- stage: b\n  dependsOn: a\n  jobs: []\n').pipeline;
    const many = build('stages:\n- stage: b\n  dependsOn:\n  - a\n  jobs: []\n').pipeline;
    expect(one?.stages[0]?.dependsOn).toStrictEqual(['a']);
    expect(many?.stages[0]?.dependsOn).toStrictEqual(['a']);
  });

  it('reads both variable spellings into one flat map', () => {
    const mapping = build('variables:\n  A: one\nsteps: []\n').pipeline;
    const sequence = build('variables:\n- name: A\n  value: one\nsteps: []\n').pipeline;
    expect(mapping?.variables).toStrictEqual({ A: 'one' });
    expect(sequence?.variables).toStrictEqual({ A: 'one' });
  });

  it('skips a `group:` entry rather than inventing a name for it (E04-S02-T02 owns groups)', () => {
    const pipeline = build(
      'variables:\n- group: shared\n- name: A\n  value: one\nsteps: []\n',
    ).pipeline;
    expect(pipeline?.variables).toStrictEqual({ A: 'one' });
  });

  it('reads root parameter defaults, empty for a parameter with none', () => {
    const pipeline = build(
      'parameters:\n- name: a\n  default: one\n- name: b\n  type: string\nsteps: []\n',
    ).pipeline;
    expect(pipeline?.parameters).toStrictEqual({ a: 'one', b: '' });
  });
});

describe('diagnostics', () => {
  it('reports an empty document', () => {
    expect(build('').diagnostics[0]?.code).toBe(MODEL_EMPTY);
  });

  it('reports a root that is not a mapping', () => {
    expect(build('- a\n- b\n').diagnostics[0]?.code).toBe(MODEL_NOT_A_MAPPING);
  });

  it('reports a document with no stages, jobs or steps', () => {
    expect(build('name: nothing-to-run\n').diagnostics[0]?.code).toBe(MODEL_EMPTY);
  });

  it('reports a step with no readable task, and says why that means a bad expansion', () => {
    const [diagnostic] = build('steps:\n- script: echo raw\n').diagnostics;
    expect(diagnostic?.code).toBe(MODEL_BAD_TASK);
    expect(diagnostic?.hint).toContain('desugars every step shorthand');
    expect(diagnostic?.range.line).toBe(2);
  });

  it('reports an agent job with no steps but not a deployment job', () => {
    expect(build('stages:\n- stage: s\n  jobs:\n  - job: a\n').diagnostics[0]?.code).toBe(
      MODEL_NO_STEPS_CONTAINER,
    );
    expect(
      build('stages:\n- stage: s\n  jobs:\n  - deployment: d\n    environment: p\n').diagnostics,
    ).toStrictEqual([]);
  });

  it('still returns a pipeline when a step is unreadable, so one bad step is not a dead conversion', () => {
    const result = build('steps:\n- script: echo raw\n');
    expect(result.pipeline?.stages[0]?.jobs[0]?.steps).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe('built from a real captured expansion', () => {
  it('models the `root-jobs` probe the service returned (C-E04-003)', () => {
    // Not a hand-written approximation: this is the byte-for-byte `finalYaml` from
    // research/experiments/E04-model/root-jobs/, so the test fails if the service's shape moves.
    const finalYaml = readFileSync(
      join(repoRoot, 'research/experiments/E04-model/root-jobs/final.yml'),
      'utf8',
    );
    const { pipeline, diagnostics } = build(finalYaml);
    expect(diagnostics).toStrictEqual([]);
    expect(pipeline?.stages).toHaveLength(1);
    expect(pipeline?.stages[0]?.id).toBe(SYNTHETIC_STAGE_ID);
    expect(pipeline?.stages[0]?.jobs[0]?.id).toBe('Build');
    expect(pipeline?.stages[0]?.jobs[0]?.steps[0]?.task).toStrictEqual({
      name: 'CmdLine',
      version: '2',
    });
    expect(pipeline?.stages[0]?.jobs[0]?.steps[0]?.inputs).toStrictEqual({ script: 'echo one' });
  });

  it('models the unnamed-job expansion, empty id and all (C-E04-004)', () => {
    const finalYaml = readFileSync(
      join(repoRoot, 'research/experiments/E04-model/root-jobs-unnamed/final.yml'),
      'utf8',
    );
    const { pipeline, diagnostics } = build(finalYaml);
    expect(diagnostics).toStrictEqual([]);
    expect(pipeline?.stages[0]?.jobs[0]?.id).toBe('');
  });
});
