// E03-S05-T01 — normalizer.
//
// Two kinds of test here. The rule table is unit-level and each case names the claim it encodes.
// The idempotence and equivalence suites run over the **real corpus pairs** (E12-S01-T02), which
// is what the Done criterion asks for: a normalizer that is stable on the service's own output.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  canonicalText,
  normalizeExpandedYaml,
  RULES,
  TASK_GUID_NAMES,
} from '../../src/normalize/normalize.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const oracleDir = join(repoRoot, 'fixtures', 'oracle');
const goldens = readdirSync(oracleDir)
  .filter((f) => f.endsWith('.final.yml'))
  .sort()
  .map((f) => [f, readFileSync(join(oracleDir, f), 'utf8')] as const);

const norm = (yaml: string) => normalizeExpandedYaml(yaml).text;

describe('rule table', () => {
  it('gives every rule a claim (BACKLOG §3: no rule without evidence)', () => {
    for (const rule of RULES) expect(rule.claim, rule.id).toMatch(/^C-E\d{2}-\d{3}$/);
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
  });

  it('[N1] folds `trigger: none` into the `{enabled: false}` form the service emits (C-E03-002)', () => {
    expect(norm('trigger: none\npr: none\nsteps: []\n')).toBe(
      norm('trigger:\n  enabled: false\npr:\n  enabled: false\nsteps: []\n'),
    );
    expect(normalizeExpandedYaml('trigger: none\n').applied).toContain('N1');
  });

  it('[N1] folds the two spellings at the `value` level too, not only in the text', () => {
    // `value` is what E03-S05-T02 diffs on, so text-level agreement alone is not enough.
    expect(normalizeExpandedYaml('trigger: none\n').value).toEqual(
      normalizeExpandedYaml('trigger:\n  enabled: false\n').value,
    );
  });

  it('[N1] leaves a real trigger configuration alone', () => {
    const real = 'trigger:\n  branches:\n    include:\n    - main\n';
    expect(normalizeExpandedYaml(real).applied).not.toContain('N1');
    expect(norm(real)).toContain('include');
  });

  it('[N2] folds mapping-form variables into the list form (C-E12-021)', () => {
    expect(norm('variables:\n  a: one\n  b: two\n')).toBe(
      norm('variables:\n- name: a\n  value: one\n- name: b\n  value: two\n'),
    );
  });

  it('[N2] keeps list-form extras such as `readonly` (C-E12-023)', () => {
    expect(norm('variables:\n- name: a\n  value: one\n  readonly: true\n')).toContain('readonly');
  });

  it('[N3] folds a scalar dependsOn into a one-element list (C-E12-021)', () => {
    expect(norm('jobs:\n- job: b\n  dependsOn: a\n')).toBe(
      norm('jobs:\n- job: b\n  dependsOn:\n  - a\n'),
    );
  });

  it('[N4] folds a scalar environment into `{name}` (C-E12-017)', () => {
    expect(norm('jobs:\n- deployment: d\n  environment: staging\n')).toBe(
      norm('jobs:\n- deployment: d\n  environment:\n    name: staging\n'),
    );
  });

  it('[N5] folds scalar container and services entries into `{alias}` (C-E03-003)', () => {
    expect(norm('jobs:\n- job: a\n  container: builder\n')).toBe(
      norm('jobs:\n- job: a\n  container:\n    alias: builder\n'),
    );
    expect(norm('jobs:\n- job: a\n  services:\n    redis: builder\n')).toBe(
      norm('jobs:\n- job: a\n  services:\n    redis:\n      alias: builder\n'),
    );
  });

  it('[N6] unifies the one grounded GUID/name pair (C-E12-019)', () => {
    expect(norm('steps:\n- task: ecdc45f6-832d-4ad9-b52b-ee49e94659be@1\n')).toBe(
      norm('steps:\n- task: PublishPipelineArtifact@1\n'),
    );
  });

  it('[N6] does not invent names for the agent-internal GUIDs (C-E12-019)', () => {
    // checkout / download are 404 in the task catalogue: no name spelling exists to unify with,
    // so the GUID must survive normalization untouched.
    for (const guid of [
      '6d15af64-176c-496d-b583-fd2ae21d4df4',
      '30f35852-3f7e-4c0c-9a88-e127b4f97211',
    ]) {
      expect(TASK_GUID_NAMES[guid]).toBeUndefined();
      expect(norm(`steps:\n- task: ${guid}@1\n`)).toContain(guid);
    }
  });

  it('[N6] keeps `download:`’s task distinct from DownloadPipelineArtifact@2', () => {
    expect(norm('steps:\n- task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1\n')).not.toBe(
      norm('steps:\n- task: DownloadPipelineArtifact@2\n'),
    );
  });

  it('[N7] compares scalar leaves as strings (C-E01-020)', () => {
    expect(norm('steps:\n- checkout: self\n  fetchDepth: 1\n  clean: true\n')).toBe(
      norm("steps:\n- checkout: self\n  fetchDepth: '1'\n  clean: 'true'\n"),
    );
  });

  it('[N8] erases key order, quoting and comments', () => {
    expect(norm("# a comment\njobs:\n- steps: []\n  job: 'a'\n")).toBe(
      norm('jobs:\n- job: a\n  steps: []\n'),
    );
  });

  it('[N8] preserves sequence order, which is semantic', () => {
    expect(norm('steps:\n- script: one\n- script: two\n')).not.toBe(
      norm('steps:\n- script: two\n- script: one\n'),
    );
  });

  it('does not expand: a steps-only document is not wrapped in stages (boundary)', () => {
    // The service wraps it (C-E00-022) — but that is expansion's job (E03-S01..S04). Doing it
    // here would let a broken expander pass preview-diff.
    expect(norm('steps:\n- script: echo\n')).not.toContain('__default');
  });
});

describe('corpus goldens (E12-S01-T02)', () => {
  it('every declared rule is reachable from the implementation', () => {
    // Guards the table against drift: a rule deleted from the code but left in RULES would
    // otherwise still pass `gives every rule a claim`.
    const exercised = new Set<string>();
    for (const sample of [
      'trigger: none\n',
      'variables:\n  a: one\n',
      'jobs:\n- job: b\n  dependsOn: a\n',
      'jobs:\n- deployment: d\n  environment: staging\n',
      'jobs:\n- job: a\n  container: builder\n  services:\n    redis: builder\n',
      'steps:\n- task: ecdc45f6-832d-4ad9-b52b-ee49e94659be@1\n',
    ]) {
      for (const id of normalizeExpandedYaml(sample).applied) exercised.add(id);
    }
    expect([...exercised].sort()).toEqual(RULES.map((r) => r.id));
  });

  it('found the committed pairs', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(10);
  });

  it.each(goldens)('%s normalizes idempotently', (_file, yaml) => {
    const once = norm(yaml);
    expect(norm(once)).toBe(once);
  });

  it.each(goldens)('%s normalizes without parse errors', (_file, yaml) => {
    expect(normalizeExpandedYaml(yaml).errors).toEqual([]);
  });

  it.each(goldens)('%s survives normalization with every leaf intact', (_file, yaml) => {
    // A normalizer that dropped content would trivially be idempotent, so assert the payload as a
    // multiset of scalar leaves. Goldens are already in service shape (list-form variables,
    // `{enabled: false}`, `{name}`/`{alias}` mappings), so only N6/N7/N8 can fire here — N6's one
    // substitution is applied to the expected side.
    const leaves = (value: unknown, out: string[] = []): string[] => {
      if (Array.isArray(value)) value.forEach((v) => leaves(v, out));
      else if (value !== null && typeof value === 'object')
        Object.values(value).forEach((v) => leaves(v, out));
      else if (value !== null) out.push(String(value));
      return out;
    };
    const substituted = leaves(parse(yaml)).map((leaf) => {
      const at = leaf.lastIndexOf('@');
      const name = at === -1 ? undefined : TASK_GUID_NAMES[leaf.slice(0, at).toLowerCase()];
      return name === undefined ? leaf : `${name}${leaf.slice(at)}`;
    });
    expect(leaves(normalizeExpandedYaml(yaml).value).sort()).toEqual(substituted.sort());
  });

  it('folds the one shape the service will not read back (C-E03-002)', () => {
    // The round-trip experiment: goldens carrying `enabled: false` are rejected as input, and
    // undoing that one rewrite makes all ten fixpoints. Both spellings must normalize alike.
    const golden = goldens.find(([, y]) => y.includes('trigger:\n  enabled: false'));
    expect(golden, 'no golden carries the disable form').toBeDefined();
    const [, yaml] = golden as readonly [string, string];
    expect(norm(yaml)).toBe(
      norm(yaml.replace(/^(trigger|pr):\n {2}enabled: false\n/gm, '$1: none\n')),
    );
  });
});

describe('canonicalText', () => {
  it('is stable for structurally equal values', () => {
    expect(canonicalText({ b: '2', a: '1' })).toBe(canonicalText({ b: '2', a: '1' }));
  });

  it('round-trips through the parser', () => {
    const value = { jobs: [{ job: 'a', steps: [{ script: 'echo hi' }] }] };
    expect(normalizeExpandedYaml(canonicalText(value)).value).toEqual(value);
  });
});
