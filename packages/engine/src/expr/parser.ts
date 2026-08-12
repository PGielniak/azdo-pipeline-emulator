/**
 * Expression parser (E02-S01-T01) — tokens (lexer.ts) → the single AST both E02 backends consume:
 * the convert-time evaluator (E02-S02/S03) and the bash compiler (E02-S05). Structural divergence
 * between the two is impossible by construction because there is only one tree.
 *
 * **The grammar is tiny, and that is a finding, not a simplification.** Azure Pipelines has no
 * operators at all — `1 == 1`, `!true`, `a && b`, and parenthesised grouping `(true)` are each
 * rejected by the service while `eq(1, 1)` is accepted (C-E02-001). So there is no precedence to
 * climb:
 *
 *     expression := primary postfix*
 *     primary    := boolean | number | version | string | namedValue | function '(' args ')'
 *     postfix    := '.' propertyName | '.' '*' | '[' expression ']' | '[' '*' ']'
 *
 * Everything else the service rejects, and this parser rejects it in the same place — positions
 * are asserted against `research/experiments/E02-grammar/survey.md` row by row.
 *
 * **Name and arity validation is optional and injected.** The service resolves function and
 * context names while parsing: `nosuchfunc(1)` fails at the *name*, `eq(1)` fails at the closing
 * paren (C-E02-011/012/013a). Function semantics belong to E02-S03 and contexts to E02-S04, so
 * this module takes an `ExprRegistry` instead of knowing any of them — omit it and names pass
 * unchecked, which is what the tokenizer tests and any syntax-only caller want.
 *
 * **Name resolution is deferred; syntax is not** (C-E02-020, E02-S01-T02). `nosuchfunc(1) 2` and
 * `nosuchcontext 2` are both reported by the service at the leftover `2`, never at the name, while
 * `eq(1) 2` (an arity error, i.e. syntax) is reported at the `)`. So an unresolvable name is
 * remembered and raised only if the parse otherwise succeeds. That is what makes `! true` report
 * the operand rather than the `!`, which E02-S01-T01 recorded as an unexplained divergence.
 */
import { tokenize, type Span, type Token } from './lexer.js';

export type ExprLiteral =
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string }
  /** 3 or 4 segments — a 2-segment literal is a number (C-E02-005). */
  | { readonly kind: 'version'; readonly segments: readonly number[] };

export type ExprNode =
  | { readonly type: 'literal'; readonly literal: ExprLiteral; readonly span: Span }
  | { readonly type: 'namedValue'; readonly name: string; readonly span: Span }
  | {
      readonly type: 'call';
      readonly name: string;
      readonly nameSpan: Span;
      readonly args: readonly ExprNode[];
      readonly span: Span;
    }
  /**
   * `a.b`. Kept distinct from `index` even though the service treats the two spellings as one
   * operation, because diagnostics and the printer must reproduce the form that was written.
   * Evaluation (E02-S02-T03) collapses them again.
   */
  | {
      readonly type: 'property';
      readonly target: ExprNode;
      readonly name: string;
      readonly nameSpan: Span;
      readonly span: Span;
    }
  /** `a['b']`, `a[0]`, `a[expr]`, and both wildcard spellings (C-E02-008/009). */
  | {
      readonly type: 'index';
      readonly target: ExprNode;
      readonly index: ExprNode;
      readonly span: Span;
    }
  /** `*` — only ever the `index` of an index node; `a.*.b` and `a[*].b` produce the same tree. */
  | { readonly type: 'wildcard'; readonly span: Span };

export type ExprErrorCode =
  | 'unrecognized-value'
  | 'unexpected-symbol'
  | 'empty-expression'
  | 'expected-property-name'
  | 'unclosed-function'
  | 'exceeded-max-depth';

export interface ExprParseError {
  readonly code: ExprErrorCode;
  /** Service-shaped sentence (C-E02-013). E02-S01-T02 owns the full rendering with the caret. */
  readonly message: string;
  /** The offending text, as the service quotes it. */
  readonly raw: string;
  /** Expression-relative; `liftSpan` converts to file coordinates. */
  readonly span: Span;
}

export type ExprParseResult =
  | { readonly ok: true; readonly node: ExprNode; readonly text: string }
  | { readonly ok: false; readonly error: ExprParseError; readonly text: string };

export interface FunctionSignature {
  readonly name: string;
  readonly minArgs: number;
  /** `Infinity` for the N-ary functions (`and`, `or`, `format`, `in`, …). */
  readonly maxArgs: number;
}

/** Names are matched case-insensitively (C-E02-011/012), so both maps are keyed lower-case. */
export interface ExprRegistry {
  readonly functions: ReadonlyMap<string, FunctionSignature>;
  readonly namedValues: ReadonlySet<string>;
}

export interface ParseOptions {
  /** Omit to skip name/arity checks entirely (syntax-only parse). */
  readonly registry?: ExprRegistry | undefined;
}

export function makeRegistry(
  functions: readonly FunctionSignature[],
  namedValues: readonly string[],
): ExprRegistry {
  return {
    functions: new Map(functions.map((fn) => [fn.name.toLowerCase(), fn])),
    namedValues: new Set(namedValues.map((name) => name.toLowerCase())),
  };
}

/** Maximum nesting depth, measured exactly: depth 50 parses, 51 does not (C-E02-014). */
export const MAX_DEPTH = 50;

/** Thrown internally, converted to an `ExprParseError` at the boundary — never escapes. */
class ParseFailure extends Error {
  constructor(readonly error: ExprParseError) {
    super(error.message);
    this.name = 'ParseFailure';
  }
}

// Declared as functions, not arrow consts: TypeScript only lets a `never`-returning call narrow
// control flow when the callee is a function declaration or an explicitly typed variable.
function fail(code: ExprErrorCode, message: string, raw: string, span: Span): never {
  throw new ParseFailure({ code, message, raw, span });
}

function unexpected(token: Token): never {
  return token.kind === 'unrecognized'
    ? fail('unrecognized-value', `Unrecognized value: '${token.raw}'`, token.raw, token.span)
    : fail('unexpected-symbol', `Unexpected symbol: '${token.raw}'`, token.raw, token.span);
}

/**
 * Parse one expression — the text *between* `${{` and `}}` (or `$[` and `]`), without the
 * delimiters. Both are the same grammar: the service parses runtime expressions at queue time and
 * rejects the same inputs, only rendering the error differently (C-E02-015).
 */
export function parseExpression(text: string, options: ParseOptions = {}): ExprParseResult {
  const tokens = tokenize(text);
  try {
    if (tokens.length === 0) {
      fail('empty-expression', 'An expression was expected', text, { start: 0, end: text.length });
    }
    const state: State = { tokens, at: 0, registry: options.registry, pending: undefined };
    const node = parseOperand(state);
    const next = state.tokens[state.at];
    // Anything left over is an error at the leftover token, and it is always phrased as a *symbol*
    // whatever the token is: `1 2` → "Unexpected symbol: '2'", `! true` → "Unexpected symbol:
    // 'true'", `1 !` → "Unexpected symbol: '!'" (C-E02-020).
    if (next !== undefined) {
      fail('unexpected-symbol', `Unexpected symbol: '${next.raw}'`, next.raw, next.span);
    }
    // Before the deferred name error: the service's depth counter runs while it parses, so a
    // too-deep expression full of unknown names reports the depth (C-E02-014).
    checkDepth(node, 1, text);
    if (state.pending !== undefined) throw new ParseFailure(state.pending);
    return { ok: true, node, text };
  } catch (error) {
    if (error instanceof ParseFailure) return { ok: false, error: error.error, text };
    throw error;
  }
}

interface State {
  readonly tokens: readonly Token[];
  at: number;
  readonly registry: ExprRegistry | undefined;
  /** The first unresolvable name, raised at the end of a successful parse (C-E02-020). */
  pending: ExprParseError | undefined;
}

/** First name error wins; any syntax error raised later still beats it. */
function defer(state: State, name: Token): void {
  state.pending ??= {
    code: 'unrecognized-value',
    message: `Unrecognized value: '${name.raw}'`,
    raw: name.raw,
    span: name.span,
  };
}

const peek = (state: State): Token | undefined => state.tokens[state.at];

/** The last token's end, used to position "ran off the end" errors. */
const endSpan = (state: State): Span => {
  const last = state.tokens[state.tokens.length - 1];
  const end = last === undefined ? 0 : last.span.end;
  return { start: end, end };
};

function parseOperand(state: State): ExprNode {
  let node = parsePrimary(state);
  // Postfix chain — uniform over every operand kind, including function results (C-E02-008).
  for (;;) {
    const token = peek(state);
    if (token === undefined) return node;
    if (token.kind === 'dereference') {
      state.at += 1;
      node = parseAfterDereference(state, node, token);
    } else if (token.kind === 'startIndex') {
      state.at += 1;
      node = parseIndex(state, node, token);
    } else {
      return node;
    }
  }
}

function parseAfterDereference(state: State, target: ExprNode, dot: Token): ExprNode {
  const token = peek(state);
  if (token === undefined) {
    // Measured verbatim: `parameters.obj.` reports at the trailing dot (C-E02-013).
    fail(
      'expected-property-name',
      "Expected a property name to follow the dereference operator '.': '.'",
      '.',
      dot.span,
    );
  }
  if (token.kind === 'wildcard') {
    state.at += 1;
    return {
      type: 'index',
      target,
      index: { type: 'wildcard', span: token.span },
      span: { start: target.span.start, end: token.span.end },
    };
  }
  if (token.kind !== 'propertyName') {
    // Always "Unexpected symbol", even for value-shaped text: `parameters.obj.9num` is reported
    // that way although `9num` would be an unrecognized *value* anywhere else (C-E02-007/013).
    fail('unexpected-symbol', `Unexpected symbol: '${token.raw}'`, token.raw, token.span);
  }
  state.at += 1;
  return {
    type: 'property',
    target,
    name: token.raw,
    nameSpan: token.span,
    span: { start: target.span.start, end: token.span.end },
  };
}

function parseIndex(state: State, target: ExprNode, open: Token): ExprNode {
  const first = peek(state);
  if (first === undefined) fail('unexpected-symbol', "Unexpected symbol: '['", '[', open.span);
  // `[]` reports on the bracket that closes it, like the arity checks (C-E02-017).
  if (first.kind === 'endIndex') unexpected(first);

  let index: ExprNode;
  if (first.kind === 'wildcard') {
    state.at += 1;
    index = { type: 'wildcard', span: first.span };
  } else {
    index = parseOperand(state);
  }

  const close = peek(state);
  if (close === undefined) fail('unexpected-symbol', "Unexpected symbol: '['", '[', open.span);
  if (close.kind !== 'endIndex') unexpected(close);
  state.at += 1;
  return { type: 'index', target, index, span: { start: target.span.start, end: close.span.end } };
}

function parsePrimary(state: State): ExprNode {
  const token = peek(state);
  // Unreachable: every caller checks for the end of the token stream first, so that running out
  // is reported as an unclosed call or index rather than as a missing operand.
  /* c8 ignore next */
  if (token === undefined)
    fail('empty-expression', 'An expression was expected', '', endSpan(state));
  state.at += 1;
  switch (token.kind) {
    case 'boolean':
      return {
        type: 'literal',
        literal: { kind: 'boolean', value: token.value as boolean },
        span: token.span,
      };
    case 'number':
      return {
        type: 'literal',
        literal: { kind: 'number', value: token.value as number },
        span: token.span,
      };
    case 'version':
      return {
        type: 'literal',
        literal: { kind: 'version', segments: token.value as readonly number[] },
        span: token.span,
      };
    case 'string':
      return {
        type: 'literal',
        literal: { kind: 'string', value: token.value as string },
        span: token.span,
      };
    case 'namedValue': {
      // Unknown contexts are reported at the name (C-E02-012) — but only once the parse gets that
      // far, so `nosuchcontext 2` reports the `2` instead (C-E02-020).
      if (
        state.registry !== undefined &&
        !state.registry.namedValues.has(token.raw.toLowerCase())
      ) {
        defer(state, token);
      }
      return { type: 'namedValue', name: token.raw, span: token.span };
    }
    case 'function':
      return parseCall(state, token);
    default:
      return unexpected(token);
  }
}

function parseCall(state: State, name: Token): ExprNode {
  // Same message and position as an unknown context — the service does not say "function"
  // (C-E02-011): `nosuchfunc(1)` → "Unrecognized value: 'nosuchfunc'" at the name. Deferred like
  // any other name (C-E02-020); with no signature there is also no arity to check, which is why
  // `nosuchfunc(1)` is reported at the name and not at its argument count.
  const signature = state.registry?.functions.get(name.raw.toLowerCase());
  if (state.registry !== undefined && signature === undefined) defer(state, name);

  const open = peek(state);
  // The lexer only classifies a keyword as a function when `(` follows, so this cannot happen.
  /* c8 ignore next */
  if (open?.kind !== 'startParameters') return unexpected(open ?? name);
  state.at += 1;

  const args: ExprNode[] = [];
  for (;;) {
    const token = peek(state);
    if (token === undefined) {
      // Reported from where the call *opened*, not where the text ran out (C-E02-013).
      fail('unclosed-function', `Unclosed function: '${name.raw}'`, name.raw, name.span);
    }
    if (token.kind === 'endParameters') {
      state.at += 1;
      if (signature !== undefined && args.length < signature.minArgs) unexpected(token);
      return {
        type: 'call',
        name: name.raw,
        nameSpan: name.span,
        args,
        span: { start: name.span.start, end: token.span.end },
      };
    }
    if (args.length > 0) {
      if (token.kind !== 'separator') unexpected(token);
      state.at += 1;
    }
    // The too-many check fires on the separator that would open the extra argument, before it is
    // read — `eq(1, 2, 3)` reports the *second* comma (C-E02-017).
    if (signature !== undefined && args.length >= signature.maxArgs) unexpected(token);
    // `eq(1,` — the text ends mid-call, still reported from the opening name (C-E02-013).
    if (peek(state) === undefined) {
      fail('unclosed-function', `Unclosed function: '${name.raw}'`, name.raw, name.span);
    }
    args.push(parseOperand(state));
  }
}

/**
 * Depth ceiling (C-E02-014). Only **function arguments** deepen the count: 49 nested `not(…)`
 * around a literal is depth 50 and parses, 50 nested does not — while a 60-link property chain
 * (`parameters.obj.a.a.…`) and a 60-link index chain are both accepted, so member access is free.
 * That asymmetry was measured, not assumed; counting member access too would reject pipelines the
 * service runs. The error carries the whole expression because the service's message has no
 * position of its own.
 */
function checkDepth(node: ExprNode, depth: number, text: string): void {
  if (depth > MAX_DEPTH) {
    fail('exceeded-max-depth', `Exceeded max expression depth ${MAX_DEPTH}`, text, {
      start: 0,
      end: text.length,
    });
  }
  switch (node.type) {
    case 'call':
      for (const arg of node.args) checkDepth(arg, depth + 1, text);
      return;
    case 'property':
      checkDepth(node.target, depth, text);
      return;
    case 'index':
      checkDepth(node.target, depth, text);
      checkDepth(node.index, depth, text);
      return;
    default:
      return;
  }
}

/**
 * The one seam between expression coordinates and file coordinates. Expression spans are relative
 * to the expression text; `offset` is where that text starts in the file (for `${{ expr }}` in a
 * scalar, the scalar's offset plus the delimiter and any leading whitespace). Keeping this in one
 * function is what lets E02-S01-T02 attach a caret to E01's `Diagnostic` without touching the AST.
 */
export function liftSpan(span: Span, offset: number): Span {
  return { start: span.start + offset, end: span.end + offset };
}

/** Every node in the tree, parents before children — used by tests and by the shell compiler. */
export function* walk(node: ExprNode): Generator<ExprNode> {
  yield node;
  switch (node.type) {
    case 'call':
      for (const arg of node.args) yield* walk(arg);
      return;
    case 'property':
      yield* walk(node.target);
      return;
    case 'index':
      yield* walk(node.target);
      yield* walk(node.index);
      return;
    default:
      return;
  }
}

/**
 * AST → expression text. Round-tripping (`print` → `parseExpression` → equal tree) is asserted
 * over the whole test table, which is a cheaper check on the literal rules than eyeballing spans:
 * it catches an asymmetric `''` escape or a property/index confusion immediately.
 *
 * Scope: reproducing *parsed source*, not stringifying values. A number node built by hand with a
 * magnitude ≥ 1e21 would print in exponent form, which this grammar does not accept (C-E02-004) —
 * unreachable from a parse, since no such literal can be written. How the service *renders* a
 * number (its `G15` format) is a separate question, and belongs to E02-S02's value model.
 */
export function print(node: ExprNode): string {
  switch (node.type) {
    case 'literal':
      switch (node.literal.kind) {
        case 'boolean':
          return node.literal.value ? 'true' : 'false';
        case 'number':
          return String(node.literal.value);
        case 'version':
          return node.literal.segments.join('.');
        case 'string':
          return `'${node.literal.value.replace(/'/g, "''")}'`;
      }
    // eslint-disable-next-line no-fallthrough -- every literal kind returns above
    case 'namedValue':
      return node.name;
    case 'call':
      return `${node.name}(${node.args.map(print).join(', ')})`;
    case 'property':
      return `${print(node.target)}.${node.name}`;
    case 'index':
      return node.index.type === 'wildcard'
        ? `${print(node.target)}[*]`
        : `${print(node.target)}[${print(node.index)}]`;
    case 'wildcard':
      return '*';
  }
}
