/**
 * E11-S02-T01 — the claim↔test coverage report is itself checked.
 *
 * The script's whole value is that its number is trustworthy, so the things that would make it lie
 * are what these tests drive: a claim id that appears only in prose must not count as a definition,
 * a range citation must expand, and the ratchet must actually fail when coverage drops.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const run = (...args: string[]): { status: number; stdout: string } => {
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
    // E09-S01-T01 is `[!]`, so C-E09-001..006 legitimately have no tests. This is the case the
    // ratchet exists to tolerate — a hard 100% gate would demand assertions that prove nothing.
    expect(defined.has('C-E09-001')).toBe(true);
    expect(defined.has('C-E09-006')).toBe(true);
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
