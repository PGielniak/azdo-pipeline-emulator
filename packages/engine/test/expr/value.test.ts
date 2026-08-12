import { describe, expect, it } from 'vitest';
import {
  NULL,
  arrayValue,
  booleanValue,
  decodeExprValue,
  encodeExprValue,
  numberValue,
  objectValue,
  parseExpression,
  parseVersionValue,
  stringValue,
  valueFromLiteral,
  versionValue,
  type ExprValue,
} from '../../src/index.js';

describe('expression value model', () => {
  it('constructs every documented kind (C-E02-018/019)', () => {
    const values: readonly ExprValue[] = [
      NULL,
      booleanValue(true),
      numberValue(-1.2),
      stringValue('a b c'),
      versionValue([1, 2, 3, 4]),
      objectValue({ key: stringValue('value') }),
      arrayValue([numberValue(1), NULL]),
    ];
    expect(values.map((value) => value.kind)).toEqual([
      'null',
      'boolean',
      'number',
      'string',
      'version',
      'object',
      'array',
    ]);
  });

  it.each([
    ['1.2.3', [1, 2, 3]],
    ['1.2.3.4', [1, 2, 3, 4]],
    ['0.0.0', [0, 0, 0]],
    ['01.002.0003', [1, 2, 3]],
  ])('parses Version %s (C-E02-005/018)', (text, segments) => {
    expect(parseVersionValue(text)?.segments).toEqual(segments);
  });

  it.each(['1.2', '1.2.3.4.5', '-1.2.3', '1.2.x', '1..3', ''])(
    'rejects non-Version %j (C-E02-005/018)',
    (text) => expect(parseVersionValue(text)).toBeUndefined(),
  );

  it('rejects invalid constructed Versions and non-finite Numbers', () => {
    expect(versionValue([1, 2]).segments).toEqual([1, 2]); // conversion-only shape (C-E02-022)
    expect(() => versionValue([1])).toThrow(RangeError);
    expect(() => versionValue([1, 2, 3, 4, 5])).toThrow(RangeError);
    expect(() => versionValue([1, -2, 3])).toThrow(RangeError);
    expect(() => versionValue([1, 2.5, 3])).toThrow(RangeError);
    expect(() => numberValue(Number.NaN)).toThrow(RangeError);
    expect(() => numberValue(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it('bridges every writable parser literal without losing its kind', () => {
    for (const text of ['true', '-1.2', "'a b c'", '1.2.3.4']) {
      const parsed = parseExpression(text);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok || parsed.node.type !== 'literal')
        throw new Error(`expected literal: ${text}`);
      expect(valueFromLiteral(parsed.node.literal).kind).toBe(parsed.node.literal.kind);
    }
  });

  it('round-trips nested values through the tagged representation', () => {
    const value = objectValue({
      missing: NULL,
      enabled: booleanValue(false),
      count: numberValue(0.5),
      label: stringValue("it's tagged"),
      release: versionValue([2026, 8, 12]),
      items: arrayValue([objectValue({ id: numberValue(7) }), NULL]),
    });
    expect(decodeExprValue(encodeExprValue(value))).toEqual(value);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { kind: 'number', value: Number.NaN },
    { kind: 'version', segments: [1] },
    { kind: 'array', value: [null] },
    { kind: 'object', value: { bad: { kind: 'boolean', value: 'true' } } },
  ])('rejects malformed tagged input %#', (input) => {
    expect(() => decodeExprValue(input)).toThrow();
  });
});
