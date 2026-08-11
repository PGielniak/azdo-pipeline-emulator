// E02-S01-T01 — expression tokenizer + parser.
//
// The table below IS the grounding artifact in test form: every row was submitted to the live
// service (`research/experiments/E02-grammar/survey.md`) and carries the row id it came from, the
// claim it encodes, and — for rejections — the **1-based position the service reported**. Asserting
// that our span converts to the same position is what "spans verified" means here; a parser that
// rejects the right expressions in the wrong place is still wrong, because E02-S01-T02 renders a
// caret from these spans.
//
// Two whole-table invariants back the per-row assertions up:
//   * every node's span, sliced out of the source, re-parses to the same subtree;
//   * print → re-parse round-trips the whole table.
// The second one caught the `''` string escape being consumed but not re-emitted.
import { describe, expect, it } from 'vitest';

import { tokenize } from '../../src/expr/lexer.js';
import {
  liftSpan,
  makeRegistry,
  parseExpression,
  print,
  walk,
  type ExprErrorCode,
  type ExprLiteral,
  type ExprNode,
  type ExprParseResult,
} from '../../src/expr/parser.js';

/**
 * Enough of the real function set to exercise resolution; full signatures land with E02-S03.
 * `Infinity` for the N-ary maximum mirrors the doc's "Maximum parameters: N".
 */
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
  /** Expression text exactly as submitted to the service. */
  readonly expr: string;
  /** `undefined` = accepted (HTTP 200); otherwise the error we must report. */
  readonly code?: ExprErrorCode;
  /** 1-based position the service reported, where its message carries one. */
  readonly pos?: number;
  /** Only fails once names/arities can be resolved — i.e. with a registry. */
  readonly needsRegistry?: boolean;
  /** Survey row id in research/experiments/E02-grammar/survey.md. */
  readonly row: string;
  readonly claim: string;
  /** Set where we knowingly differ from the service's message (not its verdict). */
  readonly note?: string;
}

const nest = (depth: number) => `${'not('.repeat(depth)}false${')'.repeat(depth)}`;

const CASES: readonly Case[] = [
  // ---- Literals: accepted ---------------------------------------------------------------------
  { expr: 'true', row: 'bool-lower', claim: 'C-E02-002' },
  { expr: 'True', row: 'bool-title', claim: 'C-E02-002' },
  { expr: 'TRUE', row: 'bool-upper', claim: 'C-E02-002' },
  { expr: '42', row: 'num-int', claim: 'C-E02-004' },
  { expr: '-1.2', row: 'num-neg', claim: 'C-E02-004' },
  { expr: '.5', row: 'num-lead-dot', claim: 'C-E02-004' },
  { expr: '1.', row: 'num-trail-dot', claim: 'C-E02-004' },
  { expr: '1.2', row: 'ver-two', claim: 'C-E02-005' },
  { expr: '1.2.3', row: 'ver-three', claim: 'C-E02-005' },
  { expr: '1.2.3.4', row: 'ver-four', claim: 'C-E02-005' },
  { expr: "'a b c'", row: 'str-plain', claim: 'C-E02-006' },
  { expr: "'It''s OK'", row: 'str-escape', claim: 'C-E02-006' },

  // ---- Literals: rejected ---------------------------------------------------------------------
  {
    expr: 'null',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'null-lower',
    claim: 'C-E02-003',
  },
  {
    expr: 'NULL',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'null-upper',
    claim: 'C-E02-003',
  },
  { expr: '+1', code: 'unrecognized-value', pos: 1, row: 'num-plus', claim: 'C-E02-004' },
  { expr: '1e3', code: 'unrecognized-value', pos: 1, row: 'num-exp', claim: 'C-E02-004' },
  { expr: '0x1F', code: 'unrecognized-value', pos: 1, row: 'num-hex', claim: 'C-E02-004' },
  { expr: '1..2', code: 'unrecognized-value', pos: 1, row: 'num-double-dot', claim: 'C-E02-004' },
  {
    expr: 'NaN',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'nan',
    claim: 'C-E02-004',
  },
  {
    expr: 'Infinity',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'infinity',
    claim: 'C-E02-004',
  },
  { expr: '-1.2.3', code: 'unrecognized-value', pos: 1, row: 'neg-version', claim: 'C-E02-005' },
  { expr: '1.2.3.4.5', code: 'unrecognized-value', pos: 1, row: 'ver-five', claim: 'C-E02-005' },
  { expr: '"double"', code: 'unrecognized-value', pos: 1, row: 'str-double', claim: 'C-E02-006' },
  {
    expr: "'unclosed",
    code: 'unrecognized-value',
    pos: 1,
    row: 'str-unclosed',
    claim: 'C-E02-006',
    note: 'the service never reaches its expression lexer here — the template scanner rejects the unclosed ${{ first, because }} was eaten as string content',
  },

  // ---- Operators: all rejected (C-E02-001) ----------------------------------------------------
  { expr: '1 == 1', code: 'unexpected-symbol', pos: 3, row: 'op-eq', claim: 'C-E02-001' },
  { expr: '1 != 2', code: 'unexpected-symbol', pos: 3, row: 'op-ne', claim: 'C-E02-001' },
  { expr: 'true && false', code: 'unexpected-symbol', pos: 6, row: 'op-and', claim: 'C-E02-001' },
  { expr: 'true || false', code: 'unexpected-symbol', pos: 6, row: 'op-or', claim: 'C-E02-001' },
  { expr: '1 > 0', code: 'unexpected-symbol', pos: 3, row: 'op-gt', claim: 'C-E02-001' },
  { expr: '1 < 2', code: 'unexpected-symbol', pos: 3, row: 'op-lt', claim: 'C-E02-001' },
  {
    expr: 'true & false',
    code: 'unexpected-symbol',
    pos: 6,
    row: 'op-amp-single',
    claim: 'C-E02-001',
  },
  {
    expr: 'true | false',
    code: 'unexpected-symbol',
    pos: 6,
    row: 'op-pipe-single',
    claim: 'C-E02-001',
  },
  { expr: '!true', code: 'unrecognized-value', pos: 1, row: 'op-not', claim: 'C-E02-001' },
  { expr: '(true)', code: 'unexpected-symbol', pos: 1, row: 'op-group', claim: 'C-E02-001' },
  { expr: 'eq(1, 1)', row: 'op-func-control', claim: 'C-E02-001' },

  // ---- Access ---------------------------------------------------------------------------------
  { expr: 'parameters.obj.a', row: 'acc-property', claim: 'C-E02-007' },
  { expr: 'parameters.obj.b_c', row: 'acc-underscore', claim: 'C-E02-007' },
  { expr: 'parameters.obj._lead', row: 'acc-lead-underscore', claim: 'C-E02-007' },
  {
    expr: 'parameters.obj.9num',
    code: 'unexpected-symbol',
    pos: 16,
    row: 'acc-lead-digit',
    claim: 'C-E02-007',
  },
  { expr: "parameters.obj['dotted.name']", row: 'acc-index-string', claim: 'C-E02-008' },
  { expr: 'parameters.obj.list[0].id', row: 'acc-index-number', claim: 'C-E02-008' },
  { expr: 'parameters.obj.list[parameters.obj.a].id', row: 'acc-index-expr', claim: 'C-E02-008' },
  { expr: "parameters['obj'].a", row: 'acc-index-named', claim: 'C-E02-008' },
  { expr: "split('a,b', ',')[1]", row: 'acc-func-index', claim: 'C-E02-008' },
  { expr: 'parameters.obj.nosuch', row: 'acc-missing', claim: 'C-E02-010' },
  { expr: 'parameters.obj.nosuch.deeper', row: 'acc-missing-chain', claim: 'C-E02-010' },
  { expr: 'convertToJson(parameters.obj.list.*.id)', row: 'acc-wildcard-dot', claim: 'C-E02-009' },
  {
    expr: 'convertToJson(parameters.obj.list[*].id)',
    row: 'acc-wildcard-index',
    claim: 'C-E02-009',
  },
  { expr: 'convertToJson(parameters)', row: 'acc-named-bare', claim: 'C-E02-012' },
  { expr: 'PARAMETERS.obj.a', row: 'acc-named-case', claim: 'C-E02-012' },

  // ---- Parse-time validation ------------------------------------------------------------------
  { expr: 'EQ(1, 1)', row: 'val-func-case', claim: 'C-E02-011' },
  { expr: 'eq (1, 1)', row: 'val-func-space', claim: 'C-E02-011' },
  {
    expr: 'nosuchfunc(1)',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'val-func-unknown',
    claim: 'C-E02-011',
  },
  {
    expr: 'eq(1)',
    code: 'unexpected-symbol',
    pos: 5,
    needsRegistry: true,
    row: 'val-func-arity',
    claim: 'C-E02-017',
  },
  {
    expr: 'eq(1, 2, 3)',
    code: 'unexpected-symbol',
    pos: 8,
    needsRegistry: true,
    row: 'val-func-too-many',
    claim: 'C-E02-017',
  },
  {
    expr: 'nosuchcontext.a',
    code: 'unrecognized-value',
    pos: 1,
    needsRegistry: true,
    row: 'val-named-unknown',
    claim: 'C-E02-012',
  },
  {
    expr: 'parameters.obj.list[]',
    code: 'unexpected-symbol',
    pos: 21,
    row: 'val-empty-index',
    claim: 'C-E02-017',
  },
  {
    expr: 'parameters.obj.',
    code: 'expected-property-name',
    pos: 15,
    row: 'val-trailing-dot',
    claim: 'C-E02-013',
  },
  {
    expr: 'eq(1,',
    code: 'unclosed-function',
    pos: 1,
    row: 'val-unclosed-call',
    claim: 'C-E02-013',
  },
  { expr: '1 2', code: 'unexpected-symbol', pos: 3, row: 'val-trailing', claim: 'C-E02-013' },
  { expr: '', code: 'empty-expression', row: 'val-empty', claim: 'C-E02-013' },

  // ---- Depth ceiling (C-E02-014) --------------------------------------------------------------
  { expr: nest(10), row: 'val-depth-control', claim: 'C-E02-014' },
  { expr: nest(49), row: 'val-depth-49', claim: 'C-E02-014' },
  { expr: nest(50), code: 'exceeded-max-depth', row: 'val-depth-50', claim: 'C-E02-014' },
  { expr: nest(51), code: 'exceeded-max-depth', row: 'val-depth-51', claim: 'C-E02-014' },
  { expr: nest(60), code: 'exceeded-max-depth', row: 'val-depth', claim: 'C-E02-014' },
  { expr: `parameters.obj${'.a'.repeat(60)}`, row: 'val-depth-property', claim: 'C-E02-014' },
  { expr: `parameters.obj${"['a']".repeat(60)}`, row: 'val-depth-index', claim: 'C-E02-014' },
];

/** Structural comparison: spans move when a subtree is sliced out, the shape must not. */
function shape(node: ExprNode): unknown {
  switch (node.type) {
    case 'literal':
      return { type: 'literal', literal: node.literal };
    case 'namedValue':
      return { type: 'namedValue', name: node.name };
    case 'call':
      return { type: 'call', name: node.name, args: node.args.map(shape) };
    case 'property':
      return { type: 'property', name: node.name, target: shape(node.target) };
    case 'index':
      return { type: 'index', target: shape(node.target), index: shape(node.index) };
    case 'wildcard':
      return { type: 'wildcard' };
  }
}

const ok = (result: ExprParseResult): ExprNode => {
  if (!result.ok)
    throw new Error(`expected a parse, got ${result.error.code}: ${result.error.message}`);
  return result.node;
};

/** `ok` narrowed to a literal node, for the value assertions. */
const literalOf = (result: ExprParseResult): ExprLiteral => {
  const node = ok(result);
  if (node.type !== 'literal') throw new Error(`expected a literal, got ${node.type}`);
  return node.literal;
};

describe('grammar table (every row = one live service probe)', () => {
  it('covers at least 60 cases, as the Done criterion requires', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(60);
  });

  it('never reuses a survey row', () => {
    expect(new Set(CASES.map((c) => c.row)).size).toBe(CASES.length);
  });

  for (const testCase of CASES) {
    const label = `${testCase.row} [${testCase.claim}] ${testCase.expr.slice(0, 60) || '(empty)'}`;

    it(`matches the service: ${label}`, () => {
      const result = parseExpression(testCase.expr, { registry: REGISTRY });
      if (testCase.code === undefined) {
        expect(result.ok, `${testCase.expr} should parse`).toBe(true);
        return;
      }
      expect(result.ok, `${testCase.expr} should be rejected`).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe(testCase.code);
      if (testCase.pos !== undefined) {
        // Service positions are 1-based within the expression text (C-E02-013).
        expect(result.error.span.start + 1, result.error.message).toBe(testCase.pos);
      }
    });
  }

  it('only name/arity rows depend on the registry being supplied', () => {
    for (const testCase of CASES) {
      const bare = parseExpression(testCase.expr);
      const expected = testCase.needsRegistry === true ? undefined : testCase.code;
      expect(bare.ok ? undefined : bare.error.code, `${testCase.row}: ${testCase.expr}`).toBe(
        expected,
      );
    }
  });
});

describe('spans', () => {
  const parsed = CASES.filter((c) => c.code === undefined).map(
    (c) => [c, ok(parseExpression(c.expr, { registry: REGISTRY }))] as const,
  );

  it('stay inside the expression text and are non-empty', () => {
    for (const [testCase, node] of parsed) {
      for (const child of walk(node)) {
        expect(child.span.start, testCase.expr).toBeGreaterThanOrEqual(0);
        expect(child.span.end, testCase.expr).toBeLessThanOrEqual(testCase.expr.length);
        expect(child.span.end, testCase.expr).toBeGreaterThan(child.span.start);
      }
    }
  });

  it('slice back out to the same subtree — the real span check', () => {
    for (const [testCase, node] of parsed) {
      for (const child of walk(node)) {
        // `*` is not an expression on its own, only the index of one.
        if (child.type === 'wildcard') continue;
        const text = testCase.expr.slice(child.span.start, child.span.end);
        const reparsed = parseExpression(text, { registry: REGISTRY });
        expect(reparsed.ok, `${testCase.expr} → slice ${JSON.stringify(text)}`).toBe(true);
        if (reparsed.ok) expect(shape(reparsed.node), text).toEqual(shape(child));
      }
    }
  });

  it('lift into file coordinates through one seam', () => {
    const node = ok(parseExpression('eq(variables.a, 1)', { registry: REGISTRY }));
    const arg = node.type === 'call' ? node.args[1] : undefined;
    expect(arg?.span).toEqual({ start: 16, end: 17 });
    // `${{ eq(...) }}` starting at file offset 100 puts the expression text at 104.
    expect(liftSpan(arg?.span ?? { start: 0, end: 0 }, 104)).toEqual({ start: 120, end: 121 });
  });
});

describe('printing', () => {
  it('round-trips every accepted case', () => {
    for (const testCase of CASES.filter((c) => c.code === undefined)) {
      const node = ok(parseExpression(testCase.expr, { registry: REGISTRY }));
      const again = parseExpression(print(node), { registry: REGISTRY });
      expect(again.ok, `${testCase.expr} → ${print(node)}`).toBe(true);
      if (again.ok) expect(shape(again.node), testCase.expr).toEqual(shape(node));
    }
  });

  it('unifies the two wildcard spellings (C-E02-009)', () => {
    const dot = ok(
      parseExpression('convertToJson(parameters.obj.list.*.id)', { registry: REGISTRY }),
    );
    const index = ok(
      parseExpression('convertToJson(parameters.obj.list[*].id)', { registry: REGISTRY }),
    );
    expect(shape(dot)).toEqual(shape(index));
    expect(print(dot)).toBe('convertToJson(parameters.obj.list[*].id)');
  });

  it('re-escapes single quotes (C-E02-006)', () => {
    const node = ok(parseExpression("'It''s OK'"));
    expect(literalOf(parseExpression("'It''s OK'"))).toEqual({ kind: 'string', value: "It's OK" });
    expect(print(node)).toBe("'It''s OK'");
  });
});

describe('AST shapes', () => {
  it('reads a version literal as segments, not a number (C-E02-005)', () => {
    expect(literalOf(parseExpression('1.2.3'))).toEqual({ kind: 'version', segments: [1, 2, 3] });
    // The two-segment case is a Number — settled live by gt(1.10, 1.9) → False.
    expect(literalOf(parseExpression('1.2'))).toEqual({ kind: 'number', value: 1.2 });
  });

  it('keeps property and index spellings distinct while meaning the same access (C-E02-008)', () => {
    expect(ok(parseExpression('parameters.obj')).type).toBe('property');
    expect(ok(parseExpression("parameters['obj']")).type).toBe('index');
  });

  it('chains postfix uniformly off a call result', () => {
    const node = ok(parseExpression("split('a,b', ',')[1]", { registry: REGISTRY }));
    expect(node.type).toBe('index');
    expect(node.type === 'index' && node.target.type).toBe('call');
  });

  it('preserves the written case of names (C-E02-002/011/012)', () => {
    expect(ok(parseExpression('EQ(1, 1)', { registry: REGISTRY })).type).toBe('call');
    expect(ok(parseExpression('EQ(1, 1)', { registry: REGISTRY }))).toMatchObject({ name: 'EQ' });
    expect(literalOf(parseExpression('True'))).toEqual({ kind: 'boolean', value: true });
  });
});

describe('tokenizer', () => {
  it('classifies a keyword as a function only when `(` follows, whitespace allowed', () => {
    expect(tokenize('eq (1, 1)')[0]?.kind).toBe('function');
    expect(tokenize('parameters.a')[0]?.kind).toBe('namedValue');
  });

  it('distinguishes a leading `.` number from a dereference', () => {
    expect(tokenize('.5')[0]).toMatchObject({ kind: 'number', value: 0.5 });
    expect(tokenize('a.b')[1]?.kind).toBe('dereference');
    expect(tokenize('eq(.5, 1)')[2]).toMatchObject({ kind: 'number', value: 0.5 });
  });

  it('gives every token a span that slices back to its own text', () => {
    const text = "eq(parameters.obj['a'].list[*].id, 'x')";
    for (const token of tokenize(text)) {
      expect(text.slice(token.span.start, token.span.end)).toBe(token.raw);
    }
  });

  it('rejects `! true` too, at a position we knowingly do not share with the service', () => {
    // Documented divergence: the service reports `Unexpected symbol: 'true'` at 3; the operand is
    // where its lexer gives up. Ours reports the `!` run at 1. Both reject — see
    // research/E02-expressions.md, "Known message-level divergence".
    const result = parseExpression('! true');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.span.start + 1).toBe(1);
  });
});
