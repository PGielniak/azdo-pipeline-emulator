import type { ExprLiteral } from './parser.js';

/** Canonical evaluator values. The discriminant is deliberately explicit: JavaScript alone
 * cannot distinguish an Azure Pipelines Version from a Number or String (C-E02-018/019). */
export type ExprValue =
  ExprNull | ExprBoolean | ExprNumber | ExprString | ExprVersion | ExprObject | ExprArray;

export interface ExprNull {
  readonly kind: 'null';
}

export interface ExprBoolean {
  readonly kind: 'boolean';
  readonly value: boolean;
}

export interface ExprNumber {
  readonly kind: 'number';
  readonly value: number;
}

export interface ExprString {
  readonly kind: 'string';
  readonly value: string;
}

export interface ExprVersion {
  readonly kind: 'version';
  /** Three or four non-negative integer segments (C-E02-005/018). */
  readonly segments: readonly [number, number, number, number?];
}

export interface ExprObject {
  readonly kind: 'object';
  readonly value: Readonly<Record<string, ExprValue>>;
}

export interface ExprArray {
  readonly kind: 'array';
  readonly value: readonly ExprValue[];
}

export const NULL: ExprNull = Object.freeze({ kind: 'null' });

export const booleanValue = (value: boolean): ExprBoolean => ({ kind: 'boolean', value });

export function numberValue(value: number): ExprNumber {
  if (!Number.isFinite(value)) throw new RangeError('expression numbers must be finite doubles');
  return { kind: 'number', value };
}

export const stringValue = (value: string): ExprString => ({ kind: 'string', value });

const validVersionSegment = (segment: number): boolean =>
  Number.isSafeInteger(segment) && segment >= 0;

export function versionValue(segments: readonly number[]): ExprVersion {
  if ((segments.length !== 3 && segments.length !== 4) || !segments.every(validVersionSegment)) {
    throw new RangeError('expression versions require three or four non-negative integer segments');
  }
  const [major, minor, build, revision] = segments;
  return {
    kind: 'version',
    segments:
      revision === undefined
        ? [major as number, minor as number, build as number]
        : [major as number, minor as number, build as number, revision],
  };
}

/** Parse the only Version literal form Azure Pipelines documents and accepts (C-E02-005/018). */
export function parseVersionValue(text: string): ExprVersion | undefined {
  if (!/^\d+(?:\.\d+){2,3}$/.test(text)) return undefined;
  const segments = text.split('.').map(Number);
  if (!segments.every(validVersionSegment)) return undefined;
  return versionValue(segments);
}

export const objectValue = (value: Readonly<Record<string, ExprValue>>): ExprObject => ({
  kind: 'object',
  value,
});

export const arrayValue = (value: readonly ExprValue[]): ExprArray => ({ kind: 'array', value });

/** Bridge the parser's writable literal kinds into the evaluator's complete value model. */
export function valueFromLiteral(literal: ExprLiteral): ExprValue {
  switch (literal.kind) {
    case 'boolean':
      return booleanValue(literal.value);
    case 'number':
      return numberValue(literal.value);
    case 'string':
      return stringValue(literal.value);
    case 'version':
      return versionValue(literal.segments);
  }
}

/** Lossless tagged serialization for fixtures, stores, and backend-conformance tables. */
export function encodeExprValue(value: ExprValue): unknown {
  switch (value.kind) {
    case 'null':
      return { kind: 'null' };
    case 'boolean':
    case 'number':
    case 'string':
      return { kind: value.kind, value: value.value };
    case 'version':
      return { kind: 'version', segments: [...value.segments] };
    case 'array':
      return { kind: 'array', value: value.value.map(encodeExprValue) };
    case 'object':
      return {
        kind: 'object',
        value: Object.fromEntries(
          Object.entries(value.value).map(([key, child]) => [key, encodeExprValue(child)]),
        ),
      };
  }
}

export function decodeExprValue(input: unknown): ExprValue {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('encoded expression value must be an object');
  }
  const record = input as Record<string, unknown>;
  switch (record.kind) {
    case 'null':
      return NULL;
    case 'boolean':
      if (typeof record.value === 'boolean') return booleanValue(record.value);
      break;
    case 'number':
      if (typeof record.value === 'number') return numberValue(record.value);
      break;
    case 'string':
      if (typeof record.value === 'string') return stringValue(record.value);
      break;
    case 'version':
      if (Array.isArray(record.segments))
        return versionValue(record.segments as unknown[] as number[]);
      break;
    case 'array':
      if (Array.isArray(record.value)) return arrayValue(record.value.map(decodeExprValue));
      break;
    case 'object':
      if (
        typeof record.value === 'object' &&
        record.value !== null &&
        !Array.isArray(record.value)
      ) {
        return objectValue(
          Object.fromEntries(
            Object.entries(record.value).map(([key, child]) => [key, decodeExprValue(child)]),
          ),
        );
      }
      break;
  }
  throw new TypeError(`invalid encoded expression ${String(record.kind)} value`);
}
