import type { ExprNode } from './parser.js';

export class BashCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BashCompileError';
  }
}

/**
 * Kind tag carried alongside every compiled operand.
 *
 * The shell has one datatype, so a value crosses into `lib/expr.sh` as its **String form** and the
 * tag is what lets `azdo_expr_cmp` reproduce the evaluator's conversion table (C-E02-020..022).
 * There is no `null` tag — a missing variable reads as the empty string (C-E02-138) — and no
 * collection tag, because Object/Array have no shell representation at all (C-E02-139).
 */
export type BashValueKind = 'bool' | 'num' | 'str' | 'ver';

export interface BashValue {
  readonly kind: BashValueKind;
  /** A single shell word, safe to paste into a command line. */
  readonly code: string;
}

export interface BashCompileOptions {
  readonly variableFunction?: string;
  readonly outputFunction?: string;
  readonly jobResultFunction?: string;
  readonly stageResultFunction?: string;
  /** `dependencies.X` names jobs in job conditions and stages in stage conditions. */
  readonly dependencyKind?: 'job' | 'stage';
  /** Overrides for the `azdo_status_<name>` default (docs/02 §6). */
  readonly statusFunctions?: Readonly<Record<string, string>>;
  /** Shell parameter holding the current stage, for same-stage `dependencies` output reads. */
  readonly stageVariable?: string;
}

/** Predicate-valued calls compile to a command; everything else compiles to a word. */
const PREDICATE_FUNCTIONS = new Set([
  'and',
  'or',
  'not',
  'eq',
  'ne',
  'lt',
  'le',
  'gt',
  'ge',
  'in',
  'notin',
  'contains',
  'startswith',
  'endswith',
  'xor',
]);

const STATUS_FUNCTIONS = new Set([
  'always',
  'canceled',
  'failed',
  'succeeded',
  'succeededorfailed',
]);

const COMPARISONS = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);

/**
 * Functions whose result or operand is a collection. They are rejected rather than emitted:
 * `split`/`convertToJson` return Array/Object, `join`/`containsValue` consume one, and `counter`
 * needs the convert-time state provider. T01 emitted `azdo_expr_<name>` calls for these, which
 * would have failed at run time with status 127 — a status a conformance row can mistake for
 * False, which is exactly what this task exists to prevent (C-E02-139/145).
 */
const COLLECTION_FUNCTIONS = new Set([
  'split',
  'join',
  'converttojson',
  'containsvalue',
  'counter',
]);

const SAFE_WORD = /^[A-Za-z0-9_.:+/@=-]+$/;

const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
/** Quote only where the shell would otherwise reparse the word, so generated code stays readable. */
const word = (text: string): string => (SAFE_WORD.test(text) ? text : quote(text));

interface Predicate {
  readonly code: string;
  /** True when `code` is an AND/OR list and must be braced before `&&`, `||` or `!`. */
  readonly list: boolean;
}

const group = (predicate: Predicate): string =>
  predicate.list ? `{ ${predicate.code}; }` : predicate.code;

function isPredicateNode(node: ExprNode): boolean {
  if (node.type !== 'call') return false;
  const lower = node.name.toLowerCase();
  return PREDICATE_FUNCTIONS.has(lower) || STATUS_FUNCTIONS.has(lower);
}

function variableRead(name: string, options: BashCompileOptions): string {
  return `"$(${options.variableFunction ?? 'azdo_var'} ${quote(name)})"`;
}

function outputRead(
  stage: string | undefined,
  job: string,
  variable: string,
  options: BashCompileOptions,
): string {
  const stageWord =
    stage === undefined ? `"$${options.stageVariable ?? 'AZDO_STAGE_ID'}"` : quote(stage);
  return `"$(${options.outputFunction ?? 'azdo_output'} ${stageWord} ${quote(job)} ${quote(variable)})"`;
}

function jobResultRead(
  stage: string | undefined,
  job: string,
  options: BashCompileOptions,
): string {
  const stageWord =
    stage === undefined ? `"$${options.stageVariable ?? 'AZDO_STAGE_ID'}"` : quote(stage);
  return `"$(${options.jobResultFunction ?? 'azdo_job_result'} ${stageWord} ${quote(job)})"`;
}

function stageResultRead(stage: string, options: BashCompileOptions): string {
  return `"$(${options.stageResultFunction ?? 'azdo_stage_result'} ${quote(stage)})"`;
}

/** Flatten `a.b['c'].d` into `['a','b','c','d']`, or undefined if any step is dynamic. */
function contextPath(node: ExprNode): string[] | undefined {
  switch (node.type) {
    case 'namedValue':
      return [node.name];
    case 'property': {
      const parent = contextPath(node.target);
      return parent === undefined ? undefined : [...parent, node.name];
    }
    case 'index': {
      if (node.index.type !== 'literal' || node.index.literal.kind !== 'string') return undefined;
      const parent = contextPath(node.target);
      return parent === undefined ? undefined : [...parent, node.index.literal.value];
    }
    default:
      return undefined;
  }
}

function compileContext(node: ExprNode, options: BashCompileOptions): BashValue {
  const path = contextPath(node);
  if (path === undefined) {
    throw new BashCompileError('dynamic member access is not supported by the shell backend');
  }
  const [head, ...rest] = path;
  const context = head?.toLowerCase();

  // The variables table is flat, so a dotted name is one key rather than a chain (C-E02-089).
  if (context === 'variables' && rest.length >= 1) {
    return { kind: 'str', code: variableRead(rest.join('.'), options) };
  }
  if (context === 'dependencies' && rest.length === 2 && rest[1]?.toLowerCase() === 'result') {
    return {
      kind: 'str',
      code:
        options.dependencyKind === 'stage'
          ? stageResultRead(rest[0] as string, options)
          : jobResultRead(undefined, rest[0] as string, options),
    };
  }
  if (context === 'dependencies' && rest.length === 3 && rest[1]?.toLowerCase() === 'outputs') {
    return {
      kind: 'str',
      code: outputRead(undefined, rest[0] as string, rest[2] as string, options),
    };
  }
  if (context === 'stagedependencies' && rest.length === 3 && rest[2]?.toLowerCase() === 'result') {
    return {
      kind: 'str',
      code: jobResultRead(rest[0] as string, rest[1] as string, options),
    };
  }
  if (
    context === 'stagedependencies' &&
    rest.length === 4 &&
    rest[2]?.toLowerCase() === 'outputs'
  ) {
    return {
      kind: 'str',
      code: outputRead(rest[0] as string, rest[1] as string, rest[3] as string, options),
    };
  }
  throw new BashCompileError(
    `context '${path.join('.')}' is not readable by the shell backend (docs/02 §6)`,
  );
}

/** Compile a node to a single shell word plus the kind tag `lib/expr.sh` needs. */
export function compileBashValue(node: ExprNode, options: BashCompileOptions = {}): BashValue {
  switch (node.type) {
    case 'literal':
      switch (node.literal.kind) {
        case 'boolean':
          return { kind: 'bool', code: node.literal.value ? 'True' : 'False' };
        case 'number':
          return { kind: 'num', code: word(String(node.literal.value)) };
        case 'version':
          return { kind: 'ver', code: word(node.literal.segments.join('.')) };
        case 'string':
          return { kind: 'str', code: word(node.literal.value) };
      }
      break;
    case 'wildcard':
      throw new BashCompileError('wildcard access is not supported by the shell backend');
    case 'namedValue':
    case 'property':
    case 'index':
      return compileContext(node, options);
    case 'call':
      return compileValueCall(node, options);
  }
  throw new BashCompileError('unsupported expression node');
}

type CallNode = Extract<ExprNode, { type: 'call' }>;

function compileValueCall(node: CallNode, options: BashCompileOptions): BashValue {
  const { name, args } = node;
  const lower = name.toLowerCase();

  // A Boolean-valued call used as a *value* runs the predicate and renders its status (C-E02-146).
  if (PREDICATE_FUNCTIONS.has(lower) || STATUS_FUNCTIONS.has(lower)) {
    const predicate = compilePredicate(node, options);
    return { kind: 'bool', code: `"$(${predicate.code}; azdo_expr_bool $?)"` };
  }
  if (COLLECTION_FUNCTIONS.has(lower)) {
    throw new BashCompileError(
      `'${name}' has no shell representation (Object/Array values or convert-time state)`,
    );
  }

  const values = args.map((arg) => compileBashValue(arg, options));
  const codes = values.map((value) => value.code).join(' ');

  switch (lower) {
    case 'lower':
    case 'upper':
    case 'trim':
    case 'replace':
    case 'format':
      return { kind: 'str', code: `"$(azdo_expr_${lower} ${codes})"` };
    case 'length':
      return { kind: 'num', code: `"$(azdo_expr_length ${codes})"` };
    case 'coalesce':
    case 'iif': {
      // Both return one of their operands unchanged, so the result kind is only knowable when the
      // candidate operands agree; a mixed-kind call would have to guess and is rejected instead.
      const candidates = lower === 'iif' ? values.slice(1) : values;
      const kinds = new Set(candidates.map((value) => value.kind));
      if (kinds.size !== 1) {
        throw new BashCompileError(
          `'${name}' needs operands of one kind in the shell backend; got ${[...kinds].join('/')}`,
        );
      }
      const kind = candidates[0]?.kind ?? 'str';
      if (lower === 'coalesce') return { kind, code: `"$(azdo_expr_coalesce ${codes})"` };
      const condition = values[0] as BashValue;
      const branches = candidates.map((value) => value.code).join(' ');
      return {
        kind,
        code: `"$(azdo_expr_iif ${condition.kind} ${condition.code} ${branches})"`,
      };
    }
    default:
      throw new BashCompileError(`unsupported shell function '${name}'`);
  }
}

/** Compile a node to a command whose exit status is 0 = True, 1 = False, 2 = evaluation error. */
function compilePredicate(node: ExprNode, options: BashCompileOptions): Predicate {
  if (node.type !== 'call' || !isPredicateNode(node)) {
    const value = compileBashValue(node, options);
    return { code: `azdo_expr_truthy ${value.kind} ${value.code}`, list: false };
  }
  const lower = node.name.toLowerCase();
  const args = node.args;

  if (lower === 'and' || lower === 'or') {
    const operator = lower === 'and' ? ' && ' : ' || ';
    const parts = args.map((arg) => group(compilePredicate(arg, options)));
    return { code: parts.join(operator), list: true };
  }
  if (lower === 'not') {
    return { code: `! ${group(compilePredicate(args[0] as ExprNode, options))}`, list: false };
  }
  if (COMPARISONS.has(lower)) {
    const left = compileBashValue(args[0] as ExprNode, options);
    const right = compileBashValue(args[1] as ExprNode, options);
    return {
      code: `azdo_expr_cmp ${lower} ${left.kind} ${left.code} ${right.kind} ${right.code}`,
      list: false,
    };
  }
  if (lower === 'in' || lower === 'notin') {
    const left = compileBashValue(args[0] as ExprNode, options);
    const tests = args.slice(1).map((candidate) => {
      const value = compileBashValue(candidate, options);
      return `azdo_expr_cmp eq ${left.kind} ${left.code} ${value.kind} ${value.code}`;
    });
    const any: Predicate = { code: tests.join(' || '), list: tests.length > 1 };
    return lower === 'in' ? any : { code: `! ${group(any)}`, list: false };
  }
  if (lower === 'contains' || lower === 'startswith' || lower === 'endswith') {
    // The substring family converts both operands to String, which is the identity here.
    const operands = args.map((arg) => compileBashValue(arg, options).code).join(' ');
    return { code: `azdo_expr_${lower} ${operands}`, list: false };
  }
  if (lower === 'xor') {
    const left = compileBashValue(args[0] as ExprNode, options);
    const right = compileBashValue(args[1] as ExprNode, options);
    return {
      code: `azdo_expr_xor ${left.kind} ${left.code} ${right.kind} ${right.code}`,
      list: false,
    };
  }

  // Status functions: the names are read from the runtime results store (docs/02 §6, E06-S03).
  const command = options.statusFunctions?.[lower] ?? `azdo_status_${lower}`;
  const names = args.map((arg) => compileBashValue(arg, options).code);
  return { code: [command, ...names].join(' '), list: false };
}

/**
 * Compile an already-parsed Azure expression into dependency-free Bash.
 *
 * The result is a *command*: run it and read `$?` (0 True, 1 False, 2 evaluation error). Helpers
 * live in `packages/runtime/lib/expr.sh`, which the generated project sources (C-E02-131).
 */
export function compileBash(node: ExprNode, options: BashCompileOptions = {}): string {
  return compilePredicate(node, options).code;
}

/** Runtime helper library the compiled expressions call into; emitted once per generated project. */
export const BASH_EXPR_HELPER_LIBRARY = 'lib/expr.sh';
