import {
  NULL,
  booleanValue,
  numberValue,
  stringValue,
  versionValue,
  type ExprValue,
  type ExprVersion,
} from './value.js';

export type PrimitiveKind = 'null' | 'boolean' | 'number' | 'string' | 'version';
export type ComparisonOperator = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge';

export class ExprConversionError extends Error {
  constructor(
    readonly from: ExprValue['kind'],
    readonly to: ExprValue['kind'],
    readonly value: ExprValue,
  ) {
    super(`Unable to convert from ${displayKind(from)} to ${displayKind(to)}.`);
    this.name = 'ExprConversionError';
  }
}

const displayKind = (kind: ExprValue['kind']): string =>
  kind.charAt(0).toUpperCase() + kind.slice(1);

const fail = (value: ExprValue, target: ExprValue['kind']): never => {
  throw new ExprConversionError(value.kind, target, value);
};

const INT32_MAX = 2_147_483_647;

function parseInvariantNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(trimmed)) return undefined;
  const result = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(result) ? result : undefined;
}

function parseConvertedVersion(text: string): ExprVersion | undefined {
  if (!/^\d+(?:\.\d+){1,3}$/.test(text)) return undefined;
  const segments = text.split('.').map(Number);
  if (segments.some((part) => !Number.isInteger(part) || part > INT32_MAX)) return undefined;
  return versionValue(segments);
}

function numberToVersion(value: number): ExprVersion | undefined {
  if (value <= 0 || value >= INT32_MAX || !Number.isFinite(value)) return undefined;
  const text = String(value);
  if (!text.includes('.') || /e/i.test(text)) return undefined;
  const fraction = text.slice(text.indexOf('.') + 1);
  if (!/[1-9]/.test(fraction)) return undefined;
  return parseConvertedVersion(text);
}

/** Convert to a documented primitive target. Unsupported/partial failures are typed (C-E02-020). */
export function convertValue(value: ExprValue, target: PrimitiveKind): ExprValue {
  if (value.kind === target) return value;
  switch (target) {
    case 'boolean':
      switch (value.kind) {
        case 'null':
          return booleanValue(false);
        case 'number':
          return booleanValue(value.value !== 0);
        case 'string':
          return booleanValue(value.value !== '');
        case 'version':
          return booleanValue(true);
        default:
          return fail(value, target);
      }
    case 'null':
      return value.kind === 'string' && value.value === '' ? NULL : fail(value, target);
    case 'number':
      switch (value.kind) {
        case 'null':
          return numberValue(0);
        case 'boolean':
          return numberValue(value.value ? 1 : 0);
        case 'string': {
          const parsed = parseInvariantNumber(value.value);
          return parsed === undefined ? fail(value, target) : numberValue(parsed);
        }
        default:
          return fail(value, target);
      }
    case 'string':
      switch (value.kind) {
        case 'null':
          return stringValue('');
        case 'boolean':
          return stringValue(value.value ? 'True' : 'False');
        case 'number':
          return stringValue(String(value.value));
        case 'version':
          return stringValue(value.segments.join('.'));
        default:
          return fail(value, target);
      }
    case 'version':
      if (value.kind === 'number') {
        const parsed = numberToVersion(value.value);
        return parsed ?? fail(value, target);
      }
      if (value.kind === 'string') {
        const parsed = parseConvertedVersion(value.value);
        return parsed ?? fail(value, target);
      }
      return fail(value, target);
  }
}

function compareVersions(left: ExprVersion, right: ExprVersion): number {
  for (let index = 0; index < 4; index += 1) {
    const a = left.segments[index] ?? -1;
    const b = right.segments[index] ?? -1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

function compareStrings(left: string, right: string): number {
  const a = left.toUpperCase();
  const b = right.toUpperCase();
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareSameKind(left: ExprValue, right: ExprValue): number | undefined {
  if (left.kind !== right.kind) return undefined;
  switch (left.kind) {
    case 'null':
      return 0;
    case 'boolean':
      return left.value === (right as typeof left).value ? 0 : left.value ? 1 : -1;
    case 'number': {
      const other = (right as typeof left).value;
      return left.value === other ? 0 : left.value < other ? -1 : 1;
    }
    case 'string':
      return compareStrings(left.value, (right as typeof left).value);
    case 'version':
      return compareVersions(left, right as ExprVersion);
    case 'object':
    case 'array':
      return left.value === (right as typeof left).value ? 0 : undefined;
  }
}

/** Comparisons convert the right operand to the left operand's kind (C-E02-020). */
export function compareValues(
  operator: ComparisonOperator,
  left: ExprValue,
  right: ExprValue,
): boolean {
  if (operator !== 'eq' && operator !== 'ne' && (left.kind === 'object' || left.kind === 'array')) {
    // Ordered functions coerce collections to Number even when both operands are the same
    // reference; the service reports Object/Array→Number (C-E02-023).
    throw new ExprConversionError(left.kind, 'number', left);
  }
  let order: number | undefined;
  try {
    if (left.kind === right.kind) order = compareSameKind(left, right);
    else if (left.kind === 'object' || left.kind === 'array') fail(right, left.kind);
    else order = compareSameKind(left, convertValue(right, left.kind));
  } catch (error) {
    if (!(error instanceof ExprConversionError)) throw error;
    if (operator === 'eq') return false;
    if (operator === 'ne') return true;
    throw error;
  }
  if (order === undefined) {
    if (operator === 'eq') return false;
    if (operator === 'ne') return true;
    throw new ExprConversionError(right.kind, left.kind, right);
  }
  switch (operator) {
    case 'eq':
      return order === 0;
    case 'ne':
      return order !== 0;
    case 'lt':
      return order < 0;
    case 'le':
      return order <= 0;
    case 'gt':
      return order > 0;
    case 'ge':
      return order >= 0;
  }
}
