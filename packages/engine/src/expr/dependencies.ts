import { objectValue, stringValue, type ExprObject, type ExprValue } from './value.js';

/** The stable fields exposed by Azure's `dependencies.<job>` object. */
export interface DependencyRecord {
  readonly result: string;
  readonly outputs?: Readonly<Record<string, string>>;
  /** Service metadata is preserved when supplied, but is not required by the expression contract. */
  readonly [key: string]: unknown;
}

function recordValue(record: DependencyRecord): ExprObject {
  const values: Record<string, ExprValue> = { result: stringValue(record.result) };
  if (record.outputs !== undefined) {
    values.outputs = objectValue(
      Object.fromEntries(
        Object.entries(record.outputs).map(([key, value]) => [key, stringValue(value)]),
      ),
      'ordinalIgnoreCase',
    );
  }
  return objectValue(values, 'ordinalIgnoreCase');
}

/** Build the job/stage `dependencies` context from the runtime result store. */
export function dependenciesContext(
  records: Readonly<Record<string, DependencyRecord>>,
): ExprObject {
  return objectValue(
    Object.fromEntries(
      Object.entries(records).map(([name, record]) => [name, recordValue(record)]),
    ),
    'ordinalIgnoreCase',
  );
}

/** Build `stageDependencies.<stage>.<job>` for cross-stage output reads. */
export function stageDependenciesContext(
  records: Readonly<Record<string, Readonly<Record<string, DependencyRecord>>>>,
): ExprObject {
  return objectValue(
    Object.fromEntries(
      Object.entries(records).map(([stage, jobs]) => [stage, dependenciesContext(jobs)]),
    ),
    'ordinalIgnoreCase',
  );
}
