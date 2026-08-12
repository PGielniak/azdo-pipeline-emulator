import { compareValues, convertValue, type ComparisonOperator } from './coercion.js';
import type { FunctionSignature } from './parser.js';
import { booleanValue, type ExprValue } from './value.js';

export type LogicalMembershipFunctionName =
  'and' | 'or' | 'not' | ComparisonOperator | 'in' | 'notIn' | 'contains' | 'containsValue';

/** Arguments stay lazy so the evaluator can preserve service short-circuiting (C-E02-028/030). */
export type ExprArgument = () => ExprValue;

export const LOGICAL_MEMBERSHIP_FUNCTIONS: readonly FunctionSignature[] = [
  { name: 'and', minArgs: 2, maxArgs: Infinity },
  { name: 'or', minArgs: 2, maxArgs: Infinity },
  { name: 'not', minArgs: 1, maxArgs: 1 },
  { name: 'eq', minArgs: 2, maxArgs: 2 },
  { name: 'ne', minArgs: 2, maxArgs: 2 },
  { name: 'lt', minArgs: 2, maxArgs: 2 },
  { name: 'le', minArgs: 2, maxArgs: 2 },
  { name: 'gt', minArgs: 2, maxArgs: 2 },
  { name: 'ge', minArgs: 2, maxArgs: 2 },
  // Learn says 1..N, but the live parser requires a candidate: 2..N (C-E02-030).
  { name: 'in', minArgs: 2, maxArgs: Infinity },
  { name: 'notIn', minArgs: 2, maxArgs: Infinity },
  { name: 'contains', minArgs: 2, maxArgs: 2 },
  { name: 'containsValue', minArgs: 2, maxArgs: 2 },
];

const signatures = new Map(
  LOGICAL_MEMBERSHIP_FUNCTIONS.map((signature) => [signature.name.toLowerCase(), signature]),
);

const canonicalNames = new Map(
  LOGICAL_MEMBERSHIP_FUNCTIONS.map((signature) => [
    signature.name.toLowerCase(),
    signature.name as LogicalMembershipFunctionName,
  ]),
);

function validateCall(name: string, count: number): LogicalMembershipFunctionName {
  const key = name.toLowerCase();
  const signature = signatures.get(key);
  const canonical = canonicalNames.get(key);
  if (signature === undefined || canonical === undefined) {
    throw new RangeError(`unknown logical or membership function: ${name}`);
  }
  if (count < signature.minArgs || count > signature.maxArgs) {
    const maximum = signature.maxArgs === Infinity ? 'N' : String(signature.maxArgs);
    throw new RangeError(
      `${signature.name} expects ${signature.minArgs}..${maximum} parameters; received ${count}`,
    );
  }
  return canonical;
}

function asBoolean(value: ExprValue): boolean {
  const converted = convertValue(value, 'boolean');
  if (converted.kind !== 'boolean') throw new Error('internal Boolean conversion invariant');
  return converted.value;
}

function asString(value: ExprValue): string {
  const converted = convertValue(value, 'string');
  if (converted.kind !== 'string') throw new Error('internal String conversion invariant');
  return converted.value;
}

const ordinalIgnoreCaseContains = (text: string, search: string): boolean =>
  text.toUpperCase().includes(search.toUpperCase());

function containsValue(collection: ExprValue, needle: ExprValue): boolean {
  const candidates =
    collection.kind === 'array'
      ? collection.value
      : collection.kind === 'object'
        ? Object.values(collection.value)
        : undefined;
  if (candidates === undefined) return false;

  // Put the needle on the left: compareValues converts each candidate to its type (C-E02-032).
  return candidates.some((candidate) => compareValues('eq', needle, candidate));
}

/** Evaluate the logical/comparison/membership built-ins, matching names case-insensitively. */
export function evaluateLogicalMembershipFunction(
  name: LogicalMembershipFunctionName | string,
  args: readonly ExprArgument[],
): ExprValue {
  const canonical = validateCall(name, args.length);

  switch (canonical) {
    case 'and':
      for (const arg of args) if (!asBoolean(arg())) return booleanValue(false);
      return booleanValue(true);
    case 'or':
      for (const arg of args) if (asBoolean(arg())) return booleanValue(true);
      return booleanValue(false);
    case 'not':
      return booleanValue(!asBoolean((args[0] as ExprArgument)()));
    case 'eq':
    case 'ne':
    case 'lt':
    case 'le':
    case 'gt':
    case 'ge':
      return booleanValue(
        compareValues(canonical, (args[0] as ExprArgument)(), (args[1] as ExprArgument)()),
      );
    case 'in': {
      const left = (args[0] as ExprArgument)();
      for (let index = 1; index < args.length; index += 1) {
        if (compareValues('eq', left, (args[index] as ExprArgument)())) return booleanValue(true);
      }
      return booleanValue(false);
    }
    case 'notIn': {
      const left = (args[0] as ExprArgument)();
      for (let index = 1; index < args.length; index += 1) {
        if (compareValues('eq', left, (args[index] as ExprArgument)())) return booleanValue(false);
      }
      return booleanValue(true);
    }
    case 'contains':
      return booleanValue(
        ordinalIgnoreCaseContains(
          asString((args[0] as ExprArgument)()),
          asString((args[1] as ExprArgument)()),
        ),
      );
    case 'containsValue':
      return booleanValue(containsValue((args[0] as ExprArgument)(), (args[1] as ExprArgument)()));
  }
}
