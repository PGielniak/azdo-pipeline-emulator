import { describe, expect, it, vi } from 'vitest';
import {
  NULL,
  LOGICAL_MEMBERSHIP_FUNCTIONS,
  arrayValue,
  booleanValue,
  evaluateLogicalMembershipFunction,
  numberValue,
  objectValue,
  stringValue,
  versionValue,
  type ExprArgument,
  type ExprValue,
} from '../../src/index.js';

const arg =
  (value: ExprValue): ExprArgument =>
  () =>
    value;
const evaluate = (name: string, values: readonly ExprValue[]) =>
  evaluateLogicalMembershipFunction(name, values.map(arg));

describe('and (C-E02-028)', () => {
  it('converts parameters and stops at the first false', () => {
    const skipped = vi.fn<ExprArgument>(() => {
      throw new Error('must not run');
    });
    expect(
      evaluateLogicalMembershipFunction('and', [arg(stringValue('yes')), arg(NULL), skipped]),
    ).toEqual(booleanValue(false));
    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('or (C-E02-028)', () => {
  it('converts parameters and stops at the first true', () => {
    const skipped = vi.fn<ExprArgument>(() => {
      throw new Error('must not run');
    });
    expect(
      evaluateLogicalMembershipFunction('or', [
        arg(numberValue(0)),
        arg(stringValue('x')),
        skipped,
      ]),
    ).toEqual(booleanValue(true));
    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('not (C-E02-028)', () => {
  it('inverts the converted Boolean', () => {
    expect(evaluate('not', [stringValue('')])).toEqual(booleanValue(true));
    expect(evaluate('NOT', [versionValue([1, 2])])).toEqual(booleanValue(false));
  });
});

describe('eq (C-E02-029)', () => {
  it('uses directional equality and returns false on conversion failure', () => {
    expect(evaluate('eq', [numberValue(1), stringValue('1')])).toEqual(booleanValue(true));
    expect(evaluate('eq', [numberValue(1), stringValue('x')])).toEqual(booleanValue(false));
  });
});

describe('ne (C-E02-029)', () => {
  it('uses directional inequality and returns true on conversion failure', () => {
    expect(evaluate('ne', [stringValue('A'), stringValue('a')])).toEqual(booleanValue(false));
    expect(evaluate('ne', [numberValue(1), stringValue('x')])).toEqual(booleanValue(true));
  });
});

describe('lt (C-E02-029)', () => {
  it('orders after converting right to left and errors on failure', () => {
    expect(evaluate('lt', [numberValue(2), stringValue('10')])).toEqual(booleanValue(true));
    expect(() => evaluate('lt', [numberValue(2), stringValue('x')])).toThrow(/convert/);
  });
});

describe('le (C-E02-029)', () => {
  it('implements less-than-or-equal', () => {
    expect(evaluate('le', [stringValue('A'), stringValue('a')])).toEqual(booleanValue(true));
    expect(evaluate('le', [numberValue(3), numberValue(2)])).toEqual(booleanValue(false));
  });
});

describe('gt (C-E02-029)', () => {
  it('implements greater-than', () => {
    expect(evaluate('gt', [versionValue([2, 0]), stringValue('1.9')])).toEqual(booleanValue(true));
    expect(evaluate('gt', [numberValue(2), numberValue(3)])).toEqual(booleanValue(false));
  });
});

describe('ge (C-E02-029)', () => {
  it('implements greater-than-or-equal', () => {
    expect(evaluate('ge', [numberValue(2), stringValue('2')])).toEqual(booleanValue(true));
    expect(evaluate('ge', [stringValue('a'), stringValue('B')])).toEqual(booleanValue(false));
  });
});

describe('in (C-E02-030)', () => {
  it('converts each candidate and stops at the first match', () => {
    const skipped = vi.fn<ExprArgument>(() => {
      throw new Error('must not run');
    });
    expect(
      evaluateLogicalMembershipFunction('in', [
        arg(stringValue('B')),
        arg(stringValue('b')),
        skipped,
      ]),
    ).toEqual(booleanValue(true));
    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('notIn (C-E02-030)', () => {
  it('returns false and stops at the first match', () => {
    const skipped = vi.fn<ExprArgument>(() => {
      throw new Error('must not run');
    });
    expect(
      evaluateLogicalMembershipFunction('notIn', [
        arg(numberValue(1)),
        arg(stringValue('1')),
        skipped,
      ]),
    ).toEqual(booleanValue(false));
    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('contains (C-E02-031)', () => {
  it('does ordinal-ignore-case substring search after String conversion', () => {
    expect(evaluate('contains', [stringValue('ABCDE'), stringValue('bcd')])).toEqual(
      booleanValue(true),
    );
    expect(evaluate('contains', [numberValue(123), numberValue(23)])).toEqual(booleanValue(true));
  });

  it('rejects arrays rather than treating them as membership collections', () => {
    expect(() => evaluate('contains', [arrayValue([stringValue('a')]), stringValue('a')])).toThrow(
      /Array to String/,
    );
  });
});

describe('containsValue (C-E02-032)', () => {
  it('searches arrays and object property values with conversion to the needle type', () => {
    expect(
      evaluate('containsValue', [
        arrayValue([stringValue('Alpha'), stringValue('beta')]),
        stringValue('BETA'),
      ]),
    ).toEqual(booleanValue(true));
    expect(
      evaluate('containsValue', [
        objectValue({ first: stringValue('no'), numericText: stringValue('01') }),
        numberValue(1),
      ]),
    ).toEqual(booleanValue(true));
  });

  it('returns false for non-collection left parameters', () => {
    expect(evaluate('containsValue', [stringValue('Alpha'), stringValue('alpha')])).toEqual(
      booleanValue(false),
    );
  });
});

describe('logical/membership signatures (C-E02-028..032)', () => {
  it('publishes parser arities, including the oracle-corrected in/notIn minimum', () => {
    expect(LOGICAL_MEMBERSHIP_FUNCTIONS).toHaveLength(13);
    expect(LOGICAL_MEMBERSHIP_FUNCTIONS.find(({ name }) => name === 'in')?.minArgs).toBe(2);
    expect(LOGICAL_MEMBERSHIP_FUNCTIONS.find(({ name }) => name === 'notIn')?.minArgs).toBe(2);
    expect(() => evaluateLogicalMembershipFunction('in', [arg(stringValue('only'))])).toThrow(
      /expects 2\.\.N/,
    );
  });
});
