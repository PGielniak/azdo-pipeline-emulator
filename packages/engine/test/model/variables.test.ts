// E04-S02-T01 — variable scope resolution and precedence.
//
// The Done field asks for a "precedence test matrix". The matrix below is the documented order
// (C-E04-082) exercised in both directions — which layer wins, and which layers are *not* visible —
// plus the two facts the probes established that make any of this our job at all: the expansion
// resolves no precedence (C-E04-080) and collapses no duplicates (C-E04-081). Those two are
// asserted against the captured transcripts, because they are claims about the service rather than
// about this module.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import type { Pipeline } from '../../src/model/types.js';
import { foldVariableName, resolveVariables, variableValue } from '../../src/model/variables.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const transcript = (probe: string): string =>
  readFileSync(join(repoRoot, 'research/experiments/E04-variables', probe, 'final.yml'), 'utf8');

const build = (yaml: string): Pipeline => {
  const result = buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml'));
  if (result.pipeline === undefined) throw new Error('no pipeline built');
  return result.pipeline;
};

/** Effective variables for the first job of the first stage. */
const resolveFirstJob = (pipeline: Pipeline) =>
  resolveVariables(pipeline, pipeline.stages[0], pipeline.stages[0]?.jobs[0]);

describe('the service leaves this to us (C-E04-080/081)', () => {
  it('keeps all three scopes in the expansion rather than resolving them', () => {
    const pipeline = build(transcript('three-scopes'));
    expect(pipeline.variables.map((v) => v.value)).toStrictEqual(['pipeline-yaml']);
    expect(pipeline.stages[0]?.variables.map((v) => v.value)).toStrictEqual(['stage-yaml']);
    expect(pipeline.stages[0]?.jobs[0]?.variables.map((v) => v.value)).toStrictEqual(['job-yaml']);
  });

  it('keeps both duplicates in one scope, in authored order', () => {
    const pipeline = build(transcript('same-scope-duplicate'));
    expect(pipeline.stages[0]?.variables.map((v) => v.value)).toStrictEqual(['alpha', 'beta']);
  });
});

describe('precedence matrix (C-E04-082)', () => {
  const pipeline = build(transcript('three-scopes'));

  it('job beats stage beats pipeline', () => {
    expect(variableValue(resolveFirstJob(pipeline), 'a')).toBe('job-yaml');
  });

  it('stage beats pipeline when there is no job-level entry', () => {
    const stage = pipeline.stages[0];
    expect(variableValue(resolveVariables(pipeline, stage), 'a')).toBe('stage-yaml');
  });

  it('pipeline wins when it is the only layer', () => {
    expect(variableValue(resolveVariables(pipeline), 'a')).toBe('pipeline-yaml');
  });

  it('reports which layer the winner came from', () => {
    expect(resolveFirstJob(pipeline).effective.get('a')?.scope).toBe('job');
    expect(resolveVariables(pipeline, pipeline.stages[0]).effective.get('a')?.scope).toBe('stage');
    expect(resolveVariables(pipeline).effective.get('a')?.scope).toBe('pipeline');
  });

  it('last wins within one scope', () => {
    const duplicates = build(transcript('same-scope-duplicate'));
    expect(variableValue(resolveVariables(duplicates, duplicates.stages[0]), 'a')).toBe('beta');
  });
});

describe('scope isolation (C-E04-083)', () => {
  const pipeline = build(`variables:
- name: root
  value: r
stages:
- stage: one
  variables:
  - name: onlyOne
    value: '1'
  jobs:
  - job: A
    variables:
    - name: onlyA
      value: a
    steps: []
  - job: B
    steps: []
- stage: two
  variables:
  - name: onlyTwo
    value: '2'
  jobs:
  - job: C
    steps: []
`);

  it('a job sees root, its own stage and itself', () => {
    const resolved = resolveVariables(pipeline, pipeline.stages[0], pipeline.stages[0]?.jobs[0]);
    expect(variableValue(resolved, 'root')).toBe('r');
    expect(variableValue(resolved, 'onlyOne')).toBe('1');
    expect(variableValue(resolved, 'onlyA')).toBe('a');
  });

  it('never sees a sibling stage’s variables', () => {
    const resolved = resolveVariables(pipeline, pipeline.stages[0], pipeline.stages[0]?.jobs[0]);
    expect(variableValue(resolved, 'onlyTwo')).toBeUndefined();
  });

  it('never sees a sibling job’s variables', () => {
    const resolved = resolveVariables(pipeline, pipeline.stages[0], pipeline.stages[0]?.jobs[1]);
    expect(variableValue(resolved, 'onlyA')).toBeUndefined();
    expect(variableValue(resolved, 'onlyOne')).toBe('1');
  });
});

describe('case-insensitive names (C-E06-003)', () => {
  const pipeline = build(`variables:
- name: MyVar
  value: root
stages:
- stage: one
  jobs:
  - job: A
    variables:
    - name: MYVAR
      value: job
    steps: []
`);

  it('a differently-cased job entry overrides the root one rather than sitting beside it', () => {
    const resolved = resolveFirstJob(pipeline);
    expect(resolved.effective.size).toBe(1);
    expect(variableValue(resolved, 'myvar')).toBe('job');
  });

  it('preserves the winner’s authored casing for display', () => {
    expect(resolveFirstJob(pipeline).effective.get('myvar')?.name).toBe('MYVAR');
  });

  it('folds a name the same way the runtime store does', () => {
    expect(foldVariableName('Build.SourceBranch')).toBe(foldVariableName('BUILD.SOURCEBRANCH'));
  });
});

describe('readonly (C-E04-085)', () => {
  it('is carried from the expansion', () => {
    const pipeline = build(transcript('readonly-flag'));
    expect(pipeline.variables[0]?.readonly).toBe(true);
    expect(resolveVariables(pipeline).effective.get('a')?.readonly).toBe(true);
  });

  it('defaults to false, and follows the winning declaration rather than accumulating', () => {
    const pipeline = build(`variables:
- name: a
  value: root
  readonly: true
stages:
- stage: one
  jobs:
  - job: A
    variables:
    - name: a
      value: job
    steps: []
`);
    expect(resolveFirstJob(pipeline).effective.get('a')?.readonly).toBe(false);
  });
});

describe('groups are names, never values (C-E04-086, PLAN D7)', () => {
  const pipeline = build(`variables:
- group: shared
- name: a
  value: inline
stages:
- stage: one
  variables:
  - group: stageGroup
  - group: shared
  jobs:
  - job: A
    steps: []
`);

  it('collects group names across layers, in order and de-duplicated', () => {
    expect(resolveFirstJob(pipeline).groups).toStrictEqual(['shared', 'stageGroup']);
  });

  it('contributes no variable value of its own', () => {
    const resolved = resolveFirstJob(pipeline);
    expect(resolved.effective.size).toBe(1);
    expect(variableValue(resolved, 'a')).toBe('inline');
  });

  it('carries the group marker on the declaration for E04-S02-T02', () => {
    expect(pipeline.variables[0]).toStrictEqual({
      name: '',
      value: '',
      readonly: false,
      group: 'shared',
    });
  });
});

describe('the mapping shorthand (C-E04-084)', () => {
  it('is normalized to the list form by the service, and read from it', () => {
    const pipeline = build(transcript('mapping-vs-list'));
    expect(pipeline.variables).toStrictEqual([
      { name: 'a', value: 'from-mapping', readonly: false },
      { name: 'b', value: 'two', readonly: false },
    ]);
  });

  it('is still read directly, for the offline arm that does not normalize', () => {
    const pipeline = build('variables:\n  a: one\n  b: two\nsteps: []\n');
    expect(pipeline.variables.map((v) => [v.name, v.value])).toStrictEqual([
      ['a', 'one'],
      ['b', 'two'],
    ]);
  });
});

describe('empty and absent', () => {
  it('resolves to nothing for a pipeline with no variables at all', () => {
    const resolved = resolveVariables(build('steps: []\n'));
    expect(resolved.effective.size).toBe(0);
    expect(resolved.groups).toStrictEqual([]);
  });

  it('tolerates a stage or job that declares none', () => {
    const pipeline = build(
      'variables:\n- name: a\n  value: r\nstages:\n- stage: s\n  jobs:\n  - job: j\n    steps: []\n',
    );
    expect(variableValue(resolveFirstJob(pipeline), 'a')).toBe('r');
  });
});
