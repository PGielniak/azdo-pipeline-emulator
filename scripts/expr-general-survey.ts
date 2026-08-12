// E02-S03-T04 grounding: general-function values, arities, and ambiguous edge cases.
// Run: node scripts/expr-general-survey.ts [probe-name]
// Output: research/experiments/E02-general/<probe-name>.md (redacted request/response)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-general');

const compile = (name: string, expression: string, asserts: string, parameters = ''): Probe => ({
  name,
  asserts: `Compile-time expression: \`${expression}\`. ${asserts}`,
  yaml: `${parameters}variables:\n  probe: \${{ ${expression} }}\nsteps:\n- script: echo done\n`,
});

const runtime = (name: string, expression: string, asserts: string): Probe => ({
  name,
  asserts: `Runtime variable expression: \`${expression}\`. ${asserts}`,
  yaml: `variables:\n  probe: $[ ${expression} ]\nsteps:\n- script: echo done\n`,
});

const condition = (name: string, expression: string, asserts: string): Probe => ({
  name,
  asserts: `Job condition: \`${expression}\`. ${asserts}`,
  yaml: `jobs:\n- job: Probe\n  condition: ${expression}\n  steps:\n  - script: echo done\n`,
});

const ARRAY = `parameters:\n- name: items\n  type: object\n  default: [Alpha, '', 2]\n`;
const OBJECT = `parameters:\n- name: value\n  type: object\n  default:\n    alpha: one\n    nested: [two, 3]\n`;

const PROBES: readonly Probe[] = [
  compile(
    'starts-ends-coercion',
    "and(startsWith(12345, '123'), endsWith('AbCdE', 'DE'))",
    'Settles String conversion and ignore-case matching.',
  ),
  compile(
    'xor-values',
    "format('{0}|{1}|{2}|{3}', xor(true, false), xor(false, true), xor(true, true), xor(false, false))",
    'Covers the complete Boolean truth table.',
  ),
  compile(
    'format-basic-reuse',
    "format('{1}-{0}-{1}', 'A', 'B')",
    'Settles index reuse and out-of-order placeholders.',
  ),
  compile(
    'format-brace-escape',
    "format('{{{0}}} {{ and }}', 'x')",
    'Settles doubled-brace escaping around a placeholder.',
  ),
  compile(
    'format-missing-index',
    "format('{1}', 'only')",
    'Settles an out-of-range placeholder index.',
  ),
  compile(
    'format-unclosed-brace',
    "format('{0', 'x')",
    'Settles malformed format-string behavior.',
  ),
  compile(
    'join-array',
    "join(';', parameters.items)",
    'Settles scalar conversion and complex/empty elements.',
    ARRAY,
  ),
  compile('join-non-array', "join('-', 12)", 'Settles the documented non-array fallback.'),
  compile(
    'split-delimiter-chars',
    "join('|', split('a,b;c,,', ',;'))",
    'Settles whether the delimiter is a string or a set of characters and preservation of empty fields.',
  ),
  compile(
    'split-empty-delimiter',
    "join('|', split('abc', ''))",
    'Settles empty-delimiter behavior.',
  ),
  compile('replace-casing', "replace('AaA', 'a', 'x')", 'Settles replacement casing.'),
  compile('replace-empty-old', "replace('abc', '', 'x')", 'Settles empty search-text behavior.'),
  compile(
    'case-conversion',
    "format('{0}|{1}', lower('ÄBC'), upper('äbc'))",
    'Confirms case conversion on non-ASCII text.',
  ),
  compile(
    'trim-whitespace',
    "trim(' \\tvalue  ')",
    'Settles tabs and non-breaking-space trimming.',
  ),
  compile(
    'length-values',
    "format('{0}|{1}', length('fabrikam'), length(parameters.items))",
    'Covers String and Array lengths.',
    ARRAY,
  ),
  compile(
    'length-object',
    'length(parameters.value)',
    'Settles behavior for an Object value.',
    OBJECT,
  ),
  compile(
    'coalesce-values',
    "format('{0}|{1}|{2}', coalesce('', 'x'), coalesce(false, 'x'), coalesce(0, 'x'))",
    'Settles empty-only skipping versus other falsey values.',
  ),
  compile(
    'coalesce-short-circuit',
    "coalesce('hit', lt(1, 'bad'))",
    'Settles left-to-right short-circuiting.',
  ),
  compile('coalesce-all-empty', "coalesce('', variables.missing)", 'Settles the no-value result.'),
  compile(
    'iif-values',
    "format('{0}|{1}', iif(true, 'yes', 'no'), iif(false, 'yes', 'no'))",
    'Covers both branches.',
  ),
  compile('iif-one-arg', 'iif(true)', 'Checks the documented but suspicious minimum arity of one.'),
  compile('iif-two-args', "iif(true, 'yes')", 'Checks two-argument arity.'),
  compile(
    'iif-lazy',
    "iif(true, 'yes', lt(1, 'bad'))",
    'Settles whether the unselected branch is evaluated.',
  ),
  compile(
    'json-object',
    'convertToJson(parameters.value)',
    'Captures exact Object/Array JSON formatting.',
    OBJECT,
  ),
  compile(
    'json-primitive',
    "convertToJson('text')",
    'Settles whether conversion accepts primitive values.',
  ),
  runtime(
    'counter-two-args',
    "counter('prefix', 7)",
    'Confirms the legal runtime-variable placement and arity.',
  ),
  runtime('counter-one-arg', "counter('prefix')", 'Checks the lower arity bound.'),
  runtime('counter-three-args', "counter('prefix', 7, 1)", 'Checks the upper arity bound.'),
  compile(
    'counter-compile-time',
    "counter('prefix', 7)",
    'Confirms counter is absent from the compile-time table.',
  ),
  condition(
    'counter-condition',
    "counter('prefix', 7)",
    'Confirms counter is forbidden in conditions.',
  ),
];

await runProbes(PROBES, OUT_DIR);
