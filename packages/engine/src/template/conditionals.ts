/**
 * Compile-time `${{ if }}` / `${{ elseif }}` / `${{ else }}` insertion.
 *
 * The service behavior is grounded by three live-preview surveys: 45 probes and 37 committed
 * input/final-YAML pairs for the chain rules themselves (`fixtures/oracle/directives/`; claims
 * C-E03-120..137), plus E03-S01-T04's `insert` survey, which settled the two questions this module
 * could not answer on its own (C-E03-138/139). Four rules are easy to miss:
 *
 * - chain state belongs to the containing sequence/mapping, so an *ordinary* sibling does not end a
 *   chain (C-E03-128) — but a *directive* sibling does (C-E03-138),
 * - the winning body is emitted at its directive's own document position (C-E03-128),
 * - after one branch wins, later `elseif` expressions are not evaluated (C-E03-132), and
 * - the orphan rejection's second sentence depends on the parent shape (C-E03-139).
 *
 * This pass plugs into T01's `walkTemplate` visitor seam. The walker preserves ordinary nodes and
 * provenance; the hooks below replace only conditional directive sites, and selected bodies are
 * walked recursively so nested containers get independent chain state while unselected bodies stay
 * completely unevaluated (C-E03-126/133).
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
  composeVisitors,
  walkTemplate,
  type DirectiveSite,
  type TemplateFrame,
  type TemplateVisitContext,
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

/**
 * Create the conditional half of a template visitor, owning one chain state per container.
 *
 * Compose it with `eachVisitor`/`insertVisitor` through `composeVisitors`, and compose it **first**.
 * It returns `undefined` for directives it does not own, so the others still get their turn — but
 * it has to *see* those sites, because a directive sibling between two chain members ends the chain
 * (C-E03-138) and a visitor that never reaches the `each`/`insert` site cannot know that happened.
 */
export function conditionalVisitor(
  context: ConditionalExpansionContext = { values: {} },
): TemplateVisitor {
  const chains = new WeakMap<MappingNode | SequenceNode, ChainState>();
  return {
    mappingDirective(site, visit) {
      if (!isConditional(site)) return endChain(chains, site.parent);
      if (!selects(site, chains, context, visit)) return [];
      if (site.body.kind !== 'mapping') {
        visit.report(bodyShapeDiagnostic(site));
        return [];
      }
      // Walking a mapping always yields a mapping, so the branch's keys can join the parent's.
      return (visit.walk(site.body, site.frame) as MappingNode).entries;
    },
    sequenceDirective(site, visit) {
      if (!isConditional(site)) return endChain(chains, site.parent);
      if (!selects(site, chains, context, visit)) return [];
      const body = visit.walk(site.body, site.frame);
      // Sequence bodies flatten; a mapping body becomes one item (C-E03-136). The original Side A
      // survey also retained scalar bodies here, but did not claim or fixture that shape.
      return body.kind === 'sequence' ? body.items : [body];
    },
  };
}

/**
 * Leave `each`/`insert` sites exactly as parsed, body included.
 *
 * `expandConditionals` is a conditionals-only pass, so it must not let the generic walker descend
 * into a loop or merge body: a conditional in there would be evaluated against bindings that do not
 * exist yet. Returning the original site rather than `undefined` is what stops the descent.
 */
const frozenDirectives: TemplateVisitor = {
  mappingDirective: (site) => [{ key: site.key, value: site.body }],
  sequenceDirective: (site) => [site.item],
};

/** Expand all conditional insertions reachable from `root`, preserving every source position. */
export function expandConditionals(
  root: PipelineNode | undefined,
  frame: TemplateFrame,
  context: ConditionalExpansionContext = { values: {} },
): ConditionalExpansionResult {
  const walked = walkTemplate(
    root,
    frame,
    composeVisitors(conditionalVisitor(context), frozenDirectives),
  );
  return { node: walked.node, diagnostics: walked.diagnostics };
}

function isConditional(site: DirectiveSite): site is ConditionalSite {
  return (
    site.directive.keyword === 'if' ||
    site.directive.keyword === 'elseif' ||
    site.directive.keyword === 'else'
  );
}

/**
 * C-E03-138: an `${{ each }}` or `${{ insert }}` between two chain members orphans the member that
 * follows, so the same state an `else` sets is set here — measured in both parent shapes, for both
 * intervening directives, for a trailing `elseif` as well as `else`, and against controls placing
 * the same `insert` immediately before and immediately after the chain, where the document expands.
 * E03-S01-T02 shipped the opposite reading as a flagged guess; E03-S01-T04 refuted it.
 *
 * Returns `undefined` so the composed `each`/`insert` visitor still owns the site.
 */
function endChain(
  chains: WeakMap<MappingNode | SequenceNode, ChainState>,
  parent: MappingNode | SequenceNode,
): undefined {
  const chain = chains.get(parent);
  if (chain !== undefined) chain.ended = true;
  return undefined;
}

/** Update this container's state and answer whether this clause contributes its body. */
function selects(
  site: ConditionalSite,
  chains: WeakMap<MappingNode | SequenceNode, ChainState>,
  context: ConditionalExpansionContext,
  visit: TemplateVisitContext,
): boolean {
  const parent = site.parent;
  const directive = site.directive;

  if (directive.keyword === 'if') {
    const chain: ChainState = { selected: false, ended: false };
    chains.set(parent, chain);
    chain.selected = evaluateCondition(site, directive.condition.text, context, visit);
    return chain.selected;
  }

  const chain = chains.get(parent);
  if (chain === undefined || chain.ended) {
    for (const diagnostic of unsupportedClauseDiagnostics(site)) visit.report(diagnostic);
    return false;
  }

  if (directive.keyword === 'else') {
    chain.ended = true;
    if (chain.selected) return false;
    chain.selected = true;
    return true;
  }

  // First branch wins, and later conditions are lazy (C-E03-132).
  if (chain.selected) return false;
  chain.selected = evaluateCondition(site, directive.condition.text, context, visit);
  return chain.selected;
}

function evaluateCondition(
  site: ConditionalSite,
  text: string,
  context: ConditionalExpansionContext,
  visit: TemplateVisitContext,
): boolean {
  const frame = site.frame;
  // The frame's names and bindings are what let a condition read an enclosing `each` variable. They
  // are empty at the root, so this is a no-op for the standalone pass and only matters once
  // `eachVisitor` is composed in (C-E03-107/151).
  const parsed = parseExpression(text, {
    registry: registryForSlot(frame.slot, [...frame.names]),
  });
  if (!parsed.ok) {
    visit.report(
      expressionDiagnostic(parsed.error, text, {
        file: frame.file,
        offset: site.key.pos.offset[0],
        range: site.key.pos.range,
      }),
    );
    return false;
  }

  try {
    return conditionTruth(
      evaluateExpression(parsed.node, { ...context, slot: frame.slot, locals: frame.bindings }),
    );
  } catch (error) {
    visit.report({
      severity: 'error',
      code: EVALUATION_ERROR,
      message: error instanceof Error ? error.message : String(error),
      file: frame.file,
      range: site.key.pos.range,
    });
    return false;
  }
}

/** C-E03-131/135: collections are truthy even when empty; primitives use Boolean truthiness. */
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

/**
 * The service's sentences for an `elseif`/`else` whose chain does not reach a live `if` — an orphan
 * (C-E03-129), one whose `else` already closed the chain (C-E03-130/137), and one broken by a
 * directive sibling (C-E03-138). All three produce the same rejection.
 *
 * The first sentence names the rule; the **second depends on the parent shape**, which E03-S01-T02
 * could not know because it only ever probed a sequence: there the service echoes the raw key,
 * while in a mapping it complains about the branch *body* instead (C-E03-139). A mapping-position
 * rejection also carries a third sentence — `Expected end of template object.` followed by a dump
 * of the engine's internal reader stack — which is a service implementation detail with no meaning
 * to a pipeline author, so it is deliberately not reproduced (docs/06 §5 decision 33).
 */
function unsupportedClauseDiagnostics(site: ConditionalSite): Diagnostic[] {
  const keyword = site.directive.keyword;
  return [
    {
      severity: 'error',
      code: CONTEXT_ERROR,
      message: `The expression directive '${keyword}' is not supported in this context`,
      file: site.frame.file,
      range: site.key.pos.range,
    },
    site.container === 'sequence'
      ? {
          severity: 'error',
          code: UNEXPECTED_DIRECTIVE,
          message: `Unexpected value '${String(site.key.value)}'`,
          file: site.frame.file,
          range: site.key.pos.range,
        }
      : {
          severity: 'error',
          code: UNEXPECTED_DIRECTIVE,
          message: 'A mapping was not expected',
          file: site.frame.file,
          range: site.body.pos.range,
        },
  ];
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
