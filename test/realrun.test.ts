// E11-S05-T01 — the L6 harness's pure half.
//
// The network half is exercised by actually running it (the committed capture and report are its
// evidence). What is tested here is everything that decides *what gets compared* — because the way
// this harness fails silently is by comparing the wrong rows and reporting parity.
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  authoredJobs,
  compareFacts,
  FIXTURE,
  isCheckoutRecord,
  markersIn,
  partitionServiceSteps,
  renderReport,
  serviceRunFromCapture,
  stripArtifactPrefix,
  type Capture,
  type RunFacts,
  type TimelineRecord,
} from '../scripts/realrun.ts';

const FIXTURE_YAML = `
stages:
- stage: build
  jobs:
  - job: compile
    steps:
    - script: echo one
      displayName: Stage build output
    - task: PublishPipelineArtifact@1
      displayName: Publish the staged directory
  - job: verify
    steps:
    - checkout: none
    - download: current
    - script: echo three
      displayName: Confirm it
`;

const AUTHORED = authoredJobs(FIXTURE_YAML);

function record(over: Partial<TimelineRecord> & { type: string; name: string }): TimelineRecord {
  return { ...over };
}

describe('authoredJobs', () => {
  it('keeps the unnamed steps as holes rather than dropping them', () => {
    // The two unnamed steps are exactly the pair that cannot be name-matched across sides, which
    // is why the comparison key is positional. Collapsing them here would hide that.
    expect(AUTHORED).toEqual([
      { job: 'compile', stepNames: ['Stage build output', 'Publish the staged directory'] },
      { job: 'verify', stepNames: [undefined, undefined, 'Confirm it'] },
    ]);
  });
});

describe('partitionServiceSteps', () => {
  const timeline: TimelineRecord[] = [
    record({ type: 'Job', id: 'j1', identifier: 'compile.build', name: 'compile' }),
    record({ type: 'Job', id: 'j2', identifier: 'verify.build', name: 'verify' }),
    record({ type: 'Task', parentId: 'j1', name: 'Initialize job', order: 1, result: 'succeeded' }),
    record({
      type: 'Task',
      parentId: 'j1',
      name: 'Checkout oracle@main to s',
      order: 2,
      result: 'succeeded',
    }),
    record({
      type: 'Task',
      parentId: 'j1',
      name: 'Stage build output',
      order: 3,
      result: 'succeeded',
    }),
    record({
      type: 'Task',
      parentId: 'j1',
      name: 'Publish the staged directory',
      order: 4,
      result: 'succeeded',
    }),
    record({
      type: 'Task',
      parentId: 'j1',
      name: 'Post-job: Checkout oracle@main to s',
      order: 5,
      result: 'succeeded',
    }),
    record({ type: 'Task', parentId: 'j1', name: 'Finalize Job', order: 6, result: 'succeeded' }),
    record({ type: 'Task', parentId: 'j2', name: 'Checkout', order: 1, result: 'skipped' }),
    record({
      type: 'Task',
      parentId: 'j2',
      name: 'Download Pipeline Artifact',
      order: 2,
      result: 'succeeded',
    }),
    record({ type: 'Task', parentId: 'j2', name: 'Confirm it', order: 3, result: 'succeeded' }),
  ];

  it('drops the agent-internal records and assigns ordinals to what is left', () => {
    const { steps, dropped, unexpected } = partitionServiceSteps(timeline, AUTHORED);
    expect(unexpected).toEqual([]);
    // Ordinals are assigned *after* the drop, so they line up with the authored list.
    expect(steps).toEqual([
      { job: 'compile', ordinal: 0, displayName: 'Stage build output', result: 'succeeded' },
      {
        job: 'compile',
        ordinal: 1,
        displayName: 'Publish the staged directory',
        result: 'succeeded',
      },
      { job: 'verify', ordinal: 0, displayName: 'Checkout', result: 'skipped' },
      { job: 'verify', ordinal: 1, displayName: 'Download Pipeline Artifact', result: 'succeeded' },
      { job: 'verify', ordinal: 2, displayName: 'Confirm it', result: 'succeeded' },
    ]);
    expect(dropped).toEqual([
      'Initialize job',
      'Checkout oracle@main to s',
      'Post-job: Checkout oracle@main to s',
      'Finalize Job',
    ]);
  });

  it('keeps `Checkout` and `Download Pipeline Artifact`, which are authored here (C-E12-058)', () => {
    // Both read as agent-internal and both are authored in this fixture: `verify` declares
    // `checkout: none` and `download: current`, neither with a displayName. Listing them as
    // internal deleted two real steps and shifted every later ordinal in the job, and the harness
    // then reported a tidy comparison over the wrong rows.
    const verify = partitionServiceSteps(timeline, AUTHORED).steps.filter(
      (s) => s.job === 'verify',
    );
    expect(verify.map((s) => s.displayName)).toEqual([
      'Checkout',
      'Download Pipeline Artifact',
      'Confirm it',
    ]);
    // The authored list has three entries for this job; the comparison is only meaningful if the
    // kept count matches it.
    expect(verify).toHaveLength(AUTHORED.find((j) => j.job === 'verify')!.stepNames.length);
  });

  it('reports an unrecognized record instead of dropping it — the whole point of the filter', () => {
    // A loose "drop what we do not recognize" rule would swallow this and report parity over the
    // rows that happened to survive. This is the assertion that keeps the comparator honest.
    const withStranger = [
      ...timeline,
      record({ type: 'Task', parentId: 'j1', name: 'Some new agent phase', order: 7 }),
    ];
    const { unexpected, steps } = partitionServiceSteps(withStranger, AUTHORED);
    expect(unexpected).toEqual(['Some new agent phase (in job compile)']);
    // And it is not quietly counted as a step either.
    expect(steps.filter((s) => s.displayName === 'Some new agent phase')).toEqual([]);
  });

  it('does not attribute a Task whose parent is not one of the fixture jobs', () => {
    const orphan = [
      ...timeline,
      record({ type: 'Job', id: 'j9', identifier: 'other.build', name: 'other' }),
      record({ type: 'Task', parentId: 'j9', name: 'Stage build output', order: 1 }),
    ];
    expect(partitionServiceSteps(orphan, AUTHORED).unexpected).toEqual([
      'Stage build output (parent is not a fixture job)',
    ]);
  });
});

describe('isCheckoutRecord', () => {
  it('matches the agent spelling and its post-job twin', () => {
    expect(isCheckoutRecord('Checkout oracle@main to s')).toBe(true);
    expect(isCheckoutRecord('Post-job: Checkout oracle@refs/heads/main to s')).toBe(true);
  });

  it('is anchored, so it cannot swallow an authored step that merely mentions checkout', () => {
    expect(isCheckoutRecord('Checkout the release notes before publishing')).toBe(false);
    expect(isCheckoutRecord('Confirm it')).toBe(false);
  });
});

describe('markersIn', () => {
  it('strips the service timestamp prefix so both sides yield the same set', () => {
    const service = '2026-09-21T10:00:00.0000000Z E2E-MARKER staged build.txt\nnoise\n';
    const local = 'E2E-MARKER staged build.txt\n';
    expect(markersIn(service)).toEqual(markersIn(local));
  });

  it('deduplicates and sorts, because the comparison is a set', () => {
    expect(markersIn('E2E-MARKER b\nE2E-MARKER a\nE2E-MARKER b\n')).toEqual([
      'E2E-MARKER a',
      'E2E-MARKER b',
    ]);
  });
});

describe('stripArtifactPrefix', () => {
  it('removes the archive wrapper directory', () => {
    expect(stripArtifactPrefix([{ path: 'drop/build.txt', sha256: 'aa' }], 'drop')).toEqual([
      { path: 'build.txt', sha256: 'aa' },
    ]);
  });

  it('leaves paths alone when the prefix is not on every entry', () => {
    // Measured, not assumed: if the service ever stops wrapping, the harness must not silently
    // eat the first path segment of every file.
    const mixed = [
      { path: 'drop/a.txt', sha256: 'aa' },
      { path: 'b.txt', sha256: 'bb' },
    ];
    expect(stripArtifactPrefix(mixed, 'drop')).toEqual(mixed);
  });
});

describe('compareFacts', () => {
  const base: RunFacts = {
    steps: [{ job: 'compile', ordinal: 0, displayName: 'Stage build output', result: 'Succeeded' }],
    markers: ['E2E-MARKER a'],
    artifacts: [{ path: 'build.txt', sha256: 'aa' }],
    skippedJobs: [],
  };

  it('reports parity when every fact matches, case-insensitively on results', () => {
    // The service says `succeeded`, the local runtime says `Succeeded`; the vocabularies differ in
    // case only and folding that is not a leniency, it is the same value.
    const service: RunFacts = {
      ...base,
      steps: [{ ...base.steps[0]!, result: 'succeeded' }],
    };
    const comparison = compareFacts(service, base);
    expect(comparison.parity).toBe(true);
    // 1 step + 1 marker + 1 artifact + the jobs-that-did-not-run row, which is always compared.
    expect(comparison.compared).toBe(4);
  });

  it('catches a differing step result, a missing marker and a differing artifact hash', () => {
    const service: RunFacts = {
      steps: [{ job: 'compile', ordinal: 0, displayName: 'Stage build output', result: 'failed' }],
      markers: ['E2E-MARKER a', 'E2E-MARKER only-on-service'],
      artifacts: [{ path: 'build.txt', sha256: 'zz' }],
      skippedJobs: [],
    };
    const { parity, differences } = compareFacts(service, base);
    expect(parity).toBe(false);
    expect(differences.map((d) => d.fact)).toEqual([
      'step compile[0] result',
      'marker "E2E-MARKER only-on-service"',
      'artifact build.txt',
    ]);
  });

  it('catches a step present on one side only, rather than comparing the shorter list', () => {
    const service: RunFacts = {
      ...base,
      steps: [
        ...base.steps,
        { job: 'compile', ordinal: 1, displayName: 'Publish', result: 'succeeded' },
      ],
    };
    const { parity, differences } = compareFacts(service, base);
    expect(parity).toBe(false);
    expect(differences[0]).toEqual({
      fact: 'step compile[1] present',
      service: 'Publish',
      local: '(absent)',
    });
  });
});

describe('the negative — the half a present-keyed comparison cannot make', () => {
  const base: RunFacts = {
    steps: [{ job: 'compile', ordinal: 0, displayName: 'Stage', result: 'Succeeded' }],
    markers: ['E2E-MARKER a'],
    artifacts: [],
    skippedJobs: ['must_not_run'],
  };

  it('compares which jobs did not run, rather than letting both sides be silently empty', () => {
    // If the service ran a job the local side skipped, neither contributes a *step* difference in
    // the direction that matters — the service's extra steps would show, but a local-only skip
    // would not. This row states the fact on both sides.
    const service: RunFacts = { ...base, skippedJobs: [] };
    const { parity, differences } = compareFacts(service, base);
    expect(parity).toBe(false);
    expect(differences).toContainEqual({
      fact: 'jobs that did not run',
      service: '(none)',
      local: 'must_not_run',
    });
  });

  it('counts a forbidden marker as a compared fact even when both sides are clean', () => {
    // The whole point: "absent on both" must be a *measurement* with a row, not silence. Without
    // this the fixture's negative contributes nothing and parity is claimed over 12 facts while
    // 13 were promised.
    const clean = compareFacts(base, base, ['E2E-MARKER must not appear']);
    expect(clean.parity).toBe(true);
    expect(clean.compared).toBe(compareFacts(base, base).compared + 1);
  });

  it('fails when the forbidden marker appears on either side', () => {
    const leaked: RunFacts = { ...base, markers: [...base.markers, 'E2E-MARKER must not appear'] };
    const { parity, differences } = compareFacts(leaked, base, ['E2E-MARKER must not appear']);
    expect(parity).toBe(false);
    expect(differences[0]).toEqual({
      fact: 'forbidden marker "E2E-MARKER must not appear" must not appear',
      service: '**present**',
      local: 'absent',
    });
  });
});

describe('serviceRunFromCapture and renderReport', () => {
  // Driven by the committed capture, so these cover the `--from-capture` path a reader would use
  // to re-analyse run 553 without credentials or agent minutes.
  const capture = JSON.parse(
    readFileSync(path.join('research', 'experiments', 'E11-realrun', 'capture.json'), 'utf8'),
  ) as Capture;
  const authored = authoredJobs(readFileSync(FIXTURE, 'utf8'));

  it('rebuilds the service facts from the committed capture with nothing unexpected', () => {
    const run = serviceRunFromCapture(capture, authored);
    expect(run.partition.unexpected).toEqual([]);
    expect(run.result).toBe('succeeded');
    // The exact set, not a count: `AGENT_INTERNAL_STEPS` *claims* these five names, and a
    // `toBeGreaterThan(0)` would still pass if four of them silently stopped matching — which is
    // the failure mode that turns this harness's report into fiction. The capture is the anchor.
    expect(run.partition.dropped).toEqual([
      'Finalize Job',
      'Checkout oracle@main to s',
      'Initialize job',
      'Post-job: Checkout oracle@main to s',
      'Finalize Job',
      'Post-job: Checkout',
      'Initialize job',
    ]);
    expect(run.facts.skippedJobs).toEqual(['must_not_run']);
  });

  it('renders the structure a reader needs: what was dropped, and the negative named on both sides', () => {
    // **Not a parity assertion.** `local` is the service facts compared against themselves, so a
    // PARITY verdict here is structurally guaranteed and would prove nothing — the real verdict
    // lives in the committed `report.md`. What this pins is that the renderer *states* the things
    // a reader has to see: the dropped set, and a negative that names both sides rather than
    // going silent.
    const run = serviceRunFromCapture(capture, authored);
    const local: RunFacts = { ...run.facts };
    const report = renderReport(run, local, compareFacts(run.facts, local, []), [
      'E2E-MARKER must not appear',
    ]);
    expect(report).toContain('## Timeline records the comparator dropped');
    expect(report).toContain('Jobs that did not run — service: `must_not_run`');
    expect(report).toContain('Forbidden marker `E2E-MARKER must not appear`');
  });
});
