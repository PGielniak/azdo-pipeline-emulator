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
