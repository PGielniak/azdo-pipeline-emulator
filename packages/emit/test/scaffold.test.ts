// E05-S01-T01 — the project scaffolder.
//
// The Done criteria are "golden-tree tests on corpus" and "re-convert produces zero diff", so the
// suite does both halves:
//   1. It snapshots the whole `stages/` tree (directories + step files + `.gitignore`) for every
//      corpus entry, built from the captured `final.yml` — the service's own output, not a
//      hand-written approximation — so the naming rules are validated against real pipelines, which
//      is the "slug edge cases validated against real pipelines" half of the task's Ground field.
//   2. It asserts `scaffold` is deterministic: the same model yields a deep-equal plan, which is
//      what makes a re-convert produce a zero diff.
//
// The slug edge cases worth pinning explicitly — parentheses ("Staging (runOnce)"), slashes
// ("Build src/app"), case-folding ("Build" vs "build"), and a matrix-key suffix that slug-collides —
// get their own focused cases rather than hiding inside a snapshot.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildPipeline, parsePipelineYaml } from '@azdo-emu/engine';
import { GITIGNORE, number, scaffold, slugify, type Scaffold } from '../src/scaffold.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const build = (yaml: string, file = 'pipeline.expanded.yml') =>
  buildPipeline(parsePipelineYaml(yaml, file));

/** The captured corpus `final.yml`s, read straight off disk (sync, self-contained — the same shape the manifest suite uses). */
function corpusFinalYamls(): { name: string; finalYaml: string }[] {
  const oracleDir = join(repoRoot, 'fixtures', 'oracle');
  return readdirSync(oracleDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name.slice(0, -'.final.yml'.length),
      finalYaml: readFileSync(join(oracleDir, e.name), 'utf8'),
    }));
}

/** A stable, readable rendering of a scaffold plan for snapshotting. */
function treeText(s: Scaffold): string {
  const lines: string[] = [];
  for (const dir of s.directories) lines.push(`${dir}/`);
  lines.push('.gitignore');
  for (const stage of s.stages)
    for (const job of stage.jobs)
      for (const step of job.steps)
        lines.push(`${step.path}${step.hook ? `  (hook ${step.hook})` : ''}`);
  return lines.join('\n');
}

describe('slugify', () => {
  it('lower-cases and collapses non-alphanumeric runs to a single dash', () => {
    expect(slugify('Build and publish')).toBe('build-and-publish');
    expect(slugify('Fan-in over every matrix leg')).toBe('fan-in-over-every-matrix-leg');
  });

  it('handles parentheses, slashes and mixed case (corpus edge cases)', () => {
    expect(slugify('Staging (runOnce)')).toBe('staging-runonce');
    expect(slugify('Build src/app')).toBe('build-src-app');
    expect(slugify('Build (governed)')).toBe('build-governed');
    expect(slugify('Parallel (slice) strategy')).toBe('parallel-slice-strategy');
  });

  it('trims leading/trailing dashes and returns empty for a symbol-only name', () => {
    expect(slugify('  Build   solution  ')).toBe('build-solution');
    expect(slugify('C#')).toBe('c');
    expect(slugify('!!!')).toBe('');
    expect(slugify('')).toBe('');
  });
});

describe('number', () => {
  it('is ordinal × 10, zero-padded, leaving gaps', () => {
    expect(number(1)).toBe('010');
    expect(number(2)).toBe('020');
    expect(number(10)).toBe('100');
  });
});

describe('scaffold', () => {
  it('is deterministic — the same model yields an identical plan (re-convert = zero diff)', () => {
    const { pipeline } = build(`stages:
- stage: Build
  jobs:
  - job: BuildJob
    displayName: Build solution
    steps:
    - task: CmdLine@2
      displayName: Build src/app
      inputs:
        script: echo hi
`);
    expect(pipeline).toBeDefined();
    expect(scaffold(pipeline!)).toEqual(scaffold(pipeline!));
  });

  it('names matrix legs `<job>__<key>` and disambiguates slug-colliding keys', () => {
    const { pipeline, diagnostics } = build(`stages:
- stage: A
  jobs:
  - job: build
    strategy:
      matrix:
        linux_debug:
          x: 1
        linux-debug:
          x: 2
    steps:
    - task: CmdLine@2
      inputs:
        script: echo hi
`);
    expect(diagnostics).toHaveLength(0);
    const jobs = scaffold(pipeline!).stages[0]!.jobs;
    expect(jobs.map((j) => j.name)).toEqual(['010-build__linux-debug', '010-build__linux-debug-2']);
  });

  it('names parallel slices `<job>__<position>`', () => {
    const { pipeline } = build(`stages:
- stage: A
  jobs:
  - job: slices
    strategy:
      parallel: 3
    steps:
    - task: CmdLine@2
      inputs:
        script: echo hi
`);
    expect(scaffold(pipeline!).stages[0]!.jobs.map((j) => j.name)).toEqual([
      '010-slices__1',
      '010-slices__2',
      '010-slices__3',
    ]);
  });

  it('flattens runOnce deployment hooks into steps/ with the hook recorded per step', () => {
    const { pipeline } = build(`stages:
- stage: Deploy
  jobs:
  - deployment: staging
    environment: prod
    strategy:
      runOnce:
        preDeploy:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo pre
        deploy:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo deploy
        on:
          failure:
            steps:
            - task: CmdLine@2
              inputs:
                script: echo rollback
`);
    const job = scaffold(pipeline!).stages[0]!.jobs[0]!;
    expect(job.steps.map((s) => [s.path.split('/').pop(), s.hook])).toEqual([
      ['010-cmdline.sh', 'preDeploy'],
      ['020-cmdline.sh', 'deploy'],
      ['030-cmdline.sh', 'onFailure'],
    ]);
    expect(job.job.steps).toHaveLength(0);
  });

  it('emits the documented .gitignore', () => {
    expect(GITIGNORE).toBe('.env\n.work/\n.artifacts/\n.cache/\n');
  });

  it('prefers an authored displayName over the origin keyword on a shorthand step', () => {
    const { pipeline } = build(`stages:
- stage: A
  jobs:
  - job: build
    steps:
    - checkout: self
      displayName: Fetch the sources
`);
    const job = scaffold(pipeline!).stages[0]!.jobs[0]!;
    expect(job.steps[0]!.path.split('/').pop()).toBe('010-fetch-the-sources.sh');
  });

  it('falls back to the kind token when both displayName and id are empty', () => {
    const { pipeline } = build(`stages:
- stage:
  jobs:
  - job:
    steps:
    - task: CmdLine@2
      displayName: '!!!'
      inputs:
        script: echo hi
`);
    const stage = scaffold(pipeline!).stages[0]!;
    expect(stage.name).toBe('010-stage');
    expect(stage.jobs[0]!.name).toBe('010-job');
    expect(stage.jobs[0]!.steps[0]!.path.split('/').pop()).toBe('010-step.sh');
  });

  it('disambiguates three colliding matrix keys without exhausting the suffix', () => {
    const { pipeline } = build(`stages:
- stage: A
  jobs:
  - job: build
    strategy:
      matrix:
        a.b: { x: 1 }
        a-b: { x: 2 }
        a_b: { x: 3 }
    steps:
    - task: CmdLine@2
      inputs:
        script: echo hi
`);
    expect(scaffold(pipeline!).stages[0]!.jobs.map((j) => j.name)).toEqual([
      '010-build__a-b',
      '010-build__a-b-2',
      '010-build__a-b-3',
    ]);
  });
});

describe('golden tree over the corpus', () => {
  for (const { name, finalYaml } of corpusFinalYamls()) {
    it(`scaffolds ${name}`, () => {
      const { pipeline, diagnostics } = build(finalYaml, `${name}.final.yml`);
      expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      expect(pipeline).toBeDefined();
      expect(treeText(scaffold(pipeline!))).toMatchSnapshot();
    });
  }
});
