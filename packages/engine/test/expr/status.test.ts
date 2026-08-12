import { describe, expect, it, vi } from 'vitest';
import {
  STATUS_FUNCTION_NAMES,
  evaluateStatusFunction,
  statusFunctionSignatures,
  stringValue,
  type ExprArgument,
  type ExprValue,
  type JobResult,
  type StatusContext,
} from '../../src/index.js';
import { makeRegistry, parseExpression } from '../../src/expr/parser.js';

const arg =
  (value: ExprValue): ExprArgument =>
  () =>
    value;
const evaluate = (
  name: string,
  context: StatusContext,
  values: readonly ExprValue[] = [],
): boolean => {
  const result = evaluateStatusFunction(name, values.map(arg), context);
  expect(result.kind).toBe('boolean');
  return result.kind === 'boolean' && result.value;
};

describe('step status functions (C-E02-061/062)', () => {
  const expected: Record<JobResult, readonly boolean[]> = {
    Succeeded: [false, false, true, true],
    SucceededWithIssues: [false, false, true, true],
    Failed: [false, true, false, true],
    Canceled: [true, false, false, false],
    Skipped: [false, false, false, false],
    Abandoned: [false, false, false, false],
  };

  it.each(Object.entries(expected))('matches the agent table for %s', (jobStatus, row) => {
    const context: StatusContext = { scope: 'step', jobStatus: jobStatus as JobResult };
    expect([
      evaluate('canceled', context),
      evaluate('failed', context),
      evaluate('succeeded', context),
      evaluate('succeededOrFailed', context),
    ]).toEqual(row);
    expect(evaluate('always', context)).toBe(true);
  });

  it('defaults an unset Agent.JobStatus to Succeeded', () => {
    expect(evaluate('succeeded', { scope: 'step' })).toBe(true);
    expect(evaluate('failed', { scope: 'step' })).toBe(false);
  });

  it('rejects arguments for all five agent-side functions', () => {
    for (const name of STATUS_FUNCTION_NAMES) {
      expect(() => evaluate(name, { scope: 'step' }, [stringValue('job')])).toThrow(/0\.\.0/);
    }
  });
});

describe('job and stage status truth tables (C-E02-067..072)', () => {
  const graph = {
    ok: 'Succeeded',
    warning: 'SucceededWithIssues',
    failed: 'Failed',
    skipped: 'Skipped',
    abandoned: 'Abandoned',
  } as const;

  it.each(['job', 'stage'] as const)('uses the dependency graph at %s scope', (scope) => {
    const context: StatusContext = { scope, dependencies: graph };
    expect(evaluate('succeeded', context)).toBe(false);
    expect(evaluate('failed', context)).toBe(true);
    expect(evaluate('succeededOrFailed', context)).toBe(true);
    expect(evaluate('always', context)).toBe(true);
    expect(evaluate('canceled', context)).toBe(false);
  });

  it('narrows to named dependencies with case-insensitive lookup', () => {
    const context: StatusContext = { scope: 'job', dependencies: graph };
    expect(evaluate('succeeded', context, [stringValue('OK'), stringValue('warning')])).toBe(true);
    expect(evaluate('failed', context, [stringValue('FAILED')])).toBe(true);
    expect(evaluate('succeededOrFailed', context, [stringValue('skipped')])).toBe(false);
    expect(evaluate('succeeded', context, [stringValue('missing')])).toBe(false);
  });

  it('matches the measured empty dependency-set identities', () => {
    const context: StatusContext = { scope: 'job', dependencies: {} };
    expect(evaluate('succeeded', context)).toBe(true);
    expect(evaluate('failed', context)).toBe(false);
    expect(evaluate('succeededOrFailed', context)).toBe(true);
  });

  it('treats Skipped and Abandoned as neither success nor failure', () => {
    for (const result of ['Skipped', 'Abandoned'] as const) {
      const context: StatusContext = { scope: 'job', dependencies: { dependency: result } };
      expect(evaluate('succeeded', context)).toBe(false);
      expect(evaluate('failed', context)).toBe(false);
      expect(evaluate('succeededOrFailed', context)).toBe(false);
      expect(evaluate('always', context)).toBe(true);
    }
  });

  it('makes cancellation independent of dependency results', () => {
    const context: StatusContext = {
      scope: 'job',
      dependencies: { dependency: 'Succeeded' },
      runCanceled: true,
    };
    expect(evaluate('canceled', context)).toBe(true);
    expect(evaluate('succeeded', context)).toBe(false);
    expect(evaluate('succeededOrFailed', context)).toBe(false);
    expect(evaluate('failed', context)).toBe(false);
    expect(evaluate('always', context)).toBe(true);
  });
});

describe('status context integration (C-E02-064/066/067)', () => {
  it('reads results through an injected fake store and converts a lazy name argument', () => {
    const reads = vi.fn(() => ({ Build: 'Succeeded', Test: 'Skipped' }) as const);
    const context: StatusContext = {
      scope: 'job',
      get dependencies() {
        return reads();
      },
    };
    const name = vi.fn<ExprArgument>(() => stringValue('build'));
    expect(evaluateStatusFunction('SUCCEEDED', [name], context)).toMatchObject({ value: true });
    expect(name).toHaveBeenCalledOnce();
    expect(reads).toHaveBeenCalledOnce();
  });

  it('publishes scope-specific parser arities', () => {
    expect(
      statusFunctionSignatures('step').every(
        ({ minArgs, maxArgs }) => minArgs === 0 && maxArgs === 0,
      ),
    ).toBe(true);
    expect(statusFunctionSignatures('job').find(({ name }) => name === 'failed')).toMatchObject({
      minArgs: 0,
      maxArgs: Infinity,
    });
    expect(() => evaluate('always', { scope: 'job' }, [stringValue('dep')])).toThrow(/0\.\.0/);
  });
});

// ---------------------------------------------------------------------------------------------
// Parity replay of the live run recorded in research/experiments/E02-status/real-run.md.
//
// The tables above assert the *rules*; these rows assert that the rules still reproduce the run
// they were derived from. Each row carries the probe pipeline's own job name, so a failure points
// at a timeline record that can be re-read rather than at an abstraction.
// ---------------------------------------------------------------------------------------------

const DEPS = {
  ok: { dep_ok: 'Succeeded' },
  skipped: { dep_skipped: 'Skipped' },
  failed: { dep_fail: 'Failed' },
  abandoned: { dep_abandon: 'Abandoned' },
  mixed: { dep_ok: 'Succeeded', dep_skipped: 'Skipped' },
  none: {},
} satisfies Record<string, Readonly<Record<string, JobResult>>>;

interface LiveRow {
  readonly job: string;
  readonly deps: Readonly<Record<string, JobResult>>;
  readonly fn: string;
  readonly args: readonly string[];
  readonly expected: boolean;
  readonly claim: string;
}

const LIVE_ROWS: readonly LiveRow[] = [
  // Skipped dependency — the cell no document states (C-E02-069).
  {
    job: 'skipped_succeeded',
    deps: DEPS.skipped,
    fn: 'succeeded',
    args: [],
    expected: false,
    claim: 'C-E02-069',
  },
  {
    job: 'skipped_succeeded_named',
    deps: DEPS.skipped,
    fn: 'succeeded',
    args: ['dep_skipped'],
    expected: false,
    claim: 'C-E02-069',
  },
  {
    job: 'skipped_succeededorfailed',
    deps: DEPS.skipped,
    fn: 'succeededOrFailed',
    args: [],
    expected: false,
    claim: 'C-E02-068',
  },
  {
    job: 'skipped_succeededorfailed_named',
    deps: DEPS.skipped,
    fn: 'succeededOrFailed',
    args: ['dep_skipped'],
    expected: false,
    claim: 'C-E02-068',
  },
  {
    job: 'skipped_failed',
    deps: DEPS.skipped,
    fn: 'failed',
    args: [],
    expected: false,
    claim: 'C-E02-069',
  },
  {
    job: 'skipped_always',
    deps: DEPS.skipped,
    fn: 'always',
    args: [],
    expected: true,
    claim: 'C-E02-069',
  },
  {
    job: 'skipped_canceled',
    deps: DEPS.skipped,
    fn: 'canceled',
    args: [],
    expected: false,
    claim: 'C-E02-069',
  },

  // Succeeded dependency.
  {
    job: 'ok_succeeded',
    deps: DEPS.ok,
    fn: 'succeeded',
    args: [],
    expected: true,
    claim: 'C-E02-067',
  },
  {
    job: 'ok_succeededorfailed',
    deps: DEPS.ok,
    fn: 'succeededOrFailed',
    args: [],
    expected: true,
    claim: 'C-E02-068',
  },
  { job: 'ok_failed', deps: DEPS.ok, fn: 'failed', args: [], expected: false, claim: 'C-E02-070' },

  // Failed dependency (C-E02-070) and the undocumented Abandoned one (C-E02-071).
  {
    job: 'fail_failed',
    deps: DEPS.failed,
    fn: 'failed',
    args: [],
    expected: true,
    claim: 'C-E02-070',
  },
  {
    job: 'fail_succeededorfailed',
    deps: DEPS.failed,
    fn: 'succeededOrFailed',
    args: [],
    expected: true,
    claim: 'C-E02-070',
  },
  {
    job: 'fail_succeeded',
    deps: DEPS.failed,
    fn: 'succeeded',
    args: [],
    expected: false,
    claim: 'C-E02-070',
  },
  {
    job: 'abandon_failed',
    deps: DEPS.abandoned,
    fn: 'failed',
    args: [],
    expected: false,
    claim: 'C-E02-071',
  },
  {
    job: 'abandon_succeededorfailed',
    deps: DEPS.abandoned,
    fn: 'succeededOrFailed',
    args: [],
    expected: false,
    claim: 'C-E02-071',
  },
  {
    job: 'abandon_always',
    deps: DEPS.abandoned,
    fn: 'always',
    args: [],
    expected: true,
    claim: 'C-E02-071',
  },

  // The minimal pair that separates all-of from any-of — one dependency each way. Neither
  // function can be told from the other on a single-dependency graph.
  {
    job: 'mixed_succeeded',
    deps: DEPS.mixed,
    fn: 'succeeded',
    args: [],
    expected: false,
    claim: 'C-E02-067',
  },
  {
    job: 'mixed_succeededorfailed',
    deps: DEPS.mixed,
    fn: 'succeededOrFailed',
    args: [],
    expected: true,
    claim: 'C-E02-068',
  },
  // Arguments replace the dependency set rather than filtering it.
  {
    job: 'mixed_succeeded_named_ok',
    deps: DEPS.mixed,
    fn: 'succeeded',
    args: ['dep_ok'],
    expected: true,
    claim: 'C-E02-067',
  },
  {
    job: 'mixed_succeeded_named_both',
    deps: DEPS.mixed,
    fn: 'succeeded',
    args: ['dep_ok', 'dep_skipped'],
    expected: false,
    claim: 'C-E02-067',
  },

  // Empty dependency set: the one asymmetry in the family (C-E02-068).
  {
    job: 'nodep_succeeded',
    deps: DEPS.none,
    fn: 'succeeded',
    args: [],
    expected: true,
    claim: 'C-E02-067',
  },
  {
    job: 'nodep_succeededorfailed',
    deps: DEPS.none,
    fn: 'succeededOrFailed',
    args: [],
    expected: true,
    claim: 'C-E02-068',
  },
  {
    job: 'nodep_failed',
    deps: DEPS.none,
    fn: 'failed',
    args: [],
    expected: false,
    claim: 'C-E02-068',
  },

  // Name handling.
  {
    job: 'case_named',
    deps: DEPS.ok,
    fn: 'succeeded',
    args: ['DEP_OK'],
    expected: true,
    claim: 'C-E02-067',
  },
  {
    job: 'unknown_named',
    deps: DEPS.ok,
    fn: 'succeeded',
    args: ['nosuchjob'],
    expected: false,
    claim: 'C-E02-072',
  },
];

describe('parity with the live run (research/experiments/E02-status/real-run.md)', () => {
  it.each(LIVE_ROWS)(
    'run 527 job $job: $fn($args) over $deps is $expected [$claim]',
    ({ deps, fn, args, expected }) => {
      const context: StatusContext = { scope: 'job', dependencies: deps };
      expect(evaluate(fn, context, args.map(stringValue))).toBe(expected);
    },
  );

  it('reproduces every row at stage scope too — one engine, two names for it', () => {
    for (const row of LIVE_ROWS) {
      const context: StatusContext = { scope: 'stage', dependencies: row.deps };
      expect(evaluate(row.fn, context, row.args.map(stringValue))).toBe(row.expected);
    }
  });
});

describe('the step/job arity split is a real divergence from the service (C-E02-060/061)', () => {
  it("rejects succeeded('A') in a step condition — which preview accepts with HTTP 200", () => {
    // Asserted rather than described: the permissive step-condition path resolves no function
    // names, so this exact text was accepted live. Ours is the only gate before the agent's.
    const stepRegistry = makeRegistry(statusFunctionSignatures('step'), []);
    expect(parseExpression("succeeded('A')", { registry: stepRegistry }).ok).toBe(false);

    const jobRegistry = makeRegistry(statusFunctionSignatures('job'), []);
    expect(parseExpression("succeeded('A')", { registry: jobRegistry }).ok).toBe(true);
  });

  it('keeps always/canceled 0-arity even at job scope, where the other three are N-ary', () => {
    const registry = makeRegistry(statusFunctionSignatures('job'), []);
    expect(parseExpression("always('A')", { registry }).ok).toBe(false);
    expect(parseExpression("canceled('A')", { registry }).ok).toBe(false);
    expect(parseExpression("succeeded('A', 'B', 'C')", { registry }).ok).toBe(true);
  });
});
