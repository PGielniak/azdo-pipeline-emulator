// E02-S05-T02 — the single row set behind both expression backends.
//
// Every row carries one behaviour with its claim ID, three ways of being checked:
//   * `source` + evaluator state — parsed and executed by `evaluateExpression` against the same
//     AST the shell backend consumes.
//   * `source` + `slot` — the run-time backend: parsed, compiled by `compileBash`, executed by
//     bats against `packages/runtime/lib/{core,expr}.sh`.
//   * `shell` — what the run-time backend is *allowed* to do with the row. `agree` means it must
//     return the same answer; `unsupported` means `compileBash` must raise `BashCompileError`;
//     `diverges` means it compiles and answers differently, and the row pins that answer so the
//     divergence cannot widen or silently disappear.
//
// Nothing is ever skipped: an unsupported row that starts compiling, and a diverging row that
// starts agreeing, both turn the build red and have to be re-recorded.
import {
  type CounterStateProvider,
  type ExprContextValues,
  type ExprSlot,
  type StatusState,
} from '../../src/index.js';
import { COERCION_ROWS } from './coercion.table.js';

export type ShellDisposition =
  | { readonly kind: 'agree' }
  /** `compileBash` must refuse the row; the reason is asserted to be recorded, not the message. */
  | { readonly kind: 'unsupported'; readonly reason: string }
  /** The compiled form runs but answers differently; `shellExpected` pins the measured answer. */
  | {
      readonly kind: 'diverges';
      readonly reason: string;
      readonly claim: string;
      readonly shellExpected: boolean | 'throws';
    };

export interface ConformanceRow {
  readonly id: string;
  readonly claim: string;
  readonly source: string;
  readonly slot: ExprSlot;
  /** `throws` = the evaluator raises, and the compiled form exits 2. */
  readonly expected: boolean | 'throws';
  /** Context values supplied to the AST evaluator. */
  readonly values?: ExprContextValues;
  /** Status state supplied only to rows that call a status function. */
  readonly status?: StatusState;
  /** Convert-time counter state supplied only to counter rows. */
  readonly counters?: CounterStateProvider;
  /** Variables seeded into the fixture store before the compiled form runs. */
  readonly store?: Readonly<Record<string, string>>;
  /** Status-function stubs the generated bats defines, as `name → exit status`. */
  readonly stubs?: Readonly<Record<string, 0 | 1>>;
  readonly shell: ShellDisposition;
}

const AGREE: ShellDisposition = { kind: 'agree' };

// ------------------------------------------------------------------------------------------
// S02 — coercion & equality (C-E02-020..023)
// ------------------------------------------------------------------------------------------

const COERCION_CONFORMANCE: readonly ConformanceRow[] = COERCION_ROWS.flatMap((row) =>
  row.source === undefined
    ? []
    : [
        {
          id: `coercion-${row.id}`,
          claim: row.claim,
          source: row.source,
          slot: 'job-condition' as ExprSlot,
          expected: row.expected,
          shell: AGREE,
        },
      ],
);

// ------------------------------------------------------------------------------------------
// S03 — logical, membership and general functions (C-E02-028..032, C-E02-041..051)
// ------------------------------------------------------------------------------------------

const FUNCTION_CONFORMANCE: readonly ConformanceRow[] = [
  {
    id: 'and-short-circuits-on-false',
    claim: 'C-E02-028',
    source: "and(false, lt(1, 'x'))",
    slot: 'job-condition',
    expected: false,
    shell: AGREE,
  },
  {
    id: 'and-all-true',
    claim: 'C-E02-028',
    source: "and(eq(1, 1), eq('a', 'A'))",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'or-short-circuits-on-true',
    claim: 'C-E02-028',
    source: "or(true, lt(1, 'x'))",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'or-after-conversion-error',
    claim: 'C-E02-028',
    source: "or(lt(1, 'x'), true)",
    slot: 'job-condition',
    expected: 'throws',
    shell: {
      kind: 'diverges',
      claim: 'C-E02-143',
      reason:
        'an OR list runs its right operand after any non-zero status, so the status-2 conversion error of the left operand is masked as False',
      shellExpected: true,
    },
  },
  {
    id: 'not-inverts',
    claim: 'C-E02-028',
    source: 'not(eq(1, 2))',
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'not-converts-string',
    claim: 'C-E02-028',
    source: "not('')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'in-matches-later-candidate',
    claim: 'C-E02-030',
    source: "in('b', 'a', 'B')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'in-converts-candidates',
    claim: 'C-E02-030',
    source: "in(1000, 'x', '1,000')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'not-in-absent',
    claim: 'C-E02-030',
    source: "notIn('b', 'a', 'c')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'contains-ordinal-ignore-case',
    claim: 'C-E02-031',
    source: "contains('ABCdef', 'cDe')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'contains-absent',
    claim: 'C-E02-031',
    source: "contains('abc', 'z')",
    slot: 'job-condition',
    expected: false,
    shell: AGREE,
  },
  {
    id: 'contains-value-array',
    claim: 'C-E02-032',
    source: "containsValue('a', 'b')",
    slot: 'job-condition',
    expected: false,
    shell: {
      kind: 'unsupported',
      reason: 'containsValue consumes an Array/Object, which has no shell representation',
    },
  },
  {
    id: 'starts-with-ignores-case',
    claim: 'C-E02-041',
    source: "startsWith('refs/heads/main', 'REFS/')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'ends-with-ignores-case',
    claim: 'C-E02-041',
    source: "endsWith('main', 'AIN')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'xor-differs',
    claim: 'C-E02-041',
    source: 'xor(true, false)',
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'xor-converts-number',
    claim: 'C-E02-041',
    source: 'xor(true, 0)',
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'format-reorders-and-reuses',
    claim: 'C-E02-045',
    source: "eq(format('{1}/{0}/{1}', 'a', 'b'), 'b/a/b')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'format-doubled-braces',
    claim: 'C-E02-045',
    source: "eq(format('{{{0}}}', 'x'), '{x}')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'format-missing-index',
    claim: 'C-E02-045',
    source: "eq(format('{2}', 'a'), 'x')",
    slot: 'job-condition',
    expected: 'throws',
    shell: {
      kind: 'diverges',
      claim: 'C-E02-144',
      reason:
        'a helper in value position reports its error through an exit status that command substitution discards, so the failed format yields the empty string and the comparison answers False instead of raising',
      shellExpected: false,
    },
  },
  {
    id: 'lower-folds',
    claim: 'C-E02-041',
    source: "eq(lower('AB'), 'ab')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'upper-folds',
    claim: 'C-E02-041',
    source: "eq(upper('ab'), 'AB')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'trim-strips-both-ends',
    claim: 'C-E02-041',
    source: "eq(trim('  x  '), 'x')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'replace-all-occurrences',
    claim: 'C-E02-046',
    source: "eq(replace('a.b.c', '.', '-'), 'a-b-c')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    // The needle is a literal substring, not a glob — the distinction the shell form must not lose
    // when it stops using `${var//pat/rep}` (C-E02-147).
    id: 'replace-treats-search-literally',
    claim: 'C-E02-046',
    source: "eq(replace('a*b*c', '*', '-'), 'a-b-c')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'replace-empty-search-is-identity',
    claim: 'C-E02-046',
    source: "eq(replace('abc', '', '-'), 'abc')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'length-counts-string',
    claim: 'C-E02-047',
    source: "eq(length('abcd'), 4)",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'coalesce-skips-empty',
    claim: 'C-E02-041',
    source: "eq(coalesce('', 'z'), 'z')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'iif-selects-false-branch',
    claim: 'C-E02-049',
    source: "eq(iif(false, 'a', 'b'), 'b')",
    slot: 'job-condition',
    expected: true,
    shell: AGREE,
  },
  {
    id: 'split-returns-array',
    claim: 'C-E02-048',
    source: "eq(split('a,b', ','), 'x')",
    slot: 'job-condition',
    expected: false,
    shell: { kind: 'unsupported', reason: 'split returns an Array, which has no shell form' },
  },
  {
    id: 'join-consumes-array',
    claim: 'C-E02-041',
    source: "eq(join(',', 'x'), 'x')",
    slot: 'job-condition',
    expected: true,
    shell: { kind: 'unsupported', reason: 'join consumes an Array, which has no shell form' },
  },
  {
    id: 'convert-to-json-returns-text',
    claim: 'C-E02-041',
    source: "eq(convertToJson('a'), '\"a\"')",
    slot: 'job-condition',
    expected: true,
    shell: {
      kind: 'unsupported',
      reason: 'convertToJson serialises Object/Array values the shell backend cannot hold',
    },
  },
  {
    id: 'counter-needs-convert-time-state',
    claim: 'C-E02-051',
    source: "eq(counter('x'), 1)",
    slot: 'runtime-variable',
    expected: true,
    counters: { next: () => 1 },
    shell: {
      kind: 'unsupported',
      reason: 'counter reads the convert-time state provider seam, not the runtime store',
    },
  },
];

// ------------------------------------------------------------------------------------------
// S04 contexts through the store, and the docs/02 §6 canonical condition
// ------------------------------------------------------------------------------------------

const BRANCH_STORE = { 'Build.SourceBranch': 'refs/heads/main', BuildId: '42' } as const;

const CONTEXT_CONFORMANCE: readonly ConformanceRow[] = [
  {
    id: 'variables-dotted-name',
    claim: 'C-E02-089',
    source: "eq(variables['Build.SourceBranch'], 'refs/heads/main')",
    slot: 'job-condition',
    expected: true,
    store: BRANCH_STORE,
    shell: AGREE,
  },
  {
    id: 'variables-fold-case',
    claim: 'C-E02-089',
    source: 'eq(variables.buildid, 42)',
    slot: 'job-condition',
    expected: true,
    store: BRANCH_STORE,
    shell: AGREE,
  },
  {
    id: 'variables-missing-equals-empty',
    claim: 'C-E02-138',
    source: "eq(variables.Absent, '')",
    slot: 'job-condition',
    expected: true,
    store: BRANCH_STORE,
    shell: AGREE,
  },
  {
    id: 'variables-missing-ordered',
    claim: 'C-E02-138',
    source: "lt(variables.Absent, 'x')",
    slot: 'job-condition',
    expected: 'throws',
    store: BRANCH_STORE,
    shell: {
      kind: 'diverges',
      claim: 'C-E02-138',
      reason:
        'the shell backend has no Null: a missing variable reads as the empty String, which orders below "x" instead of failing the String→Null conversion',
      shellExpected: true,
    },
  },
  {
    id: 'condition-docs-canonical',
    claim: 'C-E02-131',
    source: "and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))",
    slot: 'job-condition',
    expected: true,
    store: BRANCH_STORE,
    stubs: { succeeded: 0 },
    status: { dependencies: { A: 'Succeeded' } },
    shell: AGREE,
  },
  {
    id: 'condition-docs-canonical-not-succeeded',
    claim: 'C-E02-131',
    source: "and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))",
    slot: 'job-condition',
    expected: false,
    store: BRANCH_STORE,
    stubs: { succeeded: 1 },
    status: { dependencies: { A: 'Failed' } },
    shell: AGREE,
  },
  {
    id: 'dynamic-index-unsupported',
    claim: 'C-E02-139',
    source: "eq(variables[variables.BuildId], 'x')",
    slot: 'job-condition',
    expected: false,
    shell: {
      kind: 'unsupported',
      reason: 'a dynamic index needs the whole variables table, not a single azdo_var read',
    },
  },
];

/** One table, two runners (E02-S05-T02). */
export const CONFORMANCE_ROWS: readonly ConformanceRow[] = [
  ...COERCION_CONFORMANCE,
  ...FUNCTION_CONFORMANCE,
  ...CONTEXT_CONFORMANCE,
];
