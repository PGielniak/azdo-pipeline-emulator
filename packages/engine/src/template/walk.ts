/**
 * The template DOM walker: a depth-first pass over E01's `PipelineNode` tree that **recognizes**
 * directives and maintains the per-file context stack, and executes nothing.
 *
 * That split is deliberate and is the task boundary. `${{ if/elseif/else }}` chain grouping is
 * E03-S01-T02, `${{ each }}` iteration is T03, `${{ insert }}` merging is T04 and scalar
 * interpolation is T05 — each of those has to land committed oracle fixture pairs of its own, so
 * executing them here would ship directive semantics without the grounding they mandate. What this
 * module owns is everything those four tasks would otherwise each re-derive: where a directive can
 * appear, how its text is parsed, and what names are in scope inside its body.
 *
 * Grounded by 33 live preview probes (`pnpm template-walk-survey`,
 * `research/experiments/E03-walk/`, claims `C-E03-100..115` in `research/E03-template-engine.md`).
 * Two of those findings shape the code more than the rest:
 *
 *  - **Directive text is tokenized, never string-split** (C-E03-101/104). Parameters are top-level
 *    expression units — `eq(1, 1)` is one — and `each item in split('a in b', ' in ')` iterates
 *    `a`,`b`, so the ` in ` inside the string literals is not a separator. An `indexOf(' in ')`
 *    implementation gets that case wrong *silently*, iterating the wrong collection with no error.
 *  - **Loop variables share one namespace with the contexts and may not redefine them**
 *    (C-E03-106). `${{ each variables in … }}` is rejected "The idenfifier 'variables' has already
 *    been defined within the current scope", so a frame adds to a flat namespace and rejects
 *    collisions; it does not shadow.
 */
import type {
  MappingEntry,
  MappingNode,
  PipelineNode,
  ScalarNode,
  SequenceNode,
} from '../frontend/parse.js';
import type { Diagnostic } from '../frontend/diagnostics.js';
import { tokenize, type Span, type Token } from '../expr/lexer.js';
import { EXPR_CONTEXT_NAMES, type ExprSlot } from '../expr/context.js';
import { trimExpressionText } from '../expr/errors.js';

/**
 * The five keywords, lower-case. Matched **case-sensitively** — `${{ IF … }}` is not a
 * mis-spelled directive, it is not a directive at all and its text falls through to ordinary
 * expression parsing (C-E03-100). This is the one place in the language where case matters; names
 * and even boolean literals fold it everywhere else (C-E02-002/011/012).
 */
export const DIRECTIVE_KEYWORDS = ['if', 'elseif', 'else', 'each', 'insert'] as const;

export type DirectiveKeyword = (typeof DIRECTIVE_KEYWORDS)[number];

const KEYWORDS: ReadonlySet<string> = new Set(DIRECTIVE_KEYWORDS);

/**
 * Expected parameter counts, where the service enforces one. `if`/`elseif` are **absent on
 * purpose**: a wrong count after them never produces the parameter-count sentence, it falls
 * through to an expression parse over the whole delimited text (C-E03-102). The mechanism behind
 * that split is not settled and is owned by T02/T03's fixture parity, so this table records only
 * what was measured.
 */
const EXPECTED_PARAMETERS: Readonly<Partial<Record<DirectiveKeyword, number>>> = {
  each: 3,
  else: 0,
  insert: 0,
};

/** A slice of the delimited text: one top-level expression unit (C-E03-101). */
export interface DirectiveParameter {
  readonly text: string;
  /** Relative to the **trimmed** delimited text, so `liftSpan` reaches file coordinates. */
  readonly span: Span;
}

export type Directive =
  | { readonly keyword: 'if' | 'elseif'; readonly condition: DirectiveParameter }
  | { readonly keyword: 'else' }
  | {
      readonly keyword: 'each';
      readonly variable: DirectiveParameter;
      readonly collection: DirectiveParameter;
    }
  | { readonly keyword: 'insert' };

/**
 * Why a scalar that *looked* like a directive is not one. `not-a-directive` is the ordinary
 * outcome for every non-directive key and carries no error: the caller falls back to treating the
 * key as an ordinary expression or literal, exactly as the service does (C-E03-100).
 */
export type DirectiveMatch =
  | { readonly kind: 'directive'; readonly directive: Directive; readonly text: string }
  | { readonly kind: 'not-a-directive' }
  | { readonly kind: 'malformed'; readonly message: string; readonly span: Span };

/**
 * Is this scalar text exactly one `${{ … }}` expression, and if so what is inside it?
 *
 * "Exactly one" is load-bearing: mixed content (`name-${{ x }}`) is interpolation (T05), never a
 * directive, and a directive keyword in a *value* is not a directive at all (C-E03-112). The
 * returned offset is into `text`, so a caller holding the scalar's file offset can lift spans.
 *
 * The closing `}}` is found by scanning **outside single-quoted strings**, not by `endsWith`,
 * because the documented escape for a literal `${{` is to put it inside one: `${{ 'my${{value' }}`
 * (C-E03-117). A naive scan reports "not a lone expression" for a spelling the docs give as the
 * canonical way to write it — and this function is what E03-S01-T05 will use to make exactly that
 * distinction, so the bug would land there rather than here.
 */
export function loneExpression(
  text: string,
): { readonly inner: string; readonly offset: number } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('${{')) return undefined;
  const end = closingDelimiter(trimmed, 3);
  // A `}}` anywhere before the end means the scalar continues past this expression: mixed content.
  if (end === undefined || end + 2 !== trimmed.length) return undefined;
  const lead = text.length - text.trimStart().length;
  const inner = trimExpressionText(trimmed.slice(3, end));
  return { inner: inner.text, offset: lead + 3 + inner.offset };
}

/**
 * Index of the `}}` that closes an expression opened at `from`, or `undefined` if there is none.
 * Single-quoted strings are skipped, `''` being the escape for a quote inside one (C-E02-006).
 */
function closingDelimiter(text: string, from: number): number | undefined {
  let index = from;
  while (index < text.length) {
    const char = text[index];
    if (char === "'") {
      index += 1;
      while (index < text.length) {
        if (text[index] === "'") {
          if (text[index + 1] !== "'") break;
          index += 1; // `''` — a literal quote, not the terminator
        }
        index += 1;
      }
      index += 1; // past the closing quote (or past the end of an unterminated string)
      continue;
    }
    if (char === '}' && text[index + 1] === '}') return index;
    index += 1;
  }
  return undefined;
}

/**
 * Split the trimmed delimited text into `<keyword> <parameter>*` the way the service does: with
 * the expression **lexer**, reading off top-level units (C-E03-101).
 *
 * A unit boundary is a token at bracket depth 0 that cannot continue the preceding one. That is
 * the whole rule, and it reproduces every measured count: `if eq(1, 1)` is 2 units (so `if` has 1
 * parameter), `each a in parameters.items extra` is 5 (4 parameters, matching "Actual parameter
 * count: 4"), and `each item in split('a in b', ' in ')` is 4 — the string literals are single
 * tokens, which is why the separator inside them is invisible (C-E03-104).
 */
export function expressionUnits(text: string): readonly DirectiveParameter[] {
  const units: DirectiveParameter[] = [];
  let depth = 0;
  let previous: Token | undefined;
  let start: number | undefined;

  for (const token of tokenize(text)) {
    const continues =
      depth > 0 ||
      // Postfix and grouping tokens never begin a unit…
      token.kind === 'dereference' ||
      token.kind === 'startIndex' ||
      token.kind === 'startParameters' ||
      token.kind === 'endIndex' ||
      token.kind === 'endParameters' ||
      token.kind === 'separator' ||
      token.kind === 'propertyName' ||
      token.kind === 'wildcard' ||
      // …and a property name is whatever follows `.`, whichever kind the lexer gave it.
      previous?.kind === 'dereference';

    if (!continues) {
      if (start !== undefined && previous !== undefined) {
        units.push({
          text: text.slice(start, previous.span.end),
          span: { start, end: previous.span.end },
        });
      }
      start = token.span.start;
    }

    if (token.kind === 'startParameters' || token.kind === 'startIndex') depth += 1;
    if (token.kind === 'endParameters' || token.kind === 'endIndex') depth = Math.max(0, depth - 1);
    previous = token;
  }

  if (start !== undefined && previous !== undefined) {
    units.push({
      text: text.slice(start, previous.span.end),
      span: { start, end: previous.span.end },
    });
  }
  return units;
}

/**
 * Classify one mapping key / sequence-item key. `text` is the raw scalar text; spans in the result
 * are relative to the trimmed expression, matching what `serviceMessageBody` expects.
 */
export function parseDirectiveKey(text: string): DirectiveMatch {
  const lone = loneExpression(text);
  if (lone === undefined) return { kind: 'not-a-directive' };

  const units = expressionUnits(lone.inner);
  const head = units[0];
  // Case-sensitive, and a miss is not an error here (C-E03-100) — the caller parses the text as an
  // ordinary expression and reports whatever *that* says, which is what the service does.
  if (head === undefined || !KEYWORDS.has(head.text)) return { kind: 'not-a-directive' };

  const keyword = head.text as DirectiveKeyword;
  const parameters = units.slice(1);
  const expected = EXPECTED_PARAMETERS[keyword];
  const whole: Span = { start: 0, end: lone.inner.length };

  if (expected !== undefined && parameters.length !== expected) {
    return {
      kind: 'malformed',
      message:
        `Exactly ${String(expected)} parameter(s) were expected following the directive ` +
        `'${keyword}'. Actual parameter count: ${String(parameters.length)}`,
      span: whole,
    };
  }

  switch (keyword) {
    case 'else':
      return { kind: 'directive', directive: { keyword }, text: lone.inner };
    case 'insert':
      return { kind: 'directive', directive: { keyword }, text: lone.inner };
    case 'if':
    case 'elseif': {
      const condition = parameters[0];
      // No parameter-count sentence exists for these two (C-E03-102); the caller falls back to an
      // ordinary expression parse of the whole text, which is what the service reports.
      if (condition === undefined || parameters.length !== 1) return { kind: 'not-a-directive' };
      return { kind: 'directive', directive: { keyword, condition }, text: lone.inner };
    }
    case 'each': {
      const [variable, separator, collection] = parameters;
      if (variable === undefined || separator === undefined || collection === undefined) {
        return { kind: 'not-a-directive' };
      }
      // The separator is compared as text and is case-sensitive (C-E03-103).
      if (separator.text !== 'in') {
        return {
          kind: 'malformed',
          message:
            `The value '${separator.text}' is unexpected. The expected format of an 'each' ` +
            'expression is: ${ each <identifier> in <value> }',
          span: separator.span,
        };
      }
      return { kind: 'directive', directive: { keyword, variable, collection }, text: lone.inner };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Context stack
// ---------------------------------------------------------------------------------------------

/**
 * One file's frame. `depth` and `file` carry the information E03-S02-T01 (reference resolution)
 * and E03-S04-T01 (server limits) hang off; nothing here interprets them.
 *
 * `names` holds the `each` loop variables in scope, keyed **lower-case** (C-E03-107). The
 * *values* are deliberately absent: binding an iteration to its element is E03-S01-T03's, and this
 * module only owns which names exist and whether a new one is legal.
 */
export interface TemplateFrame {
  readonly file: string;
  readonly depth: number;
  readonly slot: ExprSlot;
  readonly names: ReadonlySet<string>;
}

export function rootFrame(file: string): TemplateFrame {
  return { file, depth: 0, slot: 'template-expression', names: new Set() };
}

/** A file entered from `frame` — its own names, one level deeper (docs/02 §5: per-file context). */
export function childFrame(frame: TemplateFrame, file: string): TemplateFrame {
  return { file, depth: frame.depth + 1, slot: frame.slot, names: new Set() };
}

export type BindResult =
  | { readonly ok: true; readonly frame: TemplateFrame }
  | { readonly ok: false; readonly message: string };

/**
 * Add an `each` loop variable to the frame.
 *
 * Two rules, both measured, and both different from what a conventional scope would do:
 * the name space is **flat and shared with the contexts** (`each variables in …` collides), and a
 * collision is an **error rather than shadowing** (C-E03-106). The message is the service's own
 * sentence — including its misspelling of "identifier", which is text we reproduce rather than
 * correct.
 */
export function bindLoopVariable(frame: TemplateFrame, name: string): BindResult {
  const folded = name.toLowerCase();
  const taken =
    frame.names.has(folded) ||
    EXPR_CONTEXT_NAMES.some((context) => context.toLowerCase() === folded);
  if (taken) {
    return {
      ok: false,
      message: `The idenfifier '${name}' has already been defined within the current scope`,
    };
  }
  return { ok: true, frame: { ...frame, names: new Set([...frame.names, folded]) } };
}

// ---------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------

/** Where a directive was found. The two container shapes need different splices downstream. */
export type DirectiveSite =
  | {
      readonly container: 'mapping';
      readonly directive: Directive;
      readonly key: ScalarNode;
      readonly body: PipelineNode;
      readonly frame: TemplateFrame;
      /** Index of the entry within `parent.entries`, so a chain can be grouped in document order. */
      readonly index: number;
      readonly parent: MappingNode;
    }
  | {
      readonly container: 'sequence';
      readonly directive: Directive;
      readonly key: ScalarNode;
      readonly body: PipelineNode;
      readonly frame: TemplateFrame;
      readonly index: number;
      readonly parent: SequenceNode;
      /** The one-key mapping the directive item actually is. */
      readonly item: MappingNode;
    };

/**
 * The seam T02–T05 plug into. Returning `undefined` from either hook leaves the node untouched,
 * which is what makes T01 shippable on its own: the default walk is a faithful traversal that
 * changes nothing and reports what it saw.
 */
export interface TemplateVisitor {
  /** Replacement entries for a directive in mapping position, or `undefined` to leave it. */
  readonly mappingDirective?: (
    site: DirectiveSite & { container: 'mapping' },
  ) => MappingEntry[] | undefined;
  /** Replacement items for a directive in sequence position, or `undefined` to leave it. */
  readonly sequenceDirective?: (
    site: DirectiveSite & { container: 'sequence' },
  ) => PipelineNode[] | undefined;
  /** Every scalar the walk reaches, in document order — T05's interpolation hook. */
  readonly scalar?: (node: ScalarNode, frame: TemplateFrame) => PipelineNode | undefined;
}

export interface WalkResult {
  readonly node: PipelineNode | undefined;
  /** Every directive seen, in document order. */
  readonly directives: readonly DirectiveSite[];
  /**
   * Accumulated, never thrown: the service reports **every** bad expression in a document,
   * newline-joined (C-E02-110), so a walk that aborted on the first would report a strict subset of
   * what the user would see from the real thing.
   */
  readonly diagnostics: readonly Diagnostic[];
}

const MALFORMED_DIRECTIVE = 'template-directive-malformed';

interface WalkState {
  readonly visitor: TemplateVisitor;
  readonly directives: DirectiveSite[];
  readonly diagnostics: Diagnostic[];
  /**
   * Classification is memoized per key node because the sequence walk has to *look* at an item's
   * key to decide whether the item is a directive, and then the mapping walk looks at the same key
   * again when it is not. Without this, every malformed directive in sequence position reported
   * its diagnostic twice — which the accumulation test caught.
   */
  readonly classified: WeakMap<ScalarNode, DirectiveMatch>;
}

export function walkTemplate(
  root: PipelineNode | undefined,
  frame: TemplateFrame,
  visitor: TemplateVisitor = {},
): WalkResult {
  const state: WalkState = {
    visitor,
    directives: [],
    diagnostics: [],
    classified: new WeakMap(),
  };
  const node = root === undefined ? undefined : walkNode(root, frame, state);
  return { node, directives: state.directives, diagnostics: state.diagnostics };
}

function walkNode(node: PipelineNode, frame: TemplateFrame, state: WalkState): PipelineNode {
  switch (node.kind) {
    case 'scalar':
      return state.visitor.scalar?.(node, frame) ?? node;
    case 'mapping':
      return walkMapping(node, frame, state);
    case 'sequence':
      return walkSequence(node, frame, state);
  }
}

function walkMapping(node: MappingNode, frame: TemplateFrame, state: WalkState): MappingNode {
  const entries: MappingEntry[] = [];
  node.entries.forEach((entry, index) => {
    const match = classify(entry.key, frame, state);
    if (match?.kind === 'directive') {
      const site: DirectiveSite & { container: 'mapping' } = {
        container: 'mapping',
        directive: match.directive,
        key: entry.key,
        body: entry.value,
        frame,
        index,
        parent: node,
      };
      state.directives.push(site);
      const replacement = state.visitor.mappingDirective?.(site);
      if (replacement !== undefined) {
        entries.push(...replacement);
        return;
      }
      // Not executed here (T02/T03/T04 own that): descend into the body so nested directives and
      // scalars are still visited, and keep the entry — provenance included — exactly as parsed.
      entries.push({ key: entry.key, value: walkNode(entry.value, frame, state) });
      return;
    }
    entries.push({
      key: (state.visitor.scalar?.(entry.key, frame) as ScalarNode | undefined) ?? entry.key,
      value: walkNode(entry.value, frame, state),
    });
  });
  return { kind: 'mapping', entries, pos: node.pos };
}

function walkSequence(node: SequenceNode, frame: TemplateFrame, state: WalkState): SequenceNode {
  const items: PipelineNode[] = [];
  node.items.forEach((item, index) => {
    const directiveEntry = soleDirectiveEntry(item, frame, state);
    if (directiveEntry !== undefined) {
      const site: DirectiveSite & { container: 'sequence' } = {
        container: 'sequence',
        directive: directiveEntry.match.directive,
        key: directiveEntry.entry.key,
        body: directiveEntry.entry.value,
        frame,
        index,
        parent: node,
        item: directiveEntry.mapping,
      };
      state.directives.push(site);
      const replacement = state.visitor.sequenceDirective?.(site);
      if (replacement !== undefined) {
        items.push(...replacement);
        return;
      }
      // Descend into the body only. Walking `item` whole would re-enter `walkMapping`, which
      // would classify the same key a second time and record the site twice — the first version
      // of this loop did exactly that, and the nested-directive test is what caught it.
      items.push({
        kind: 'mapping',
        entries: [
          {
            key: directiveEntry.entry.key,
            value: walkNode(directiveEntry.entry.value, frame, state),
          },
        ],
        pos: directiveEntry.mapping.pos,
      });
      return;
    }
    items.push(walkNode(item, frame, state));
  });
  return { kind: 'sequence', items, pos: node.pos };
}

/**
 * A directive in sequence position is a sequence item that is a mapping whose **only** key is the
 * directive — `- ${{ if … }}:` followed by the body. A mapping with other keys alongside is an
 * ordinary item that happens to contain a directive key, and is walked as a mapping (which is also
 * how the corpus's `${{ if ne(pair.key, 'steps') }}` sibling-key idiom is reached).
 */
function soleDirectiveEntry(
  item: PipelineNode,
  frame: TemplateFrame,
  state: WalkState,
):
  | { mapping: MappingNode; entry: MappingEntry; match: DirectiveMatch & { kind: 'directive' } }
  | undefined {
  if (item.kind !== 'mapping' || item.entries.length !== 1) return undefined;
  const entry = item.entries[0];
  if (entry === undefined) return undefined;
  const match = classify(entry.key, frame, state);
  if (match?.kind !== 'directive') return undefined;
  return { mapping: item, entry, match };
}

/**
 * Classify a key, recording a diagnostic for a malformed directive. Returns `undefined` for
 * anything that is not a directive — including a *wrongly cased* keyword, which is an ordinary
 * expression key as far as this layer is concerned (C-E03-100).
 */
function classify(
  key: ScalarNode,
  frame: TemplateFrame,
  state: WalkState,
): DirectiveMatch | undefined {
  if (typeof key.value !== 'string') return undefined;
  let match = state.classified.get(key);
  if (match === undefined) {
    match = parseDirectiveKey(key.value);
    state.classified.set(key, match);
    if (match.kind === 'malformed') state.diagnostics.push(malformedDiagnostic(match, key, frame));
  }
  return match.kind === 'directive' ? match : undefined;
}

function malformedDiagnostic(
  match: DirectiveMatch & { kind: 'malformed' },
  key: ScalarNode,
  frame: TemplateFrame,
): Diagnostic {
  return {
    severity: 'error',
    code: MALFORMED_DIRECTIVE,
    // No help link, and that is measured rather than an omission: both directive sentences come
    // back from the service bare, while every *expression* error in the same responses ends with
    // "For more help, refer to <link>" (C-E03-101/103). E02's `serviceMessageBody` classifies its
    // own codes the same way — these two are simply not expression errors.
    message: match.message,
    file: frame.file,
    // The host scalar's own range: the service locates a directive error at the key, not inside it
    // (C-E02-105), and here that is also where the caret is most useful.
    range: key.pos.range,
  };
}
