// E02-S01-T01 grounding — what grammar does the *service* actually accept?
//
// The open reference for the DistributedTask expression engine is `actions/runner`'s
// `src/Sdk/DTExpressions2` (C-E00-012/013), but that fork is the **GitHub Actions** dialect: its
// lexer accepts `==`/`&&`/`||`/`!`, compares `true`/`false`/`null` *ordinally* (so `True` is not a
// boolean there), and registers Actions' function set (`case`, `toJson`, `fromJson`). Azure
// Pipelines documents none of that. Mirroring the fork would therefore build a tokenizer that
// over-accepts — an invalid pipeline that parses locally and is rejected by the service is the one
// failure mode that survives into every later E02 task.
//
// So every literal/operator/access rule the tokenizer encodes is decided here, by submitting one
// expression at a time to the preview endpoint and recording accept-with-value or reject-with-
// message. Per D6 the oracle outranks the fork on divergence.
//
// Run: node scripts/expr-grammar-survey.ts            (all probes)
//      node scripts/expr-grammar-survey.ts <id>       (one probe)
// Output: research/experiments/E02-grammar/survey.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { parse } from 'yaml';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-grammar');

interface Probe {
  readonly id: string;
  /** Group heading in the survey table. */
  readonly group: string;
  /** The expression text, submitted inside the wrapper below. */
  readonly expr: string;
  /** What the answer decides in `lexer.ts`/`parser.ts`. */
  readonly decides: string;
  /** Runtime (`$[ ]`) instead of compile-time (`${{ }}`). */
  readonly runtime?: boolean;
}

/**
 * Context for the access probes. Keys chosen to exercise the documented property-name rule
 * ("start with a-Z or _, followed by a-Z, 0-9, or _") and its complement.
 */
const PARAMETERS = `parameters:
- name: obj
  type: object
  default:
    a: 1
    b_c: two
    _lead: three
    9num: four
    dotted.name: five
    list:
    - id: 7
      n: x
    - id: 8
      n: y
`;

function pipeline(probe: Probe): string {
  const open = probe.runtime === true ? '$[' : '${{';
  const close = probe.runtime === true ? ']' : '}}';
  return `${PARAMETERS}variables:
  probe: ${open} ${probe.expr} ${close}
steps:
- script: echo done
`;
}

const PROBES: readonly Probe[] = [
  // ---- Literals -----------------------------------------------------------------------------
  {
    id: 'bool-lower',
    group: 'Literals',
    expr: 'true',
    decides: 'baseline boolean spelling',
  },
  {
    id: 'bool-title',
    group: 'Literals',
    expr: 'True',
    decides:
      'docs say boolean literals are case-insensitive; the fork compares Ordinal, i.e. `True` would be a named value there',
  },
  { id: 'bool-upper', group: 'Literals', expr: 'TRUE', decides: 'upper bound of the same rule' },
  { id: 'null-lower', group: 'Literals', expr: 'null', decides: 'null keyword' },
  { id: 'null-upper', group: 'Literals', expr: 'NULL', decides: 'case folding of `null`' },
  { id: 'num-int', group: 'Literals', expr: '42', decides: 'integer literal + output formatting' },
  { id: 'num-neg', group: 'Literals', expr: '-1.2', decides: 'leading `-` is part of the number' },
  {
    id: 'num-lead-dot',
    group: 'Literals',
    expr: '.5',
    decides: 'docs: a number "Starts with -, ., or 0 through 9"',
  },
  {
    id: 'num-plus',
    group: 'Literals',
    expr: '+1',
    decides: 'the fork lexes a leading `+` as a number; the docs do not list it',
  },
  { id: 'num-exp', group: 'Literals', expr: '1e3', decides: 'scientific notation accepted?' },
  { id: 'num-hex', group: 'Literals', expr: '0x1F', decides: 'hex accepted?' },
  {
    id: 'num-trail-dot',
    group: 'Literals',
    expr: '1.',
    decides: 'trailing separator with no fraction',
  },
  {
    id: 'ver-two',
    group: 'Literals',
    expr: '1.2',
    decides:
      'number or Version? docs say a Version has "two or three period characters", so 1.2 should be a Number',
  },
  { id: 'ver-three', group: 'Literals', expr: '1.2.3', decides: 'three-segment version literal' },
  { id: 'ver-four', group: 'Literals', expr: '1.2.3.4', decides: 'four-segment version literal' },
  {
    id: 'ver-five',
    group: 'Literals',
    expr: '1.2.3.4.5',
    decides: 'segment ceiling — five segments must fail if the lexer stops at four',
  },
  {
    id: 'neg-version',
    group: 'Literals',
    expr: '-1.2.3',
    decides: 'a Version cannot carry a sign — is the whole token rejected?',
  },
  {
    id: 'num-double-dot',
    group: 'Literals',
    expr: '1..2',
    decides: 'empty segment: the scan keeps `.` inside the token, so this must fail to resolve',
  },
  { id: 'nan', group: 'Literals', expr: 'NaN', decides: 'the fork lexes NaN as a Number' },
  {
    id: 'infinity',
    group: 'Literals',
    expr: 'Infinity',
    decides: 'the fork lexes Infinity as a Number',
  },
  { id: 'str-plain', group: 'Literals', expr: "'a b c'", decides: 'single-quoted string' },
  {
    id: 'str-escape',
    group: 'Literals',
    expr: "'It''s OK'",
    decides: "the documented '' escape, and whether the result carries one quote",
  },
  {
    id: 'str-double',
    group: 'Literals',
    expr: '"double"',
    decides: 'double quotes must be a lexer error — docs say strings "Must be single-quoted"',
  },
  {
    id: 'str-unclosed',
    group: 'Literals',
    expr: "'unclosed",
    decides: 'unterminated string error shape',
  },
  {
    id: 'ver-vs-num',
    group: 'Literals',
    expr: 'gt(1.10, 1.9)',
    decides:
      'discriminates the two-segment case: as Numbers 1.10 < 1.9 → False, as Versions 1.10 > 1.9 → True',
  },
  {
    id: 'ver-vs-num-control',
    group: 'Literals',
    expr: 'gt(1.10.0, 1.9.0)',
    decides: 'control: three segments can only be a Version, so this must be True',
  },
  // ---- Operator syntax ----------------------------------------------------------------------
  {
    id: 'op-eq',
    group: 'Operators',
    expr: '1 == 1',
    decides:
      'THE structural question: infix operators mean a precedence-climbing parser, their absence means primary + postfix chain only',
  },
  { id: 'op-ne', group: 'Operators', expr: '1 != 2', decides: 'same, `!=`' },
  { id: 'op-and', group: 'Operators', expr: 'true && false', decides: 'same, `&&`' },
  { id: 'op-or', group: 'Operators', expr: 'true || false', decides: 'same, `||`' },
  { id: 'op-not', group: 'Operators', expr: '!true', decides: 'same, prefix `!`' },
  { id: 'op-gt', group: 'Operators', expr: '1 > 0', decides: 'same, `>`' },
  { id: 'op-lt', group: 'Operators', expr: '1 < 2', decides: 'same, `<` (symmetry with `>`)' },
  {
    id: 'op-amp-single',
    group: 'Operators',
    expr: 'true & false',
    decides: 'is a lone `&` a symbol too, or does it fall into the keyword scan?',
  },
  {
    id: 'op-pipe-single',
    group: 'Operators',
    expr: 'true | false',
    decides: 'same question for `|`',
  },
  {
    id: 'op-bang-alone',
    group: 'Operators',
    expr: '! true',
    decides:
      'reconciles `!=` reporting "Unexpected symbol" against `!true` reporting "Unrecognized value" — i.e. whether `!` is a symbol char on its own',
  },
  {
    id: 'op-group',
    group: 'Operators',
    expr: '(true)',
    decides: 'is `(` legal as logical grouping outside a function call?',
  },
  {
    id: 'op-func-control',
    group: 'Operators',
    expr: 'eq(1, 1)',
    decides: 'control: the documented function form must be accepted in the same position',
  },
  // ---- Access -------------------------------------------------------------------------------
  {
    id: 'acc-property',
    group: 'Access',
    expr: 'parameters.obj.a',
    decides: 'property dereference',
  },
  {
    id: 'acc-underscore',
    group: 'Access',
    expr: 'parameters.obj.b_c',
    decides: 'documented identifier charset (letters, digits, underscore)',
  },
  {
    id: 'acc-lead-underscore',
    group: 'Access',
    expr: 'parameters.obj._lead',
    decides: 'leading underscore, documented as legal',
  },
  {
    id: 'acc-lead-digit',
    group: 'Access',
    expr: 'parameters.obj.9num',
    decides: 'property name starting with a digit — must be rejected if the charset rule holds',
  },
  {
    id: 'acc-index-string',
    group: 'Access',
    expr: "parameters.obj['dotted.name']",
    decides: 'index syntax reaches names the property syntax cannot spell',
  },
  {
    id: 'acc-index-number',
    group: 'Access',
    expr: 'parameters.obj.list[0].id',
    decides: 'numeric index into an array, then a property off the result',
  },
  {
    id: 'acc-index-expr',
    group: 'Access',
    expr: 'parameters.obj.list[parameters.obj.a].id',
    decides: 'is an arbitrary expression legal inside `[ ]`, or only a literal?',
  },
  {
    id: 'acc-index-named',
    group: 'Access',
    expr: "parameters['obj'].a",
    decides: 'index directly off a named value',
  },
  {
    id: 'acc-missing',
    group: 'Access',
    expr: 'parameters.obj.nosuch',
    decides: 'dictionary miss → Null (parse-time legal)',
  },
  {
    id: 'acc-missing-chain',
    group: 'Access',
    expr: 'parameters.obj.nosuch.deeper',
    decides: 'chaining off Null — the documented safe-navigation behaviour',
  },
  {
    id: 'acc-wildcard-dot',
    group: 'Access',
    expr: 'convertToJson(parameters.obj.list.*.id)',
    decides: 'filtered array via `.*.` — documented for ADO, and a distinct AST node',
  },
  {
    id: 'acc-wildcard-index',
    group: 'Access',
    expr: 'convertToJson(parameters.obj.list[*].id)',
    decides: 'the `[*]` spelling of the same thing (the fork lexes `*` after `[` too)',
  },
  {
    id: 'acc-func-index',
    group: 'Access',
    expr: "split('a,b', ',')[1]",
    decides: 'postfix index applied to a function result',
  },
  {
    id: 'acc-named-case',
    group: 'Access',
    expr: 'PARAMETERS.obj.a',
    decides: 'is the context (named-value) name case-insensitive like the function name?',
  },
  {
    id: 'acc-named-bare',
    group: 'Access',
    expr: 'convertToJson(parameters)',
    decides: 'a named value with no dereference is a complete expression on its own',
  },
  // ---- Parse-time validation ------------------------------------------------------------------
  {
    id: 'val-func-case',
    group: 'Validation',
    expr: 'EQ(1, 1)',
    decides: 'are function names case-insensitive? (the fork uses an OrdinalIgnoreCase map)',
  },
  {
    id: 'val-func-space',
    group: 'Validation',
    expr: 'eq (1, 1)',
    decides: 'whitespace between a function name and `(` — the fork looks ahead past it',
  },
  {
    id: 'val-func-unknown',
    group: 'Validation',
    expr: 'nosuchfunc(1)',
    decides: 'unrecognized function is a *parse-time* error in the fork — is it here?',
  },
  {
    id: 'val-func-arity',
    group: 'Validation',
    expr: 'eq(1)',
    decides: 'arity is validated at parse time in the fork (TooFewParameters)',
  },
  {
    id: 'val-func-too-many',
    group: 'Validation',
    expr: 'eq(1, 2, 3)',
    decides: 'where the too-many-arguments error is positioned (the arity check has two sides)',
  },
  {
    id: 'val-empty-index',
    group: 'Validation',
    expr: 'parameters.obj.list[]',
    decides: 'an index with nothing in it',
  },
  {
    id: 'val-trailing-dot',
    group: 'Validation',
    expr: 'parameters.obj.',
    decides: 'expression ending on a dereference — the unexpected-end case',
  },
  {
    id: 'val-unclosed-call',
    group: 'Validation',
    expr: 'eq(1,',
    decides: 'unclosed call: does the expression parser see it, or the template scanner first?',
  },
  {
    id: 'val-depth-50',
    group: 'Validation',
    expr: `${'not('.repeat(50)}false${')'.repeat(50)}`,
    decides: 'exact ceiling: 50 nested calls — accepted or not?',
  },
  {
    id: 'val-depth-49',
    group: 'Validation',
    expr: `${'not('.repeat(49)}false${')'.repeat(49)}`,
    decides:
      '49 nested calls + the leaf = depth 50 exactly; if this passes and 50 fails, the rule is "error when depth > 50, counting the leaf"',
  },
  {
    id: 'val-depth-property',
    group: 'Validation',
    expr: `parameters.obj${'.a'.repeat(60)}`,
    decides:
      'does the depth ceiling count member access too, or only function arguments? (missing members are Null, so nothing else can fail here)',
  },
  {
    id: 'val-depth-index',
    group: 'Validation',
    expr: `parameters.obj${"['a']".repeat(60)}`,
    decides: 'same question for index access',
  },
  {
    id: 'val-depth-51',
    group: 'Validation',
    expr: `${'not('.repeat(51)}false${')'.repeat(51)}`,
    decides: 'the other side of the boundary, so the constant is not an off-by-one guess',
  },
  {
    id: 'val-named-unknown',
    group: 'Validation',
    expr: 'nosuchcontext.a',
    decides: 'unrecognized named value — parse-time error, and what it is called',
  },
  {
    id: 'val-trailing',
    group: 'Validation',
    expr: '1 2',
    decides: 'trailing garbage after a complete expression',
  },
  {
    id: 'val-empty',
    group: 'Validation',
    expr: '',
    decides: 'the empty expression',
  },
  {
    id: 'val-depth',
    group: 'Validation',
    expr: `${'not('.repeat(60)}false${')'.repeat(60)}`,
    decides: 'nesting ceiling — the fork caps at MaxDepth = 50',
  },
  {
    id: 'val-depth-control',
    group: 'Validation',
    expr: `${'not('.repeat(10)}false${')'.repeat(10)}`,
    decides: 'control for the ceiling: 10 deep must be accepted',
  },
  // ---- Runtime ($[ ]) -------------------------------------------------------------------------
  {
    id: 'rt-func',
    group: 'Runtime',
    expr: 'eq(1, 1)',
    runtime: true,
    decides: 'is a runtime expression parsed at preview time at all, or passed through verbatim?',
  },
  {
    id: 'rt-op',
    group: 'Runtime',
    expr: '1 == 1',
    runtime: true,
    decides: 'if it is parsed, the runtime parser is a second reachable grammar and must agree',
  },
  {
    id: 'rt-garbage',
    group: 'Runtime',
    expr: "'unclosed",
    runtime: true,
    decides: 'control: does *any* malformed runtime expression get rejected at preview time?',
  },
];

/** The value the service put in `variables.probe`, whatever shape `variables:` came back as. */
function probeValue(finalYaml: string): string {
  const doc = parse(finalYaml) as { variables?: unknown };
  const vars = doc.variables;
  if (Array.isArray(vars)) {
    for (const entry of vars) {
      const row = entry as { name?: unknown; value?: unknown };
      if (row.name === 'probe') return row.value === undefined ? '(no value)' : String(row.value);
    }
  } else if (vars !== null && typeof vars === 'object') {
    const value = (vars as Record<string, unknown>).probe;
    if (value !== undefined) return String(value);
  }
  return '(probe variable absent)';
}

/** One-line cell: never let a service message break the table. */
const cell = (text: string): string =>
  text
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ⏎ ')
    .trim();

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const only = process.argv[2];
const selected = only === undefined ? PROBES : PROBES.filter((p) => p.id === only);
if (selected.length === 0) {
  throw new Error(`no probe named ${only}; known: ${PROBES.map((p) => p.id).join(', ')}`);
}

await mkdir(OUT_DIR, { recursive: true });

interface Row extends Probe {
  readonly verdict: string;
  readonly detail: string;
}

const rows: Row[] = [];
for (const probe of selected) {
  const outcome = await preview(config, { yamlOverride: pipeline(probe) });
  const verdict =
    outcome.kind === 'expanded'
      ? 'accepted'
      : outcome.kind === 'rejected'
        ? `rejected (${outcome.status})`
        : outcome.kind;
  const detail =
    outcome.kind === 'expanded'
      ? probeValue(outcome.finalYaml)
      : outcome.kind === 'rejected'
        ? redact(outcome.message, config)
        : JSON.stringify(outcome);
  rows.push({ ...probe, verdict, detail });
  console.log(`${probe.id.padEnd(20)} ${verdict.padEnd(15)} ${cell(detail).slice(0, 90)}`);
}

const groups = [...new Set(rows.map((r) => r.group))];
const body = [
  '# E02-S01-T01 — expression grammar survey (live service)',
  '',
  'Each row is one live `preview` call: the expression below submitted as',
  '`variables:\\n  probe: ${{ <expr> }}` (or `$[ <expr> ]` for the Runtime group) on top of a fixed',
  '`parameters.obj` object. **accepted** means HTTP 200 and the value column is what the service',
  'put in `variables.probe`; **rejected** shows the service message verbatim (redacted).',
  '',
  'Regenerate with `pnpm expr-grammar-survey`. Source of truth for the claims in',
  '`research/E02-expressions.md`; where a row contradicts `actions/runner`,',
  'the service wins (D6, C-E00-013).',
  '',
  `Context object: \`{a: 1, b_c: two, _lead: three, 9num: four, 'dotted.name': five, list: [{id: 7, n: x}, {id: 8, n: y}]}\``,
  '',
];
for (const group of groups) {
  body.push(
    `## ${group}`,
    '',
    '| id | expression | outcome | value / message | decides |',
    '|---|---|---|---|---|',
  );
  for (const row of rows.filter((r) => r.group === group)) {
    body.push(
      `| \`${row.id}\` | \`${cell(row.expr) || '(empty)'}\` | ${row.verdict} | ${cell(row.detail)} | ${cell(row.decides)} |`,
    );
  }
  body.push('');
}

await writeFile(path.join(OUT_DIR, 'survey.md'), redact(body.join('\n'), config), 'utf8');
console.log(`\n-> ${path.join(OUT_DIR, 'survey.md')}`);
