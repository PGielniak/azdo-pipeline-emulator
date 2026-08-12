import { describe, expect, it } from 'vitest';
import {
  NULL,
  accessIndex,
  accessProperty,
  arrayValue,
  booleanValue,
  numberValue,
  objectValue,
  parseExpression,
  stringValue,
  versionValue,
} from '../../src/index.js';

const parameterObject = objectValue({
  CamelKey: stringValue('value'),
  nested: objectValue({ DeepKey: stringValue('deep') }),
  'dotted.name': stringValue('dotted'),
  '1': stringValue('numeric-key'),
  list: arrayValue([stringValue('zero'), stringValue('one')]),
});

describe('object member access', () => {
  it('supports property and index syntax while dotted keys require the index form (C-E02-024)', () => {
    expect(accessProperty(parameterObject, 'CamelKey')).toEqual(stringValue('value'));
    expect(accessIndex(parameterObject, stringValue('CamelKey'))).toEqual(stringValue('value'));
    expect(accessIndex(parameterObject, stringValue('dotted.name'))).toEqual(stringValue('dotted'));
    expect(accessIndex(parameterObject, numberValue(1))).toEqual(stringValue('numeric-key'));
  });

  it("returns Null for variables['no.such'] (C-E02-024)", () => {
    const parsed = parseExpression("variables['no.such']");
    expect(parsed.ok && parsed.node.type).toBe('index');
    const variables = objectValue({ Existing: stringValue('yes') }, 'ordinalIgnoreCase');
    expect(accessIndex(variables, stringValue('no.such'))).toBe(NULL);
  });

  it('keeps parameter objects case-sensitive but variables case-insensitive (C-E02-027)', () => {
    expect(accessProperty(parameterObject, 'camelkey')).toBe(NULL);
    expect(accessIndex(parameterObject, stringValue('CAMELKEY'))).toBe(NULL);

    const variables = objectValue({ MyVar: stringValue('variable-value') }, 'ordinalIgnoreCase');
    expect(accessProperty(variables, 'myvar')).toEqual(stringValue('variable-value'));
    expect(accessIndex(variables, stringValue('MYVAR'))).toEqual(stringValue('variable-value'));
  });

  it('rejects ambiguous keys in an ignore-case object', () => {
    expect(() =>
      objectValue({ key: stringValue('one'), KEY: stringValue('two') }, 'ordinalIgnoreCase'),
    ).toThrow(/duplicate case-insensitive object key/);
  });
});

describe('safe chaining', () => {
  it('returns Null through arbitrarily chained missing property/index access (C-E02-025)', () => {
    const missing = accessProperty(parameterObject, 'missing');
    expect(missing).toBe(NULL);
    expect(accessProperty(missing, 'deeper')).toBe(NULL);
    expect(accessIndex(missing, stringValue('deeper'))).toBe(NULL);
    expect(accessProperty(accessProperty(missing, 'a'), 'b')).toBe(NULL);
  });

  it.each([NULL, booleanValue(true), numberValue(1), stringValue('text'), versionValue([1, 2])])(
    'returns Null when indexing non-collection $kind',
    (target) => {
      expect(accessProperty(target, 'anything')).toBe(NULL);
      expect(accessIndex(target, numberValue(0))).toBe(NULL);
    },
  );
});

describe('array indexing', () => {
  const array = arrayValue([stringValue('zero'), stringValue('one')]);

  it.each([
    [numberValue(0), 'zero'],
    [numberValue(1), 'one'],
    [stringValue('1'), 'one'],
    [numberValue(1.9), 'one'],
    [NULL, 'zero'],
    [booleanValue(true), 'one'],
  ] as const)('converts and floors index %# (C-E02-026)', (index, expected) => {
    expect(accessIndex(array, index)).toEqual(stringValue(expected));
  });

  it.each([
    numberValue(-1),
    numberValue(2),
    stringValue('x'),
    versionValue([1, 2]),
    objectValue({}),
    arrayValue([]),
  ])('returns Null for invalid/out-of-range index %# (C-E02-026)', (index) => {
    expect(accessIndex(array, index)).toBe(NULL);
  });
});
