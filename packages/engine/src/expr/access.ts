import { ExprConversionError, convertValue } from './coercion.js';
import { NULL, stringValue, type ExprObject, type ExprValue } from './value.js';

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
 * Evaluate one `target[index]` operation. Every miss and every non-collection target yields Null,
 * which makes member chains safe without special-casing the AST shape (C-E02-024/025).
 */
export function accessIndex(target: ExprValue, index: ExprValue): ExprValue {
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
