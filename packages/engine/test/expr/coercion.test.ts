import { describe, expect, it } from 'vitest';
import {
  NULL,
  booleanValue,
  compareValues,
  convertValue,
  numberValue,
  stringValue,
  versionValue,
} from '../../src/index.js';
import { COERCION_ROWS } from './coercion.table.js';

describe('documented conversion matrix (C-E02-020)', () => {
  it.each([
    [NULL, 'boolean', booleanValue(false)],
    [numberValue(0), 'boolean', booleanValue(false)],
    [numberValue(-1), 'boolean', booleanValue(true)],
    [stringValue(''), 'boolean', booleanValue(false)],
    [stringValue('x'), 'boolean', booleanValue(true)],
    [versionValue([1, 2]), 'boolean', booleanValue(true)],
    [booleanValue(false), 'number', numberValue(0)],
    [booleanValue(true), 'number', numberValue(1)],
    [NULL, 'number', numberValue(0)],
    [booleanValue(false), 'string', stringValue('False')],
    [booleanValue(true), 'string', stringValue('True')],
    [NULL, 'string', stringValue('')],
    [numberValue(0.5), 'string', stringValue('0.5')],
    [versionValue([1, 2, 3, 4]), 'string', stringValue('1.2.3.4')],
    [stringValue(''), 'null', NULL],
  ] as const)('converts %#', (input, target, expected) => {
    expect(convertValue(input, target)).toEqual(expected);
  });

  it('implements live-corrected partial conversions (C-E02-021/022)', () => {
    expect(convertValue(stringValue(' 1,000.5 '), 'number')).toEqual(numberValue(1000.5));
    expect(convertValue(numberValue(1.2), 'version')).toEqual(versionValue([1, 2]));
    expect(convertValue(stringValue('1.2'), 'version')).toEqual(versionValue([1, 2]));
  });

  it.each([
    [stringValue('x'), 'number'],
    [stringValue('12,34'), 'number'],
    [stringValue('x'), 'null'],
    [numberValue(2), 'version'],
    [stringValue('1'), 'version'],
    [versionValue([1, 2]), 'number'],
  ] as const)('rejects failed/unsupported conversion %#', (input, target) => {
    expect(() => convertValue(input, target)).toThrow(/Unable to convert/);
  });
});

describe('comparison conformance table', () => {
  it('contains at least 120 rows and cites every row', () => {
    expect(COERCION_ROWS).toHaveLength(120);
    expect(COERCION_ROWS.every((row) => /^C-E02-\d+$/.test(row.claim))).toBe(true);
  });

  it.each(COERCION_ROWS)('$id ($claim)', ({ operator, left, right, expected }) => {
    if (expected === 'throws') {
      expect(() => compareValues(operator, left, right)).toThrow(/Unable to convert/);
    } else {
      expect(compareValues(operator, left, right)).toBe(expected);
    }
  });
});
