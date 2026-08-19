// E03-S01-T04 — the `${{ insert }}` merge directive.
//
// The fixture suite uses the exact 2026-08-19 preview input/finalYaml pairs. Probes the service
// rejected have no golden, so they are asserted against their committed error transcripts instead —
// the rejection *is* the claim.
//
// Two of this task's claims are about layers other than the directive visitor, and the tests say so
// rather than quietly asserting the visitor's behavior as if it were the whole story: the collision
// rule lives on the mapping rebuild in `walk.ts` because it is not `insert`'s (C-E03-171), and the
// two "not a directive" positions (C-E03-173) are rejected by the *schema*, which is E01-S02's.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { conditionalVisitor } from '../../src/template/conditionals.js';
import { eachVisitor } from '../../src/template/each.js';
import { insertVisitor, InsertValueError } from '../../src/template/insert.js';
import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { composeVisitors } from '../../src/template/walk.js';
import {
  expandFixture,
  oracleFixtures,
  repoRoot,
  walkFixture,
  type DirectiveVisitorFactory,
} from './fixture-harness.js';

/**
 * All three directive visitors, composed the way an emitter would. `insert` fixtures deliberately
 * mix directives — the chain probes are the whole point of this task's second half — so a suite
 * that ran `insertVisitor` alone would not exercise the documents it committed.
 *
 * `conditionalVisitor` is composed **first** on purpose: `composeVisitors` stops at the first hook
 * that answers, and the conditional pass has to reach the `insert`/`each` site to learn that a
 * chain was broken (C-E03-138). Ordering it after `insertVisitor` makes those five probes expand.
 */
const directives: DirectiveVisitorFactory = (evaluate, values) =>
  composeVisitors(conditionalVisitor({ values }), insertVisitor(evaluate), eachVisitor(evaluate));

const expand = (source: string) => expandFixture(source, directives);

const probe = (name: string, file = 'probe.yml'): string =>
  readFileSync(join(repoRoot, 'research', 'experiments', 'E03-insert', name, file), 'utf8');

/** The message the service returned, reassembled from its committed transcript. */
const rejection = (name: string): string =>
  (JSON.parse(probe(name, 'response.json')) as { message: string }).message
    .split('\n')
    .map((line) => line.replace(/^\S+ \(Line: \d+, Col: \d+\): /, ''))
    .join('\n');

/** The first two sentences of a rejection — see C-E03-139 on the third. */
const sentences = (name: string, count: number): string =>
  rejection(name).split('\n').slice(0, count).join('\n');

/**
 * `sequence-position-valid` has a committed oracle pair but cannot be a byte-golden: its inserted
 * keys form a `script:` step, and the service **desugars** that into `task: CmdLine@2` with an
 * `inputs.script`. Shortcut desugaring is deliberately outside the E03-S05-T01 normalizer (doing it
 * there would let a broken expander pass `preview-diff`) and belongs to E04. Its structural point
 * — one merged item, not two spliced ones — is asserted directly below instead.
 */
const DESUGARED_BY_THE_SERVICE = new Set(['insert-sequence-position-valid']);

const fixtures = oracleFixtures('insert-');
const goldens = fixtures.filter(({ name }) => !DESUGARED_BY_THE_SERVICE.has(name));

describe('insert oracle goldens', () => {
  it('commits the live input/finalYaml pairs', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(6);
    expect(goldens.map(({ name }) => name)).toContain('insert-doc-canonical');
  });

  it.each(goldens)('$name matches the service finalYaml (C-E03-163..167)', ({ input, final }) => {
    const local = expand(input).yaml;
    expect(normalizeExpandedYaml(local).value).toEqual(normalizeExpandedYaml(final).value);
  });

  it('C-E03-168 — two `${{ insert }}` keys in one mapping both merge, in document order', () => {
    // Byte-identical directive keys. This only reaches the walker because E01-S01-T04 already
    // exempted directive keys from the parse-time duplicate rule (C-E01-038/039) — the gap
    // E03-S01-T01 filed for the `${{ if }}` shape of the same problem. Asserting the *order* is
    // what makes this more than a repeat of that fix.
    const fixture = goldens.find(({ name }) => name === 'insert-two-inserts-disjoint');
    const result = expand(fixture?.input ?? '') as unknown as { yaml: string };
    expect(result.yaml.indexOf('ONE:')).toBeLessThan(result.yaml.indexOf('TWO:'));
  });
});

describe('the merge', () => {
  const variables = (yaml: string): readonly string[] =>
    [...yaml.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1] ?? '');

  it('C-E03-163 — merged keys land at the directive’s own position, not at the end', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-position');
    // The golden comparison alone would not catch an append-at-the-end implementation if some
    // normalization sorted keys, so order is asserted directly.
    expect(variables(expand(fixture?.input ?? '').yaml)).toEqual([
      'BEFORE',
      'MID_A',
      'MID_B',
      'AFTER',
    ]);
  });

  it('C-E03-163 — the source object’s authored order survives, unsorted', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-object-order');
    expect(variables(expand(fixture?.input ?? '').yaml)).toEqual([
      'BASE',
      'ZETA',
      'ALPHA',
      'MIDDLE',
    ]);
  });

  it('C-E03-165 — an empty object contributes nothing', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-empty-object');
    expect(variables(expand(fixture?.input ?? '').yaml)).toEqual(['BEFORE', 'AFTER']);
  });

  it('C-E03-164 — the value may be a literal mapping rather than an expression', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-literal-mapping-value');
    expect(variables(expand(fixture?.input ?? '').yaml)).toEqual([
      'BEFORE',
      'LIT_A',
      'LIT_B',
      'AFTER',
    ]);
  });

  it('C-E03-174 — in a sequence item the merge stays inside the item, it does not splice', () => {
    // `sequence-position` alone cannot prove this: its object has one key, so merging and splicing
    // produce the same document and a test written on it passes under either implementation (this
    // was caught by mutation — swapping the visitor to splice left the whole suite green).
    // `sequence-position-valid` supplies two keys that together form one valid step, so the two
    // readings genuinely differ, and the service returned **one** step carrying both.
    const fixture = fixtures.find(({ name }) => name === 'insert-sequence-position-valid');
    const steps = (
      walkFixture(fixture?.input ?? '', directives).plain as {
        stages: { jobs: { steps: Record<string, unknown>[] }[] }[];
      }
    ).stages[0]?.jobs[0]?.steps;
    expect(steps).toHaveLength(2);
    expect(steps?.[0]).toEqual({ script: 'echo merged', displayName: 'Merged' });
    // The service's own output agrees, modulo the `script:`→`task:` desugaring that is E04's.
    expect(fixture?.final).toContain('displayName: Merged');
  });

  it('C-E03-174 — the single-key probe rejects on the *merged* key, at the schema layer', () => {
    // `Unexpected value 'A'` is a step-schema complaint about the merged key (E01-S02's layer),
    // not a complaint about the directive — which is why this probe expands here rather than
    // raising.
    const result = expand(probe('sequence-position'));
    expect(rejection('sequence-position')).toBe("Unexpected value 'A'");
    expect(result.yaml).toContain('- A: a');
  });
});

describe('non-mapping values', () => {
  it.each(['value-string', 'value-array', 'value-scalar-literal', 'value-empty'])(
    'C-E03-172 — %s is rejected in the service’s words',
    (name) => {
      expect(() => expand(probe(name))).toThrowError(InsertValueError);
      try {
        expand(probe(name));
      } catch (error) {
        expect((error as InsertValueError).message).toBe(rejection(name));
      }
    },
  );

  it('C-E03-172 — the sentence carries no help link, like every directive rejection', () => {
    expect(rejection('value-string')).not.toContain('For more help');
  });
});

describe('key collisions (C-E03-169..171)', () => {
  // The `Do` field asks "error vs overwrite". These assert **error**, and that neither value wins.
  const collide = (name: string) => walkFixture(probe(name), directives);

  it('C-E03-169 — a literal key then an inserted duplicate is an error, not an overwrite', () => {
    const result = collide('collision-literal-before');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      rejection('collision-literal-before'),
    ]);
    expect(rejection('collision-literal-before')).toBe("'FOO' is already defined");
  });

  it('C-E03-169 — an inserted key then a literal duplicate is the same error', () => {
    const result = collide('collision-literal-after');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      rejection('collision-literal-after'),
    ]);
  });

  it('C-E03-170 — the comparison folds case and the message echoes the later spelling', () => {
    // Literal `FOO`, inserted `foo`: the service said `'foo' is already defined`, i.e. the *later*
    // spelling. An implementation that echoed the key already present would say `FOO` and pass a
    // case-sensitive test while failing this one.
    const result = collide('collision-case');
    expect(rejection('collision-case')).toBe("'foo' is already defined");
    expect(result.diagnostics.map((d) => d.message)).toEqual([rejection('collision-case')]);
  });

  it('C-E03-171 — the rule is the mapping’s, not `insert`’s: an `each` key collides too', () => {
    const result = collide('collision-from-each');
    expect(result.diagnostics.map((d) => d.message)).toEqual([rejection('collision-from-each')]);
    expect(rejection('collision-from-each')).toBe("'FOO' is already defined");
  });

  it('C-E03-169 — the later entry is the one dropped', () => {
    // Scoped to `variables`: the whole document also carries the parameter *default* the insert
    // reads from, so a document-wide search for `from-insert` would always find it.
    const result = collide('collision-literal-before') as {
      plain: { variables: Record<string, string> };
    };
    expect(result.plain.variables).toEqual({ FOO: 'from-literal' });
  });

  it('C-E03-111/168 — identical *directive* keys are exempt from the duplicate rule', () => {
    // Two `${{ insert }}` keys are byte-identical and the service accepts them (C-E03-168), so the
    // dedup must key off "is this a directive", not off raw key text. Our front end still rejects
    // the document earlier (E01-S01-T04), so this asserts the walker rule on a synthetic document
    // that reaches it: two identical `${{ if }}` keys with the same effect.
    const source =
      'parameters:\n- name: a\n  type: boolean\n  default: true\n' +
      'variables:\n  BASE: base\n  ${{ if parameters.a }}:\n    ONE: one\n';
    expect(walkFixture(source, directives).diagnostics).toEqual([]);
  });
});

describe('directive position (C-E03-173)', () => {
  it.each(['bare-sequence-item', 'value-position'])(
    '%s reaches no directive hook, and its text survives verbatim',
    (name) => {
      // Walked without the T05 scalar stand-in, because the rule under test is exactly that the
      // text must *not* be evaluated: the service answers `Unexpected value '${{ insert }}'`, not
      // the `Unrecognized value: 'insert'` an expression evaluation would produce.
      const result = walkFixture(probe(name), directives, false);
      expect(result.directives).toEqual([]);
      expect(result.diagnostics).toEqual([]);
      expect(JSON.stringify(result.plain)).toContain('${{ insert }}');
      // The rejection itself is the schema's (E01-S02), not the template engine's; recorded here
      // so that task and E03-S01-T05 have the exact text.
      expect(rejection(name)).toBe("Unexpected value '${{ insert }}'");
    },
  );

  it('C-E03-173 — the control: a bare unknown name *is* an ordinary expression failure', () => {
    // Without this, "the service said Unexpected value" would not distinguish "recognized as a
    // directive that may not act" from "parsed as an expression and failed to resolve".
    const control = readFileSync(
      join(repoRoot, 'research', 'experiments', 'E03-each', 'implicit-index-name', 'response.json'),
      'utf8',
    );
    expect(JSON.parse(control) as { message: string }).toHaveProperty(
      'message',
      expect.stringContaining("Unrecognized value: 'index'"),
    );
  });
});

describe('chains broken by a directive sibling (C-E03-138)', () => {
  // This is the question E03-S01-T02 filed and handed here, and the answer inverts what it
  // shipped: an ordinary sibling leaves a chain intact, a *directive* sibling breaks it.
  //
  // A rejection is reported, not thrown, because a single service response carries every bad
  // expression in the document (C-E02-110) — the same rule `walk.ts` already follows.
  const reported = (name: string): string =>
    walkFixture(probe(name), directives)
      .diagnostics.map(({ message }) => message)
      .join('\n');

  it.each([
    ['chain-insert-between', 'else', 'mapping'],
    ['chain-insert-between-true', 'else', 'mapping'],
    ['chain-each-between', 'else', 'mapping'],
    ['chain-elseif-after-insert', 'elseif', 'mapping'],
    ['chain-each-between-sequence', 'else', 'sequence'],
  ])('%s orphans the trailing `%s` in %s position', (name, keyword) => {
    // Two sentences, matching the service; the third (an internal reader-stack dump) is
    // deliberately not reproduced — C-E03-139, docs/06 §5 decision 33.
    expect(reported(name)).toBe(sentences(name, 2));
    expect(reported(name)).toContain(`directive '${keyword}' is not supported`);
  });

  it('C-E03-138 — the same insert placed *before* the chain head is harmless', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-chain-insert-before');
    expect(expand(fixture?.input ?? '').yaml).toContain('PICK: from-else');
  });

  it('C-E03-138 — and placed *after* the chain it is harmless too', () => {
    const fixture = goldens.find(({ name }) => name === 'insert-chain-insert-after');
    expect(expand(fixture?.input ?? '').yaml).toContain('PICK: from-else');
  });

  it('C-E03-128 — the control still holds: an *ordinary* sibling does not break a chain', () => {
    // Without this, "directives break chains" would be indistinguishable from "anything between
    // two members breaks a chain", which is the reading C-E03-128 already refuted.
    const source =
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
      'variables:\n  ${{ if parameters.a }}:\n    PICK: from-if\n' +
      '  MIDDLE: middle\n  ${{ else }}:\n    PICK: from-else\n';
    expect(expand(source).yaml).toContain('PICK: from-else');
  });
});

describe('orphan wording is position-dependent (C-E03-139)', () => {
  it.each([
    ['orphan-else-mapping', 'else'],
    ['orphan-elseif-mapping', 'elseif'],
  ])('%s uses the mapping-position second sentence', (name, keyword) => {
    const diagnostics = walkFixture(probe(name), directives).diagnostics;
    expect(diagnostics.map(({ message }) => message).join('\n')).toBe(sentences(name, 2));
    expect(diagnostics[0]?.message).toContain(`directive '${keyword}' is not supported`);
  });

  it('the mapping and sequence forms genuinely differ, so one message cannot serve both', () => {
    // E03-S01-T02 measured only the sequence form and hard-coded its second sentence. Asserting
    // the difference is what stops a future simplification from collapsing them again.
    expect(sentences('orphan-else-mapping', 2)).toContain('A mapping was not expected');
    expect(sentences('orphan-else-mapping', 2)).not.toContain('Unexpected value');
  });
});
