import { ExprConversionError, convertValue } from './coercion.js';
import {
  NULL,
  filteredArrayValue,
  objectValues,
  stringValue,
  type ExprObject,
  type ExprValue,
} from './value.js';

const INT32_MAX = 2_147_483_647;

/**
 * A miss on an object whose `missPolicy` is `'error'` — in practice the top-level `parameters`
 * context, the one collection the service refuses to null-propagate (C-E02-087).
 *
 * The service renders this as a *bare* sentence behind file coordinates and nothing else:
 * `/azure-pipelines.yml (Line: 6, Col: 10): Key not found 'noSuchParameter'` — no "Located at
 * position N within expression", no help link. That is a shape none of the six parse errors in
 * `errors.ts` use, and it is not a parse error at all: the expression parsed fine and the context
 * resolved, so it is raised here, during evaluation (C-E02-088).
 */
export class ExprKeyNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Key not found '${key}'`);
    this.name = 'ExprKeyNotFoundError';
  }
}

function objectKey(object: ExprObject, wanted: string): string | undefined {
  if (object.keyComparison === 'ordinal') {
    return Object.hasOwn(object.value, wanted) ? wanted : undefined;
  }
  const folded = wanted.toUpperCase();
  return Object.keys(object.value).find((key) => key.toUpperCase() === folded);
}

/** Property syntax and string-index syntax share lookup after parsing (C-E02-024/027). */
export function accessProperty(target: ExprValue, name: string): ExprValue {
  return accessIndex(target, stringValue(name));
}

/**
 * Evaluate either wildcard spelling. Ordinary collections contribute every child; applying a
 * wildcard to a filtered result contributes every child collection's values into one result, so
 * each wildcard flattens exactly one level (C-E02-160/162/163).
 */
export function accessWildcard(target: ExprValue): ExprValue {
  if (target.kind === 'object') return filteredArrayValue(objectValues(target));
  if (target.kind !== 'array') return filteredArrayValue([]);
  if (target.filtered !== true) return filteredArrayValue(target.value);

  const values: ExprValue[] = [];
  for (const child of target.value) {
    if (child.kind === 'object') values.push(...objectValues(child));
    else if (child.kind === 'array') values.push(...child.value);
  }
  return filteredArrayValue(values);
}

/**
 * Evaluate one `target[index]` operation. An ordinary miss/non-collection target yields Null
 * (C-E02-024/025); a filtered target maps the access and omits unsuccessful children
 * (C-E02-161/164).
 */
export function accessIndex(target: ExprValue, index: ExprValue): ExprValue {
  if (target.kind === 'array' && target.filtered === true) {
    const values: ExprValue[] = [];
    for (const child of target.value) {
      const found = tryAccessFilteredChild(child, index);
      if (found !== undefined) values.push(found);
    }
    return filteredArrayValue(values);
  }

  if (target.kind === 'object') {
    try {
      const converted = convertValue(index, 'string');
      if (converted.kind !== 'string') return NULL;
      const key = objectKey(target, converted.value);
      if (key === undefined) {
        if (target.missPolicy === 'error') throw new ExprKeyNotFoundError(converted.value);
        return NULL;
      }
      return target.value[key] ?? NULL;
    } catch (error) {
      if (error instanceof ExprConversionError) return NULL;
      throw error;
    }
  }

  if (target.kind === 'array') {
    try {
      const converted = convertValue(index, 'number');
      if (converted.kind !== 'number') return NULL;
      const integer = Math.floor(converted.value);
      if (integer < 0 || integer > INT32_MAX || integer >= target.value.length) return NULL;
      return target.value[integer] ?? NULL;
    } catch (error) {
      if (error instanceof ExprConversionError) return NULL;
      throw error;
    }
  }

  return NULL;
}

/**
 * A later postfix is mapped over a filtered result. Misses and primitive children are omitted,
 * but a present Null/empty value is retained (C-E02-161/164). `undefined` is only the internal
 * "not found" sentinel; it is not an expression value.
 */
function tryAccessFilteredChild(target: ExprValue, index: ExprValue): ExprValue | undefined {
  try {
    if (target.kind === 'object') {
      const converted = convertValue(index, 'string');
      if (converted.kind !== 'string') return undefined;
      const key = objectKey(target, converted.value);
      return key === undefined ? undefined : target.value[key];
    }

    if (target.kind === 'array') {
      const converted = convertValue(index, 'number');
      if (converted.kind !== 'number') return undefined;
      const integer = Math.floor(converted.value);
      if (integer < 0 || integer > INT32_MAX || integer >= target.value.length) return undefined;
      return target.value[integer];
    }
  } catch (error) {
    if (error instanceof ExprConversionError) return undefined;
    throw error;
  }
  return undefined;
}
