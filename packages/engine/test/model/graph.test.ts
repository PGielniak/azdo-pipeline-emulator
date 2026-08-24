// E04-S03-T02 — dependency graphs: defaults, cycles, missing targets, empty `dependsOn: []`.
//
// Every expected sentence is the service's, measured in `research/experiments/E04-dependency-graph/`
// (C-E04-123..138). The tests split cleanly: the *defaults* are read off `resolveStageGraph` /
// `resolveJobGraph` as effective dependency lists, while the *validation* (cycles, missing targets,
// the no-dependency-free-node sentence and its shadowing precedence) is read off `buildPipeline`'s
// diagnostics, because that is where the model-build invariant lives (docs/01 §6).
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import {
  GRAPH_NO_DEPENDENCY_FREE,
  GRAPH_UNKNOWN_TARGET,
  resolveJobGraph,
  resolveStageGraph,
} from '../../src/model/graph.js';

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

const stageIds = (yaml: string): string[] =>
  build(yaml).pipeline?.stages.map((stage) => stage.id) ?? [];

const stageDeps = (yaml: string): (readonly string[])[] => {
  const pipeline = build(yaml).pipeline;
  expect(pipeline).toBeDefined();
  const diagnostics: import('../../src/frontend/diagnostics.js').Diagnostic[] = [];
  return resolveStageGraph(pipeline!.stages, 'pipeline.expanded.yml', diagnostics).map(
    (node) => node.dependsOn,
  );
};

const messages = (yaml: string): string[] => build(yaml).diagnostics.map((d) => d.message);

describe('stage graph — the sequential default (C-E04-123)', () => {
  const threeStages = `stages:
- stage: A
  jobs: []
- stage: B
  jobs: []
- stage: C
  jobs: []
`;

  it('makes a stage without `dependsOn` depend on the stage before it', () => {
    expect(stageDeps(threeStages)).toStrictEqual([[], ['A'], ['B']]);
  });

  it('the first stage has no dependency', () => {
    expect(stageDeps(threeStages)[0]).toStrictEqual([]);
  });

  it('an explicit `dependsOn` replaces the default, and a later absent stage chains from it', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn: A
  jobs: []
- stage: C
  jobs: []
`;
    expect(stageDeps(yaml)).toStrictEqual([[], ['A'], ['B']]);
  });
});

describe('stage graph — empty `dependsOn: []` is the opt-out (C-E04-125)', () => {
  it('runs in parallel with the first stage rather than after it', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn: []
  jobs: []
`;
    expect(stageDeps(yaml)).toStrictEqual([[], []]);
  });

  it('a fan-out then fan-in graph', () => {
    const yaml = `stages:
- stage: Test
  jobs: []
- stage: US1
  dependsOn: Test
  jobs: []
- stage: US2
  dependsOn: Test
  jobs: []
- stage: EU
  dependsOn:
  - US1
  - US2
  jobs: []
`;
    expect(stageDeps(yaml)).toStrictEqual([[], ['Test'], ['Test'], ['US1', 'US2']]);
  });
});

describe('job graph — the parallel default (C-E04-124)', () => {
  const threeJobs = `stages:
- stage: A
  jobs:
  - job: A1
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: A2
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: A3
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;

  it('gives every job an empty dependency list', () => {
    const pipeline = build(threeJobs).pipeline;
    expect(pipeline).toBeDefined();
    const graph = resolveJobGraph(pipeline!.stages[0]!, 'pipeline.expanded.yml', []);
    expect(graph.map((node) => [node.id, node.dependsOn])).toStrictEqual([
      ['A1', []],
      ['A2', []],
      ['A3', []],
    ]);
  });

  it('respects an authored job dependency', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: A1
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: A2
    dependsOn: A1
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    const pipeline = build(yaml).pipeline;
    const graph = resolveJobGraph(pipeline!.stages[0]!, 'pipeline.expanded.yml', []);
    expect(graph.map((node) => [node.id, node.dependsOn])).toStrictEqual([
      ['A1', []],
      ['A2', ['A1']],
    ]);
  });
});

describe('job graph — matrix legs share one reference name (C-E04-136)', () => {
  it('resolves `dependsOn: Build` against the base name, not the leg ids', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Build
    strategy:
      matrix:
        Alpha: { V: a }
        Beta: { V: b }
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: Deploy
    dependsOn: Build
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    const result = build(yaml);
    expect(result.diagnostics).toStrictEqual([]);
    const pipeline = result.pipeline!;
    // The legs are distinct ids, but the graph has one node per reference name.
    expect(pipeline.stages[0]!.jobs.map((job) => job.id)).toStrictEqual([
      'Build Alpha',
      'Build Beta',
      'Deploy',
    ]);
    const graph = resolveJobGraph(pipeline.stages[0]!, 'pipeline.expanded.yml', []);
    expect(graph.map((node) => [node.id, node.dependsOn])).toStrictEqual([
      ['Build', []],
      ['Deploy', ['Build']],
    ]);
  });
});

describe('validation — missing targets (C-E04-126/127)', () => {
  it('stage: `Stage B depends on unknown stage NoSuchStage.`', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn: NoSuchStage
  jobs: []
`;
    const result = build(yaml);
    expect(result.diagnostics.map((d) => d.code)).toStrictEqual([GRAPH_UNKNOWN_TARGET]);
    expect(result.diagnostics[0]?.message).toBe('Stage B depends on unknown stage NoSuchStage.');
  });

  it('job: `Stage A job A2 depends on unknown job NoSuchJob.`', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: A1
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: A2
    dependsOn: NoSuchJob
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    const result = build(yaml);
    expect(result.diagnostics.map((d) => d.code)).toStrictEqual([GRAPH_UNKNOWN_TARGET]);
    expect(result.diagnostics[0]?.message).toBe('Stage A job A2 depends on unknown job NoSuchJob.');
  });
});

describe('validation — cycles, edge by edge (C-E04-130/131/132)', () => {
  it('stage: each participating edge gets its own sentence, in declaration order', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn:
  - A
  - C
  jobs: []
- stage: C
  dependsOn: B
  jobs: []
`;
    expect(messages(yaml)).toStrictEqual([
      'Stage B depends on stage C which creates a cycle in the dependency graph.',
      'Stage C depends on stage B which creates a cycle in the dependency graph.',
    ]);
  });

  it('job: `Stage A job B depends on job C which creates a cycle …`', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: Root
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: B
    dependsOn:
    - Root
    - C
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: C
    dependsOn: B
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    expect(messages(yaml)).toStrictEqual([
      'Stage A job B depends on job C which creates a cycle in the dependency graph.',
      'Stage A job C depends on job B which creates a cycle in the dependency graph.',
    ]);
  });

  it('a self-loop is a cycle edge when a dependency-free node exists elsewhere (C-E04-135)', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn: B
  jobs: []
`;
    expect(messages(yaml)).toStrictEqual([
      'Stage B depends on stage B which creates a cycle in the dependency graph.',
    ]);
  });
});

describe('validation — the no-dependency-free-node sentence (C-E04-128/129)', () => {
  it('stage: a mutual dependency has no root and reports the single sentence', () => {
    const yaml = `stages:
- stage: A
  dependsOn: B
  jobs: []
- stage: B
  dependsOn: A
  jobs: []
`;
    const result = build(yaml);
    expect(result.diagnostics.map((d) => d.code)).toStrictEqual([GRAPH_NO_DEPENDENCY_FREE]);
    expect(result.diagnostics[0]?.message).toBe(
      'The pipeline must contain at least one stage with no dependencies.',
    );
  });

  it('job: `Stage A must contain at least one job with no dependencies.`', () => {
    const yaml = `stages:
- stage: A
  jobs:
  - job: A1
    dependsOn: A2
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
  - job: A2
    dependsOn: A1
    steps: [{ task: CmdLine@2, inputs: { script: echo } }]
`;
    expect(messages(yaml)).toStrictEqual([
      'Stage A must contain at least one job with no dependencies.',
    ]);
  });
});

describe('validation — the precedence (C-E04-133/134)', () => {
  it('the no-dependency-free-node sentence shadows a missing target', () => {
    const yaml = `stages:
- stage: A
  dependsOn: Z
  jobs: []
- stage: B
  dependsOn: A
  jobs: []
`;
    expect(messages(yaml)).toStrictEqual([
      'The pipeline must contain at least one stage with no dependencies.',
    ]);
  });

  it('cycle edges are reported before missing targets', () => {
    const yaml = `stages:
- stage: A
  jobs: []
- stage: B
  dependsOn:
  - A
  - C
  jobs: []
- stage: C
  dependsOn:
  - B
  - Z
  jobs: []
`;
    expect(messages(yaml)).toStrictEqual([
      'Stage B depends on stage C which creates a cycle in the dependency graph.',
      'Stage C depends on stage B which creates a cycle in the dependency graph.',
      'Stage C depends on unknown stage Z.',
    ]);
  });

  it('the sequential default participates in the root check (C-E04-133)', () => {
    // A has an explicit (missing) dependency; B is absent, so it chains onto A. Neither is
    // dependency-free, so the missing target is shadowed — exactly the measured transcript.
    const yaml = `stages:
- stage: A
  dependsOn:
  - Z1
  - Z2
  jobs: []
- stage: B
  jobs: []
`;
    expect(messages(yaml)).toStrictEqual([
      'The pipeline must contain at least one stage with no dependencies.',
    ]);
  });
});

describe('a valid graph produces no diagnostics', () => {
  it('a single stage and a fan-in pipeline are both clean', () => {
    expect(build('stages:\n- stage: A\n  jobs: []\n').diagnostics).toStrictEqual([]);
    expect(
      build(`stages:
- stage: A
  jobs: []
- stage: B
  dependsOn: A
  jobs: []
`).diagnostics,
    ).toStrictEqual([]);
  });
});

describe('stage identity is preserved through the graph', () => {
  it('node ids mirror the stage ids', () => {
    const yaml = `stages:
- stage: one
  jobs: []
- stage: two
  jobs: []
`;
    expect(stageIds(yaml)).toStrictEqual(['one', 'two']);
    const pipeline = build(yaml).pipeline;
    const graph = resolveStageGraph(pipeline!.stages, 'pipeline.expanded.yml', []);
    expect(graph.map((node) => node.id)).toStrictEqual(['one', 'two']);
  });
});
