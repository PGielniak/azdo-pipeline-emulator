/**
 * E11-S03-T01 — the nightly drift detector, driven offline.
 *
 * The Done criterion is "simulated drift (hand-edited fixture) alerts correctly". It is proved
 * here rather than by editing a committed fixture and running live: `preview()` takes its `fetch`
 * as a parameter, so a mutated `finalYaml` can be handed to the real comparator without touching
 * the corpus, without the org, and where every reviewer's CI run sees it.
 *
 * What each test guards:
 *  * a one-byte change in the service's answer must be reported, naming the entry;
 *  * an unchanged answer must **not** be reported — a detector that always alerts is worse than
 *    none, because the first real drift arrives as one more line in a list nobody reads;
 *  * redaction happens *before* the comparison, or every entry naming the organization drifts on
 *    every run (the trap `scripts/corpus-oracle.ts`'s header calls out);
 *  * nothing the harness writes carries the organization name or the PAT — the report is uploaded
 *    as a CI artifact.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  checkEntry,
  checkExpansions,
  diffExcerpt,
  isFailure,
  renderReport,
  smokeConvert,
  type DriftReport,
} from '../scripts/drift.ts';
import { oraclePairPath, readCorpus } from '../scripts/corpus.ts';
import type { OracleConfig } from '../packages/fetch/src/oracle.ts';

const ORG = 'contoso-real-org';
const PAT = 'pat-value-that-must-never-be-written';

const config: OracleConfig = {
  orgUrl: `https://dev.azure.com/${ORG}`,
  project: 'oracle',
  pipelineId: 19,
  pat: PAT,
  apiVersion: '7.1',
};

const corpus = await readCorpus('.');
const entry = corpus[0]!;
const committed = readFileSync(oraclePairPath(entry.name), 'utf8');

/** A `fetch` that answers every preview with `finalYaml`, the way the live service does. */
const serving = (finalYaml: string) =>
  (async () =>
    new Response(JSON.stringify({ finalYaml }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as Parameters<typeof checkEntry>[3];

describe('the detector reports drift', () => {
  it('alerts on a one-byte change, naming the entry', async () => {
    // The smallest change the service could make. A detector that needs a big one is not a
    // detector.
    const mutated = `${committed}# the service added a line\n`;
    const check = await checkEntry(config, entry, committed, serving(mutated));
    expect(check.status).toBe('drifted');
    expect(check.entry).toBe(entry.name);
    expect(check.diff).toContain('# the service added a line');
  });

  it('alerts on a change in the middle, not only at the end', async () => {
    const lines = committed.split('\n');
    const target = lines.findIndex((line) => line.includes('steps:'));
    expect(target).toBeGreaterThan(-1);
    lines[target] = `${lines[target]!} # reformatted`;
    const check = await checkEntry(config, entry, committed, serving(lines.join('\n')));
    expect(check.status).toBe('drifted');
    expect(check.diff).toContain('# reformatted');
  });

  it('reports a refusal separately from a drift', async () => {
    // A 500 on an unknown pipeline id (C-E00-024) is an operational problem, not a service change,
    // and conflating the two would send the reader to the drift runbook for a broken PAT.
    const refusing = (async () =>
      new Response(
        JSON.stringify({ message: `no pipeline in ${ORG}`, typeKey: 'PipelineNotFound' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      )) as unknown as Parameters<typeof checkEntry>[3];
    const check = await checkEntry(config, entry, committed, refusing);
    expect(check.status).toBe('rejected');
    expect(check.diff).toBe('');
    expect(check.message).not.toContain(ORG);
  });
});

describe('the detector stays quiet when nothing moved', () => {
  it('reports every corpus entry stable when the service answers what is committed', async () => {
    // The whole corpus, so a detector that alerts on one entry's formatting is caught here rather
    // than at 02:30 on the first scheduled run.
    const answers = new Map(
      corpus.map((item) => [item.rootYaml, readFileSync(oraclePairPath(item.name), 'utf8')]),
    );
    const replaying = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { yamlOverride: string };
      return new Response(JSON.stringify({ finalYaml: answers.get(body.yamlOverride) }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as Parameters<typeof checkEntry>[3];

    const checks = await checkExpansions(config, '.', replaying);
    expect(checks).toHaveLength(corpus.length);
    expect(checks.filter((check) => check.status !== 'stable')).toEqual([]);
  });

  it('is not fooled into passing by an empty answer', async () => {
    const check = await checkEntry(config, entry, committed, serving(''));
    expect(check.status).toBe('drifted');
  });
});

describe('redaction happens before the comparison, not after', () => {
  it('does not report drift when the fresh answer names the organization', async () => {
    // The committed pairs were redacted on the way in (`corpus-oracle.ts`), so the live response
    // carries the real organization where the pair carries `{org}`. Comparing raw would drift on
    // every entry that mentions it, forever — and the first real drift would arrive as noise.
    const withOrg = committed.split('{org}').join(ORG);
    const check = await checkEntry(config, entry, committed, serving(withOrg));
    expect(check.status).toBe('stable');
  });

  it('reports drift that is not just the organization name', async () => {
    const withOrgAndDrift = `${committed.split('{org}').join(ORG)}# real change\n`;
    const check = await checkEntry(config, entry, committed, serving(withOrgAndDrift));
    expect(check.status).toBe('drifted');
    expect(check.diff).toContain('# real change');
    expect(check.diff).not.toContain(ORG);
  });
});

describe('nothing the harness writes carries a secret (CLAUDE.md rule 4)', () => {
  it('keeps the organization and the PAT out of a drift diff', async () => {
    const leaky = `${committed}# ${ORG} said ${PAT}\n`;
    const check = await checkEntry(config, entry, committed, serving(leaky));
    expect(check.status).toBe('drifted');
    expect(check.diff).not.toContain(ORG);
    expect(check.diff).not.toContain(PAT);
    expect(check.diff).toContain('{org}');
    expect(check.diff).toContain('{pat}');
  });

  it('keeps them out of a smoke log', async () => {
    // The report is uploaded as a CI artifact; a task that echoes its endpoint URL must not put
    // the organization in it.
    const results = await smokeConvert(config, '.', () => ({
      step: 'run',
      status: 3,
      output: `connecting to https://dev.azure.com/${ORG} with ${PAT}\n`,
    }));
    const failed = results.find((result) => result.status === 'run-failed');
    expect(failed?.log).not.toContain(ORG);
    expect(failed?.log).not.toContain(PAT);
    expect(failed?.log).toContain('{org}');
  });

  it('keeps them out of the rendered report', () => {
    const report: DriftReport = {
      checkedAt: '2026-09-02T00:00:00.000Z',
      expansions: [{ entry: 'x', status: 'drifted', diff: '- a\n+ b' }],
      smoke: [{ entry: 'x', status: 'run-failed', log: 'boom' }],
    };
    const text = renderReport(report);
    expect(text).toContain('x');
    expect(text).not.toContain(ORG);
    expect(text).not.toContain(PAT);
  });
});

describe('what fails the job', () => {
  const base: DriftReport = { checkedAt: 'now', expansions: [], smoke: [] };

  it('fails on drift', () => {
    expect(isFailure({ ...base, expansions: [{ entry: 'x', status: 'drifted', diff: 'd' }] })).toBe(
      true,
    );
  });

  it('fails on a refusal, because an unanswerable question is not evidence of stability', () => {
    expect(
      isFailure({
        ...base,
        expansions: [{ entry: 'x', status: 'rejected', diff: '', message: 'm' }],
      }),
    ).toBe(true);
  });

  it('fails when convert refuses a document the service accepted', () => {
    expect(
      isFailure({ ...base, smoke: [{ entry: 'x', status: 'convert-failed', log: 'l' }] }),
    ).toBe(true);
  });

  it('fails when the smoke ran and nothing came out clean', () => {
    // One `run-failed` is a missing tool; all of them is the runtime not working at all, and the
    // plain script fixtures need nothing beyond bash.
    expect(
      isFailure({
        ...base,
        smoke: [
          { entry: 'x', status: 'run-failed', log: 'l' },
          { entry: 'y', status: 'run-failed', log: 'l' },
        ],
      }),
    ).toBe(true);
  });

  it('does not fail when the smoke was skipped entirely (--expansion)', () => {
    expect(isFailure({ ...base, expansions: [{ entry: 'x', status: 'stable', diff: '' }] })).toBe(
      false,
    );
  });

  it('does not fail on a non-zero run', () => {
    // A GitHub runner has no `helm`, `kubectl` or `pwsh`, so a corpus entry driving those exits
    // non-zero for a reason that is not drift. Pinning per-entry exit codes would encode the
    // runner's toolset (docs/06 §5 decision 75); the outcome is recorded in the report instead.
    expect(
      isFailure({
        ...base,
        smoke: [
          { entry: 'x', status: 'run-failed', log: 'l' },
          { entry: 'y', status: 'ok', log: '' },
        ],
      }),
    ).toBe(false);
  });

  it('passes when everything is stable', () => {
    expect(
      isFailure({
        ...base,
        expansions: [{ entry: 'x', status: 'stable', diff: '' }],
        smoke: [{ entry: 'x', status: 'ok', log: '' }],
      }),
    ).toBe(false);
  });
});

describe('the diff excerpt', () => {
  it('elides the common prefix and shows both sides of the change', () => {
    const excerpt = diffExcerpt('a\nb\nc\nd\n', 'a\nb\nX\nd\n');
    expect(excerpt).toContain('- c');
    expect(excerpt).toContain('+ X');
    expect(excerpt).toContain('  b');
    expect(excerpt).not.toContain('- a');
  });

  it('caps a wholesale rewrite so the report stays readable', () => {
    const big = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const excerpt = diffExcerpt('one line', big, 3, 10);
    expect(excerpt.split('\n').filter((line) => line.startsWith('+ '))).toHaveLength(10);
  });

  it('says where the documents first differ', () => {
    expect(diffExcerpt('a\nb\n', 'a\nc\n')).toContain('@@ committed -2 / fresh +2 @@');
  });
});
