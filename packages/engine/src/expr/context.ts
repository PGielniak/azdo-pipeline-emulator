/**
 * Expression **contexts** — which named values exist, in which slot, and what a lookup returns.
 *
 * The expressions doc spends one sentence on this: "In a compile-time expression (`${{ }}`) you
 * have access to `parameters` and statically defined `variables`. In a runtime expression (`$[ ]`)
 * you have access to more `variables` but no parameters." That sentence names two slots and three
 * contexts, and it is not enough to build against — the pipeline has seven contexts, and C-E02-065
 * already established that the *function* table varies per slot, so there was no reason to assume
 * the named-value table does not.
 *
 * 61 live probes (`research/experiments/E02-context/survey.md`) measured the whole grid. The result
 * is **three** distinct name tables, not the doc's two (C-E02-080..084):
 *
 * | context             | `${{ }}` compile | `$[ ]` runtime var | job/stage `condition:` |
 * |---------------------|:----------------:|:------------------:|:----------------------:|
 * | `parameters`        |        yes       |         no         |           no           |
 * | `variables`         |        yes       |        yes         |          yes           |
 * | `dependencies`      |        no        |         no         |          yes           |
 * | `stageDependencies` |        no        |         no         |          yes           |
 * | `resources`         |        no        |        yes         |           no           |
 * | `pipeline`          |        no        |        yes         |          yes           |
 * | `environment`       |        no        |         no         |           no           |
 *
 * `resources` and `dependencies` are a double dissociation: each is legal in exactly one of the two
 * *runtime* slots and rejected in the other. So "compile time vs run time" does not describe the
 * gate — the slot does (C-E02-082).
 *
 * **Availability is nothing but this name set.** A context that exists but is wrong for the slot is
 * rejected byte-identically to one that does not exist anywhere: `${{ dependencies.A.result }}` and
 * `${{ nosuchcontext.probe }}` both come back `Unrecognized value: '<name>'. Located at position 1
 * within expression: '<expr>'…`. That is why this module gates by handing `parseExpression` a
 * per-slot `ExprRegistry` rather than adding an error kind — `errors.ts` renders it already
 * (C-E02-081).
 */
import { makeRegistry, type ExprRegistry } from './parser.js';
import { NON_STATUS_FUNCTIONS } from './general-functions.js';
import { statusFunctionSignatures, type StatusScope } from './status.js';
import { resourcesContext } from './resources.js';
import { objectValue, stringValue, type ExprObject, type ExprValue } from './value.js';

/** The seven context names the service knows. Anything else is `Unrecognized value` everywhere. */
export type ExprContextName =
  | 'parameters'
  | 'variables'
  | 'dependencies'
  | 'stageDependencies'
  | 'resources'
  | 'pipeline'
  | 'environment';

export const EXPR_CONTEXT_NAMES: readonly ExprContextName[] = [
  'parameters',
  'variables',
  'dependencies',
  'stageDependencies',
  'resources',
  'pipeline',
  'environment',
];

/**
 * Where an expression sits. This is the gate for *both* tables — named values here and function
 * signatures via `statusScopeForSlot` — so a caller can never pair a step's function set with a
 * stage's context set.
 */
export type ExprSlot =
  /** `${{ }}` in a value, `${{ if }}`, `${{ each }}` — one table, measured identical. */
  | 'template-expression'
  /** `$[ ]` as the whole value of a `variables:` entry. */
  | 'runtime-variable'
  | 'job-condition'
  | 'stage-condition'
  /** Evaluated by the agent, never validated by the service — see `grounded` below. */
  | 'step-condition';

export interface SlotAvailability {
  readonly contexts: readonly ExprContextName[];
  /**
   * `false` where the service accepts *anything* in the slot, so the set is our policy rather than
   * a measurement. Only `step-condition` is ungrounded, and it is not a small caveat: the negative
   * controls proved the slot resolves no names at all (C-E02-085).
   */
  readonly grounded: boolean;
  readonly note?: string;
}

/**
 * The measured grid. Two slots accept literally everything and are marked `grounded: false`:
 *
 *  - `step-condition` — already known (C-E02-060, docs/06 §5 decision 17).
 *  - a **job-scoped** `variables:` value — newly measured here and *not* a slot in this enum
 *    precisely because it validates nothing: `$[ nosuchcontext.probe ]` and even the bad-arity
 *    `$[ eq(1) ]` are both accepted inside a job's own `variables:` block, while both are rejected
 *    at the root. Any "context X is legal inside a job" reading of those rows is an artifact
 *    (C-E02-085). `runtime-variable` therefore describes the root block, which is where the
 *    service actually checks.
 */
export const SLOT_AVAILABILITY: Readonly<Record<ExprSlot, SlotAvailability>> = {
  'template-expression': { contexts: ['parameters', 'variables'], grounded: true },
  'runtime-variable': { contexts: ['variables', 'resources', 'pipeline'], grounded: true },
  'job-condition': {
    contexts: ['variables', 'dependencies', 'stageDependencies', 'pipeline'],
    grounded: true,
  },
  'stage-condition': {
    contexts: ['variables', 'dependencies', 'stageDependencies', 'pipeline'],
    grounded: true,
  },
  'step-condition': {
    contexts: ['variables'],
    grounded: false,
    note:
      'The service resolves no names in a step condition, so it cannot tell us this table and no ' +
      'probe in that slot is evidence. `variables` is the agent-side set the conditions doc ' +
      "implies (it expands step-level succeeded() as in(variables['Agent.JobStatus'], …)). " +
      'Narrowing this needs agent source or a real run, not preview.',
  },
};

export function contextsForSlot(slot: ExprSlot): readonly ExprContextName[] {
  return SLOT_AVAILABILITY[slot].contexts;
}

export function isContextAvailable(slot: ExprSlot, name: string): boolean {
  const wanted = name.toLowerCase();
  return contextsForSlot(slot).some((context) => context.toLowerCase() === wanted);
}

/**
 * Which status-function table this slot uses, or `undefined` where status functions are illegal.
 * Derived from the slot rather than chosen separately, so the two gates cannot disagree — the doc
 * sentence "in conditions, but not in variable definitions" is enforced by the service, and
 * `${{ always() }}`, `${{ if succeeded() }}` and `$[ always() ]` are all rejected (C-E02-065).
 */
export function statusScopeForSlot(slot: ExprSlot): StatusScope | undefined {
  switch (slot) {
    case 'step-condition':
      return 'step';
    case 'job-condition':
      return 'job';
    case 'stage-condition':
      return 'stage';
    case 'template-expression':
    case 'runtime-variable':
      return undefined;
  }
}

/**
 * Functions that are *not* legal in every slot, keyed lower-case. The status family is the
 * mirror image of this and is handled by `statusScopeForSlot`.
 *
 * `counter` is legal in exactly one slot: a **runtime** variable. The doc says "Use this function
 * only in an expression that defines a variable. Don't use it as part of a condition for a step,
 * job, or stage", and the service enforces that — but more narrowly than the sentence reads, since
 * a *compile-time* variable definition is a variable definition and is rejected too. All three
 * rejections are the ordinary `Unrecognized value: 'counter'` (C-E02-096).
 */
const SLOT_RESTRICTED_FUNCTIONS: Readonly<Record<string, readonly ExprSlot[]>> = {
  counter: ['runtime-variable'],
};

/**
 * The registry `parseExpression` needs for this slot: the non-status functions minus any the slot
 * does not carry, the status functions where the slot has them, and exactly this slot's context
 * names. Parsing with it produces the service's own rejection for a wrong-slot name, because name
 * resolution happens during the parse (C-E02-011/012).
 */
export function registryForSlot(
  slot: ExprSlot,
  additionalNamedValues: readonly string[] = [],
): ExprRegistry {
  const scope = statusScopeForSlot(slot);
  const functions = [
    ...NON_STATUS_FUNCTIONS.filter((signature) => {
      const allowed = SLOT_RESTRICTED_FUNCTIONS[signature.name.toLowerCase()];
      return allowed === undefined || allowed.includes(slot);
    }),
    ...(scope === undefined ? [] : statusFunctionSignatures(scope)),
  ];
  return makeRegistry(functions, [...contextsForSlot(slot), ...additionalNamedValues]);
}

/** Context objects by canonical name; absent means the caller has no data for that context. */
export type ExprContextValues = Partial<Record<ExprContextName, ExprValue>>;

export interface ExprContext {
  readonly slot: ExprSlot;
  readonly values: ExprContextValues;
}

/**
 * Raised when an expression names a context this slot does not have. The message is the service's
 * own sentence so `errors.ts` can render it with the position and help link it already knows how
 * to attach — availability needs no new error shape (C-E02-081).
 */
export class ExprContextUnavailableError extends Error {
  // Not `name` — that is `Error.name`, and the assignment below would have silently overwritten
  // the context we were asked about.
  constructor(
    readonly contextName: string,
    readonly slot: ExprSlot,
  ) {
    super(`Unrecognized value: '${contextName}'`);
    this.name = 'ExprContextUnavailableError';
  }
}

/**
 * Resolve a bare context name to its value. Names fold case (C-E02-011/012). A context that is
 * legal here but that the caller supplied no data for resolves to an **empty object**, not an
 * error: the service treats an absent collection as empty, which is why `variables.noSuchVariable`
 * is Null rather than a rejection (C-E02-086).
 */
export function resolveContext(context: ExprContext, name: string): ExprValue {
  if (!isContextAvailable(context.slot, name)) {
    throw new ExprContextUnavailableError(name, context.slot);
  }
  const canonical = EXPR_CONTEXT_NAMES.find(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  );
  const value = canonical === undefined ? undefined : context.values[canonical];
  return value ?? emptyContextObject(canonical);
}

/**
 * "No data supplied" is not the same as "empty object" for every context. Two have inner structure
 * the service always presents, so the fallback has to go through their builders:
 *
 *  - `parameters` keeps its `error` miss policy, so a miss still raises `Key not found` when the
 *    pipeline declares no parameters at all (C-E02-087).
 *  - `resources` always has **both** `repositories` and `containers`; a run with nothing declared
 *    still dumps `{"repositories": {"self": …}, "containers": {}}`, so a bare `{}` here would make
 *    `resources.repositories` Null where the service gives an object (C-E02-121).
 */
function emptyContextObject(name: ExprContextName | undefined): ExprObject {
  if (name === 'parameters') return parametersContext({});
  if (name === 'resources') return resourcesContext({});
  return objectValue({}, 'ordinalIgnoreCase');
}

/**
 * The `parameters` context. Two policies, both measured, and both different from what the rest of
 * the value model does by default:
 *
 *  - **Keys fold case.** `parameters.MYPARAM` resolves a parameter declared `myParam`
 *    (C-E02-087). Note this is the *top-level context only* — an object nested inside a parameter
 *    value stays ordinal case-sensitive per C-E02-024/027, which is why those nested objects are
 *    built with the `objectValue` defaults and this one is not.
 *  - **A miss is an error, not Null.** `parameters.noSuchParameter` is rejected `Key not found
 *    'noSuchParameter'` — the single collection in the language that refuses to null-propagate.
 *    Measured against `variables.noSuchVariable` in the same slot and syntax, which returns Null
 *    (C-E02-087). The same rejection appears when the pipeline declares no `parameters:` block at
 *    all, so the context always exists and it is the *lookup* that fails.
 */
export function parametersContext(entries: Readonly<Record<string, ExprValue>>): ExprObject {
  return objectValue(entries, 'ordinalIgnoreCase', 'error');
}

/**
 * The `variables` context: **flat**, keyed by the literal variable name, folding case, and
 * null-propagating on a miss.
 *
 * Flat is the load-bearing word. `variables['My.Var']` returns the value of a variable *named*
 * `My.Var`, while the property chain `variables.My.Var` returns empty — it reads a variable named
 * `My`, misses, and null-propagates. A dot in a variable name is not structure (C-E02-089).
 */
export function variablesContext(entries: Readonly<Record<string, string>>): ExprObject {
  const values: Record<string, ExprValue> = {};
  for (const [name, value] of Object.entries(entries)) values[name] = stringValue(value);
  return objectValue(values, 'ordinalIgnoreCase', 'null');
}
