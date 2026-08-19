// E03-S01-T03 — iterative insertion (`each`).
//
// The fixture suite uses the exact 2026-08-18 preview input/finalYaml pairs. `eachVisitor` owns
// only iteration; the shared harness supplies the scalar stand-in for T05 so the test can compare
// complete outputs without implementing generic interpolation in the wrong backlog task.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { eachVisitor, TemplateExpressionParseError } from '../../src/template/each.js';
import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { expandFixture, oracleFixtures, repoRoot } from './fixture-harness.js';

const fixtures = oracleFixtures('each-');

const expand = (source: string) => expandFixture(source, eachVisitor);

describe('iterative insertion oracle goldens', () => {
  it('commits at least eight live input/finalYaml pairs', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(8);
    expect(fixtures).toHaveLength(11);
  });

  it.each(fixtures)('$name matches the service finalYaml (C-E03-144..151)', ({ input, final }) => {
    const local = expand(input).yaml;
    expect(normalizeExpandedYaml(local).value).toEqual(normalizeExpandedYaml(final).value);
  });
});

describe('each visitor', () => {
  it('C-E03-145 — preserves authored mapping order, including integer-like keys', () => {
    const fixture = fixtures.find(({ name }) => name === 'each-mapping-numeric-key-order');
    expect(fixture).toBeDefined();
    const local = expand(fixture?.input ?? '').yaml;
    expect(local.indexOf('script: echo 10=ten')).toBeLessThan(local.indexOf('script: echo 2=two'));
    expect(local.indexOf('script: echo 2=two')).toBeLessThan(
      local.indexOf('script: echo 01=leading'),
    );
  });

  it('C-E03-147 — recursively expands nested each with both bindings', () => {
    const fixture = fixtures.find(({ name }) => name === 'each-nested-each');
    expect(fixture).toBeDefined();
    expect(expand(fixture?.input ?? '').directives).toEqual(['each', 'each', 'each']);
  });

  it('C-E03-151 — creates no implicit index named value', () => {
    const source = readFileSync(
      join(repoRoot, 'research', 'experiments', 'E03-each', 'implicit-index-name', 'probe.yml'),
      'utf8',
    );
    expect(() => expand(source)).toThrowError(TemplateExpressionParseError);
    try {
      expand(source);
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateExpressionParseError);
      expect((error as TemplateExpressionParseError).detail.message).toBe(
        "Unrecognized value: 'index'",
      );
    }
  });
});
