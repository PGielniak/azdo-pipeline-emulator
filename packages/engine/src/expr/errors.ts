/**
 * Expression parse errors, rendered the way the service renders them (E02-S01-T02).
 *
 * `parser.ts` produces an `ExprParseError` with an expression-relative span. This module turns it
 * into the two things a user sees: the **service-shaped sentence** (so a local failure reads like
 * the one they would get from Azure Pipelines) and a **`Diagnostic`** carrying real file
 * coordinates, so E01's code frame can put a caret under the offending token.
 *
 * Everything here is measured, not styled — 64 live rejections in
 * `research/experiments/E02-errors/` (`pnpm expr-error-survey`), replayed as a parity table in
 * `packages/engine/test/expr/errors.test.ts`. Four findings shape the module:
 *
 *  * The service **trims** the delimited text before parsing: `${{    null }}` reports position 1
 *    over the expression `'null'` (C-E02-021). Hence `trimExpressionText`, which every caller must
 *    use, or every position it renders is off by the indentation.
 *  * `(Line, Col)` points at the **host scalar**, never at the offending token — `probe: prefix ${{
 *    null }}` reports Col 10, the `p` of `prefix`, with the token 19 characters further on
 *    (C-E02-022). We deliberately point at the token instead: a caret under the scalar's first
 *    character would be useless, and the position within the expression is in the message anyway.
 *  * Three message shapes, not one: two of the six codes carry no position and one carries no help
 *    link either (C-E02-023). A single format string gets those wrong.
 *  * The service truncates the assembled compile-time message at 500 characters and appends
 *    `[...]` — mid-URL if that is where 500 falls (C-E02-024). We do not truncate; the test proves
 *    parity by truncating *our* message the same way and comparing.
 */
import type { SourceRange } from '../frontend/parse.js';
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { Span } from './lexer.js';
import type { ExprErrorCode, ExprParseError } from './parser.js';

/** The link the service appends to every expression error that has a help page (C-E02-023). */
export const EXPRESSION_HELP_URL = 'https://go.microsoft.com/fwlink/?linkid=842996';

/**
 * Compile-time messages are cut to this many characters, `[...]` appended (C-E02-024). Runtime
 * (`$[ ]`) messages are not cut at all — a 591-character one came back whole. Exported because the
 * parity test needs to apply it to reproduce a truncated row; our own output never uses it.
 */
export const SERVICE_MESSAGE_CAP = 500;

/** `${{ }}` (compile time) or `$[ ]` (runtime). Same grammar, different error prefix. */
export type ExprMode = 'compile' | 'runtime';

/**
 * The service loses file coordinates for runtime expressions — they are parsed at queue time, long
 * after the file is gone — and prefixes them with this instead (C-E02-015/025).
 */
export const RUNTIME_MESSAGE_PREFIX = 'An error occurred while loading the YAML build pipeline. ';

/**
 * How each error code is phrased. Measured per code; rendering all six alike would invent a
 * position for the two that have none and a help link for the one that has neither (C-E02-023).
 */
const SHAPE: Record<ExprErrorCode, 'positioned' | 'help-only' | 'bare'> = {
  // `<sentence>. Located at position N within expression: '<expr>'. For more help, …`
  'unrecognized-value': 'positioned',
  'unexpected-symbol': 'positioned',
  'expected-property-name': 'positioned',
  'unclosed-function': 'positioned',
  // `<sentence>. For more help, …` — the depth ceiling is a property of the whole expression.
  'exceeded-max-depth': 'help-only',
  // `<sentence>` alone, no position, no echo, no link.
  'empty-expression': 'bare',
};

const DIAGNOSTIC_CODE: Record<ExprErrorCode, string> = {
  'unrecognized-value': 'EXPRESSION_UNRECOGNIZED_VALUE',
  'unexpected-symbol': 'EXPRESSION_UNEXPECTED_SYMBOL',
  'expected-property-name': 'EXPRESSION_EXPECTED_PROPERTY_NAME',
  'unclosed-function': 'EXPRESSION_UNCLOSED_FUNCTION',
  'exceeded-max-depth': 'EXPRESSION_MAX_DEPTH',
  'empty-expression': 'EXPRESSION_EMPTY',
};

/**
 * The delimited text with the whitespace the service strips before parsing removed (C-E02-021).
 * `offset` is how many characters were dropped from the front, so a caller that knows where the
 * delimited text starts in the file can still reach file coordinates:
 *
 *     const { text, offset } = trimExpressionText(inner);   // inner = between `${{` and `}}`
 *     parseExpression(text, …)                              // positions now match the service
 *     liftSpan(error.span, innerOffsetInFile + offset)      // …and so do file coordinates
 */
export function trimExpressionText(inner: string): { text: string; offset: number } {
  const start = inner.length - inner.trimStart().length;
  return { text: inner.trim(), offset: start };
}

/** 1-based position within the expression, as the service counts it; `undefined` where it has none. */
export function servicePosition(error: ExprParseError): number | undefined {
  return SHAPE[error.code] === 'positioned' ? error.span.start + 1 : undefined;
}

/**
 * The service's message body for this error — everything after the location prefix, byte for byte.
 * `text` must be the trimmed expression (`trimExpressionText`), because the echo is the parsed
 * text and not the source slice: `${{    1 == 1 }}` echoes `'1 == 1'`.
 *
 * Not truncated (C-E02-024) and not synthesized: where the service compiles an interpolated scalar
 * into a `format(...)` call and positions the error inside *that*, we keep the user's expression —
 * see `expressionDiagnostic`.
 */
export function serviceMessageBody(error: ExprParseError, text: string): string {
  switch (SHAPE[error.code]) {
    case 'bare':
      return error.message;
    case 'help-only':
      return `${error.message}. For more help, refer to ${EXPRESSION_HELP_URL}`;
    case 'positioned':
      return (
        `${error.message}. Located at position ${String(error.span.start + 1)} ` +
        `within expression: '${text}'. For more help, refer to ${EXPRESSION_HELP_URL}`
      );
  }
}

/**
 * Cut like the service cuts a compile-time message (C-E02-024). The cap applies to the assembled
 * string *including* its location prefix — `echo-cap-control` was severed mid-URL at 505 characters
 * with an expression of only 353 — so callers pass the whole thing, prefix included.
 */
export function truncateServiceMessage(message: string): string {
  return message.length <= SERVICE_MESSAGE_CAP
    ? message
    : `${message.slice(0, SERVICE_MESSAGE_CAP)}[...]`;
}

/** Where an expression sits, so its error can be reported in file coordinates. */
export interface ExprHost {
  readonly file: string;
  /**
   * Offset in `source` of the first character of the **trimmed** expression text — i.e. after
   * `${{`/`$[` and after whatever `trimExpressionText` dropped.
   */
  readonly offset: number;
  /** The file's text. Without it there is nothing to count lines in, so `range` is used verbatim. */
  readonly source?: string | undefined;
  /**
   * Location to fall back on when `source` is absent — normally the host scalar's range, which is
   * exactly what the service would have reported (C-E02-022).
   */
  readonly range?: SourceRange | undefined;
  /** Default `compile`. */
  readonly mode?: ExprMode | undefined;
}

/** 1-based line/column of `offset` in `source`. */
function lineColOf(source: string, offset: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lastBreak = before.lastIndexOf('\n');
  return { line: before.split('\n').length, col: clamped - lastBreak };
}

/** Expression span → file range, via the one seam (`liftSpan`'s coordinates). */
function fileRange(span: Span, host: ExprHost): SourceRange | undefined {
  if (host.source === undefined) return host.range;
  const start = lineColOf(host.source, host.offset + span.start);
  const end = lineColOf(host.source, host.offset + Math.max(span.end, span.start + 1));
  return { line: start.line, col: start.col, endLine: end.line, endCol: end.col };
}

/**
 * An expression error as a `Diagnostic`, so it renders through E01's reporter — code frame, caret,
 * `--json` shape — like every other error the converter produces.
 *
 * **Deliberate divergence, and the reason this task exists.** The service reports the *host
 * scalar's* position and then says "Located at position N within expression" (C-E02-022); our range
 * covers the offending token itself, so the caret lands on it. The message still carries the
 * service's own sentence verbatim, so the two are reconcilable by eye. When the expression is
 * embedded in a larger scalar the service goes further and reports a position inside a synthetic
 * `format(…)` call it compiled the scalar into (C-E02-026) — a text that appears nowhere in the
 * user's file. We never reproduce that: pointing at real source is the whole point of a caret.
 */
export function expressionDiagnostic(
  error: ExprParseError,
  text: string,
  host: ExprHost,
): Diagnostic {
  const range = fileRange(error.span, host) ?? {
    line: 1,
    col: 1,
    endLine: 1,
    endCol: 1,
  };
  const body = serviceMessageBody(error, text);
  return {
    severity: 'error',
    code: DIAGNOSTIC_CODE[error.code],
    message: host.mode === 'runtime' ? `${RUNTIME_MESSAGE_PREFIX}${body}` : body,
    file: host.file,
    range,
  };
}

/**
 * The expression with a caret under the offending token — the part of an expression error that a
 * file-level code frame cannot show, because inside a block scalar or a template the expression is
 * one fragment of a much longer line:
 *
 *     eq(1)
 *         ^
 *
 * Indented by two spaces to sit under a rendered diagnostic. Newlines in the expression (a folded
 * multi-line scalar can produce them) are shown as spaces so the caret column stays honest.
 */
export function renderExprCaret(error: ExprParseError, text: string): string {
  const flat = text.replace(/[\r\n\t]/g, ' ');
  const start = Math.max(0, Math.min(error.span.start, flat.length));
  const width = Math.max(1, Math.min(error.span.end, flat.length) - start);
  return `  ${flat}\n  ${' '.repeat(start)}${'^'.repeat(width)}`;
}

/**
 * Full standalone rendering: the service's sentence, then the expression with its caret. Used where
 * there is no file to frame — the CLI's expression-only paths and test output.
 */
export function renderExprError(
  error: ExprParseError,
  text: string,
  mode: ExprMode = 'compile',
): string {
  const body = serviceMessageBody(error, text);
  const head = mode === 'runtime' ? `${RUNTIME_MESSAGE_PREFIX}${body}` : body;
  return SHAPE[error.code] === 'bare' && text.length === 0
    ? head
    : `${head}\n${renderExprCaret(error, text)}`;
}
