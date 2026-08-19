// Shared oracle-fixture harness for the E03-S01 directive tasks.
//
// Extracted from E03-S01-T03's `each.test.ts` when E03-S01-T02 landed the second directive suite:
// both drive the same pipeline — parse the committed preview *input*, run one directive visitor
// over it, serialize, and compare against the committed `finalYaml` through the E03-S05-T01
// normalizer. Keeping one copy means a fix to the parameter binding or the scalar stand-in cannot
// silently apply to one directive's goldens and not the other's.
//
// The scalar adapter here is deliberately minimal: generic interpolation is E03-S01-T05, and these
// probes contain only simple context/loop references, so it supports no broader syntax.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { expect } from 'vitest';

import { evaluateTemplateExpression } from '../../src/template/each.js';
import {
  parsePipelineYaml,
  type MappingEntry,
  type MappingNode,
  type PipelineNode,
  type Provenance,
} from '../../src/frontend/parse.js';
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

export const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const fixtureDir = join(repoRoot, 'fixtures', 'oracle', 'directives');

export interface OracleFixture {
  readonly name: string;
  readonly input: string;
  readonly final: string;
}

/** Every committed `<prefix>*.input.yml`/`.final.yml` pair, sorted by name. */
export function oracleFixtures(prefix: string): readonly OracleFixture[] {
  return readdirSync(fixtureDir)
    .filter((file) => file.startsWith(prefix) && file.endsWith('.input.yml'))
    .sort()
    .map((inputFile) => {
      const name = inputFile.slice(0, -'.input.yml'.length);
      return {
        name,
        input: readFileSync(join(fixtureDir, inputFile), 'utf8'),
        final: readFileSync(join(fixtureDir, `${name}.final.yml`), 'utf8'),
      };
    });
}

export type Evaluator = (expression: string, frame: TemplateFrame) => ExprValue;

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

/** Bind the defaults in these self-contained probes; typed/overridden binding belongs to E03-S02. */
export function contexts(root: PipelineNode | undefined): ExprContextValues {
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

/** Fixture-only scalar adapter standing in for E03-S01-T05. */
export function fixtureScalars(evaluate: Evaluator): NonNullable<TemplateVisitor['scalar']> {
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

export function plain(node: PipelineNode | undefined): unknown {
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

/**
 * Parse `source`, walk it with the visitor `directive` builds, and return the serialized result
 * plus the directive keywords the walk saw in document order.
 */
export function expandFixture(
  source: string,
  directive: (evaluate: Evaluator) => TemplateVisitor,
): { yaml: string; directives: readonly string[] } {
  const parsed = parsePipelineYaml(source, 'azure-pipelines.yml');
  expect(parsed.errors).toEqual([]);
  const values = contexts(parsed.root);
  const evaluate: Evaluator = (expression, frame) =>
    evaluateTemplateExpression(expression, frame, values);
  const visitor = { ...directive(evaluate), scalar: fixtureScalars(evaluate) };
  const result = walkTemplate(parsed.root, rootFrame('azure-pipelines.yml'), visitor);
  expect(result.diagnostics).toEqual([]);
  return {
    yaml: stringify(plain(result.node), { lineWidth: 0 }),
    directives: result.directives.map((site) => site.directive.keyword),
  };
}
