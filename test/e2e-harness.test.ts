// E11-S04-T01 — the L5 harness's own logic.
//
// The container runs are the tier itself and are exercised by `pnpm test:e2e`; what this file
// covers is everything around them, hermetically: the expectations file matches the samples on
// disk, the assertions actually fail when they should, and the container script does the things
// the tier depends on.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildImages,
  checkSample,
  containerScript,
  imageTag,
  parseExitCode,
  readExpectations,
  renderResults,
  type Exec,
  type SampleExpectation,
} from '../scripts/e2e.ts';

const repoRoot = process.cwd();
const expectations = readExpectations(repoRoot);

describe('the expectations file and the samples on disk agree', () => {
  it('every sample directory has an entry, and every entry a directory', () => {
    // The failure this prevents is silent: a sample nobody pinned would be *skipped*, and the
    // suite would stay green while testing less than it claims.
    const onDisk = readdirSync(join(repoRoot, 'fixtures', 'e2e'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(Object.keys(expectations).sort()).toEqual(onDisk);
  });

  it('every sample is a pipeline, and names an image that exists', () => {
    for (const [name, expectation] of Object.entries(expectations)) {
      expect(existsSync(join(repoRoot, 'fixtures', 'e2e', name, 'azure-pipelines.yml'))).toBe(true);
      expect(existsSync(join(repoRoot, 'docker', 'e2e', `Dockerfile.${expectation.image}`))).toBe(
        true,
      );
    }
  });

  it('every sample is template-free, so the suite needs no credentials (C-E12-028)', () => {
    // `--offline-expand` and the service agree only while there is nothing to expand. A `${{ }}`
    // here would make the tier depend on a live PAT, and a lapsed one would turn it red for a
    // reason that has nothing to do with E2E.
    for (const name of Object.keys(expectations)) {
      // Comments are stripped first: each sample's header *explains* why it avoids `${{ }}`, and a
      // check that read the prose would fail on the very sentence documenting the rule.
      const body = readFileSync(
        join(repoRoot, 'fixtures', 'e2e', name, 'azure-pipelines.yml'),
        'utf8',
      )
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n');
      expect(body, name).not.toMatch(/\$\{\{/);
      expect(body, name).not.toMatch(/^\s*extends:/m);
    }
  });

  it('at least one sample pins a non-zero exit code (C-E12-029)', () => {
    // The whole reason this tier exists rather than reusing drift.ts Phase B, which records exit
    // codes instead of pinning them because a hosted runner's toolset decides them (decision 75).
    expect(Object.values(expectations).some((e) => e.exitCode !== 0)).toBe(true);
  });

  it('at least one sample asserts a marker must be *absent*', () => {
    // A suite that only looks for markers cannot tell a working condition from one always true.
    expect(Object.values(expectations).some((e) => e.absentMarkers.length > 0)).toBe(true);
  });
});

describe('the assertions fail when they should', () => {
  const expectation: SampleExpectation = {
    image: 'base',
    exitCode: 0,
    artifacts: ['workspace/a/app/build.txt'],
    markers: ['MARK-present'],
    absentMarkers: ['MARK-absent'],
  };
  const goodLog = 'MARK-present\nE2E-FILE workspace/a/app/build.txt\n';

  it('passes a run that did everything', () => {
    expect(checkSample(expectation, goodLog, 0)).toEqual([]);
  });

  it('catches a wrong exit code', () => {
    expect(checkSample(expectation, goodLog, 1)).toContain('exit code 1, expected 0');
  });

  it('catches a missing marker', () => {
    expect(checkSample(expectation, 'E2E-FILE workspace/a/app/build.txt', 0)).toContain(
      'missing log marker: MARK-present',
    );
  });

  it('catches a marker that must not be there', () => {
    expect(checkSample(expectation, `${goodLog}MARK-absent\n`, 0)).toContain(
      'marker present but must not be: MARK-absent',
    );
  });

  it('a printed path is not a produced file', () => {
    // The artifact assertion matches the marked listing, not the raw log: a step that merely
    // *echoed* the path would otherwise satisfy an assertion about the file existing.
    const printed = 'MARK-present\nwriting workspace/a/app/build.txt now\n';
    expect(checkSample(expectation, printed, 0)).toContain(
      'artifact not found in the run tree: workspace/a/app/build.txt',
    );
  });

  it('reads the run.sh status back out of the container log', () => {
    expect(parseExitCode('noise\nE2E-EXIT 4\nmore')).toBe(4);
    // -1 rather than 0: a log with no marker means the run never reported, which must not read as
    // success.
    expect(parseExitCode('the container died early')).toBe(-1);
  });
});

describe('the container script', () => {
  const script = containerScript();

  it('follows the generated README’s own quick start', () => {
    // The first thing L5 should catch is a documented first step that does not work.
    expect(script).toContain('cp .env.example .env');
    expect(script).toContain('bash run.sh');
  });

  it('captures run.sh’s status instead of letting it end the script', () => {
    // Sample 03's pinned code is non-zero; without this nothing after it could be reported.
    expect(script).toContain('run_status=$?');
    expect(script).toContain('echo "E2E-EXIT $run_status"');
  });

  it('points the checkout at the mounted sample, not at the repository', () => {
    expect(script).toContain('export AZDO_SELF_REPO=/work/source');
  });

  it('copies the project before running it, because the mount is read-only', () => {
    // A run that could edit its own scripts could make itself pass.
    expect(script).toContain('cp -r /project /work/out');
  });
});

describe('image builds', () => {
  it('layers node on the base, so the two cannot disagree about the runtime’s needs', () => {
    const calls: string[][] = [];
    const exec: Exec = (_command, args) => {
      calls.push([...args]);
      return { status: 0, stdout: '', stderr: '' };
    };
    expect(buildImages('.', exec)).toEqual([]);
    expect(calls[1]).toContain(`BASE=${imageTag('base')}`);
  });

  it('stops after a failed base, because the node image is FROM it', () => {
    const calls: string[][] = [];
    const exec: Exec = (_command, args) => {
      calls.push([...args]);
      return { status: 1, stdout: '', stderr: 'boom' };
    };
    const problems = buildImages('.', exec);
    expect(problems).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('the report', () => {
  it('shows the cause, not the file listing, when a sample fails', () => {
    const rendered = renderResults([
      {
        sample: 'x',
        status: 'failed',
        problems: ['exit code 2, expected 0'],
        exitCode: 2,
        log: `${'E2E-FILE noise\n'.repeat(40)}the actual cause\n`,
      },
    ]);
    expect(rendered).toContain('the actual cause');
    expect(rendered).not.toContain('E2E-FILE noise');
  });

  it('says nothing extra for a sample that passed', () => {
    const rendered = renderResults([
      { sample: 'x', status: 'ok', problems: [], exitCode: 0, log: 'anything' },
    ]);
    expect(rendered.trim()).toBe('ok   x (exit 0)');
  });
});
