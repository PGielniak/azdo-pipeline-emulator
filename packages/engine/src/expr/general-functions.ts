import { convertValue } from './coercion.js';
import type { ExprArgument } from './functions.js';
import { LOGICAL_MEMBERSHIP_FUNCTIONS } from './functions.js';
import type { FunctionSignature } from './parser.js';
import {
  NULL,
  arrayValue,
  booleanValue,
  numberValue,
  stringValue,
  type ExprValue,
} from './value.js';

export type GeneralFunctionName =
  | 'startsWith'
  | 'endsWith'
  | 'xor'
  | 'format'
  | 'join'
  | 'split'
  | 'replace'
  | 'lower'
  | 'upper'
  | 'trim'
  | 'length'
  | 'coalesce'
  | 'iif'
  | 'convertToJson'
  | 'counter';

export interface CounterStateProvider {
  /** `seed` is absent for the live-accepted one-argument form (C-E02-051). */
  next(prefix: string, seed?: number): number;
}

export interface GeneralFunctionContext {
  readonly counters?: CounterStateProvider | undefined;
}

export const GENERAL_FUNCTIONS: readonly FunctionSignature[] = [
  { name: 'startsWith', minArgs: 2, maxArgs: 2 },
  { name: 'endsWith', minArgs: 2, maxArgs: 2 },
  { name: 'xor', minArgs: 2, maxArgs: 2 },
  { name: 'format', minArgs: 1, maxArgs: Infinity },
  { name: 'join', minArgs: 2, maxArgs: 2 },
  { name: 'split', minArgs: 2, maxArgs: 2 },
  { name: 'replace', minArgs: 3, maxArgs: 3 },
  { name: 'lower', minArgs: 1, maxArgs: 1 },
  { name: 'upper', minArgs: 1, maxArgs: 1 },
  { name: 'trim', minArgs: 1, maxArgs: 1 },
  { name: 'length', minArgs: 1, maxArgs: 1 },
  { name: 'coalesce', minArgs: 2, maxArgs: Infinity },
  // Learn says 1..3, but the live parser requires exactly three (C-E02-049).
  { name: 'iif', minArgs: 3, maxArgs: 3 },
  { name: 'convertToJson', minArgs: 1, maxArgs: 1 },
  // Learn says exactly two, but the runtime-variable parser accepts one or two (C-E02-051).
  { name: 'counter', minArgs: 1, maxArgs: 2 },
];

/** Complete current documented non-status catalogue (C-E02-041). */
export const NON_STATUS_FUNCTIONS: readonly FunctionSignature[] = [
  ...LOGICAL_MEMBERSHIP_FUNCTIONS,
  ...GENERAL_FUNCTIONS,
];

const signatures = new Map(
  GENERAL_FUNCTIONS.map((signature) => [signature.name.toLowerCase(), signature]),
);
const canonicalNames = new Map(
  GENERAL_FUNCTIONS.map((signature) => [
    signature.name.toLowerCase(),
    signature.name as GeneralFunctionName,
  ]),
);

function validateCall(name: string, count: number): GeneralFunctionName {
  const signature = signatures.get(name.toLowerCase());
  const canonical = canonicalNames.get(name.toLowerCase());
  if (signature === undefined || canonical === undefined) {
    throw new RangeError(`unknown general function: ${name}`);
  }
  if (count < signature.minArgs || count > signature.maxArgs) {
    const maximum = signature.maxArgs === Infinity ? 'N' : String(signature.maxArgs);
    throw new RangeError(
      `${signature.name} expects ${signature.minArgs}..${maximum} parameters; received ${count}`,
    );
  }
  return canonical;
}

function asString(value: ExprValue): string {
  const converted = convertValue(value, 'string');
  if (converted.kind !== 'string') throw new Error('internal String conversion invariant');
  return converted.value;
}

function asBoolean(value: ExprValue): boolean {
  const converted = convertValue(value, 'boolean');
  if (converted.kind !== 'boolean') throw new Error('internal Boolean conversion invariant');
  return converted.value;
}

function asNumber(value: ExprValue): number {
  const converted = convertValue(value, 'number');
  if (converted.kind !== 'number') throw new Error('internal Number conversion invariant');
  return converted.value;
}

function formatValue(value: ExprValue): string {
  return asString(value);
}

function formatText(pattern: string, values: readonly ExprValue[]): string {
  let result = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] as string;
    if (char !== '{' && char !== '}') {
      result += char;
      continue;
    }
    if (pattern[index + 1] === char) {
      result += char;
      index += 1;
      continue;
    }
    if (char === '}') throw new RangeError(`The following format string is invalid: ${pattern}`);
    const close = pattern.indexOf('}', index + 1);
    if (close === -1) throw new RangeError(`The following format string is invalid: ${pattern}`);
    const placeholder = pattern.slice(index + 1, close);
    if (!/^\d+$/.test(placeholder)) {
      throw new RangeError(`The following format string is invalid: ${pattern}`);
    }
    const value = values[Number(placeholder)];
    if (value === undefined) {
      throw new RangeError(
        `The following format string references more arguments than were supplied: {${placeholder}}`,
      );
    }
    result += formatValue(value);
    index = close;
  }
  return result;
}

function joinElement(value: ExprValue): string {
  return value.kind === 'array' || value.kind === 'object' ? '' : asString(value);
}

function jsonValue(value: ExprValue): unknown {
  switch (value.kind) {
    case 'null':
      return null;
    case 'boolean':
    case 'number':
    case 'string':
      return value.value;
    case 'version':
      return value.segments.join('.');
    case 'array':
      return value.value.map(jsonValue);
    case 'object':
      return Object.fromEntries(
        Object.entries(value.value).map(([key, child]) => [key, jsonValue(child)]),
      );
  }
}

/** Evaluate the current documented non-status remainder, preserving lazy coalesce only. */
export function evaluateGeneralFunction(
  name: GeneralFunctionName | string,
  args: readonly ExprArgument[],
  context: GeneralFunctionContext = {},
): ExprValue {
  const canonical = validateCall(name, args.length);

  if (canonical === 'coalesce') {
    for (const arg of args) {
      const value = arg();
      if (value.kind !== 'null' && (value.kind !== 'string' || value.value !== '')) return value;
    }
    return NULL;
  }

  // Unlike coalesce, iif evaluates the unselected branch too (C-E02-049).
  const values = args.map((arg) => arg());
  const first = values[0] as ExprValue;

  switch (canonical) {
    case 'startsWith':
      return booleanValue(
        asString(first)
          .toUpperCase()
          .startsWith(asString(values[1] as ExprValue).toUpperCase()),
      );
    case 'endsWith':
      return booleanValue(
        asString(first)
          .toUpperCase()
          .endsWith(asString(values[1] as ExprValue).toUpperCase()),
      );
    case 'xor':
      return booleanValue(asBoolean(first) !== asBoolean(values[1] as ExprValue));
    case 'format':
      return stringValue(formatText(asString(first), values.slice(1)));
    case 'join': {
      const separator = asString(first);
      const right = values[1] as ExprValue;
      return stringValue(
        right.kind === 'array' ? right.value.map(joinElement).join(separator) : joinElement(right),
      );
    }
    case 'split': {
      const text = asString(first);
      const separator = asString(values[1] as ExprValue);
      return arrayValue((separator === '' ? [text] : text.split(separator)).map(stringValue));
    }
    case 'replace': {
      const text = asString(first);
      const search = asString(values[1] as ExprValue);
      const replacement = asString(values[2] as ExprValue);
      return stringValue(search === '' ? text : text.replaceAll(search, replacement));
    }
    case 'lower':
      return stringValue(asString(first).toLowerCase());
    case 'upper':
      return stringValue(asString(first).toUpperCase());
    case 'trim':
      return stringValue(asString(first).trim());
    case 'length':
      if (first.kind === 'string' || first.kind === 'array') return numberValue(first.value.length);
      if (first.kind === 'object') return numberValue(Object.keys(first.value).length);
      return numberValue(asString(first).length);
    case 'iif':
      return asBoolean(first) ? (values[1] as ExprValue) : (values[2] as ExprValue);
    case 'convertToJson':
      return stringValue(JSON.stringify(jsonValue(first), null, 2));
    case 'counter': {
      if (context.counters === undefined) throw new Error('counter requires a state provider');
      const prefix = asString(first);
      const seed = values[1] === undefined ? undefined : asNumber(values[1]);
      return numberValue(context.counters.next(prefix, seed));
    }
  }
}
