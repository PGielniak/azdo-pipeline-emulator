// E04-S03-T03 — the deployment job model.
//
// The model reads a deployment job's `environment:`, its `strategy: runOnce` hook sequence, and the
// auto-download flag from the service's `finalYaml`, where every hook's steps arrive desugared into
// `task: Name@version` (C-E04-030/148) and the environment scalar is already promoted to `{name}`
// (C-E04-142). The output-variable naming quirk is a pure helper over those fields (C-E04-151/152).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { buildPipeline } from '../../src/model/build.js';
import { runOnceOutputVariableKey } from '../../src/model/deployment.js';
import type { Job, RunOnceStrategy } from '../../src/model/types.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const deploymentJob = (yaml: string): Job | undefined =>
  buildPipeline(parsePipelineYaml(yaml, 'pipeline.expanded.yml')).pipeline?.stages[0]?.jobs[0];

const strategyOf = (job: Job | undefined): RunOnceStrategy | undefined =>
  job?.strategy?.kind === 'runOnce' ? job.strategy : undefined;

describe('environment parsing', () => {
  it('reads the object form with name, resourceName and resourceType (C-E04-145)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment:
      name: env1
      resourceName: vmsfortesting
      resourceType: virtualMachine
    strategy:
      runOnce:
        deploy:
          steps: []
`);
    expect(job?.environment).toStrictEqual({
      name: 'env1',
      resourceName: 'vmsfortesting',
      resourceType: 'virtualMachine',
    });
  });

  it('reads the scalar shorthand as a bare name (C-E04-142)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
`);
    expect(job?.environment).toStrictEqual({ name: 'prod' });
  });

  it('splits the dotted `env.resource` scalar on the first dot (C-E04-143)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: smarthotel-dev.bookings
`);
    expect(job?.environment).toStrictEqual({ name: 'smarthotel-dev', resourceName: 'bookings' });
  });
});

describe('runOnce hook sequence', () => {
  it('models every hook in its authored slot (C-E04-146)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        preDeploy:
          steps:
          - task: A@1
        deploy:
          steps:
          - task: B@1
        routeTraffic:
          steps:
          - task: C@1
        postRouteTraffic:
          steps:
          - task: D@1
        on:
          failure:
            steps:
            - task: F@1
          success:
            steps:
            - task: E@1
`);
    const strategy = strategyOf(job);
    expect(strategy?.preDeploy?.steps.map((s) => s.task.name)).toStrictEqual(['A']);
    expect(strategy?.deploy?.steps.map((s) => s.task.name)).toStrictEqual(['B']);
    expect(strategy?.routeTraffic?.steps.map((s) => s.task.name)).toStrictEqual(['C']);
    expect(strategy?.postRouteTraffic?.steps.map((s) => s.task.name)).toStrictEqual(['D']);
    expect(strategy?.onSuccess?.steps.map((s) => s.task.name)).toStrictEqual(['E']);
    expect(strategy?.onFailure?.steps.map((s) => s.task.name)).toStrictEqual(['F']);
  });

  it('omits hooks the author did not write', () => {
    const strategy = strategyOf(
      deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        deploy:
          steps:
          - task: B@1
`),
    );
    expect(strategy?.deploy).toBeDefined();
    expect(strategy?.preDeploy).toBeUndefined();
    expect(strategy?.routeTraffic).toBeUndefined();
    expect(strategy?.postRouteTraffic).toBeUndefined();
    expect(strategy?.onSuccess).toBeUndefined();
    expect(strategy?.onFailure).toBeUndefined();
  });

  it('desugars the hooks’ steps the same way a job’s are (C-E04-030/148)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        deploy:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo hi
`);
    const deploy = strategyOf(job)?.deploy;
    expect(deploy?.steps[0]?.task).toStrictEqual({ name: 'CmdLine', version: '2' });
    expect(deploy?.steps[0]?.inputs).toStrictEqual({ script: 'echo hi' });
  });
});

describe('auto-download flag', () => {
  it('defaults to true: a deployment job auto-downloads (C-E06-096, C-E04-149)', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        deploy:
          steps:
          - task: B@1
`);
    expect(job?.autoDownloadArtifacts).toBe(true);
  });

  it('is false when the deploy hook carries the desugared `download: none` (C-E04-150)', () => {
    // The service renders `- download: none` as the agent-internal download GUID with
    // `condition: false` and `inputs.alias: none` (research/experiments/E04-deployment/download-none/).
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        deploy:
          steps:
          - task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1
            condition: false
            inputs:
              alias: none
          - task: B@1
`);
    expect(job?.autoDownloadArtifacts).toBe(false);
    // The suppression marker itself is still a step the model carries, origin recovered (C-E04-032).
    const deploy = strategyOf(job)?.deploy;
    expect(deploy?.steps[0]?.origin).toBe('download');
    expect(deploy?.steps[0]?.inputs['alias']).toBe('none');
  });

  it('a `download: none` in another hook does not suppress the deploy hook’s download', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      runOnce:
        preDeploy:
          steps:
          - task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1
            inputs:
              alias: none
        deploy:
          steps:
          - task: B@1
`);
    expect(job?.autoDownloadArtifacts).toBe(true);
  });
});

describe('rolling and canary are reserved (C-E04-154)', () => {
  it('records rolling as a bare marker and parses no hooks', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      rolling:
        maxParallel: 2
        deploy:
          steps:
          - task: B@1
`);
    expect(job?.strategy).toStrictEqual({ kind: 'rolling' });
  });

  it('records canary the same way', () => {
    const job = deploymentJob(`stages:
- stage: s
  jobs:
  - deployment: d
    environment: prod
    strategy:
      canary:
        increments: [10, 20]
        deploy:
          steps:
          - task: B@1
`);
    expect(job?.strategy).toStrictEqual({ kind: 'canary' });
  });
});

describe('output-variable naming quirk', () => {
  const runOnce = (environment: string): Job | undefined =>
    deploymentJob(`stages:
- stage: StageA
  jobs:
  - deployment: A1
    environment: ${environment}
    strategy:
      runOnce:
        deploy:
          steps:
          - task: B@1
            name: setvarStep
`);

  it('keys by the job name when no resource is targeted (C-E04-151/153)', () => {
    const job = runOnce('env1');
    expect(job).toBeDefined();
    expect(runOnceOutputVariableKey(job!, 'setvarStep', 'myOutputVar')).toBe(
      'A1.setvarStep.myOutputVar',
    );
  });

  it('keys by `Deploy_<resourceName>` when a resource is targeted (C-E04-152)', () => {
    const job = runOnce(
      '{ name: env1, resourceName: vmsfortesting, resourceType: virtualMachine }',
    );
    expect(job).toBeDefined();
    expect(runOnceOutputVariableKey(job!, 'setvarStep', 'myOutputVar')).toBe(
      'Deploy_vmsfortesting.setvarStep.myOutputVar',
    );
  });
});

describe('built from the real corpus expansion', () => {
  it('models the runOnce deployment job the service returned', () => {
    const finalYaml = readFileSync(
      join(repoRoot, 'fixtures/oracle/08-deployment-runonce.final.yml'),
      'utf8',
    );
    const { pipeline, diagnostics } = buildPipeline(parsePipelineYaml(finalYaml, 'final.yml'));
    expect(diagnostics).toStrictEqual([]);

    const staging = pipeline?.stages[1]?.jobs[0];
    expect(staging?.kind).toBe('deployment');
    expect(staging?.id).toBe('staging');
    expect(staging?.environment).toStrictEqual({ name: 'corpus-staging' });
    expect(staging?.steps).toStrictEqual([]);
    const strategy = strategyOf(staging);
    expect(strategy?.deploy?.steps).toHaveLength(3);
    expect(strategy?.preDeploy?.steps.map((s) => s.origin)).toStrictEqual(['download', undefined]);
    expect(strategy?.onFailure?.steps).toHaveLength(1);
    expect(strategy?.onSuccess?.steps).toHaveLength(1);
    // No `download: none` in the deploy hook → auto-download stays on.
    expect(staging?.autoDownloadArtifacts).toBe(true);

    const production = pipeline?.stages[2]?.jobs[0];
    expect(production?.kind).toBe('deployment');
    expect(production?.environment).toStrictEqual({ name: 'corpus-production' });
    expect(production?.strategy).toStrictEqual({ kind: 'rolling' });
  });
});
