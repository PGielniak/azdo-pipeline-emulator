import type { ExprNode } from './parser.js';

export class BashCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BashCompileError';
  }
}

export interface BashCompileOptions {
  readonly variableFunction?: string;
  readonly outputFunction?: string;
  readonly statusFunctions?: Readonly<Record<string, string>>;
}

const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
const variable = (name: string, options: BashCompileOptions): string =>
  `${options.variableFunction ?? 'azdo_var'} ${quote(name)}`;

function compile(node: ExprNode, options: BashCompileOptions): string {
  switch (node.type) {
    case 'literal':
      if (node.literal.kind === 'boolean') return node.literal.value ? 'True' : 'False';
      if (node.literal.kind === 'number') return String(node.literal.value);
      if (node.literal.kind === 'version') return quote(node.literal.segments.join('.'));
      return quote(node.literal.value);
    case 'namedValue':
      throw new BashCompileError(`unsupported shell name '${node.name}' (use a runtime context)`);
    case 'wildcard':
      throw new BashCompileError('wildcard access is not supported by the shell backend');
    case 'property':
      return compileAccess(node.target, node.name, options);
    case 'index':
      if (node.index.type === 'literal' && node.index.literal.kind === 'string') {
        return compileAccess(node.target, node.index.literal.value, options);
      }
      throw new BashCompileError(
        'dynamic array/object indexing is not supported by the shell backend',
      );
    case 'call':
      return compileCall(node.name, node.args, options);
  }
}

function compileAccess(target: ExprNode, name: string, options: BashCompileOptions): string {
  if (target.type === 'namedValue' && target.name.toLowerCase() === 'variables') {
    return `$(${variable(name, options)})`;
  }
  if (
    target.type === 'index' &&
    target.index.type === 'literal' &&
    target.index.literal.kind === 'string'
  ) {
    const path = flattenContextPath(target.target, target.index.literal.value);
    if (path?.[0]?.toLowerCase() === 'dependencies') {
      const output = options.outputFunction ?? 'azdo_output';
      return `$( ${output} ${path.slice(1).map(quote).join(' ')} )`;
    }
  }
  throw new BashCompileError('unsupported shell member access');
}

function flattenContextPath(target: ExprNode, final: string): string[] | undefined {
  if (target.type === 'namedValue') return [target.name, final];
  if (target.type === 'property') {
    const parent = flattenContextPath(target.target, target.name);
    return parent === undefined ? undefined : [...parent, final];
  }
  return undefined;
}

function compileCall(name: string, args: readonly ExprNode[], options: BashCompileOptions): string {
  const lower = name.toLowerCase();
  if (lower === 'and' || lower === 'or') {
    if (args.length < 2) throw new BashCompileError(`${name} requires at least two arguments`);
    const operator = lower === 'and' ? ' && ' : ' || ';
    return args.map((arg) => asPredicate(compile(arg, options))).join(operator);
  }
  if (lower === 'not') return `[ ${compile(args[0] as ExprNode, options)} != True ]`;
  if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(lower)) {
    const left = compile(args[0] as ExprNode, options);
    const right = compile(args[1] as ExprNode, options);
    const operator = lower === 'eq' ? '=' : lower === 'ne' ? '!=' : `-${lower}`;
    return `[ "${left}" ${operator} ${right} ]`;
  }
  const status = options.statusFunctions?.[lower];
  if (status !== undefined)
    return `${status} ${args.map((arg) => quote(compile(arg, options))).join(' ')}`.trim();
  if (
    [
      'format',
      'join',
      'split',
      'replace',
      'lower',
      'upper',
      'trim',
      'length',
      'coalesce',
      'iif',
      'converttojson',
    ].includes(lower)
  ) {
    return `azdo_expr_${lower} ${args.map((arg) => quote(compile(arg, options))).join(' ')}`;
  }
  throw new BashCompileError(`unsupported shell function '${name}'`);
}

function asPredicate(expression: string): string {
  return expression.startsWith('[ ') ? expression : `[ ${expression} = True ]`;
}

/** Compile an already-parsed Azure expression into dependency-free Bash. */
export function compileBash(node: ExprNode, options: BashCompileOptions = {}): string {
  return compile(node, options);
}

/** Runtime helpers consumed by generated expressions; emitted once per generated project. */
export const BASH_EXPR_HELPERS = `# Generated expression helpers (C-E02-131)\nazdo_expr_bool() { [ "$1" = True ] && printf True || printf False; }\n`;
