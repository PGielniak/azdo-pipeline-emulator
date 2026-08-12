import { ExprConversionError, convertValue } from './coercion.js';
import { NULL, stringValue, type ExprObject, type ExprValue } from './value.js';

const INT32_MAX = 2_147_483_647;

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
      return key === undefined ? NULL : (target.value[key] ?? NULL);
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
