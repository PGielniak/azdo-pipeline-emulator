// Shared oracle-fixture harness for the E03-S01 directive tasks.
//
// Extracted from E03-S01-T03's `each.test.ts` when E03-S01-T02 landed the second directive suite:
// both drive the same pipeline — parse the committed preview *input*, run one directive visitor
// over it, serialize, and compare against the committed `finalYaml` through the E03-S05-T01
// normalizer. Keeping one copy means a fix to the parameter binding or to interpolation cannot
// silently apply to one directive's goldens and not the other's.
//
// The minimal `fixtureScalars` stand-in that stood here for T02–T04 is **gone**: E03-S01-T05 landed
// `interpolationVisitor`, so every directive suite now runs the real interpolation pass and the
// goldens they were already passing are re-checked against it. Two of the stand-in's shortcuts were
// wrong and are the reason the replacement is worth noting — it trimmed the host scalar before
// deciding lone-vs-mixed (C-E03-180) and it evaluated a lone `${{ insert }}` in value position
// (C-E03-194).
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
} from '../../src/frontend/parse.js';
import { parametersContext, type ExprContextValues } from '../../src/expr/context.js';
import {
  NULL,
  arrayValue,
  booleanValue,
  numberValue,
  orderedObjectValue,
  stringValue,
  type ExprValue,
} from '../../src/expr/value.js';
import {
  composeVisitors,
  rootFrame,
  walkTemplate,
  type TemplateFrame,
  type TemplateVisitor,
} from '../../src/template/walk.js';
import { interpolationVisitor } from '../../src/template/interpolate.js';

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

/**
 * How a suite names the visitor under test. `each`/`insert` take an injected evaluator, while
 * `conditionalVisitor` parses conditions itself so it can turn a parse failure into the service's
 * own diagnostic — so the harness offers both the evaluator and the raw context values, and each
 * factory takes the one it needs.
 */
export type DirectiveVisitorFactory = (
  evaluate: Evaluator,
  values: ExprContextValues,
) => TemplateVisitor;

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
  directive: DirectiveVisitorFactory,
): { yaml: string; directives: readonly string[] } {
  const result = walkFixture(source, directive);
  expect(result.diagnostics).toEqual([]);
  return {
    yaml: stringify(result.plain, { lineWidth: 0 }),
    directives: result.directives,
  };
}

/**
 * `expandFixture` without the "no diagnostics" assertion, for the cases where the diagnostics *are*
 * the behavior under test — E03-S01-T04's key collisions, which the walker accumulates rather than
 * throwing (C-E03-169..171), and the two positions where `${{ insert }}` is not a directive at all
 * (C-E03-173), where the interesting assertion is that nothing was reported.
 */
export function walkFixture(
  source: string,
  directive: DirectiveVisitorFactory,
  // `false` omits interpolation entirely, leaving the walker on its own. It exists for the tests
  // that assert what the *walker* does with a scalar nobody expands — and it no longer has to
  // exist for C-E03-173/194, which the real interpolator now implements: a lone `${{ insert }}` in
  // value position is left verbatim rather than evaluated, so those probes pass either way.
  scalars = true,
): {
  plain: unknown;
  directives: readonly string[];
  diagnostics: readonly { message: string }[];
} {
  const parsed = parsePipelineYaml(source, 'azure-pipelines.yml');
  expect(parsed.errors).toEqual([]);
  const values = contexts(parsed.root);
  const evaluate: Evaluator = (expression, frame) =>
    evaluateTemplateExpression(expression, frame, values);
  const visitor = scalars
    ? composeVisitors(directive(evaluate, values), interpolationVisitor(evaluate))
    : directive(evaluate, values);
  const result = walkTemplate(parsed.root, rootFrame('azure-pipelines.yml'), visitor);
  return {
    plain: plain(result.node),
    directives: result.directives.map((site) => site.directive.keyword),
    diagnostics: result.diagnostics,
  };
}
