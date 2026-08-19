// E03-S01-T02 — conditional insertion chains (`${{ if / elseif / else }}`).
//
// The fixture suite uses the exact 2026-08-19 preview input/finalYaml pairs (18 of them; the task
// asks for six). Four more probes were rejected by the service and have no golden, so they are
// asserted against their committed error transcripts instead — the rejection *is* the claim.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { conditionalVisitor, ConditionalChainError } from '../../src/template/conditional.js';
import { eachVisitor } from '../../src/template/each.js';
import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { expandFixture, oracleFixtures, repoRoot, type Evaluator } from './fixture-harness.js';
import type { TemplateVisitor } from '../../src/template/walk.js';

const fixtures = oracleFixtures('if-');

const expand = (source: string) => expandFixture(source, conditionalVisitor);

const probe = (name: string, file = 'probe.yml'): string =>
  readFileSync(join(repoRoot, 'research', 'experiments', 'E03-if', name, file), 'utf8');

/** The message the service returned, reassembled from its committed transcript. */
const rejection = (name: string): string =>
  (JSON.parse(probe(name, 'response.json')) as { message: string }).message
    // The two sentences carry `<file> (Line: N, Col: M): ` prefixes, which C-E02-105 assigns to the
    // host scalar rather than to the directive; only the sentences themselves are this task's.
    .split('\n')
    .map((line) => line.replace(/^\S+ \(Line: \d+, Col: \d+\): /, ''))
    .join('\n');

const steps = (yaml: string): readonly string[] =>
  [...yaml.matchAll(/script: (.+)$/gm)].map((match) => match[1] ?? '');

describe('conditional insertion oracle goldens', () => {
  it('commits at least six live input/finalYaml pairs', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(6);
    expect(fixtures).toHaveLength(18);
  });

  it.each(fixtures)('$name matches the service finalYaml (C-E03-122..133)', ({ input, final }) => {
    const local = expand(input).yaml;
    expect(normalizeExpandedYaml(local).value).toEqual(normalizeExpandedYaml(final).value);
  });
});

describe('chain grouping', () => {
  // The task's own `Do` field says "winning branch spliced into parent" — which reads as splicing
  // at the chain head. These two fixtures are what refutes that, so they are asserted on order
  // explicitly and not only through the golden comparison, which would let a future refactor
  // regress the position while some other normalization hid it.
  it('C-E03-128 — an ordinary sibling does not break the chain (sequence)', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-interrupted-chain-false');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo interrupt', 'echo from-else']);
  });

  it('C-E03-128 — the winner is spliced at its own position, not the head’s', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-interrupted-chain-false');
    const yaml = expand(fixture?.input ?? '').yaml;
    expect(yaml.indexOf('echo interrupt')).toBeLessThan(yaml.indexOf('echo from-else'));
  });

  it('C-E03-128 — an ordinary key does not break the chain (mapping)', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-mapping-interrupted-chain');
    const yaml = expand(fixture?.input ?? '').yaml;
    expect(yaml).toContain('PICK: from-else');
    expect(yaml).toContain('MIDDLE: middle');
  });

  it('C-E03-127 — a second `if` starts a new chain, so the trailing `else` binds to it', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-two-chains-adjacent');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo first-if', 'echo second-else']);
  });

  it('C-E03-125 — a chain with no `else` and every condition false emits nothing', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-no-else-all-false');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo before', 'echo after']);
  });
});

describe('chain rejections', () => {
  it('C-E03-129 — an `else` with no preceding `if` is rejected in the service’s words', () => {
    expect(() => expand(probe('orphan-else'))).toThrowError(ConditionalChainError);
    try {
      expand(probe('orphan-else'));
    } catch (error) {
      expect((error as ConditionalChainError).message).toBe(rejection('orphan-else'));
    }
  });

  it('C-E03-129 — an `elseif` with no preceding `if` is rejected the same way', () => {
    try {
      expand(probe('orphan-elseif'));
      expect.unreachable('orphan elseif must not expand');
    } catch (error) {
      expect(error).toBeInstanceOf(ConditionalChainError);
      expect((error as ConditionalChainError).message).toBe(rejection('orphan-elseif'));
    }
  });

  it('C-E03-130 — `else` terminates the chain: a later `elseif` is rejected', () => {
    try {
      expand(probe('elseif-after-else'));
      expect.unreachable('an elseif after an else must not expand');
    } catch (error) {
      expect(error).toBeInstanceOf(ConditionalChainError);
      expect((error as ConditionalChainError).message).toBe(rejection('elseif-after-else'));
    }
  });

  it('C-E03-129/130 — the message carries no help link, unlike an expression error', () => {
    // Directive rejections come back bare (C-E03-101/103, re-observed here); asserting the
    // absence is the only way a later renderer cannot quietly start appending one.
    expect(rejection('orphan-else')).not.toContain('For more help');
  });
});

describe('branch laziness', () => {
  // Each of these is only meaningful against `ctl-missing-parameter`, which proves the very same
  // `parameters.missing` read is a hard rejection when it is actually reached (HTTP 400,
  // "Key not found 'missing'"). Without the control, "it expanded" would prove nothing.
  it('C-E03-132 — a later condition is not evaluated once a branch has won', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-elseif-not-evaluated');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo from-if']);
  });

  it('C-E03-132 — resolving a trailing `else` stops at the winner, not at the nearest member', () => {
    // `if true` / `elseif <raises>` / `else`: a backwards scan that evaluated nearest-first would
    // touch the raising condition and reject a document the service expands.
    const fixture = fixtures.find(({ name }) => name === 'if-chain-shortcircuit-else');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo from-if']);
  });

  it('C-E03-133 — a losing branch’s body is never evaluated', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-untaken-body-not-evaluated');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo before']);
  });

  it('the control really does raise when the same read is reached', () => {
    expect(() => expand(probe('ctl-missing-parameter'))).toThrowError(/Key not found 'missing'/);
    expect(rejection('ctl-missing-parameter')).toBe("Key not found 'missing'");
  });
});

describe('condition conversion', () => {
  it('C-E03-131 — a non-empty string condition is taken', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-condition-non-boolean');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo before', 'echo from-if']);
  });

  it('C-E03-131 — an empty string condition is not', () => {
    const fixture = fixtures.find(({ name }) => name === 'if-condition-empty-string');
    expect(steps(expand(fixture?.input ?? '').yaml)).toEqual(['echo before']);
  });
});

describe('composition with `each`', () => {
  // The visitors are spread together exactly as an emitter would compose them; this asserts that
  // neither swallows the other's directives, since both hooks receive every site.
  const both = (evaluate: Evaluator): TemplateVisitor => ({
    ...eachVisitor(evaluate),
    ...conditionalVisitor(evaluate),
    mappingDirective: (site, context) =>
      eachVisitor(evaluate).mappingDirective?.(site, context) ??
      conditionalVisitor(evaluate).mappingDirective?.(site, context),
    sequenceDirective: (site, context) =>
      eachVisitor(evaluate).sequenceDirective?.(site, context) ??
      conditionalVisitor(evaluate).sequenceDirective?.(site, context),
  });

  it('expands an `if` nested inside an `each` body', () => {
    const source =
      'parameters:\n- name: items\n  type: object\n  default:\n' +
      '  - name: alpha\n    ship: true\n  - name: beta\n    ship: false\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ each item in parameters.items }}:\n' +
      '        - ${{ if item.ship }}:\n' +
      '          - task: CmdLine@2\n            inputs:\n              script: echo ${{ item.name }}\n';
    expect(steps(expandFixture(source, both).yaml)).toEqual(['echo alpha']);
  });
});
