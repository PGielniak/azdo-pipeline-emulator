/**
 * Conditional insertion chains (`${{ if / elseif / else }}`), E03-S01-T02.
 *
 * Recognition and traversal stay in `walk.ts`; this module plugs into its directive seam, exactly
 * as `each.ts` does. It owns one thing: deciding whether a branch wins, and splicing the winning
 * body into the parent.
 *
 * Grounding: Microsoft Learn C-E03-120/121 for the syntax and the two parent shapes, plus 21 live
 * preview probes under `research/experiments/E03-if/` (C-E03-122..133). The docs establish none of
 * the rules below; three of them are the reason this module is not a five-line `if` statement.
 *
 *  - **Chain membership is not adjacency-gated, and the winner is spliced at its *own* position**
 *    (C-E03-128). An ordinary sibling between `${{ if }}` and `${{ else }}` neither breaks the
 *    chain nor moves the output: with a false `if`, the probe emitted the intervening step *first*
 *    and the `else` body after it. So a chain is not a contiguous run that expands as a unit — each
 *    directive expands in place and merely consults the ones before it. That is why this file
 *    resolves each directive **independently by looking backwards**, rather than grouping a chain
 *    forwards from its `if` and emitting the winner at the head's index, which is the shape the
 *    task's own **Do** field suggests and which would reorder that document.
 *  - **Conditions and bodies of losing branches are never evaluated** (C-E02-132/133). Both were
 *    measured against a control that proves the read really does fail when it is reached
 *    (`ctl-missing-parameter`, HTTP 400 `Key not found 'missing'`), so the laziness here is a
 *    behavior we reproduce, not an optimization we chose. The backward scan gets it for free: it
 *    stops at the first earlier branch that wins, so nothing after a winner is ever touched.
 *  - **An `else` terminates its chain and an orphan is a hard error** (C-E03-129/130), while the
 *    same document shape with the directives merely *skipped* expands silently. Anything that
 *    treats "this `else` contributes nothing" and "this `else` has no `if`" as one case gets one of
 *    the two wrong.
 */
import { convertValue } from '../expr/coercion.js';
import type { ExprValue } from '../expr/value.js';
import type { MappingEntry, MappingNode, PipelineNode, ScalarNode } from '../frontend/parse.js';
import {
  parseDirectiveKey,
  type Directive,
  type DirectiveSite,
  type TemplateFrame,
  type TemplateVisitContext,
  type TemplateVisitor,
} from './walk.js';

export type ConditionEvaluator = (expression: string, frame: TemplateFrame) => ExprValue;

/**
 * A chain error. Carries the service's two sentences separately: the first names the rule, the
 * second echoes the raw key. They arrive newline-joined and **without** a help link, like every
 * other directive rejection and unlike every expression rejection (C-E03-129).
 */
export class ConditionalChainError extends Error {
  constructor(
    readonly keyword: 'elseif' | 'else',
    readonly rawKey: string,
  ) {
    super(
      `The expression directive '${keyword}' is not supported in this context\n` +
        `Unexpected value '${rawKey}'`,
    );
    this.name = 'ConditionalChainError';
  }
}

/**
 * Create the conditional half of a template visitor. Spread it together with `eachVisitor` and the
 * T04/T05 visitors; directives this module does not own return `undefined` and stay available to
 * whichever pass does own them.
 */
export function conditionalVisitor(evaluate: ConditionEvaluator): TemplateVisitor {
  // Conditions are memoized per key node. A chain of n members would otherwise re-evaluate its
  // head n times, and — more importantly — the memo is what keeps "evaluated at most once" true no
  // matter how the backward scan is entered.
  const decided = new WeakMap<ScalarNode, boolean>();
  return {
    mappingDirective: (site, context) => {
      if (!isConditional(site.directive)) return undefined;
      return taken(site, decided, evaluate) ? mappingBody(site, context) : [];
    },
    sequenceDirective: (site, context) => {
      if (!isConditional(site.directive)) return undefined;
      return taken(site, decided, evaluate) ? sequenceBody(site, context) : [];
    },
  };
}

function isConditional(directive: Directive): boolean {
  return (
    directive.keyword === 'if' || directive.keyword === 'elseif' || directive.keyword === 'else'
  );
}

function mappingBody(
  site: DirectiveSite & { container: 'mapping' },
  context: TemplateVisitContext,
): MappingEntry[] {
  const body = context.walk(site.body, site.frame);
  if (body.kind !== 'mapping') {
    throw new TypeError('a conditional directive in mapping position requires a mapping body');
  }
  // Spliced, not nested: the branch's keys become the parent's keys (C-E03-123).
  return [...body.entries];
}

function sequenceBody(
  site: DirectiveSite & { container: 'sequence' },
  context: TemplateVisitContext,
): PipelineNode[] {
  const body = context.walk(site.body, site.frame);
  if (body.kind !== 'sequence') {
    throw new TypeError('a conditional directive in sequence position requires a sequence body');
  }
  return [...body.items];
}

/** Does this directive win? `if` asks only itself; `elseif`/`else` ask their chain first. */
function taken(
  site: DirectiveSite,
  decided: WeakMap<ScalarNode, boolean>,
  evaluate: ConditionEvaluator,
): boolean {
  if (site.directive.keyword === 'if') {
    return condition(site.key, site.directive.condition.text, site.frame, decided, evaluate);
  }
  if (site.directive.keyword !== 'elseif' && site.directive.keyword !== 'else') return false;

  // Members before this one, in **document order**. Order is not a detail: the service stops at the
  // first winner, so `if true` / `elseif <raises>` / `else` expands, and evaluating the chain
  // nearest-first instead would touch the raising condition and reject a document the service
  // accepts (C-E03-132, probe `chain-shortcircuit-else`).
  for (const earlier of precedingBranches(site)) {
    if (condition(earlier.key, earlier.condition, site.frame, decided, evaluate)) return false;
  }
  // Nobody before it won: an `else` takes it, an `elseif` asks itself.
  return site.directive.keyword === 'else'
    ? true
    : condition(site.key, site.directive.condition.text, site.frame, decided, evaluate);
}

interface PrecedingBranch {
  readonly condition: string;
  readonly key: ScalarNode;
}

/**
 * The conditional directives before `site` in its parent, in document order, from the chain head.
 *
 * Non-directive siblings are skipped rather than treated as chain terminators — measured in both
 * parent shapes (C-E03-128). `each`/`insert` siblings are skipped too, which is **not** measured:
 * no probe put one inside a chain, so this is the reading consistent with C-E03-128 rather than a
 * claim, and it is recorded as an open question in `research/E03-template-engine.md`.
 *
 * Throws rather than returning empty for the two shapes the service rejects: a chain that reaches
 * the start of its parent without an `if` (C-E03-129), and one whose `else` already closed it
 * (C-E03-130).
 */
function precedingBranches(site: DirectiveSite): readonly PrecedingBranch[] {
  const keys =
    site.container === 'mapping'
      ? site.parent.entries.map((entry) => entry.key)
      : site.parent.items.map(soleKey);
  const orphan = (): never => {
    if (site.directive.keyword !== 'elseif' && site.directive.keyword !== 'else') {
      throw new TypeError('unreachable: only elseif/else look backwards');
    }
    throw new ConditionalChainError(site.directive.keyword, String(site.key.value));
  };

  const reversed: PrecedingBranch[] = [];
  for (let index = site.index - 1; index >= 0; index -= 1) {
    const key = keys[index];
    if (key === undefined || typeof key.value !== 'string') continue;
    const match = parseDirectiveKey(key.value);
    if (match.kind !== 'directive') continue;
    const { directive } = match;
    if (directive.keyword === 'else') orphan();
    if (directive.keyword !== 'if' && directive.keyword !== 'elseif') continue;
    reversed.push({ condition: directive.condition.text, key });
    if (directive.keyword === 'if') return reversed.reverse();
  }
  return orphan();
}

/** The directive key of a one-key-mapping sequence item, matching `walk.ts`'s own rule. */
function soleKey(item: PipelineNode): ScalarNode | undefined {
  if (item.kind !== 'mapping') return undefined;
  const mapping: MappingNode = item;
  if (mapping.entries.length !== 1) return undefined;
  return mapping.entries[0]?.key;
}

/**
 * Evaluate one condition, once. The result is **converted** to Boolean rather than required to be
 * one: `${{ if 'text' }}` is taken and `${{ if '' }}` is not (C-E03-131), which is the same
 * String→Boolean rule the conversion matrix already encodes (C-E02-020).
 */
function condition(
  key: ScalarNode,
  text: string,
  frame: TemplateFrame,
  decided: WeakMap<ScalarNode, boolean>,
  evaluate: ConditionEvaluator,
): boolean {
  const memo = decided.get(key);
  if (memo !== undefined) return memo;
  const converted = convertValue(evaluate(text, frame), 'boolean');
  const result = converted.kind === 'boolean' && converted.value;
  decided.set(key, result);
  return result;
}
