import type { FunctionSignature } from './parser.js';
import type { ExprArgument } from './functions.js';
import { booleanValue, type ExprValue } from './value.js';
import { convertValue } from './coercion.js';

/**
 * Job status check functions — the one E02 family with **two implementations behind one spelling**.
 *
 * A step condition is evaluated by the agent; a job or stage condition by the server-side
 * orchestrator. They differ in arity (C-E02-061 vs C-E02-064), in what `canceled()` reads
 * (C-E02-062), and in what a status call means at all. The service cannot even police the
 * difference for us: a step condition is validated by a permissive path that resolves no function
 * names, so `succeeded('A')` on a step is accepted at queue time and rejected by the agent at run
 * time (C-E02-060/061). That makes `scope` a required part of the context rather than a detail —
 * getting it wrong is exactly the class of bug that passes locally and fails on the service.
 *
 * Truth tables come from `research/experiments/E02-status/real-run.md` (a real agentless run — the
 * only way to observe values preview never computes) and from the agent source for the step level.
 */

/**
 * A completed job or stage result. The first five are the documented set; `Abandoned` is a sixth
 * the docs never list, produced when a job's own condition errors, and no status function except
 * `always()` matches it (C-E02-071).
 */
export type JobResult =
  'Succeeded' | 'SucceededWithIssues' | 'Failed' | 'Canceled' | 'Skipped' | 'Abandoned';

export type StatusScope = 'step' | 'job' | 'stage';

export type StatusFunctionName =
  'always' | 'canceled' | 'failed' | 'succeeded' | 'succeededOrFailed';

export const STATUS_FUNCTION_NAMES: readonly StatusFunctionName[] = [
  'always',
  'canceled',
  'failed',
  'succeeded',
  'succeededOrFailed',
];

/** Injected state. Which fields are read depends entirely on `scope`. */
export interface StatusContext {
  readonly scope: StatusScope;
  /**
   * Step scope only: `Agent.JobStatus` as it stands *before* this step. Undefined means the
   * variable is not set yet — the agent defaults it to `Succeeded`, which is why `succeeded()` is
   * true on a job's first step (C-E02-062).
   */
  readonly jobStatus?: JobResult | undefined;
  /**
   * Job/stage scope only: the results of this job's (or stage's) dependency graph, keyed by name.
   * Keys are matched case-insensitively (C-E02-067). A name that is absent counts as "not
   * succeeded" rather than raising (C-E02-072).
   */
  readonly dependencies?: Readonly<Record<string, JobResult>> | undefined;
  /** Job/stage scope only: whether the run itself was canceled. */
  readonly runCanceled?: boolean | undefined;
}

const STEP_SIGNATURES: readonly FunctionSignature[] = [
  // The agent registers all five with minParameters 0, maxParameters 0 (C-E02-061).
  { name: 'always', minArgs: 0, maxArgs: 0 },
  { name: 'canceled', minArgs: 0, maxArgs: 0 },
  { name: 'failed', minArgs: 0, maxArgs: 0 },
  { name: 'succeeded', minArgs: 0, maxArgs: 0 },
  { name: 'succeededOrFailed', minArgs: 0, maxArgs: 0 },
];

const GRAPH_SIGNATURES: readonly FunctionSignature[] = [
  // `always` and `canceled` stay 0-arity even here: `always('A')` and `canceled('A')` are rejected
  // by the service at the closing paren, while the other three take dependency names 0..N
  // (C-E02-064).
  { name: 'always', minArgs: 0, maxArgs: 0 },
  { name: 'canceled', minArgs: 0, maxArgs: 0 },
  { name: 'failed', minArgs: 0, maxArgs: Infinity },
  { name: 'succeeded', minArgs: 0, maxArgs: Infinity },
  { name: 'succeededOrFailed', minArgs: 0, maxArgs: Infinity },
];

/** Signatures for `makeRegistry`. Scope-dependent by necessity, not by preference (C-E02-060). */
export function statusFunctionSignatures(scope: StatusScope): readonly FunctionSignature[] {
  return scope === 'step' ? STEP_SIGNATURES : GRAPH_SIGNATURES;
}

const canonicalNames = new Map<string, StatusFunctionName>(
  GRAPH_SIGNATURES.map((signature) => [
    signature.name.toLowerCase(),
    signature.name as StatusFunctionName,
  ]),
);

/** Names are case-insensitive, and the family is registered as functions, not named values
 * (C-E02-066) — a bare `always` is a parse error, so it never reaches this module. */
export function isStatusFunction(name: string): boolean {
  return canonicalNames.has(name.toLowerCase());
}

function validateCall(name: string, count: number, scope: StatusScope): StatusFunctionName {
  const canonical = canonicalNames.get(name.toLowerCase());
  if (canonical === undefined) throw new RangeError(`unknown status function: ${name}`);
  const signature = statusFunctionSignatures(scope).find((s) => s.name === canonical);
  if (signature === undefined) throw new RangeError(`unknown status function: ${name}`);
  if (count < signature.minArgs || count > signature.maxArgs) {
    const maximum = signature.maxArgs === Infinity ? 'N' : String(signature.maxArgs);
    throw new RangeError(
      `${signature.name} expects ${signature.minArgs}..${maximum} parameters in a ${scope} ` +
        `condition; received ${count}`,
    );
  }
  return canonical;
}

const SUCCESSFUL: ReadonlySet<JobResult> = new Set<JobResult>(['Succeeded', 'SucceededWithIssues']);
const SUCCEEDED_OR_FAILED: ReadonlySet<JobResult> = new Set<JobResult>([
  'Succeeded',
  'SucceededWithIssues',
  'Failed',
]);

/** Step scope reads exactly one value, defaulting to Succeeded when unset (C-E02-062). */
function stepStatus(context: StatusContext): JobResult {
  return context.jobStatus ?? 'Succeeded';
}

/**
 * The results this call ranges over: the named dependencies when arguments are given, otherwise
 * the whole graph. Arguments **replace** the set rather than filtering it — naming one succeeded
 * dependency is True even while a skipped one remains in the graph (C-E02-067).
 */
function selectedResults(
  context: StatusContext,
  names: readonly string[] | undefined,
): (JobResult | undefined)[] {
  const graph = context.dependencies ?? {};
  if (names === undefined) return Object.values(graph);

  // Case-insensitive lookup (C-E02-067); an unmatched name yields undefined, which every rule
  // below treats as "not succeeded, not failed" rather than as an error (C-E02-072).
  const folded = new Map<string, JobResult>(
    Object.entries(graph).map(([key, result]) => [key.toUpperCase(), result]),
  );
  return names.map((name) => folded.get(name.toUpperCase()));
}

/** Dependency-name arguments are ordinary expressions converted to String, not static names
 * — the service accepts `succeeded(variables['jobName'])` and `succeeded(1)` (C-E02-064). */
function argumentNames(args: readonly ExprArgument[]): string[] {
  return args.map((arg) => {
    const converted = convertValue(arg(), 'string');
    if (converted.kind !== 'string') throw new Error('internal String conversion invariant');
    return converted.value;
  });
}

export function evaluateStatusFunction(
  name: StatusFunctionName | string,
  args: readonly ExprArgument[],
  context: StatusContext,
): ExprValue {
  const canonical = validateCall(name, args.length, context.scope);

  if (context.scope === 'step') {
    const status = stepStatus(context);
    switch (canonical) {
      case 'always':
        return booleanValue(true); // literal true; reads no context at all (C-E02-062)
      case 'canceled':
        // At step level this is the *job's* status, not run-level cancellation (C-E02-062).
        return booleanValue(status === 'Canceled');
      case 'failed':
        return booleanValue(status === 'Failed');
      case 'succeeded':
        return booleanValue(SUCCESSFUL.has(status));
      case 'succeededOrFailed':
        return booleanValue(SUCCEEDED_OR_FAILED.has(status));
    }
  }

  if (canonical === 'always') return booleanValue(true);
  if (canonical === 'canceled') return booleanValue(context.runCanceled === true);

  const names = args.length === 0 ? undefined : argumentNames(args);
  const results = selectedResults(context, names);

  switch (canonical) {
    case 'succeeded':
      // All-of, and False outright when the run is canceled ("Evaluates to False if the pipeline
      // is canceled"). All-of over an empty set is True, which is why a job with no dependencies
      // runs by default (C-E02-067).
      if (context.runCanceled === true) return booleanValue(false);
      return booleanValue(
        results.every((result) => result !== undefined && SUCCESSFUL.has(result)),
      );
    case 'failed':
      // Any-of; over an empty set False (C-E02-070).
      return booleanValue(results.some((result) => result !== undefined && result === 'Failed'));
    case 'succeededOrFailed':
      // Any-of **except over an empty set**, where it is True — measured, not derived, and the one
      // asymmetry in the family (C-E02-068). Stating it as "unless non-empty and none qualifies"
      // keeps the empty case from falling out of a `some` call as False.
      //
      // Cancellation first: "like always(), except it evaluates to False when the pipeline is
      // canceled" is the half of the doc's summary the live rows do not contradict.
      if (context.runCanceled === true) return booleanValue(false);
      if (results.length === 0) return booleanValue(true);
      return booleanValue(
        results.some((result) => result !== undefined && SUCCEEDED_OR_FAILED.has(result)),
      );
  }
}
