// E02-S05-T02 — one table, two runners.
//
// Runner 1 (here): the convert-time `ExprNode` backend through `evaluateExpression`.
// Runner 2: `packages/runtime/test/expr-conformance.bats`, generated at the bottom of this file
//   and executed by `pnpm test:bats`. It is committed, and the snapshot assertion below is the
//   freshness guard — editing the compiler without regenerating turns this file red rather than
//   leaving a stale suite passing against code that no longer exists.
import { describe, expect, it } from 'vitest';
import {
  BashCompileError,
  booleanValue,
  compileBash,
  evaluateExpression,
  parseExpression,
  registryForSlot,
  variablesContext,
  type ExprEvaluationContext,
  type ExprNode,
} from '../../src/index.js';
import { CONFORMANCE_ROWS, type ConformanceRow } from './conformance.table.js';

const parse = (row: ConformanceRow): ExprNode => {
  const result = parseExpression(row.source, { registry: registryForSlot(row.slot) });
  if (!result.ok) throw new Error(`${row.id}: ${result.error.message}`);
  return result.node;
};

const label = (row: ConformanceRow): string => `${row.claim} ${row.id}: ${row.source}`;

const evaluationContext = (row: ConformanceRow): ExprEvaluationContext => ({
  slot: row.slot,
  values: {
    ...row.values,
    ...(row.store === undefined ? {} : { variables: variablesContext(row.store) }),
  },
  status: row.status,
  counters: row.counters,
});

describe('conformance table (E02-S05-T02)', () => {
  it('rows have unique ids', () => {
    const ids = CONFORMANCE_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every row parses in its declared slot', () => {
    for (const row of CONFORMANCE_ROWS) expect(() => parse(row), label(row)).not.toThrow();
  });
});

describe('eval backend', () => {
  for (const row of CONFORMANCE_ROWS) {
    it(label(row), () => {
      const evaluate = () => evaluateExpression(parse(row), evaluationContext(row));
      if (row.expected === 'throws') {
        expect(evaluate).toThrow();
        return;
      }
      expect(evaluate()).toEqual(booleanValue(row.expected));
    });
  }
});

describe('shell backend compilation', () => {
  for (const row of CONFORMANCE_ROWS) {
    it(label(row), () => {
      const node = parse(row);
      if (row.shell.kind === 'unsupported') {
        // Asserted, never skipped: if the compiler learns to emit this row, the reason recorded in
        // the table is stale and the row must be re-dispositioned rather than quietly widened.
        expect(() => compileBash(node), row.shell.reason).toThrow(BashCompileError);
        return;
      }
      expect(compileBash(node)).toBeTypeOf('string');
    });
  }
});

// ------------------------------------------------------------------------------------------
// Runner 2 — generate the bats suite
// ------------------------------------------------------------------------------------------

const shQuote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
/** bats names the test in a double-quoted string. */
const batsName = (text: string): string => text.replaceAll(/[\\"$`]/gu, (char) => `\\${char}`);

const statusFor = (expected: boolean | 'throws'): number =>
  expected === 'throws' ? 2 : expected ? 0 : 1;

function batsCase(row: ConformanceRow): string {
  const shell = row.shell;
  const disposition = shell.kind === 'diverges' ? `diverges ${shell.claim}` : 'agree';
  const expected = shell.kind === 'diverges' ? shell.shellExpected : row.expected;
  const lines = [`@test "${batsName(`${row.claim} ${row.id} [${disposition}]: ${row.source}`)}" {`];
  if (shell.kind === 'diverges') lines.push(`  # ${shell.reason}`);
  for (const [name, value] of Object.entries(row.store ?? {})) {
    lines.push(`  azdo_var_set ${shQuote(name)} ${shQuote(value)}`);
  }
  for (const [name, status] of Object.entries(row.stubs ?? {})) {
    lines.push(`  azdo_status_${name.toLowerCase()}() { return ${status}; }`);
  }
  lines.push(`  run -${statusFor(expected)} azdo_emu_expr_run ${shQuote(compileBash(parse(row)))}`);
  lines.push('}');
  return lines.join('\n');
}

function generateBats(): string {
  const runnable = CONFORMANCE_ROWS.filter((row) => row.shell.kind !== 'unsupported');
  const unsupported = CONFORMANCE_ROWS.filter((row) => row.shell.kind === 'unsupported');
  return [
    '#!/usr/bin/env bats',
    '# GENERATED FILE — do not edit.',
    '#',
    '# Source of truth: packages/engine/test/expr/conformance.table.ts (E02-S05-T02).',
    '# Regenerate with `pnpm expr-conformance-bats`; the engine suite fails while this file is',
    '# stale, so the two backends cannot drift apart unnoticed.',
    '#',
    '# Exit status is the datum: 0 = True, 1 = False, 2 = evaluation error. Rows tagged',
    '# `diverges` assert the *measured* shell answer together with the claim that explains why it',
    '# differs from the evaluator, so the gap can neither widen nor vanish in silence.',
    '#',
    `# ${unsupported.length} row(s) are rejected by the compiler and are asserted in the engine suite`,
    '# instead (BashCompileError):',
    ...unsupported.map((row) => `#   ${row.id} — ${(row.shell as { reason: string }).reason}`),
    '',
    'bats_require_minimum_version 1.5.0',
    '',
    'setup() {',
    '  load helpers/expr-conformance.bash',
    '  azdo_emu_expr_setup',
    '}',
    '',
    ...runnable.map(batsCase),
    '',
  ].join('\n');
}

describe('shell backend suite', () => {
  it('the committed bats file matches the table', async () => {
    await expect(generateBats()).toMatchFileSnapshot('../../../runtime/test/expr-conformance.bats');
  });
});
