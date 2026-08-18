/**
 * Compile-time `${{ if }}` / `${{ elseif }}` / `${{ else }}` insertion.
 *
 * The service behavior is grounded by 23 live preview probes and 19 committed input/final-YAML
 * pairs (`fixtures/oracle/directives/`; claims C-E03-120..127). Two rules are easy to miss:
 *
 * - chain state belongs to the containing sequence/mapping, so an ordinary sibling does not end a
 *   chain (C-E03-123), and
 * - after one branch wins, later `elseif` expressions are not evaluated (C-E03-121).
 *
 * This pass plugs into T01's `walkTemplate` visitor seam. The walker preserves ordinary nodes and
 * provenance; the hooks below replace only conditional directive sites. Each selected body is
 * passed through a fresh expansion, which gives every nested container independent chain state
 * while leaving unselected bodies completely unevaluated (C-E03-124).
 */
import type { EvaluationContext } from '../expr/evaluate.js';
import { evaluateExpression } from '../expr/evaluate.js';
import { registryForSlot } from '../expr/context.js';
import { expressionDiagnostic } from '../expr/errors.js';
import { parseExpression } from '../expr/parser.js';
import type { ExprValue } from '../expr/value.js';
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingNode, PipelineNode, SequenceNode } from '../frontend/parse.js';
import {
  walkTemplate,
  type DirectiveSite,
  type TemplateFrame,
  type TemplateVisitor,
} from './walk.js';

export type ConditionalExpansionContext = Omit<EvaluationContext, 'slot'>;

export interface ConditionalExpansionResult {
  readonly node: PipelineNode | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

interface ChainState {
  selected: boolean;
  ended: boolean;
}

type ConditionalSite = DirectiveSite & {
  readonly directive:
    | { readonly keyword: 'if' | 'elseif'; readonly condition: { readonly text: string } }
    | { readonly keyword: 'else' };
};

const CONTEXT_ERROR = 'template-directive-context';
const UNEXPECTED_DIRECTIVE = 'template-directive-unexpected';
const BODY_SHAPE_ERROR = 'template-directive-body-shape';
const EVALUATION_ERROR = 'template-condition-evaluation';

/** Expand all conditional insertions reachable from `root`, preserving every source position. */
export function expandConditionals(
  root: PipelineNode | undefined,
  frame: TemplateFrame,
  context: ConditionalExpansionContext = { values: {} },
): ConditionalExpansionResult {
  const diagnostics: Diagnostic[] = [];
  const chains = new WeakMap<MappingNode | SequenceNode, ChainState>();

  const expandBody = (body: PipelineNode): PipelineNode => {
    const nested = expandConditionals(body, frame, context);
    diagnostics.push(...nested.diagnostics);
    // A parsed directive always has a body node, so recursive expansion cannot turn it undefined.
    return nested.node ?? body;
  };

  const visitor: TemplateVisitor = {
    mappingDirective(site) {
      // `each`/`insert` own whether and how their bodies become reachable. Returning the original
      // site (rather than `undefined`) prevents the generic walker from evaluating a conditional
      // inside a not-yet-expanded loop/merge with missing bindings.
      if (!isConditional(site)) return [{ key: site.key, value: site.body }];
      if (!selects(site, chains, frame, context, diagnostics)) return [];
      if (site.body.kind !== 'mapping') {
        diagnostics.push(bodyShapeDiagnostic(site));
        return [];
      }
      // `expandConditionals` preserves the root container shape.
      return (expandBody(site.body) as MappingNode).entries;
    },
    sequenceDirective(site) {
      if (!isConditional(site)) return [site.item];
      if (!selects(site, chains, frame, context, diagnostics)) return [];
      const body = expandBody(site.body);
      // Sequence bodies flatten; mapping/scalar bodies become one item (C-E03-122).
      return body.kind === 'sequence' ? body.items : [body];
    },
  };

  const walked = walkTemplate(root, frame, visitor);
  return { node: walked.node, diagnostics: [...walked.diagnostics, ...diagnostics] };
}

function isConditional(site: DirectiveSite): site is ConditionalSite {
  return (
    site.directive.keyword === 'if' ||
    site.directive.keyword === 'elseif' ||
    site.directive.keyword === 'else'
  );
}

/** Update this container's state and answer whether this clause contributes its body. */
function selects(
  site: ConditionalSite,
  chains: WeakMap<MappingNode | SequenceNode, ChainState>,
  frame: TemplateFrame,
  context: ConditionalExpansionContext,
  diagnostics: Diagnostic[],
): boolean {
  const parent = site.parent;
  const directive = site.directive;

  if (directive.keyword === 'if') {
    const chain: ChainState = { selected: false, ended: false };
    chains.set(parent, chain);
    chain.selected = evaluateCondition(site, directive.condition.text, frame, context, diagnostics);
    return chain.selected;
  }

  const chain = chains.get(parent);
  if (chain === undefined || chain.ended) {
    diagnostics.push(...unsupportedClauseDiagnostics(site));
    return false;
  }

  if (directive.keyword === 'else') {
    chain.ended = true;
    if (chain.selected) return false;
    chain.selected = true;
    return true;
  }

  // First branch wins, and later conditions are lazy (C-E03-121).
  if (chain.selected) return false;
  chain.selected = evaluateCondition(site, directive.condition.text, frame, context, diagnostics);
  return chain.selected;
}

function evaluateCondition(
  site: ConditionalSite,
  text: string,
  frame: TemplateFrame,
  context: ConditionalExpansionContext,
  diagnostics: Diagnostic[],
): boolean {
  const parsed = parseExpression(text, { registry: registryForSlot(frame.slot) });
  if (!parsed.ok) {
    diagnostics.push(
      expressionDiagnostic(parsed.error, text, {
        file: frame.file,
        offset: site.key.pos.offset[0],
        range: site.key.pos.range,
      }),
    );
    return false;
  }

  try {
    return conditionTruth(evaluateExpression(parsed.node, { ...context, slot: frame.slot }));
  } catch (error) {
    diagnostics.push({
      severity: 'error',
      code: EVALUATION_ERROR,
      message: error instanceof Error ? error.message : String(error),
      file: frame.file,
      range: site.key.pos.range,
    });
    return false;
  }
}

/** C-E03-125: collections are truthy even when empty; primitives use their Boolean conversion. */
export function conditionTruth(value: ExprValue): boolean {
  switch (value.kind) {
    case 'null':
      return false;
    case 'boolean':
      return value.value;
    case 'number':
      return value.value !== 0;
    case 'string':
      return value.value !== '';
    case 'version':
    case 'array':
    case 'object':
      return true;
  }
}

function unsupportedClauseDiagnostics(site: ConditionalSite): Diagnostic[] {
  const keyword = site.directive.keyword;
  const diagnostics: Diagnostic[] = [
    {
      severity: 'error',
      code: CONTEXT_ERROR,
      message: `The expression directive '${keyword}' is not supported in this context`,
      file: site.frame.file,
      range: site.key.pos.range,
    },
  ];
  if (site.container === 'sequence') {
    diagnostics.push({
      severity: 'error',
      code: UNEXPECTED_DIRECTIVE,
      message: `Unexpected value '${String(site.key.value)}'`,
      file: site.frame.file,
      range: site.key.pos.range,
    });
  }
  return diagnostics;
}

function bodyShapeDiagnostic(site: ConditionalSite): Diagnostic {
  return {
    severity: 'error',
    code: BODY_SHAPE_ERROR,
    message: 'Expected a mapping',
    file: site.frame.file,
    range: site.body.pos.range,
  };
}
