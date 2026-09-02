/**
 * E11-S03-T02 — the drift triage runbook, and the fixture its exercise produced.
 *
 * A runbook is prose, so most of it cannot be tested. Three things about it can, and each is
 * something whose silent loss would make the document actively misleading rather than merely
 * stale:
 *
 *  * the sources it tells a reader to check are the *pinned* ones (C-E12-025/026), because the
 *    obvious URL is the roadmap and following it instead of the sprint pages produces a confident
 *    wrong verdict;
 *  * it still states that absence from the release notes does **not** refute a service-change
 *    verdict (C-E12-027) — the one sentence that stops a real drift being closed as "not
 *    announced";
 *  * the fixture the exercise filed still pins what it says it pins.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { oraclePairPath, readCorpus, readManifest, sha256 } from '../scripts/corpus.ts';

const runbook = readFileSync('research/drift-runbook.md', 'utf8');

describe('the runbook cites the sources it was grounded on', () => {
  it('sends the reader to the sprint series, not only to the roadmap URL (C-E12-025/026)', () => {
    expect(runbook).toContain('release-notes/features-timeline');
    expect(runbook).toContain('sprint-<N>-update');
    // The distinction is the whole point of that section: a plan is not a shipped change.
    expect(runbook).toMatch(/roadmap/i);
    expect(runbook).toContain('aka.ms/azuredevops/releasenotes');
  });

  it('pins both pages by commit so a reader can see what was actually read (C-E12-026)', () => {
    expect(runbook).toContain('467f8d6362cdfc5348b4a2e2846fbfeb4ba66f48');
    expect(runbook).toContain('598e4fec55f6de2a552fe94d6743888a6fdb16fd');
  });

  it('keeps the rule that silence in the release notes refutes nothing (C-E12-027)', () => {
    // Losing this sentence is how a real, unannounced service change gets closed as a non-event.
    expect(runbook).toMatch(/does not refute/i);
    expect(runbook).toMatch(/unannounced/i);
  });

  it('names the 302-not-401 trap before any drift reasoning (C-E00-025)', () => {
    // Ten `rejected` entries is an expired PAT far more often than it is a service change.
    expect(runbook).toContain('302');
    expect(runbook).toContain('oracle-setup.md');
    expect(runbook.indexOf('302')).toBeLessThan(runbook.indexOf('## 2. Classify'));
  });

  it('puts the fixture step before the re-fetch, which is the rule that makes it work', () => {
    expect(runbook.indexOf('## 4. Fixture-first')).toBeLessThan(runbook.indexOf('## 5. Claim'));
    expect(runbook).toMatch(/Only now\*{0,2} re-fetch/i);
  });

  it('is reachable from the failure it explains', () => {
    // `scripts/drift.ts` prints this path when the job fails; a runbook nobody is sent to is a
    // document, not a runbook.
    expect(readFileSync('scripts/drift.ts', 'utf8')).toContain('research/drift-runbook.md');
  });
});

describe('the fixture the exercise filed (C-E04-002)', () => {
  const name = '11-implicit-wrapping';

  it('exists with its oracle pair, as the corpus rule requires', async () => {
    const corpus = await readCorpus('.');
    const entry = corpus.find((item) => item.name === name);
    expect(entry, 'the exercise files a permanent fixture, not a scratch one').toBeDefined();
    expect(existsSync(oraclePairPath(name))).toBe(true);

    const manifest = await readManifest('.');
    const row = manifest.entries[name];
    expect(row?.inputSha256).toBe(entry!.inputSha256);
    expect(row?.finalYamlSha256).toBe(sha256(readFileSync(oraclePairPath(name), 'utf8')));
  });

  it('submits a document with no stage and no job, or it pins nothing', async () => {
    const entry = (await readCorpus('.')).find((item) => item.name === name)!;
    expect(entry.rootYaml).toMatch(/^steps:/m);
    expect(entry.rootYaml).not.toMatch(/^stages:/m);
    expect(entry.rootYaml).not.toMatch(/^jobs:/m);
  });

  it('pins all three facts C-E04-002 asserts', () => {
    // The synthesized stage name, the synthesized job name, and `script:` desugaring to a task.
    const pair = readFileSync(oraclePairPath(name), 'utf8');
    expect(pair).toContain('stage: __default');
    expect(pair).toContain('job: Job');
    expect(pair).toContain('task: CmdLine@2');
  });

  it('stays the narrowest entry in the corpus, so its diff stays readable', async () => {
    // The value of the fixture is that a future drift here is a handful of lines. An entry that
    // grew extra steps would lose exactly that.
    const corpus = await readCorpus('.');
    const pair = readFileSync(oraclePairPath(name), 'utf8');
    expect(pair.split('\n').length).toBeLessThan(20);
    for (const other of corpus) {
      if (other.name === name) continue;
      expect(
        readFileSync(oraclePairPath(other.name), 'utf8').length,
        `${other.name} is not longer than the narrow fixture`,
      ).toBeGreaterThan(pair.length);
    }
  });

  it('records the gap it deliberately left (C-E04-003)', () => {
    // One drift produces one fixture; the `jobs:`-rooted variant is still transcript-only and the
    // README says so rather than implying coverage the corpus does not have.
    const readme = readFileSync(`fixtures/corpus/${name}/README.md`, 'utf8');
    expect(readme).toContain('C-E04-003');
    expect(readme).toMatch(/transcript-only/i);
  });
});
