/**
 * Expression tokenizer (E02-S01-T01) — the first half of the one grammar both E02 backends share
 * (docs/02 §6): the convert-time evaluator and the bash compiler consume the same AST, so a
 * divergence here is a divergence everywhere.
 *
 * **Which grammar this is.** Not the one in `actions/runner`. That repo is the open fork of the
 * DistributedTask engine (C-E00-012/013), but it carries the **GitHub Actions** dialect: infix
 * operators, ordinal `true`/`false`/`null` keywords, Actions' function set. Azure Pipelines
 * accepts none of that, and a tokenizer that over-accepts would let invalid pipelines parse
 * locally and fail on the service — so every rule below was decided by submitting the expression
 * to the live preview endpoint (`research/experiments/E02-grammar/survey.md`, 74 probes) and the
 * fork is used only for shape (C-E02-016).
 *
 * The headline consequence is C-E02-001: **there are no operators**. `1 == 1`, `!true`, `a && b`
 * and even `(true)` are all rejected by the service; only `eq(1, 1)` works. So the tokenizer emits
 * operator-ish punctuation as a single `symbol` kind that the parser always rejects, and the
 * parser (parser.ts) needs no precedence climbing at all.
 *
 * Offsets are **expression-relative** — index 0 is the first character of the expression text, not
 * of the file. `liftSpan` in parser.ts is the one seam that turns them into file coordinates.
 */

/** Half-open, expression-relative, 0-based. The service counts from 1 (C-E02-013); rendering owns that. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export type TokenKind =
  /** `true`/`True`/`TRUE` — case-insensitive (C-E02-002). */
  | 'boolean'
  /** Plain decimal: `42`, `-1.2`, `.5`, `1.` (C-E02-004). */
  | 'number'
  /** Three or four dotted segments; two segments is a number (C-E02-005). */
  | 'version'
  /** Single-quoted, `''` escape (C-E02-006). */
  | 'string'
  /** A keyword not followed by `(` — a context such as `parameters` (C-E02-012). */
  | 'namedValue'
  /** A keyword followed (possibly after whitespace) by `(` (C-E02-011). */
  | 'function'
  /** A keyword directly after `.` (C-E02-007). */
  | 'propertyName'
  | 'startParameters'
  | 'endParameters'
  | 'startIndex'
  | 'endIndex'
  | 'separator'
  | 'dereference'
  /** `*` after `.` or `[` — filtered array (C-E02-009). */
  | 'wildcard'
  /** `=` `<` `>` `&` `|` `!=` … — lexically recognised, never legal (C-E02-001). */
  | 'symbol'
  /** Value-shaped text that resolves to nothing: `null`, `+1`, `0x1F`, `"x"` (C-E02-003/004/006). */
  | 'unrecognized';

export interface Token {
  readonly kind: TokenKind;
  /** Exact source text of the token. */
  readonly raw: string;
  readonly span: Span;
  /** Parsed payload for literal kinds; `segments` for a version. */
  readonly value?: boolean | number | string | readonly number[];
}

/**
 * Characters that end a keyword or number scan. Whitespace plus the punctuation the lexer owns.
 * `!` is in here as a symbol-starter, but with one measured exception — see `readSymbol`.
 */
function isBoundary(c: string): boolean {
  switch (c) {
    case '(':
    case ')':
    case '[':
    case ']':
    case ',':
    case '.':
    case '!':
    case '>':
    case '<':
    case '=':
    case '&':
    case '|':
      return true;
    default:
      return /\s/.test(c);
  }
}

/** Property-name rule, documented and confirmed live: `[A-Za-z_][A-Za-z0-9_]*` (C-E02-007). */
const KEYWORD = /^[A-Za-z_][A-Za-z0-9_]*$/;

const TWO_CHAR_SYMBOLS = new Set(['==', '!=', '>=', '<=', '&&', '||']);
const ONE_CHAR_SYMBOLS = new Set(['>', '<', '=', '&', '|']);

/**
 * `1.` and `.5` are legal, `1e3`/`0x1F`/`+1`/`1..2` are not (C-E02-004). Deliberately hand-rolled
 * rather than `Number(str)`, which accepts every one of those rejected forms.
 */
function parseNumberLiteral(raw: string): number | undefined {
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isNaN(value) ? undefined : value;
}

/**
 * Three or four segments, no sign (C-E02-005). Two segments never reaches here — it is a number,
 * settled by `gt(1.10, 1.9)` returning False, i.e. numeric ordering.
 */
function parseVersionLiteral(raw: string): readonly number[] | undefined {
  if (!/^\d+(?:\.\d+){2,3}$/.test(raw)) return undefined;
  return raw.split('.').map((segment) => Number(segment));
}

/**
 * Tokenize `expression`. Never throws and never stops early: illegal text becomes a `symbol` or
 * `unrecognized` token carrying its span, so the parser can report *where* rather than *that*.
 *
 * Legality-by-previous-token (C-E02-016) is the parser's job here, not the lexer's — the lexer
 * only needs the previous token to make three context-sensitive decisions the service also makes:
 * `.` starts a number vs. dereferences; a keyword after `.` is a property name; a keyword before
 * `(` is a function.
 */
export function tokenize(expression: string): readonly Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let last: Token | undefined;

  const push = (token: Token): void => {
    tokens.push(token);
    last = token;
  };

  const token = (
    kind: TokenKind,
    start: number,
    end: number,
    value?: boolean | number | string | readonly number[],
  ): Token => ({
    kind,
    raw: expression.slice(start, end),
    span: { start, end },
    ...(value === undefined ? {} : { value }),
  });

  /** Scan a single- or double-character symbol; anything else runs to the boundary. */
  const readSymbol = (): Token => {
    const start = index;
    const two = expression.slice(start, start + 2);
    if (TWO_CHAR_SYMBOLS.has(two)) {
      index += 2;
      return token('symbol', start, index);
    }
    const one = expression[start] as string;
    if (ONE_CHAR_SYMBOLS.has(one)) {
      index += 1;
      return token('symbol', start, index);
    }
    // A lone `!`: the service does not treat it as a symbol on its own — `!true` comes back as
    // `Unrecognized value: '!true'`, one token scanned to the boundary (C-E02-013, and the
    // "known message-level divergence" note in research/E02-expressions.md).
    index += 1;
    while (index < expression.length && !isBoundary(expression[index] as string)) index += 1;
    return token('unrecognized', start, index);
  };

  const readNumber = (): Token => {
    const start = index;
    index += 1;
    while (
      index < expression.length &&
      (!isBoundary(expression[index] as string) || expression[index] === '.')
    ) {
      index += 1;
    }
    const raw = expression.slice(start, index);
    const number = parseNumberLiteral(raw);
    if (number !== undefined) return token('number', start, index, number);
    const version = parseVersionLiteral(raw);
    if (version !== undefined) return token('version', start, index, version);
    return token('unrecognized', start, index);
  };

  const readString = (): Token => {
    const start = index;
    index += 1; // opening quote
    let value = '';
    let closed = false;
    while (index < expression.length) {
      const c = expression[index++] as string;
      if (c === "'") {
        if (index >= expression.length || expression[index] !== "'") {
          closed = true;
          break;
        }
        index += 1; // '' → one literal quote (C-E02-006)
      }
      value += c;
    }
    // An unterminated string never reaches us from a real pipeline: the template scanner rejects
    // the enclosing `${{ … }}` first, because the closing braces get eaten as string content.
    return closed ? token('string', start, index, value) : token('unrecognized', start, index);
  };

  const readKeyword = (): Token => {
    const start = index;
    index += 1;
    while (index < expression.length && !isBoundary(expression[index] as string)) index += 1;
    const raw = expression.slice(start, index);
    if (!KEYWORD.test(raw)) return token('unrecognized', start, index);

    if (last?.kind === 'dereference') return token('propertyName', start, index);
    if (/^true$/i.test(raw)) return token('boolean', start, index, true);
    if (/^false$/i.test(raw)) return token('boolean', start, index, false);

    // Lookahead past whitespace: `eq (1, 1)` is accepted (C-E02-011).
    let ahead = index;
    while (ahead < expression.length && /\s/.test(expression[ahead] as string)) ahead += 1;
    return expression[ahead] === '('
      ? token('function', start, index)
      : token('namedValue', start, index);
  };

  while (index < expression.length) {
    const c = expression[index] as string;
    if (/\s/.test(c)) {
      index += 1;
      continue;
    }
    switch (c) {
      case '(':
        push(token(last?.kind === 'function' ? 'startParameters' : 'symbol', index, index + 1));
        index += 1;
        break;
      case ')':
        push(token('endParameters', index, index + 1));
        index += 1;
        break;
      case '[':
        push(token('startIndex', index, index + 1));
        index += 1;
        break;
      case ']':
        push(token('endIndex', index, index + 1));
        index += 1;
        break;
      case ',':
        push(token('separator', index, index + 1));
        index += 1;
        break;
      case '*':
        push(token('wildcard', index, index + 1));
        index += 1;
        break;
      case "'":
        push(readString());
        break;
      case '!':
      case '>':
      case '<':
      case '=':
      case '&':
      case '|':
        push(readSymbol());
        break;
      case '.': {
        // A leading `.` is a number only where a value may start; elsewhere it dereferences.
        const startsValue =
          last === undefined ||
          last.kind === 'separator' ||
          last.kind === 'startIndex' ||
          last.kind === 'startParameters';
        if (startsValue) {
          push(readNumber());
        } else {
          push(token('dereference', index, index + 1));
          index += 1;
        }
        break;
      }
      default:
        push(c === '-' || (c >= '0' && c <= '9') ? readNumber() : readKeyword());
        break;
    }
  }

  return tokens;
}
