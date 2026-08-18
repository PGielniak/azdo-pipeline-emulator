// E03-S01-T03 — iterative insertion (`each`).
//
// The fixture suite uses the exact 2026-08-18 preview input/finalYaml pairs. `eachVisitor` owns
// only iteration; the small scalar adapter below stands in for T05 so the test can compare complete
// outputs without implementing generic interpolation in the wrong backlog task.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { describe, expect, it } from 'vitest';

import {
  eachVisitor,
  evaluateTemplateExpression,
  TemplateExpressionParseError,
} from '../../src/template/each.js';
import {
  parsePipelineYaml,
  type MappingEntry,
  type MappingNode,
  type PipelineNode,
  type Provenance,
} from '../../src/frontend/parse.js';
import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { parametersContext, type ExprContextValues } from '../../src/expr/context.js';
import {
  NULL,
  arrayValue,
  booleanValue,
  numberValue,
  objectEntries,
  orderedObjectValue,
  stringValue,
  type ExprValue,
} from '../../src/expr/value.js';
import {
  loneExpression,
  rootFrame,
  walkTemplate,
  type TemplateFrame,
  type TemplateVisitor,
} from '../../src/template/walk.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtureDir = join(repoRoot, 'fixtures', 'oracle', 'directives');
const fixtures = readdirSync(fixtureDir)
  .filter((file) => /^each-.*\.input\.yml$/.test(file))
  .sort()
  .map((inputFile) => {
    const name = inputFile.slice(0, -'.input.yml'.length);
    return {
      name,
      input: readFileSync(join(fixtureDir, inputFile), 'utf8'),
      final: readFileSync(join(fixtureDir, `${name}.final.yml`), 'utf8'),
    };
  });

const entry = (mapping: MappingNode, key: string): MappingEntry | undefined =>
  mapping.entries.find((candidate) => String(candidate.key.value) === key);

function exprValue(node: PipelineNode): ExprValue {
  switch (node.kind) {
    case 'scalar':
      if (node.value === null) return NULL;
      if (typeof node.value === 'boolean') return booleanValue(node.value);
      if (typeof node.value === 'number') return numberValue(node.value);
      return stringValue(node.value);
    case 'sequence':
      return arrayValue(node.items.map(exprValue));
    case 'mapping':
      return orderedObjectValue(
        node.entries.map(({ key, value }) => [String(key.value), exprValue(value)] as const),
      );
  }
}

/** Bind the defaults in these self-contained probes; typed/overridden binding belongs to T02. */
function contexts(root: PipelineNode | undefined): ExprContextValues {
  if (root?.kind !== 'mapping') return {};
  const parameters = entry(root, 'parameters')?.value;
  if (parameters?.kind !== 'sequence') return {};
  const values: Record<string, ExprValue> = {};
  for (const parameter of parameters.items) {
    if (parameter.kind !== 'mapping') continue;
    const name = entry(parameter, 'name')?.value;
    const fallback = entry(parameter, 'default')?.value;
    if (name?.kind === 'scalar' && typeof name.value === 'string' && fallback !== undefined) {
      values[name.value] = exprValue(fallback);
    }
  }
  return { parameters: parametersContext(values) };
}

function scalar(value: ExprValue, pos: Provenance): PipelineNode {
  switch (value.kind) {
    case 'null':
      return { kind: 'scalar', value: null, style: 'plain', pos };
    case 'boolean':
    case 'number':
    case 'string':
      return { kind: 'scalar', value: value.value, style: 'plain', pos };
    case 'version':
      return { kind: 'scalar', value: value.segments.join('.'), style: 'plain', pos };
    case 'array':
      return { kind: 'sequence', items: value.value.map((child) => scalar(child, pos)), pos };
    case 'object':
      return {
        kind: 'mapping',
        entries: objectEntries(value).map(([key, child]) => ({
          key: { kind: 'scalar', value: key, style: 'plain', pos },
          value: scalar(child, pos),
        })),
        pos,
      };
  }
}

function rendered(value: ExprValue): string {
  switch (value.kind) {
    case 'null':
      return '';
    case 'boolean':
      return value.value ? 'True' : 'False';
    case 'number':
    case 'string':
      return String(value.value);
    case 'version':
      return value.segments.join('.');
    case 'array':
    case 'object':
      throw new TypeError('fixture mixed-content expressions are scalar');
  }
}

type Evaluator = (expression: string, frame: TemplateFrame) => ExprValue;

/**
 * Fixture-only scalar adapter. Full quote-aware/mixed-content behavior is E03-S01-T05; these
 * probes contain only simple loop references, so this intentionally supports no broader syntax.
 */
function fixtureScalars(evaluate: Evaluator): NonNullable<TemplateVisitor['scalar']> {
  return (node, frame) => {
    if (typeof node.value !== 'string' || !node.value.includes('${{')) return undefined;
    const lone = loneExpression(node.value);
    if (lone !== undefined) return scalar(evaluate(lone.inner, frame), node.pos);
    const value = node.value.replace(/\$\{\{\s*([^{}]*?)\s*}}/g, (_match, expression: string) =>
      rendered(evaluate(expression.trim(), frame)),
    );
    return { ...node, value };
  };
}

function plain(node: PipelineNode | undefined): unknown {
  if (node === undefined) return null;
  switch (node.kind) {
    case 'scalar':
      return node.value;
    case 'sequence':
      return node.items.map(plain);
    case 'mapping':
      return Object.fromEntries(
        node.entries.map(({ key, value }) => [String(key.value), plain(value)]),
      );
  }
}

function expand(source: string): { yaml: string; directives: readonly string[] } {
  const parsed = parsePipelineYaml(source, 'azure-pipelines.yml');
  expect(parsed.errors).toEqual([]);
  const values = contexts(parsed.root);
  const evaluate: Evaluator = (expression, frame) =>
    evaluateTemplateExpression(expression, frame, values);
  const visitor = { ...eachVisitor(evaluate), scalar: fixtureScalars(evaluate) };
  const result = walkTemplate(parsed.root, rootFrame('azure-pipelines.yml'), visitor);
  expect(result.diagnostics).toEqual([]);
  return {
    yaml: stringify(plain(result.node), { lineWidth: 0 }),
    directives: result.directives.map((site) => site.directive.keyword),
  };
}

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
