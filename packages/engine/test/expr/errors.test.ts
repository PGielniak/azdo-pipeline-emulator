// E02-S01-T02 — server-style parse errors.
//
// **This is a parity table, not a snapshot of our own output.** Every row is one live rejection
// recorded in `research/experiments/E02-errors/cases.json` (`pnpm expr-error-survey`, 64 probes).
// The test parses the service's message into `{kind, raw, position, echo}`, renders the same
// expression through our own error renderer, and asserts the two agree — field by field for a
// readable failure, then byte for byte so nothing drifts unnoticed. A `toMatchSnapshot()` of our
// renderer would pass whatever we wrote; this cannot.
//
// The rows we knowingly do not reproduce are enumerated below as `DIVERGENCES` and asserted just as
// hard: each one states what the service does, why we do something else, and the claim recording it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { renderDiagnostic } from '../../src/frontend/diagnostics.js';
import { parsePipelineYaml, snippetOf } from '../../src/frontend/parse.js';
import {
  EXPRESSION_HELP_URL,
  RUNTIME_MESSAGE_PREFIX,
  expressionDiagnostic,
  renderExprCaret,
  renderExprError,
  serviceMessageBody,
  servicePosition,
  trimExpressionText,
  truncateServiceMessage,
} from '../../src/expr/errors.js';
import {
  makeRegistry,
  parseExpression,
  type ExprErrorCode,
  type ExprParseError,
} from '../../src/expr/parser.js';
import { registryForSlot } from '../../src/expr/context.js';

const REGISTRY = makeRegistry(
  [
    { name: 'eq', minArgs: 2, maxArgs: 2 },
    { name: 'gt', minArgs: 2, maxArgs: 2 },
    { name: 'not', minArgs: 1, maxArgs: 1 },
    { name: 'split', minArgs: 2, maxArgs: 2 },
    { name: 'convertToJson', minArgs: 1, maxArgs: 1 },
    { name: 'format', minArgs: 1, maxArgs: Number.POSITIVE_INFINITY },
  ],
  ['parameters', 'variables', 'dependencies'],
);

interface Case {
  readonly id: string;
  readonly group: string;
  readonly wrapper: string;
  readonly mode: 'compile' | 'runtime';
  readonly inner: string;
  readonly yaml: string;
  readonly openLine: number;
  readonly openCol: number;
  readonly outcome: string;
  readonly message?: string;
  readonly decides: string;
}

const CASES: readonly Case[] = (
  JSON.parse(
    readFileSync(
      new URL('../../../../research/experiments/E02-errors/cases.json', import.meta.url),
      'utf8',
    ),
  ) as { cases: Case[] }
).cases;

/**
 * Rows the service answers with something our expression renderer deliberately does not produce.
 * Each is asserted by its own `it` below — the point of listing them is that a row can only leave
 * the parity table by being named here, with a reason.
 */
const DIVERGENCES: Record<string, string> = {
  // The service compiles an interpolated scalar into a synthetic `format(…)` call and positions the
  // error inside *that* text (C-E02-109). It is not in the user's file, so we never render it.
  'embed-mid-scalar': 'format() synthesis',
  'embed-second-expr': 'format() synthesis',
  'block-scalar': 'format() synthesis',
  // The template scanner rejects these before the expression lexer ever runs (C-E02-006); E03 owns
  // the message.
  'quote-in-raw': 'template scanner, not the expression parser',
  'grammar-str-unclosed': 'template scanner, not the expression parser',
  // Two bad expressions, two messages, newline-joined (C-E02-110). Our error type is per
  // expression; collecting them is E03-S01's job.
  'multi-bad-scalars': 'document-level collection',
};

interface Parsed {
  readonly prefix: string;
  readonly body: string;
  readonly kind: string;
  readonly raw: string;
  readonly position: number;
  readonly echo: string;
}

const COMPILE_PREFIX = /^(\S+ \(Line: \d+, Col: \d+\): )([\s\S]*)$/;
const POSITIONED =
  /^(?<kind>[^:]+): '(?<raw>[\s\S]*)'\. Located at position (?<position>\d+) within expression: '(?<echo>[\s\S]*)'\. For more help, refer to (?<url>\S+)$/;

function splitPrefix(message: string): { prefix: string; body: string } {
  if (message.startsWith(RUNTIME_MESSAGE_PREFIX)) {
    return {
      prefix: RUNTIME_MESSAGE_PREFIX,
      body: message.slice(RUNTIME_MESSAGE_PREFIX.length),
    };
  }
  const match = COMPILE_PREFIX.exec(message);
  if (match === null) throw new Error(`unrecognized message prefix: ${message}`);
  return { prefix: match[1] as string, body: match[2] as string };
}

/** Full decomposition; only for rows the service positioned. */
function parseServiceMessage(message: string): Parsed {
  const { prefix, body } = splitPrefix(message);
  const match = POSITIONED.exec(body);
  if (match?.groups === undefined) throw new Error(`not a positioned message: ${body}`);
  return {
    prefix,
    body,
    kind: match.groups.kind as string,
    raw: match.groups.raw as string,
    position: Number(match.groups.position),
    echo: match.groups.echo as string,
  };
}

const rejectionOf = (text: string, registry = REGISTRY): ExprParseError => {
  const result = parseExpression(text, { registry });
  if (result.ok) throw new Error(`expected a rejection for ${JSON.stringify(text)}`);
  return result.error;
};

const caseById = (id: string): Case => {
  const found = CASES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no case ${id} — re-run pnpm expr-error-survey`);
  return found;
};

const messageOf = (id: string): string => {
  const message = caseById(id).message;
  if (message === undefined) throw new Error(`case ${id} was accepted`);
  return message;
};

const PARITY = CASES.filter((c) => DIVERGENCES[c.id] === undefined);

describe('the experiment corpus itself', () => {
  it('is what the task Ground field asks for: live service rejections, well over five', () => {
    // The floor is the corpus we have, not the five the task asked for. `expr-error-survey <id>`
    // rewrites both output files with that single row, so a partial run committed by accident would
    // otherwise shrink every loop below to nothing and still pass green — the same silent-empty
    // failure mode E12-S01-T01 found in coverage globs.
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    expect(PARITY.length).toBeGreaterThanOrEqual(55);
    expect(CASES.every((c) => c.outcome === 'rejected')).toBe(true);
    expect(CASES.every((c) => (c.message ?? '').length > 0)).toBe(true);
    // Every name in the divergence list is a row that exists, so a renamed probe cannot quietly
    // exempt itself.
    for (const id of Object.keys(DIVERGENCES)) expect(caseById(id).id).toBe(id);
  });

  it('covers every ExprErrorCode, so no message shape is untested', () => {
    const codes = new Set<ExprErrorCode>();
    for (const testCase of PARITY) {
      const { text } = trimExpressionText(testCase.inner);
      codes.add(rejectionOf(text).code);
    }
    const all: ExprErrorCode[] = [
      'unrecognized-value',
      'unexpected-symbol',
      'empty-expression',
      'expected-property-name',
      'expected-function-call',
      'unclosed-function',
      'exceeded-max-depth',
    ];
    // The original E02-errors corpus predates this seventh shape. Its dedicated oracle pair is
    // part of this table rather than silently claiming a generated corpus contains it (C-E02-132).
    codes.add(rejectionOf('eq').code);
    expect([...codes].sort()).toEqual(all.sort());
  });

  it('exercises both delimiters and more than one document shape', () => {
    expect(new Set(CASES.map((c) => c.mode))).toEqual(new Set(['compile', 'runtime']));
    expect(new Set(CASES.map((c) => c.wrapper)).size).toBeGreaterThanOrEqual(6);
  });
});

describe('message parity (every row = one live service rejection)', () => {
  for (const testCase of PARITY) {
    it(`${testCase.id}: ${JSON.stringify(testCase.inner.slice(0, 48))}`, () => {
      const service = messageOf(testCase.id);
      const { text } = trimExpressionText(testCase.inner);
      const error = rejectionOf(text);
      const { prefix, body } = splitPrefix(service);
      const ours = serviceMessageBody(error, text);

      // Field by field first: a mismatch names the field rather than dumping two long strings.
      if (POSITIONED.test(body)) {
        const parsed = parseServiceMessage(service);
        expect(parsed.raw, 'offending text').toBe(error.raw);
        expect(parsed.position, 'position within the expression').toBe(servicePosition(error));
        expect(parsed.echo, 'echoed expression').toBe(text);
        expect(`${parsed.kind}: '${parsed.raw}'`, 'sentence').toBe(error.message);
      }

      // Then byte for byte, reconstructed under the service's own prefix and its 500-character cap
      // — which applies to compile-time messages only (C-E02-107).
      const full = `${prefix}${ours}`;
      expect(testCase.mode === 'compile' ? truncateServiceMessage(full) : full).toBe(service);
    });
  }

  it('renders the runtime prefix the service uses when it has no file to point at (C-E02-108)', () => {
    const { text } = trimExpressionText(caseById('rt-arity').inner);
    const rendered = renderExprError(rejectionOf(text), text, 'runtime');
    expect(rendered.split('\n')[0]).toBe(messageOf('rt-arity'));
    expect(rendered).toBe(
      [
        `${RUNTIME_MESSAGE_PREFIX}Unexpected symbol: ')'. Located at position 5 within expression: ` +
          `'eq(1)'. For more help, refer to ${EXPRESSION_HELP_URL}`,
        '  eq(1)',
        '      ^',
      ].join('\n'),
    );
  });

  it('keeps the runtime kind the compile-time parser produced (C-E02-015)', () => {
    // The one runtime row whose *kind* differs is the operator case: `$[ 1 == 1 ]` comes back as
    // "Unrecognized value: '=='" where `${{ 1 == 1 }}` says "Unexpected symbol". Every other
    // runtime row matches compile-time exactly (rt-arity/rt-named-unknown/rt-trailing-dot/rt-depth
    // above), so the swap is confined to operator text and reproducing it would mean a second
    // classification pass that renders a *worse* message. Deliberate: one grammar, one kind.
    const error = rejectionOf('1 == 1');
    expect(error.code).toBe('unexpected-symbol');
    expect(renderExprError(error, '1 == 1', 'runtime')).toContain("Unexpected symbol: '=='");
  });
});

describe('bare known-function parity', () => {
  const EXPECTED_EQ =
    `Expected '(' to follow a function: 'eq'. Located at position 1 within expression: 'eq'. ` +
    `For more help, refer to ${EXPRESSION_HELP_URL}`;

  it('matches compile-variable and job-condition oracle messages byte-for-byte (C-E02-132)', () => {
    for (const registry of [REGISTRY, registryForSlot('job-condition')]) {
      const error = rejectionOf('eq', registry);
      expect(error).toMatchObject({
        code: 'expected-function-call',
        raw: 'eq',
        span: { start: 0, end: 2 },
      });
      expect(serviceMessageBody(error, 'eq')).toBe(EXPECTED_EQ);
    }
  });

  it('keeps bare contexts and unavailable status functions out of the new error kind (C-E02-133/134)', () => {
    const context = parseExpression('variables', {
      registry: registryForSlot('template-expression'),
    });
    expect(context).toMatchObject({ ok: true, node: { type: 'namedValue', name: 'variables' } });

    const unavailableStatus = rejectionOf('always', registryForSlot('template-expression'));
    expect(unavailableStatus).toMatchObject({
      code: 'unrecognized-value',
      raw: 'always',
    });
    expect(serviceMessageBody(unavailableStatus, 'always')).toBe(
      `Unrecognized value: 'always'. Located at position 1 within expression: 'always'. ` +
        `For more help, refer to ${EXPRESSION_HELP_URL}`,
    );
  });
});

describe('documented divergences', () => {
  it('never reports a position inside the synthetic format() call (C-E02-109)', () => {
    for (const id of ['embed-mid-scalar', 'embed-second-expr', 'block-scalar']) {
      const testCase = caseById(id);
      const parsed = parseServiceMessage(messageOf(id));
      const { text } = trimExpressionText(testCase.inner);

      // What the service did: compiled the whole scalar into `format('…', <expressions>)` and
      // positioned the error inside that text — where the user's expression really does appear.
      expect(parsed.echo.startsWith('format(')).toBe(true);
      expect(parsed.echo.slice(parsed.position - 1, parsed.position - 1 + text.length)).toBe(text);
      expect(parsed.echo).not.toBe(text);

      // What we do: report the user's own expression, positioned within itself.
      const error = rejectionOf(text);
      expect(servicePosition(error)).toBe(1);
      expect(serviceMessageBody(error, text)).toContain(`within expression: '${text}'`);
    }
  });

  it('leaves unclosed-delimiter errors to the template scanner (C-E02-006)', () => {
    for (const id of ['quote-in-raw', 'grammar-str-unclosed']) {
      const { body } = splitPrefix(messageOf(id));
      expect(body).toMatch(/^The expression is not closed\./);
      expect(body).not.toContain('Located at position');
    }
  });

  it('is singular where the service reports every bad expression in the document (C-E02-110)', () => {
    const messages = messageOf('multi-bad-scalars').split('\n');
    expect(messages).toHaveLength(2);
    const first = parseServiceMessage(messages[0] as string);
    const second = parseServiceMessage(messages[1] as string);
    expect([first.raw, second.raw]).toEqual(['null', 'NULL']);
    // Ours matches the first; collecting the rest is E03-S01's scanner, which owns the document.
    const { text } = trimExpressionText(caseById('multi-bad-scalars').inner);
    expect(serviceMessageBody(rejectionOf(text), text)).toBe(first.body);
  });

  it('does not truncate its own messages, and the cap is on the assembled string (C-E02-107)', () => {
    const control = caseById('echo-cap-control');
    const runtime = caseById('echo-cap-runtime');
    // A 353-character expression is severed mid-URL: the cap counts the location prefix too.
    expect(messageOf('echo-cap-control')).toHaveLength(505);
    expect(messageOf('echo-cap-control').endsWith('[...]')).toBe(true);
    expect(messageOf('echo-cap-control')).toContain('refer to https://go.');
    expect(messageOf('echo-cap-control')).not.toContain(EXPRESSION_HELP_URL);
    // The same expression as a runtime expression, with a *longer* prefix, comes back whole.
    expect(messageOf('echo-cap-runtime').endsWith(EXPRESSION_HELP_URL)).toBe(true);
    expect(messageOf('echo-cap-runtime').length).toBeGreaterThan(505);
    // Ours keeps the whole expression in both modes; the fwlink survives.
    for (const testCase of [control, runtime]) {
      const { text } = trimExpressionText(testCase.inner);
      const body = serviceMessageBody(rejectionOf(text), text);
      expect(body).toContain(text);
      expect(body.endsWith(EXPRESSION_HELP_URL)).toBe(true);
    }
  });
});

describe('file coordinates', () => {
  // `condition-field` is the simplest row where the expression is not at the start of the document:
  //   steps:
  //   - script: echo hi
  //     condition: ${{ null }}
  const CONDITION = caseById('condition-field');

  it('points the diagnostic at the offending token, not at the host scalar (C-E02-105)', () => {
    const { text, offset } = trimExpressionText(CONDITION.inner);
    const error = rejectionOf(text);
    // `${{` at Col 14 (service-reported and locally computed agree), delimiters are 3 characters.
    const openOffset = CONDITION.yaml.indexOf(`\${{${CONDITION.inner}}}`);
    const diagnostic = expressionDiagnostic(error, text, {
      file: 'azure-pipelines.yml',
      source: CONDITION.yaml,
      offset: openOffset + 3 + offset,
    });
    expect(CONDITION.openCol).toBe(14);
    expect(parseServiceMessage(messageOf('condition-field')).prefix).toContain('Col: 14');
    // The service says Col 14 (the scalar); we say 18 (the `n` of `null`) so the caret lands on it.
    expect(diagnostic.range).toEqual({ line: 3, col: 18, endLine: 3, endCol: 22 });
    expect(diagnostic.code).toBe('EXPRESSION_UNRECOGNIZED_VALUE');
    expect(diagnostic.message).toBe(splitPrefix(messageOf('condition-field')).body);
  });

  it('frames the real source line through E01s renderer', () => {
    const { text, offset } = trimExpressionText(CONDITION.inner);
    const openOffset = CONDITION.yaml.indexOf(`\${{${CONDITION.inner}}}`);
    const diagnostic = expressionDiagnostic(rejectionOf(text), text, {
      file: 'azure-pipelines.yml',
      source: CONDITION.yaml,
      offset: openOffset + 3 + offset,
    });
    expect(renderDiagnostic(diagnostic, { source: CONDITION.yaml, contextLines: 1 })).toContain(
      ['  > 3 |   condition: ${{ null }}', '      |                  ^^^^'].join('\n'),
    );
  });

  it('lands on the token when the offset comes from a real parsed document, not from the test', () => {
    // The one piece of arithmetic E03-S01 must get right is `ExprHost.offset`, and everywhere else
    // in this file the test computes it by hand. Here it comes from E01's parser instead: the
    // scalar node's own provenance + the delimiter width + what `trimExpressionText` dropped. If
    // that lands where the hand-computed range lands, the seam is proven rather than asserted.
    const parsed = parsePipelineYaml(CONDITION.yaml, 'azure-pipelines.yml');
    expect(parsed.errors).toEqual([]);
    const root = parsed.root;
    const steps = root?.kind === 'mapping' ? root.entries[0]?.value : undefined;
    const step = steps?.kind === 'sequence' ? steps.items[0] : undefined;
    const scalar =
      step?.kind === 'mapping'
        ? step.entries.find((entry) => entry.key.value === 'condition')?.value
        : undefined;
    if (scalar?.kind !== 'scalar') throw new Error('expected the condition scalar');

    // Exactly what E03-S01's scanner will do: find the delimiter inside the scalar's own source
    // text, then hand `errors.ts` the offset of the trimmed expression.
    const raw = snippetOf(parsed.source, scalar);
    const open = raw.indexOf('${{');
    const inner = raw.slice(open + 3, raw.lastIndexOf('}}'));
    const { text, offset } = trimExpressionText(inner);
    expect(text).toBe('null');

    const diagnostic = expressionDiagnostic(rejectionOf(text), text, {
      file: 'azure-pipelines.yml',
      source: parsed.source,
      offset: scalar.pos.offset[0] + open + 3 + offset,
    });
    expect(diagnostic.range).toEqual({ line: 3, col: 18, endLine: 3, endCol: 22 });
  });

  it('falls back to the host scalar range when the file text is not at hand', () => {
    const range = { line: 9, col: 5, endLine: 9, endCol: 30 };
    const diagnostic = expressionDiagnostic(rejectionOf('null'), 'null', {
      file: 'template.yml',
      offset: 0,
      range,
    });
    expect(diagnostic.range).toEqual(range);
    expect(diagnostic.file).toBe('template.yml');
  });

  it('prefixes the runtime message the way the service does, keeping our coordinates', () => {
    const diagnostic = expressionDiagnostic(rejectionOf('null'), 'null', {
      file: 'azure-pipelines.yml',
      source: 'x: $[ null ]\n',
      offset: 6,
      mode: 'runtime',
    });
    expect(diagnostic.message.startsWith(RUNTIME_MESSAGE_PREFIX)).toBe(true);
    expect(diagnostic.range).toEqual({ line: 1, col: 7, endLine: 1, endCol: 11 });
  });
});

describe('trimming (C-E02-104)', () => {
  it('strips exactly what the service strips, and says how much', () => {
    expect(trimExpressionText(' null ')).toEqual({ text: 'null', offset: 1 });
    expect(trimExpressionText('    1 == 1 ')).toEqual({ text: '1 == 1', offset: 4 });
    // A folded multi-line scalar arrives with the newline still in the delimited text.
    expect(trimExpressionText(' null\n    ')).toEqual({ text: 'null', offset: 1 });
    expect(trimExpressionText('')).toEqual({ text: '', offset: 0 });
  });

  it('is what makes the extra-whitespace rows report position 1 rather than 5', () => {
    for (const id of ['ws-baseline', 'ws-leading', 'ws-newline']) {
      const { text } = trimExpressionText(caseById(id).inner);
      expect(servicePosition(rejectionOf(text))).toBe(1);
      expect(parseServiceMessage(messageOf(id)).position).toBe(1);
    }
  });
});

describe('caret rendering', () => {
  it('underlines the offending token', () => {
    expect(renderExprError(rejectionOf('eq(1, 2, 3)'), 'eq(1, 2, 3)')).toBe(
      [
        `Unexpected symbol: ','. Located at position 8 within expression: 'eq(1, 2, 3)'. ` +
          `For more help, refer to ${EXPRESSION_HELP_URL}`,
        '  eq(1, 2, 3)',
        '         ^',
      ].join('\n'),
    );
  });

  it('spans a multi-character token', () => {
    expect(renderExprCaret(rejectionOf('1 == 1'), '1 == 1')).toBe('  1 == 1\n    ^^');
  });

  it('marks the whole expression for the two errors that have no position of their own', () => {
    expect(renderExprError(rejectionOf(`${'not('.repeat(51)}false${')'.repeat(51)}`), 'x')).toBe(
      [
        `Exceeded max expression depth 50. For more help, refer to ${EXPRESSION_HELP_URL}`,
        '  x',
        '  ^',
      ].join('\n'),
    );
    // The empty expression has nothing to point at, so it renders as the bare sentence.
    expect(renderExprError(rejectionOf(''), '')).toBe('An expression was expected');
  });

  it('flattens newlines so the caret column stays honest', () => {
    const error: ExprParseError = {
      code: 'unexpected-symbol',
      message: "Unexpected symbol: 'b'",
      raw: 'b',
      span: { start: 2, end: 3 },
    };
    expect(renderExprCaret(error, 'a\nb')).toBe('  a b\n    ^');
  });
});
