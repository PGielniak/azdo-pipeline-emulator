// E04-S03-T01 — matrix & parallel strategy expansion.
//
// The builder is the entry point: the service leaves `strategy:` unexpanded (C-E04-118), so these
// assertions feed a `strategy:` block through `buildPipeline` and check the concrete jobs it
// produces. Every expected shape is grounded — the space-separated `<JobName> <key>` naming and the
// 1-based `<JobName> <position>` slices come from run 546's timeline (`Build Alpha`/`Build Beta`,
// `Slice 1`/`Slice 2`, C-E04-119/121), not from a hand-written guess.
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import { STRATEGY_RUNTIME_MATRIX } from '../../src/model/strategy.js';
import type { Job, Pipeline } from '../../src/model/types.js';

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

const shape = (pipeline: Pipeline | undefined): unknown =>
  JSON.parse(JSON.stringify(pipeline, (key, value) => (key === 'provenance' ? undefined : value)));

const jobsOf = (yaml: string): readonly Job[] => {
  const pipeline = build(yaml).pipeline;
  expect(pipeline).toBeDefined();
  return pipeline?.stages[0]?.jobs ?? [];
};

describe('matrix expansion', () => {
  const matrixYaml = `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix:
        Alpha:
          MATRIX_VAR: 'a'
        Beta:
          MATRIX_VAR: 'b'
      maxParallel: 2
    steps:
    - task: CmdLine@2
      inputs:
        script: echo hi
`;

  it('expands one job into one per matrix key, named `<JobName> <key>` (C-E04-110/119)', () => {
    const jobs = jobsOf(matrixYaml);
    expect(jobs.map((job) => job.id)).toStrictEqual(['Build Alpha', 'Build Beta']);
    expect(jobs.map((job) => job.matrixKey)).toStrictEqual(['Alpha', 'Beta']);
  });

  it("injects each key's mapping as job-level variables (C-E04-112/122)", () => {
    const jobs = jobsOf(matrixYaml);
    expect(jobs[0]?.variables).toStrictEqual([{ name: 'MATRIX_VAR', value: 'a', readonly: false }]);
    expect(jobs[1]?.variables).toStrictEqual([{ name: 'MATRIX_VAR', value: 'b', readonly: false }]);
  });

  it('records `maxParallel` verbatim on every leg (C-E04-113)', () => {
    for (const job of jobsOf(matrixYaml)) expect(job.maxParallel).toBe(2);
  });

  it('preserves the authored key order', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix:
        Zulu: { V: 'z' }
        Alpha: { V: 'a' }
        Mike: { V: 'm' }
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    expect(jobsOf(yaml).map((job) => job.id)).toStrictEqual([
      'Build Zulu',
      'Build Alpha',
      'Build Mike',
    ]);
  });

  it('does not touch a job without a strategy (single job, no matrixKey, no maxParallel)', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Plain
    steps:
    - task: CmdLine@2
      inputs:
        script: echo
`;
    const jobs = jobsOf(yaml);
    expect(jobs.map((job) => job.id)).toStrictEqual(['Plain']);
    expect(jobs[0]?.matrixKey).toBeUndefined();
    expect(jobs[0]?.maxParallel).toBeUndefined();
  });
});

describe('runtime-expression matrix (degraded path)', () => {
  const runtimeMatrixYaml = `stages:
- stage: A
  jobs:
  - job: runner
    strategy:
      matrix: $[ dependencies.generator.outputs['mtrx.legs'] ]
    steps:
    - task: CmdLine@2
      inputs:
        script: echo
`;

  it('keeps the job unexpanded and warns (C-E04-116)', () => {
    const result = build(runtimeMatrixYaml);
    expect(result.pipeline?.stages[0]?.jobs.map((job) => job.id)).toStrictEqual(['runner']);
    expect(result.pipeline?.stages[0]?.jobs[0]?.matrixKey).toBeUndefined();
    expect(result.diagnostics.map((d) => d.code)).toStrictEqual([STRATEGY_RUNTIME_MATRIX]);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });
});

describe('parallel expansion', () => {
  const parallelYaml = `stages:
- stage: A
  jobs:
  - job: Slice
    strategy:
      parallel: 2
    steps:
    - task: CmdLine@2
      inputs:
        script: echo
`;

  it('duplicates the job N times, named `<JobName> <position>` with a 1-based position (C-E04-121)', () => {
    const jobs = jobsOf(parallelYaml);
    expect(jobs.map((job) => job.id)).toStrictEqual(['Slice 1', 'Slice 2']);
  });

  it('injects System.JobPositionInPhase and System.TotalJobsInPhase (C-E04-114/121)', () => {
    const jobs = jobsOf(parallelYaml);
    expect(jobs[0]?.variables).toStrictEqual([
      { name: 'System.JobPositionInPhase', value: '1', readonly: false },
      { name: 'System.TotalJobsInPhase', value: '2', readonly: false },
    ]);
    expect(jobs[1]?.variables).toStrictEqual([
      { name: 'System.JobPositionInPhase', value: '2', readonly: false },
      { name: 'System.TotalJobsInPhase', value: '2', readonly: false },
    ]);
  });

  it('records no `maxParallel` — it is matrix-only (C-E04-115)', () => {
    for (const job of jobsOf(parallelYaml)) expect(job.maxParallel).toBeUndefined();
  });
});

describe('the empty-matrix edge case', () => {
  it('still yields one job rather than none (C-E04-117)', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix: {}
    steps:
    - task: CmdLine@2
      inputs:
        script: echo
`;
    const jobs = jobsOf(yaml);
    expect(jobs.map((job) => job.id)).toStrictEqual(['Build']);
    expect(jobs[0]?.matrixKey).toBeUndefined();
    expect(jobs[0]?.variables).toStrictEqual([]);
  });
});

// `shape` is exercised once so the whole-model JSON shape (minus provenance) stays a regression
// surface too, matching the builder suite's convention.
describe('whole-model shape', () => {
  it('a matrix job round-trips through the provenance-stripping shape', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix:
        Alpha: { V: 'a' }
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    expect(shape(build(yaml).pipeline)).toMatchSnapshot();
  });
});
