import { describe, expect, it, vi } from 'vitest';
import {
  GENERAL_FUNCTIONS,
  NON_STATUS_FUNCTIONS,
  NULL,
  arrayValue,
  booleanValue,
  evaluateGeneralFunction,
  numberValue,
  objectValue,
  stringValue,
  type CounterStateProvider,
  type ExprArgument,
  type ExprValue,
} from '../../src/index.js';

const arg =
  (value: ExprValue): ExprArgument =>
  () =>
    value;
const evaluate = (
  name: string,
  values: readonly ExprValue[],
  counters?: CounterStateProvider,
): ExprValue => evaluateGeneralFunction(name, values.map(arg), { counters });

describe('startsWith / endsWith (C-E02-042)', () => {
  it('String-converts and compares ordinal ignore-case', () => {
    expect(evaluate('startsWith', [numberValue(12345), stringValue('123')])).toEqual(
      booleanValue(true),
    );
    expect(evaluate('ENDSWITH', [stringValue('AbCdE'), stringValue('DE')])).toEqual(
      booleanValue(true),
    );
  });
});

describe('xor (C-E02-043)', () => {
  it.each([
    [true, false, true],
    [false, true, true],
    [true, true, false],
    [false, false, false],
  ])('xor(%s, %s) = %s', (left, right, result) => {
    expect(evaluate('xor', [booleanValue(left), booleanValue(right)])).toEqual(
      booleanValue(result),
    );
  });
});

describe('format (C-E02-044)', () => {
  it('supports reordered/reused indexes and doubled braces', () => {
    expect(
      evaluate('format', [stringValue('{1}-{0}-{1}'), stringValue('A'), stringValue('B')]),
    ).toEqual(stringValue('B-A-B'));
    expect(evaluate('format', [stringValue('{{{0}}} {{ and }}'), stringValue('x')])).toEqual(
      stringValue('{x} { and }'),
    );
  });

  it('uses the two measured service error shapes', () => {
    expect(() => evaluate('format', [stringValue('{1}'), stringValue('only')])).toThrow(
      /references more arguments/,
    );
    expect(() => evaluate('format', [stringValue('{0'), stringValue('x')])).toThrow(
      /format string is invalid/,
    );
  });
});

describe('join (C-E02-045)', () => {
  it('converts primitive elements and empties complex elements', () => {
    expect(
      evaluate('join', [
        stringValue(';'),
        arrayValue([
          stringValue('Alpha'),
          objectValue({ nested: stringValue('ignored') }),
          numberValue(2),
        ]),
      ]),
    ).toEqual(stringValue('Alpha;;2'));
    expect(evaluate('join', [stringValue('-'), numberValue(12)])).toEqual(stringValue('12'));
  });
});

describe('split / replace (C-E02-046/042)', () => {
  it('splits on the exact delimiter and preserves empty fields', () => {
    expect(evaluate('split', [stringValue('a,b;c,,'), stringValue(',;')])).toEqual(
      arrayValue([stringValue('a,b;c,,')]),
    );
    expect(evaluate('split', [stringValue('a,,b,'), stringValue(',')])).toEqual(
      arrayValue([stringValue('a'), stringValue(''), stringValue('b'), stringValue('')]),
    );
    expect(evaluate('split', [stringValue('abc'), stringValue('')])).toEqual(
      arrayValue([stringValue('abc')]),
    );
  });

  it('replaces case-sensitively and leaves an empty search unchanged', () => {
    expect(evaluate('replace', [stringValue('AaA'), stringValue('a'), stringValue('x')])).toEqual(
      stringValue('AxA'),
    );
    expect(evaluate('replace', [stringValue('abc'), stringValue(''), stringValue('x')])).toEqual(
      stringValue('abc'),
    );
  });
});

describe('lower / upper / trim (C-E02-042)', () => {
  it('matches the live Unicode and whitespace controls', () => {
    expect(evaluate('lower', [stringValue('ÄBC')])).toEqual(stringValue('äbc'));
    expect(evaluate('upper', [stringValue('äbc')])).toEqual(stringValue('ÄBC'));
    expect(evaluate('trim', [stringValue(' \tvalue\u00a0 ')])).toEqual(stringValue('value'));
  });
});

describe('length (C-E02-047)', () => {
  it('counts strings, arrays, and the live-discovered Object properties', () => {
    expect(evaluate('length', [stringValue('fabrikam')])).toEqual(numberValue(8));
    expect(evaluate('length', [arrayValue([NULL, NULL, NULL])])).toEqual(numberValue(3));
    expect(evaluate('length', [objectValue({ a: NULL, b: NULL })])).toEqual(numberValue(2));
  });
});

describe('coalesce (C-E02-048)', () => {
  it('skips only Null/empty String and preserves false/zero', () => {
    expect(evaluate('coalesce', [NULL, stringValue(''), stringValue('hit')])).toEqual(
      stringValue('hit'),
    );
    expect(evaluate('coalesce', [booleanValue(false), stringValue('x')])).toEqual(
      booleanValue(false),
    );
    expect(evaluate('coalesce', [numberValue(0), stringValue('x')])).toEqual(numberValue(0));
    expect(evaluate('coalesce', [NULL, stringValue('')])).toBe(NULL);
  });

  it('short-circuits after the first qualifying value', () => {
    const skipped = vi.fn<ExprArgument>(() => {
      throw new Error('must not evaluate');
    });
    expect(evaluateGeneralFunction('coalesce', [arg(stringValue('hit')), skipped])).toEqual(
      stringValue('hit'),
    );
    expect(skipped).not.toHaveBeenCalled();
  });
});

describe('iif (C-E02-049)', () => {
  it('selects by Boolean conversion but eagerly evaluates both branches', () => {
    expect(evaluate('iif', [booleanValue(true), stringValue('yes'), stringValue('no')])).toEqual(
      stringValue('yes'),
    );
    const unselected = vi.fn<ExprArgument>(() => {
      throw new Error('eager branch');
    });
    expect(() =>
      evaluateGeneralFunction('iif', [
        arg(booleanValue(true)),
        arg(stringValue('yes')),
        unselected,
      ]),
    ).toThrow(/eager branch/);
    expect(unselected).toHaveBeenCalledOnce();
  });

  it('uses the oracle-corrected exact arity', () => {
    expect(() => evaluate('iif', [booleanValue(true)])).toThrow(/3\.\.3/);
    expect(() => evaluate('iif', [booleanValue(true), stringValue('yes')])).toThrow(/3\.\.3/);
  });
});

describe('convertToJson (C-E02-050)', () => {
  it('serializes nested values with the service two-space layout', () => {
    expect(
      evaluate('convertToJson', [
        objectValue({
          alpha: stringValue('one'),
          nested: arrayValue([stringValue('two'), numberValue(3)]),
        }),
      ]),
    ).toEqual(stringValue('{\n  "alpha": "one",\n  "nested": [\n    "two",\n    3\n  ]\n}'));
    expect(evaluate('convertToJson', [stringValue('text')])).toEqual(stringValue('"text"'));
  });
});

describe('counter (C-E02-051)', () => {
  it('delegates prefix and optional seed to the injected state provider', () => {
    const next = vi
      .fn<(prefix: string, seed?: number) => number>()
      .mockReturnValueOnce(7)
      .mockReturnValueOnce(8);
    const counters: CounterStateProvider = { next };
    expect(evaluate('counter', [stringValue('prefix'), numberValue(7)], counters)).toEqual(
      numberValue(7),
    );
    expect(evaluate('counter', [stringValue('prefix')], counters)).toEqual(numberValue(8));
    expect(next).toHaveBeenNthCalledWith(1, 'prefix', 7);
    expect(next).toHaveBeenNthCalledWith(2, 'prefix', undefined);
  });

  it('requires a provider and rejects the live-rejected third argument', () => {
    expect(() => evaluate('counter', [stringValue('prefix')])).toThrow(/state provider/);
    expect(() =>
      evaluate('counter', [stringValue('prefix'), numberValue(0), numberValue(1)], {
        next: () => 0,
      }),
    ).toThrow(/1\.\.2/);
  });
});

describe('complete non-status registry (C-E02-041)', () => {
  it('matches the current Learn catalogue exactly', () => {
    const expected = [
      'and',
      'coalesce',
      'contains',
      'containsValue',
      'convertToJson',
      'counter',
      'endsWith',
      'eq',
      'format',
      'ge',
      'gt',
      'in',
      'iif',
      'join',
      'le',
      'length',
      'lower',
      'lt',
      'ne',
      'not',
      'notIn',
      'or',
      'replace',
      'split',
      'startsWith',
      'trim',
      'upper',
      'xor',
    ];
    expect(NON_STATUS_FUNCTIONS.map(({ name }) => name).sort()).toEqual(expected.sort());
    expect(GENERAL_FUNCTIONS).toHaveLength(15);
  });
});
