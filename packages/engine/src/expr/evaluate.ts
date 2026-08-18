/**
 * The convert-time backend's **walker** (E02-S05-T03).
 *
 * docs/02 §6 promises "one implementation, two backends", but until this module existed only the
 * shell backend consumed an `ExprNode`: the eval side was a set of per-family entry points
 * (`compareValues`, `evaluateLogicalMembershipFunction`, `evaluateGeneralFunction`,
 * `evaluateStatusFunction`) that every caller had to wire together by hand. E02-S05-T02's
 * conformance rows carried a hand-written `evaluate()` thunk for exactly that reason, and a
 * hand-written thunk is not the same program as the compiler's input — the two could agree on every
 * row while the *composition* (dispatch, laziness, null propagation) went untested. This module is
 * that composition, and nothing else.
 *
 * **No new service behavior is claimed here.** Every rule below is already grounded and each
 * dispatch branch cites the claims it composes; the map is in `research/E02-expressions.md`
 * §E02-S05-T03. Filtered-array traversal is grounded separately by C-E02-160..164.
 *
 * **Scope is part of the context, not a separate argument.** `context.slot` decides both which
 * named values resolve (C-E02-080..086) and which status-function table applies (C-E02-060/064/065),
 * so a caller cannot pair a step's function set with a stage's context set — the invariant
 * `registryForSlot` enforces at parse time, kept here at evaluation time.
 */
import { accessIndex, accessProperty, accessWildcard } from './access.js';
import { resolveContext, statusScopeForSlot, type ExprContext } from './context.js';
import {
  LOGICAL_MEMBERSHIP_FUNCTIONS,
  evaluateLogicalMembershipFunction,
  type ExprArgument,
} from './functions.js';
import {
  GENERAL_FUNCTIONS,
  evaluateGeneralFunction,
  type CounterStateProvider,
} from './general-functions.js';
import type { ExprNode } from './parser.js';
import { evaluateStatusFunction, isStatusFunction, type StatusContext } from './status.js';
import { NULL, valueFromLiteral, type ExprValue } from './value.js';

/**
 * Status state **without** `scope`: the scope comes from the slot, never from the caller
 * (C-E02-060/064/065). A step's `succeeded()` reads `Agent.JobStatus` while a job's reads its
 * dependency graph, so a mismatched scope would not fail — it would answer a different question.
 */
export type StatusState = Omit<StatusContext, 'scope'>;

/**
 * Everything one evaluation needs: the slot and its context values (E02-S04-T01), plus the two
 * pieces of injected state the function families read.
 */
export interface EvaluationContext extends ExprContext {
  /**
   * Template-local named values such as `each` loop variables. Keys are folded lower-case by the
   * template frame; only the declared variable enters scope, never a synthesized index
   * (C-E03-107/151).
   */
  readonly locals?: Readonly<Record<string, ExprValue>> | undefined;
  /**
   * Job/stage/step results and run cancellation. Absent state is the empty graph rather than an
   * error, which is what makes a job with no dependencies run by default (C-E02-067).
   */
  readonly status?: StatusState | undefined;
  /** The convert-time `counter` seam (C-E02-051); `counter` is legal in one slot (C-E02-096). */
  readonly counters?: CounterStateProvider | undefined;
}

/** Spelling used by the conformance harness. */
export type ExprEvaluationContext = EvaluationContext;

const LOGICAL_NAMES = new Set(
  LOGICAL_MEMBERSHIP_FUNCTIONS.map((signature) => signature.name.toLowerCase()),
);
const GENERAL_NAMES = new Set(GENERAL_FUNCTIONS.map((signature) => signature.name.toLowerCase()));

/**
 * Evaluate a parsed expression.
 *
 * Errors are *evaluation* errors — `ExprConversionError` (C-E02-020..022), `ExprKeyNotFoundError`
 * (C-E02-087/088) and `ExprContextUnavailableError` (C-E02-081) — never parse errors: by the time
 * a node exists, the text has parsed.
 *
 * A `RangeError` from this function means the *caller* built an impossible call — an unknown name,
 * a bad arity, or a status function in a slot that has none, all of which `parseExpression` with
 * `registryForSlot(slot)` would have rejected. It is a programming error, not a pipeline error, and
 * matches how the family evaluators already report the same class of mistake.
 */
export function evaluateExpression(node: ExprNode, context: EvaluationContext): ExprValue {
  switch (node.type) {
    case 'literal':
      // The parser's writable literal kinds bridge straight into the value model (C-E02-018/019).
      return valueFromLiteral(node.literal);
    case 'namedValue':
      // Availability *is* the name set: a context legal elsewhere but not here is rejected
      // byte-identically to one that exists nowhere, while a legal-but-unsupplied context resolves
      // to an empty collection rather than an error (C-E02-081/086).
      return context.locals?.[node.name.toLowerCase()] ?? resolveContext(context, node.name);
    case 'property':
      // Property and string-index syntax share one lookup after parsing (C-E02-024/027).
      return accessProperty(evaluateExpression(node.target, context), node.name);
    case 'index':
      if (node.index.type === 'wildcard') {
        return accessWildcard(evaluateExpression(node.target, context));
      }
      // Ordinary misses/non-collections yield Null except on `parameters`, while a filtered target
      // maps the access and omits unsuccessful children (C-E02-024/025/087/161/164). Those rules
      // live in `access.ts`; the walker only supplies operands, evaluating the index as an ordinary
      // expression because `[ ]` takes one (C-E02-008).
      return accessIndex(
        evaluateExpression(node.target, context),
        evaluateExpression(node.index, context),
      );
    case 'wildcard':
      // Unreachable through a parse — `*` is only ever the index of an index node — but the walker
      // stays total rather than trusting that a hand-built tree obeys that. With no target, it has
      // the same result as a wildcard over Null/non-collection (C-E02-162).
      return accessWildcard(NULL);
    case 'call':
      return evaluateCall(node, context);
  }
}

type CallNode = Extract<ExprNode, { type: 'call' }>;

function evaluateCall(node: CallNode, context: EvaluationContext): ExprValue {
  const lower = node.name.toLowerCase();

  /*
   * Arguments cross into the families as thunks, which is what preserves the service's laziness:
   * `and`/`or` stop at the first decisive operand (C-E02-028), `in`/`notIn` at the first match
   * (C-E02-030) and `coalesce` at the first non-empty value (C-E02-048), while `iif` evaluates both
   * branches (C-E02-049) and every other function evaluates all of its arguments. Which is which is
   * already encoded in the family evaluators; handing them eager values here would flatten all of
   * it silently, and `and(false, lt(1, 'x'))` would raise where the service answers False.
   */
  const args: readonly ExprArgument[] = node.args.map(
    (arg) => () => evaluateExpression(arg, context),
  );

  if (isStatusFunction(lower))
    return evaluateStatusFunction(node.name, args, statusFor(node, context));
  if (LOGICAL_NAMES.has(lower)) return evaluateLogicalMembershipFunction(node.name, args);
  if (GENERAL_NAMES.has(lower)) {
    return evaluateGeneralFunction(node.name, args, { counters: context.counters });
  }
  throw new RangeError(`unknown function: ${node.name}`);
}

/**
 * The status state for this call, with the scope taken from the slot rather than from the caller
 * (C-E02-060/064/065). Absent state is the empty graph, not an error: `succeeded()` is all-of, and
 * all-of over an empty set is True, which is why a job with no dependencies runs by default
 * (C-E02-067).
 */
function statusFor(node: CallNode, context: EvaluationContext): StatusContext {
  const scope = statusScopeForSlot(context.slot);
  if (scope === undefined) {
    // The slot registry rejects status functions here at parse time, so reaching this means the
    // caller skipped `registryForSlot` — a programming error, not a pipeline error.
    throw new RangeError(`status function '${node.name}' is not available in a ${context.slot}`);
  }
  // Put the derived discriminator last. TypeScript's structural typing lets a caller pass a
  // wider object through a variable, so this also prevents an accidental `scope` property from
  // overriding the slot-derived truth table at runtime.
  return { ...context.status, scope };
}
