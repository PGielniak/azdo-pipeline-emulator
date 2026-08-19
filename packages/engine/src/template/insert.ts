/**
 * The `${{ insert }}` merge directive, E03-S01-T04.
 *
 * Recognition and traversal stay in `walk.ts`; this module plugs into its directive seam, as
 * `conditionals.ts` and `each.ts` do. It owns one operation: resolve the directive's value to a
 * mapping and splice that mapping's entries into the parent, at the directive's own position.
 *
 * Grounding: the template-expressions doc's "Insertion" paragraph (C-E03-160/161 — the Ground
 * field's "templates doc" has no such section), the `actions/runner` fork, which for once *does*
 * implement the directive under test (C-E03-162), and 32 live preview probes under
 * `research/experiments/E03-insert/` (C-E03-163..174). Three findings shape the code:
 *
 *  - **Collisions are a hard error, and the rule is not this directive's** (C-E03-169/171). The
 *    task's `Do` field asks "error vs overwrite" and the answer is error — `'FOO' is already
 *    defined`, reported at the *later* occurrence, case-insensitively. But an `each`-produced key
 *    colliding with a literal rejects identically, with no `insert` anywhere, so the check lives in
 *    `walk.ts` where a mapping is rebuilt, not here. Putting it here would accept or reject the
 *    same document depending on which directive happened to produce the duplicate.
 *  - **A directive in sequence position is still a mapping-key insertion** (C-E03-174).
 *    `- ${{ insert }}: <object>` merges into the one-key mapping the *item* is, so this visitor
 *    returns one replacement item holding the merged mapping — where `if`/`each` splice their
 *    body's items into the parent sequence. Reusing their shape here silently flattens a step.
 *  - **The value must resolve to a mapping** (C-E03-172). A string, a sequence, a bare scalar and
 *    an empty value all reject with the same one-sentence `Expected a mapping`.
 */
import type { ExprValue } from '../expr/value.js';
import { objectEntries } from '../expr/value.js';
import type { MappingEntry, PipelineNode, Provenance, ScalarNode } from '../frontend/parse.js';
import {
  loneExpression,
  type DirectiveSite,
  type TemplateFrame,
  type TemplateVisitContext,
  type TemplateVisitor,
} from './walk.js';

export type InsertExpressionEvaluator = (expression: string, frame: TemplateFrame) => ExprValue;

/**
 * The service's sentence for a value that is not a mapping, byte for byte, and bare: directive
 * rejections carry no help link where expression rejections do (C-E03-129/172).
 */
export class InsertValueError extends Error {
  constructor() {
    super('Expected a mapping');
    this.name = 'InsertValueError';
  }
}

/**
 * Create the `insert` half of a template visitor. Combine it with `conditionalVisitor` and
 * `eachVisitor` through `composeVisitors`, **not** an object spread — `{...a, ...b}` keeps only the
 * last definition of each hook, and all three of these define both directive hooks. Directives this
 * module does not own return `undefined` and stay available to whichever pass does own them.
 */
export function insertVisitor(evaluate: InsertExpressionEvaluator): TemplateVisitor {
  return {
    mappingDirective: (site, context) =>
      site.directive.keyword === 'insert' ? merged(site, context, evaluate) : undefined,
    sequenceDirective: (site, context) => {
      if (site.directive.keyword !== 'insert') return undefined;
      // One item, not spliced items: the directive merged into the item's own mapping and the
      // service then validated *that* against the step schema (C-E03-174).
      return [{ kind: 'mapping', entries: merged(site, context, evaluate), pos: site.item.pos }];
    },
  };
}

/** The entries the directive contributes, in the source object's authored order (C-E03-163). */
function merged(
  site: DirectiveSite,
  context: TemplateVisitContext,
  evaluate: InsertExpressionEvaluator,
): MappingEntry[] {
  // A lone `${{ … }}` value is evaluated rather than walked. Walking it would work only because a
  // scalar visitor (E03-S01-T05) happens to be installed and would turn it into a structural node;
  // this path is the doc's canonical spelling and must not depend on a task that has not landed.
  if (site.body.kind === 'scalar' && typeof site.body.value === 'string') {
    const lone = loneExpression(site.body.value);
    if (lone === undefined) throw new InsertValueError();
    return entriesOf(evaluate(lone.inner, site.frame), site.body.pos);
  }

  // Otherwise it is written out as a mapping (C-E03-164). Walk it so directives nested inside the
  // inserted literal still expand.
  const body = context.walk(site.body, site.frame);
  if (body.kind !== 'mapping') throw new InsertValueError();
  return [...body.entries];
}

/** An evaluated object as mapping entries; anything else is the `Expected a mapping` case. */
function entriesOf(value: ExprValue, pos: Provenance): MappingEntry[] {
  if (value.kind !== 'object') throw new InsertValueError();
  // Zero entries is legal and contributes nothing (C-E03-165) — `objectEntries` keeps the object's
  // recorded order, which is what makes the authored order of C-E03-163 survive.
  return objectEntries(value).map(([key, child]) => ({
    key: { kind: 'scalar', value: key, style: 'plain', pos } satisfies ScalarNode,
    value: node(child, pos),
  }));
}

/**
 * An `ExprValue` as a DOM node. E03-S01-T05 owns the general lone-expression→structure conversion;
 * this is the same mapping restricted to what an inserted object can hold, and is deliberately
 * local so `insert` does not block on that task.
 */
function node(value: ExprValue, pos: Provenance): PipelineNode {
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
      return { kind: 'sequence', items: value.value.map((child) => node(child, pos)), pos };
    case 'object':
      return {
        kind: 'mapping',
        entries: objectEntries(value).map(([key, child]) => ({
          key: { kind: 'scalar', value: key, style: 'plain', pos } satisfies ScalarNode,
          value: node(child, pos),
        })),
        pos,
      };
  }
}
