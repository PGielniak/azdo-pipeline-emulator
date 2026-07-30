// E01-S01-T03 — diagnostic type + renderers (docs/01 §1: every violation reports
// file:line:col, the JSON-path in the document, and a readable message).
// The location prefix deliberately mirrors the service's own error style
// `<file> (Line: N, Col: M): <message>` (C-E01-007 format string, C-E01-008 real sample)
// so local output reads like the errors users already see from Azure Pipelines.
import type { ParseError, SourceRange } from './parse.js';

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: string;
  message: string;
  file: string;
  range: SourceRange;
  /** JSON-path into the document, e.g. `$.stages[0].jobs[1].steps[2].task` */
  jsonPath?: string;
  hint?: string;
}

export interface RenderOptions {
  /** Source text of `diagnostic.file` — enables the code-frame excerpt. */
  source?: string;
  /** ANSI colors; off by default so piped/test output stays clean. */
  color?: boolean;
  /** Context lines above/below the code frame (default 2). */
  contextLines?: number;
}

/** Parse errors flow into the shared diagnostic type (all epics report through it). */
export function parseErrorToDiagnostic(error: ParseError): Diagnostic {
  return {
    severity: 'error',
    code: error.code,
    message: error.message,
    file: error.pos.file,
    range: error.pos.range,
  };
}

/** `<file> (Line: N, Col: M)` — the service's location style (C-E01-007/008). */
export function formatLocation(file: string, range: SourceRange): string {
  return `${file} (Line: ${range.line}, Col: ${range.col})`;
}

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

const SEVERITY_COLOR: Record<Severity, string> = {
  error: ANSI.red,
  warning: ANSI.yellow,
  info: ANSI.blue,
};

export function renderDiagnostic(diagnostic: Diagnostic, options: RenderOptions = {}): string {
  const color = options.color === true;
  const paint = (text: string, ...codes: string[]): string =>
    color ? `${codes.join('')}${text}${ANSI.reset}` : text;

  const head =
    paint(diagnostic.severity, SEVERITY_COLOR[diagnostic.severity], ANSI.bold) +
    ` ${paint(diagnostic.code, ANSI.bold)}: ` +
    `${formatLocation(diagnostic.file, diagnostic.range)}: ${diagnostic.message}`;

  const lines = [head];
  if (diagnostic.jsonPath) lines.push(`  ${paint(`at ${diagnostic.jsonPath}`, ANSI.dim)}`);
  if (options.source !== undefined) {
    const frame = codeFrame(options.source, diagnostic.range, color, options.contextLines ?? 2);
    if (frame) lines.push(frame);
  }
  if (diagnostic.hint) lines.push(`  hint: ${diagnostic.hint}`);
  return lines.join('\n');
}

export function renderDiagnostics(
  diagnostics: readonly Diagnostic[],
  options: RenderOptions = {},
): string {
  return diagnostics.map((d) => renderDiagnostic(d, options)).join('\n\n');
}

/** Stable machine-readable form for `--json`: the diagnostic type is the wire shape. */
export function renderDiagnosticsJson(diagnostics: readonly Diagnostic[]): string {
  return `${JSON.stringify({ diagnostics }, null, 2)}\n`;
}

function codeFrame(
  source: string,
  range: SourceRange,
  color: boolean,
  contextLines: number,
): string | undefined {
  const sourceLines = source.split('\n');
  if (range.line < 1 || range.line > sourceLines.length) return undefined;

  const first = Math.max(1, range.line - contextLines);
  const last = Math.min(sourceLines.length, range.line + contextLines);
  const gutterWidth = String(last).length;
  const paint = (text: string, ...codes: string[]): string =>
    color ? `${codes.join('')}${text}${ANSI.reset}` : text;

  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    const text = sourceLines[n - 1] ?? '';
    const gutter = String(n).padStart(gutterWidth);
    if (n === range.line) {
      out.push(
        `  ${paint('>', SEVERITY_COLOR.error, ANSI.bold)} ${paint(gutter, ANSI.dim)} | ${text}`,
      );
      const caretSpan =
        range.endLine === range.line
          ? Math.max(1, range.endCol - range.col)
          : Math.max(1, text.length - range.col + 1);
      const caret = `${' '.repeat(range.col - 1)}${'^'.repeat(caretSpan)}`;
      out.push(`    ${' '.repeat(gutterWidth)} | ${paint(caret, SEVERITY_COLOR.error, ANSI.bold)}`);
    } else {
      out.push(`    ${paint(gutter, ANSI.dim)} | ${text}`);
    }
  }
  return out.join('\n');
}
