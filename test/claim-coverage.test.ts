/**
 * E11-S02-T01 — the claim↔test coverage report is itself checked.
 *
 * The script's whole value is that its number is trustworthy, so the things that would make it lie
 * are what these tests drive: a claim id that appears only in prose must not count as a definition,
 * a range citation must expand, and the ratchet must actually fail when coverage drops.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Each invocation greps all of `research/` and every test directory, so it is not cheap. The suite
 * asks the same three questions repeatedly, so results are memoized per argument list — without
 * this the file ran the scan ~a dozen times and the added CPU pushed a parallel end-to-end test in
 * `packages/emit` past its 5s timeout.
 */
const cache = new Map<string, { status: number; stdout: string }>();

const run = (...args: string[]): { status: number; stdout: string } => {
  const key = args.join(' ');
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const result = runUncached(...args);
  cache.set(key, result);
  return result;
};

/** The mutation probe changes the tree between calls, so it must bypass the memo. */
const runUncached = (...args: string[]): { status: number; stdout: string } => {
  try {
    return {
      status: 0,
      stdout: execFileSync('bash', ['scripts/claim-coverage.sh', ...args], { encoding: 'utf8' }),
    };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? 1,
      stdout: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
    };
  }
};

describe('the report', () => {
  it('counts claims and prints a per-epic breakdown', () => {
    const { status, stdout } = run();
    expect(status).toBe(0);
    expect(stdout).toMatch(/Claim↔test coverage: \d+\/\d+ claims referenced by a test \(\d+%\)/);
    expect(stdout).toContain('epic');
    // A whole epic at zero is the signal worth acting on, which is why the breakdown exists.
    expect(stdout).toMatch(/^E09\s+\d+\s+\d+$/m);
  });

  it('lists the unreferenced ids, one per line and nothing else', () => {
    const { stdout } = run('--list');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^C-E\d{2}-\d{3}$/);
  });
});

describe('what the count must not get wrong', () => {
  const defined = new Set(run('--list').stdout.trim().split('\n').filter(Boolean));

  it('does not report a claim that a test cites only through a range', () => {
    // A test citing `C-E02-020..023` covers all four. Counting only the endpoint would understate
    // coverage and push someone to add redundant citations to satisfy the report.
    for (const id of ['C-E02-020', 'C-E02-021', 'C-E02-022', 'C-E02-023']) {
      expect(defined.has(id), `${id} is cited by a range and should count as covered`).toBe(false);
    }
  });

  it('still reports a claim inside a cited range’s epic that nothing cites', () => {
    // The expansion must not be so eager that it marks a whole epic covered. C-E09-087 is a real
    // gap — the tests cite 085, 086, 088 and 089 individually and never that one — and C-E09-084
    // sits just below the block with no citation at all.
    expect(defined.has('C-E09-087')).toBe(true);
    expect(defined.has('C-E09-084')).toBe(true);
    // …while its neighbours, which tests do cite, are absent from the gap list.
    expect(defined.has('C-E09-085')).toBe(false);
    expect(defined.has('C-E09-088')).toBe(false);
  });

  it('reports the blocked device-code claims, which have no implementation yet', () => {
    // E09-S01-T01 is `[!]`, so C-E09-002..006 legitimately have no tests. This is the case the
    // ratchet exists to tolerate — a hard 100% gate would demand assertions that prove nothing.
    // C-E09-001 used to be in this list and no longer is: E09-S01-T02 (2026-09-03) pins the same
    // Azure DevOps resource GUID for the `az` arm and asserts it, so the claim gained a real test
    // while the device-code flow it was written for is still unbuilt.
    expect(defined.has('C-E09-003')).toBe(true);
    expect(defined.has('C-E09-006')).toBe(true);
    expect(defined.has('C-E09-001')).toBe(false);
  });

  it('counts a claim id mentioned inside another claim’s prose only once', () => {
    // Definitions are anchored to the start of a line; a cross-reference in a body is not a second
    // definition, or the denominator would inflate every time one claim cited another.
    const research = readFileSync('research/E09-auth-fetchers.md', 'utf8');
    const bodyMentions = (research.match(/C-E09-030/g) ?? []).length;
    const definitions = (research.match(/^\[C-E09-030\]/gm) ?? []).length;
    expect(bodyMentions).toBeGreaterThan(1);
    expect(definitions).toBe(1);
  });
});

describe('what the scan includes (E11-S03-T02)', () => {
  it('counts the repo-level meta-tests, which cite claims no package owns', () => {
    // The runbook tests cite C-E12-025..027 — claims about documentation pages, with no package
    // to live in. Before this they were invisible to the report and read as permanent gaps.
    const gaps = new Set(run('--list').stdout.trim().split('\n').filter(Boolean));
    for (const id of ['C-E12-025', 'C-E12-026', 'C-E12-027']) {
      expect(gaps.has(id), `${id} is cited by test/drift-runbook.test.ts`).toBe(false);
    }
  });

  it('excludes this file, so the report cannot certify itself', () => {
    // This test names uncovered claim ids as *data*. If the scan counted them, every id mentioned
    // here would become "covered" by being used as an example of not being covered.
    const script = readFileSync('scripts/claim-coverage.sh', 'utf8');
    expect(script).toContain('claim-coverage.test.ts');
    // The four ids asserted as gaps above are named in this file and must still be reported.
    const gaps = new Set(run('--list').stdout.trim().split('\n').filter(Boolean));
    for (const id of ['C-E09-003', 'C-E09-006', 'C-E09-084', 'C-E09-087']) {
      expect(gaps.has(id), `${id} must stay a gap despite being named here`).toBe(true);
    }
  });
});

describe('the ratchet', () => {
  it('passes at the recorded floor', () => {
    const { status, stdout } = run('--check');
    expect(status).toBe(0);
    expect(stdout).toContain('at or above the floor');
  });

  it('records a floor that is a plain number', () => {
    // A malformed floor would silently become 0 and the gate would stop gating.
    expect(readFileSync('.claim-coverage-floor', 'utf8').trim()).toMatch(/^\d+$/);
  });

  it('the floor is not above the current coverage, so CI is not born red', () => {
    const percent = Number(/\((\d+)%\)/.exec(run().stdout)?.[1] ?? '0');
    const floor = Number(readFileSync('.claim-coverage-floor', 'utf8').trim());
    expect(percent).toBeGreaterThanOrEqual(floor);
  });
});

describe('orphaned claim references are a gate, not a ratchet (E11-S04-T02)', () => {
  const PROBE = 'packages/runtime/test/__orphan_probe.bats';

  it('reports zero orphans on the current tree', () => {
    // The whole point: a test may cite a claim that does not exist, and until this direction was
    // measured two invented ids (C-E08-042/043) sat in `doctor-requirements.test.ts` looking
    // exactly like grounding. `C-E08-030…059` is an *unallocated* block, so they resolved to
    // nothing while satisfying `checkToolContract`'s citation check.
    expect(run('--orphans').stdout.trim()).toBe('');
  });

  it('--check fails on an orphan, with no floor to grandfather it', () => {
    writeFileSync(PROBE, '# orphan probe C-E99-999\n');
    try {
      const { status, stdout } = runUncached('--check');
      expect(status).toBe(1);
      expect(stdout).toContain('orphaned claim reference');
      expect(runUncached('--orphans').stdout).toContain('C-E99-999');
    } finally {
      rmSync(PROBE, { force: true });
    }
    // …and the tree is clean again once the probe is gone.
    expect(runUncached('--check').status).toBe(0);
  });

  it('grades the two directions differently, and says so', () => {
    // A gap is legitimate and numerous; an orphan never is. If these ever collapse into one rule,
    // either the ratchet becomes an impossible gate or the gate becomes a suggestion.
    const script = readFileSync('scripts/claim-coverage.sh', 'utf8');
    expect(script).toContain('--orphans');
    expect(run('--list').stdout.trim().length).toBeGreaterThan(0);
    expect(run('--orphans').stdout.trim().length).toBe(0);
  });

  it('the doctor contract checks a citation’s shape, which is why the repo checks existence', () => {
    // `checkToolContract` matches /C-E\d{2}-\d{3}/ — it cannot know whether the claim exists, and
    // has no business reading `research/`. The orphan gate is where that half is enforced.
    const requirements = readFileSync('packages/cli/src/doctor/requirements.ts', 'utf8');
    expect(requirements).toMatch(/C-E\\d\{2\}-\\d\{3\}/);
  });
});

describe('the runtime conformance suite is tagged and standalone (E11-S04-T02)', () => {
  it('tags every bats file as either conformance or harness', () => {
    const files = readdirSync('packages/runtime/test').filter((f) => f.endsWith('.bats'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const head = readFileSync(`packages/runtime/test/${file}`, 'utf8').slice(0, 600);
      expect(head, `${file} carries no bats file_tags`).toMatch(
        /# bats file_tags=(conformance|harness)/,
      );
    }
  });

  it('exposes standalone entry points that CI actually runs', () => {
    // `pnpm test:runtime` did not exist until this task, which is how the gap was found. A script
    // only contributors run is unverified; CI must invoke the shipped one (decision 75's lesson).
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['test:runtime']).toContain('bats');
    expect(pkg.scripts['test:conformance']).toContain('--filter-tags conformance');
    expect(pkg.scripts.test).toContain('test:runtime');

    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('pnpm test:runtime');
  });

  it('only the harness file is exempt from carrying claim ids', () => {
    // The `harness` tag is a narrow, named exemption — it must not spread to files that assert
    // real Azure DevOps behavior, or "every test carries its claim id" quietly stops meaning
    // anything. Exactly one file may hold it.
    const files = readdirSync('packages/runtime/test').filter((f) => f.endsWith('.bats'));
    const harness = files.filter((f) =>
      readFileSync(`packages/runtime/test/${f}`, 'utf8').includes('# bats file_tags=harness'),
    );
    expect(harness).toEqual(['fixture-store.bats']);
  });
});
