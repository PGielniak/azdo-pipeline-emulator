/**
 * Iterative insertion (`${{ each }}`), E03-S01-T03.
 *
 * Recognition and traversal stay in `walk.ts`; this module plugs into its directive seam. It owns
 * exactly the iterative behavior: evaluate a collection, bind one loop value, recursively walk a
 * fresh body, and splice the body's entries/items into the parent. Scalar interpolation remains
 * E03-S01-T05 and is supplied independently through `TemplateVisitor.scalar`.
 *
 * Grounding: Microsoft Learn C-E03-140..143 plus 12 live preview probes under
 * `research/experiments/E03-each/` (C-E03-144..151).
 */
import type { ExprContextValues } from '../expr/context.js';
import { registryForSlot } from '../expr/context.js';
import { evaluateExpression } from '../expr/evaluate.js';
import { parseExpression, type ExprParseError } from '../expr/parser.js';
import { objectEntries, objectValue, stringValue, type ExprValue } from '../expr/value.js';
import type { MappingEntry, PipelineNode } from '../frontend/parse.js';
import {
  bindLoopVariable,
  type DirectiveSite,
  type TemplateFrame,
  type TemplateVisitor,
  type TemplateVisitContext,
} from './walk.js';

export type EachExpressionEvaluator = (expression: string, frame: TemplateFrame) => ExprValue;

export class EachExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EachExpansionError';
  }
}

export class TemplateExpressionParseError extends Error {
  constructor(
    readonly expression: string,
    readonly detail: ExprParseError,
  ) {
    super(detail.message);
    this.name = 'TemplateExpressionParseError';
  }
}

/** Parse and evaluate one template expression with the current loop bindings in scope. */
export function evaluateTemplateExpression(
  expression: string,
  frame: TemplateFrame,
  values: ExprContextValues,
): ExprValue {
  const parsed = parseExpression(expression, {
    registry: registryForSlot(frame.slot, [...frame.names]),
  });
  if (!parsed.ok) throw new TemplateExpressionParseError(expression, parsed.error);
  return evaluateExpression(parsed.node, {
    slot: frame.slot,
    values,
    locals: frame.bindings,
  });
}

/**
 * Create the `each` half of a template visitor. Spread this together with T02/T04/T05 visitors;
 * non-`each` directives return `undefined` and remain available to their owning pass.
 */
export function eachVisitor(evaluate: EachExpressionEvaluator): TemplateVisitor {
  return {
    mappingDirective: (site, context) =>
      site.directive.keyword === 'each' ? expandMapping(site, context, evaluate) : undefined,
    sequenceDirective: (site, context) =>
      site.directive.keyword === 'each' ? expandSequence(site, context, evaluate) : undefined,
  };
}

function iterations(site: DirectiveSite, evaluate: EachExpressionEvaluator): readonly ExprValue[] {
  if (site.directive.keyword !== 'each') return [];
  const collection = evaluate(site.directive.collection.text, site.frame);
  if (collection.kind === 'array') {
    // Sequence iteration binds the element itself, once, in source order (C-E03-144).
    return collection.value;
  }
  if (collection.kind === 'object') {
    // Explicit order metadata prevents JS from reordering integer-like YAML keys (`10,2,01`),
    // which the service retains exactly (C-E03-145).
    return objectEntries(collection).map(([key, value]) =>
      objectValue({ key: stringValue(key), value }),
    );
  }
  throw new EachExpansionError(
    `each collection must be an array or object, got ${collection.kind}`,
  );
}

function boundFrame(site: DirectiveSite, value: ExprValue): TemplateFrame {
  if (site.directive.keyword !== 'each') return site.frame;
  const bound = bindLoopVariable(site.frame, site.directive.variable.text, value);
  if (!bound.ok) throw new EachExpansionError(bound.message);
  // No index is added: only this declared binding enters the frame (C-E03-151).
  return bound.frame;
}

function expandMapping(
  site: DirectiveSite & { container: 'mapping' },
  context: TemplateVisitContext,
  evaluate: EachExpressionEvaluator,
): MappingEntry[] {
  const entries: MappingEntry[] = [];
  for (const value of iterations(site, evaluate)) {
    const body = context.walk(site.body, boundFrame(site, value));
    if (body.kind !== 'mapping') {
      throw new EachExpansionError('each in mapping position requires a mapping body');
    }
    // Each walked body is spliced, not nested (C-E03-146); an empty collection runs zero times.
    entries.push(...body.entries);
  }
  return entries;
}

function expandSequence(
  site: DirectiveSite & { container: 'sequence' },
  context: TemplateVisitContext,
  evaluate: EachExpressionEvaluator,
): PipelineNode[] {
  const items: PipelineNode[] = [];
  for (const value of iterations(site, evaluate)) {
    const body = context.walk(site.body, boundFrame(site, value));
    if (body.kind !== 'sequence') {
      throw new EachExpansionError('each in sequence position requires a sequence body');
    }
    // Recursive walking with the bound frame makes nested `each` outer-major/inner-minor and keeps
    // both names available (C-E03-147).
    items.push(...body.items);
  }
  return items;
}
