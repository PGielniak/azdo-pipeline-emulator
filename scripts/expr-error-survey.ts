// E02-S01-T02 grounding — what does a *rejected* expression look like coming back from the
// service, and what exactly do the numbers in it point at?
//
// E02-S01-T01 already established the accept/reject grammar (74 probes,
// research/experiments/E02-grammar/survey.md). What it did **not** settle is everything the
// renderer needs:
//
//   * `Located at position N` — N counted over *what* text? Every grammar probe wrote the
//     expression as `${{ <expr> }}`, one space each side, so "position relative to the trimmed
//     expression" and "position relative to the text after `${{`" are indistinguishable in all 74
//     rows. One probe with extra leading whitespace separates them, and the answer decides the
//     arithmetic in every other case (`ws-*`).
//   * `(Line: L, Col: C)` — the same rows all have the scalar value starting exactly where `${{`
//     starts, so scalar-start and delimiter-start are also indistinguishable, and nothing says
//     whether C tracks the offending token at all (`embed-*`, `deep-indent`, `block-scalar`).
//   * whether the echoed expression is truncated (`long-echo`), how a quote inside the offending
//     text is escaped (`quote-*`), whether one document yields one error or a list (`multi-*`),
//     and the runtime (`$[ ]`) rendering of a non-operator error (`rt-*`).
//   * the `!` family, which E02-S01-T01 left as an open note handed to this task.
//
// The `grammar-*` group re-submits every rejecting row of the earlier survey through this script,
// so `cases.json` — the machine-readable parity table `packages/engine/test/expr/errors.test.ts`
// runs against — is generated wholly by one live run and covers the six error kinds known when
// E02-S01-T02 ran. E02-S01-T03's seventh kind has a dedicated oracle pair.
//
// Run: node scripts/expr-error-survey.ts            (all probes)
//      node scripts/expr-error-survey.ts <id>       (one probe — **rewrites both output files with
//                                                    that row alone**; commit only a full run, and
//                                                    the corpus-size guard in errors.test.ts fails
//                                                    if a partial one is)
// Output: research/experiments/E02-errors/{survey.md,cases.json} (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-errors');

/** Same context object as the grammar survey, so `grammar-*` rows are directly comparable. */
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

const TAIL = `steps:
- script: echo done
`;

/**
 * A wrapper decides *where in the document* the expression sits. `inner` is the text between the
 * delimiters, verbatim — including any whitespace the probe deliberately adds, because that is
 * exactly what the `ws-*` probes are asking about.
 */
type Wrapper = (inner: string) => string;

const WRAPPERS = {
  /** Minimal document; `${{` at Line 2, Col 10. */
  plain: (inner) => `variables:\n  probe: \${{${inner}}}\n${TAIL}`,
  /** The grammar survey's wrapper: `${{` at Line 16, Col 10 — positions comparable row for row. */
  params: (inner) => `${PARAMETERS}variables:\n  probe: \${{${inner}}}\n${TAIL}`,
  /** Runtime expression, same slot. */
  runtime: (inner) => `variables:\n  probe: $[${inner}]\n${TAIL}`,
  /** Expression embedded mid-scalar: scalar value starts at Col 10, `${{` at Col 17. */
  embedded: (inner) => `variables:\n  probe: prefix \${{${inner}}} suffix\n${TAIL}`,
  /** Two expressions in one scalar, the *second* one bad: does the position restart? */
  second: (inner) => `variables:\n  probe: \${{ 'ok' }} then \${{${inner}}}\n${TAIL}`,
  /** Two bad scalars: one message or a list? The probe's own expression comes first. */
  twoScalars: (inner) => `variables:\n  a: \${{${inner}}}\n  b: \${{ NULL }}\n${TAIL}`,
  /** Inside a block scalar, three lines below where the scalar starts. */
  block: (inner) =>
    `steps:\n- script: |\n    echo one\n    echo two\n    echo \${{${inner}}}\n    echo three\n`,
  /** A step field other than a variable value, indented deeper. */
  deepIndent: (inner) =>
    `jobs:\n- job: A\n  steps:\n  - script: echo hi\n    displayName: \${{${inner}}}\n`,
  /** `condition:` — the field expressions are documented in, at Col 14. */
  condition: (inner) => `steps:\n- script: echo hi\n  condition: \${{${inner}}}\n`,
} satisfies Record<string, Wrapper>;

type WrapperName = keyof typeof WRAPPERS;

interface Probe {
  readonly id: string;
  readonly group: string;
  /** Text between the delimiters, verbatim. */
  readonly inner: string;
  readonly wrapper: WrapperName;
  /** What the answer decides in `errors.ts`. */
  readonly decides: string;
}

const grammar = (id: string, expr: string, decides: string): Probe => ({
  id: `grammar-${id}`,
  group: 'Grammar rows (re-probe)',
  inner: ` ${expr} `,
  wrapper: 'params',
  decides,
});

const LONG_STRING = 'a'.repeat(380);

const PROBES: readonly Probe[] = [
  // ---- Position semantics ---------------------------------------------------------------------
  {
    id: 'ws-baseline',
    group: 'Position',
    inner: ' null ',
    wrapper: 'plain',
    decides: 'baseline: one space each side, the shape all 74 grammar probes used',
  },
  {
    id: 'ws-leading',
    group: 'Position',
    inner: '    null ',
    wrapper: 'plain',
    decides:
      'THE arithmetic question: position 1 means the service trims before parsing, position 5 means it counts from the character after `${{`',
  },
  {
    id: 'ws-leading-inner',
    group: 'Position',
    inner: '    1 == 1 ',
    wrapper: 'plain',
    decides:
      'the same question with the error away from the start: position 3 (trimmed) vs 7 (untrimmed) — and what the echoed expression contains',
  },
  {
    id: 'ws-newline',
    group: 'Position',
    inner: ' null\n    ',
    wrapper: 'plain',
    decides:
      'a folded newline inside the delimiters: does the echo carry it, and does Line move? (YAML folds it to a space before the template scanner sees it)',
  },
  {
    id: 'embed-mid-scalar',
    group: 'Position',
    inner: ' null ',
    wrapper: 'embedded',
    decides:
      'Col: scalar start (10) or `${{` (17)? and does the echo hold the expression or the whole scalar?',
  },
  {
    id: 'embed-second-expr',
    group: 'Position',
    inner: ' null ',
    wrapper: 'second',
    decides:
      'two expressions in one scalar, the second bad: does position restart per expression, and does Col move to the second `${{`?',
  },
  {
    id: 'deep-indent',
    group: 'Position',
    inner: ' null ',
    wrapper: 'deepIndent',
    decides: 'Col at a deeper indentation (`displayName:` at Col 18) — confirms Col is not fixed',
  },
  {
    id: 'condition-field',
    group: 'Position',
    inner: ' null ',
    wrapper: 'condition',
    decides: 'the field expressions are documented in; Col 14',
  },
  {
    id: 'block-scalar',
    group: 'Position',
    inner: ' null ',
    wrapper: 'block',
    decides:
      'expression three lines inside a block scalar: does Line point at the real line (5) or at the scalar start (2)?',
  },
  // ---- Echo rendering -------------------------------------------------------------------------
  {
    id: 'long-echo',
    group: 'Echo',
    inner: ` eq('${LONG_STRING}', 'x') 2 `,
    decides:
      'is the echoed expression truncated past some length? our renderer must do whatever this does',
    wrapper: 'plain',
  },
  {
    id: 'quote-in-raw',
    group: 'Echo',
    inner: ` "a'b" `,
    wrapper: 'plain',
    decides:
      "the offending token itself contains a single quote — is it escaped in the message (`''`) or emitted raw?",
  },
  {
    id: 'quote-in-echo',
    group: 'Echo',
    inner: " eq('it''s', 1) 2 ",
    wrapper: 'plain',
    decides:
      'the echoed *expression* contains the `` escape: is the echo the raw source text or a re-print of the parsed value?',
  },
  {
    id: 'echo-cap-control',
    group: 'Echo',
    inner: ` eq('${'a'.repeat(340)}', 'x') 2 `,
    wrapper: 'plain',
    decides:
      'control for `long-echo`: a message comfortably under the cap must come back whole, fwlink and all',
  },
  {
    id: 'echo-cap-runtime',
    group: 'Echo',
    inner: ` eq('${LONG_STRING}', 'x') 2 `,
    wrapper: 'runtime',
    decides:
      'the runtime prefix is 57 chars against the compile-time 41: if the cap counts the prefix, the same expression is cut 16 characters earlier here',
  },
  {
    id: 'multi-bad-scalars',
    group: 'Echo',
    inner: ' null ',
    wrapper: 'twoScalars',
    decides:
      'two independently bad expressions in one document: one message or a list? (decides whether our renderer is singular)',
  },
  // ---- The `!` family (E02-S01-T01 handed this note to T02) -------------------------------------
  {
    id: 'bang-alone',
    group: 'Bang',
    inner: ' ! ',
    wrapper: 'plain',
    decides: 'a lone `!` with nothing after it — is `!` a token the lexer knows?',
  },
  {
    id: 'bang-after-value',
    group: 'Bang',
    inner: ' 1 ! ',
    wrapper: 'plain',
    decides: 'if `!` is its own token, this reports it as an unexpected symbol at position 3',
  },
  {
    id: 'bang-double',
    group: 'Bang',
    inner: ' !!true ',
    wrapper: 'plain',
    decides:
      'does the scan-to-boundary reading (`!!true` as one unrecognized value) or the symbol reading (`!` then `!true`) fit?',
  },
  {
    id: 'bang-tight',
    group: 'Bang',
    inner: ' !true ',
    wrapper: 'plain',
    decides: 're-probe of the row our tokenizer matches: one token scanned to the boundary',
  },
  {
    id: 'bang-spaced',
    group: 'Bang',
    inner: ' ! true ',
    wrapper: 'plain',
    decides:
      're-probe of the documented divergence: the service reports the operand, we report `!`',
  },
  {
    id: 'bang-eq',
    group: 'Bang',
    inner: ' !eq(1, 1) ',
    wrapper: 'plain',
    decides: '`!` immediately before a function name — where does the token boundary land?',
  },
  // ---- Which error wins when a document has two -------------------------------------------------
  // `bang-spaced` (`! true`) reports the *operand* at position 3, not the unresolvable `!` at
  // position 1 — the divergence E02-S01-T01 left open. Two models fit that single row: the parser
  // resolves names in a second pass (so any syntax error beats any value error), or it simply
  // reports the furthest position reached. These rows separate them: under "second pass" the name
  // errors below lose to the trailing symbol, under "furthest wins" they lose too — but
  // `nosuchfunc(1) 2` distinguishes it from "first error wins", which both models reject.
  {
    id: 'order-unrec-then-garbage',
    group: 'Ordering',
    inner: ' 1e3 2 ',
    wrapper: 'plain',
    decides:
      'an unresolvable value token followed by a leftover token: position 1 (reported where it was read) or 5 (deferred behind the syntax error)?',
  },
  {
    id: 'order-quote-then-garbage',
    group: 'Ordering',
    inner: ' "double" 2 ',
    wrapper: 'plain',
    decides:
      'is the eager class really "value-shaped text" or only "digit-led"? `1e3 2` is one row; if this reports at 9 the eager class is narrower than a single row suggests',
  },
  {
    id: 'order-plus-then-garbage',
    group: 'Ordering',
    inner: ' +1 2 ',
    wrapper: 'plain',
    decides: 'the other side of that boundary: a `+`-led token',
  },
  {
    id: 'order-hex-then-garbage',
    group: 'Ordering',
    inner: ' 0x1F 2 ',
    wrapper: 'plain',
    decides:
      'digit-led like `1e3`, so it should be eager — asserting the eager class is "the lexer started a number scan" rather than one row about exponents',
  },
  {
    id: 'order-negver-then-garbage',
    group: 'Ordering',
    inner: ' -1.2.3 2 ',
    wrapper: 'plain',
    decides:
      'the `-`-led case, the one the docs list as a number start *and* as a sign: eager with the digits, or keyword-shaped like `+1`?',
  },
  {
    id: 'order-name-then-garbage',
    group: 'Ordering',
    inner: ' nosuchcontext 2 ',
    wrapper: 'plain',
    decides: 'the same question for an unknown named value, whose error our parser raises eagerly',
  },
  {
    id: 'order-func-then-garbage',
    group: 'Ordering',
    inner: ' nosuchfunc(1) 2 ',
    wrapper: 'plain',
    decides: 'and for an unknown function name',
  },
  {
    id: 'order-arity-then-garbage',
    group: 'Ordering',
    inner: ' eq(1) 2 ',
    wrapper: 'plain',
    decides:
      'two syntax errors: the arity error at 5 and the leftover at 8 — which end of the text wins',
  },
  {
    id: 'order-bang-bang-spaced',
    group: 'Ordering',
    inner: ' ! ! ',
    wrapper: 'plain',
    decides: 'two unresolvable tokens, no valid operand anywhere',
  },
  // ---- Runtime ($[ ]) --------------------------------------------------------------------------
  {
    id: 'rt-arity',
    group: 'Runtime',
    inner: ' eq(1) ',
    wrapper: 'runtime',
    decides:
      'C-E02-015 saw the kind swap to `Unrecognized value` for an operator error — does it swap for an arity error too, or is the swap operator-specific?',
  },
  {
    id: 'rt-named-unknown',
    group: 'Runtime',
    inner: ' nosuchcontext.a ',
    wrapper: 'runtime',
    decides: 'an unrecognized named value at runtime: same kind as compile time?',
  },
  {
    id: 'rt-trailing-dot',
    group: 'Runtime',
    inner: ' variables. ',
    wrapper: 'runtime',
    decides: 'the sentence-shaped kinds at runtime — prefix only, or a different sentence?',
  },
  {
    id: 'rt-depth',
    group: 'Runtime',
    inner: ` ${'not('.repeat(51)}false${')'.repeat(51)} `,
    wrapper: 'runtime',
    decides: 'the position-less depth message at runtime',
  },
  // ---- Grammar rows, re-probed so cases.json is one self-contained live run ---------------------
  grammar('null-lower', 'null', 'unrecognized value, error at position 1'),
  grammar('null-upper', 'NULL', 'case folding preserved in the echo'),
  grammar('num-plus', '+1', 'unrecognized value'),
  grammar('num-exp', '1e3', 'unrecognized value'),
  grammar('num-hex', '0x1F', 'unrecognized value'),
  grammar('ver-five', '1.2.3.4.5', 'unrecognized value'),
  grammar('neg-version', '-1.2.3', 'unrecognized value'),
  grammar('num-double-dot', '1..2', 'unrecognized value'),
  grammar('nan', 'NaN', 'unrecognized value'),
  grammar('infinity', 'Infinity', 'unrecognized value'),
  grammar('str-double', '"double"', 'unrecognized value with quote-ish characters in the raw'),
  grammar('op-eq', '1 == 1', 'unexpected symbol at position 3'),
  grammar('op-ne', '1 != 2', 'unexpected symbol at position 3'),
  grammar('op-and', 'true && false', 'unexpected symbol at position 6'),
  grammar('op-or', 'true || false', 'unexpected symbol at position 6'),
  grammar('op-gt', '1 > 0', 'unexpected symbol at position 3'),
  grammar('op-lt', '1 < 2', 'unexpected symbol at position 3'),
  grammar('op-amp-single', 'true & false', 'unexpected symbol at position 6'),
  grammar('op-pipe-single', 'true | false', 'unexpected symbol at position 6'),
  grammar('op-group', '(true)', 'unexpected symbol at position 1'),
  grammar('acc-lead-digit', 'parameters.obj.9num', 'unexpected symbol at position 16'),
  grammar('val-func-unknown', 'nosuchfunc(1)', 'unrecognized value positioned at the name'),
  grammar('val-func-arity', 'eq(1)', 'unexpected symbol at the closing paren'),
  grammar('val-func-too-many', 'eq(1, 2, 3)', 'unexpected symbol at the separator'),
  grammar('val-empty-index', 'parameters.obj.list[]', 'unexpected symbol at the closing bracket'),
  grammar('val-trailing-dot', 'parameters.obj.', 'the dereference sentence, positioned at the dot'),
  grammar('val-unclosed-call', 'eq(1,', 'the unclosed-function sentence, positioned at the name'),
  grammar('val-named-unknown', 'nosuchcontext.a', 'unrecognized value at the context name'),
  grammar('val-trailing', '1 2', 'unexpected symbol at the leftover token'),
  grammar('val-empty', '', 'the bare "An expression was expected" — no position, no echo'),
  grammar(
    'val-depth-51',
    `${'not('.repeat(51)}false${')'.repeat(51)}`,
    'the depth message — no position, no echo, but a fwlink',
  ),
  grammar('str-unclosed', "'unclosed", 'the template scanner error, not an expression error'),
];

/** 1-based line/column of `offset` in `text`. */
function lineCol(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const col = offset - (before.lastIndexOf('\n') + 1) + 1;
  return { line, col };
}

/** One-line cell: never let a service message break the table. */
const cell = (text: string): string =>
  text
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ⏎ ')
    .trim();

const clip = (text: string, max = 120): string =>
  text.length <= max ? text : `${text.slice(0, max)}… (${text.length} chars)`;

interface Case {
  readonly id: string;
  readonly group: string;
  readonly wrapper: WrapperName;
  readonly mode: 'compile' | 'runtime';
  /** Verbatim text between the delimiters — what the test feeds our parser. */
  readonly inner: string;
  readonly yaml: string;
  /** 1-based position of the opening delimiter in `yaml`. */
  readonly openLine: number;
  readonly openCol: number;
  readonly outcome: string;
  readonly status: number | undefined;
  /** The service's message, verbatim and redacted; absent when the probe was accepted. */
  readonly message: string | undefined;
  readonly decides: string;
}

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const only = process.argv[2];
const selected = only === undefined ? PROBES : PROBES.filter((p) => p.id === only);
if (selected.length === 0) {
  throw new Error(`no probe named ${only}; known: ${PROBES.map((p) => p.id).join(', ')}`);
}

await mkdir(OUT_DIR, { recursive: true });

const cases: Case[] = [];
for (const probe of selected) {
  const yaml = WRAPPERS[probe.wrapper](probe.inner);
  const mode = probe.wrapper === 'runtime' ? 'runtime' : 'compile';
  const open = yaml.indexOf(mode === 'runtime' ? `$[${probe.inner}]` : `\${{${probe.inner}}}`);
  const { line, col } = lineCol(yaml, open);
  const outcome = await preview(config, { yamlOverride: yaml });
  const message =
    outcome.kind === 'rejected'
      ? redact(outcome.message, config)
      : outcome.kind === 'expanded'
        ? undefined
        : redact(JSON.stringify(outcome), config);
  cases.push({
    id: probe.id,
    group: probe.group,
    wrapper: probe.wrapper,
    mode,
    inner: probe.inner,
    yaml,
    openLine: line,
    openCol: col,
    outcome: outcome.kind,
    status: 'status' in outcome ? outcome.status : undefined,
    message,
    decides: probe.decides,
  });
  console.log(
    `${probe.id.padEnd(22)} ${outcome.kind.padEnd(10)} ${cell(message ?? '(accepted)').slice(0, 100)}`,
  );
}

const groups = [...new Set(cases.map((c) => c.group))];
const body = [
  '# E02-S01-T02 — expression parse-error survey (live service)',
  '',
  'Each row is one live `preview` call. **inner** is the text between the delimiters, verbatim —',
  'leading/trailing spaces are part of the probe, since half of these rows exist to find out what',
  'the service counts positions over. **expr at** is the 1-based line/column of the opening `${{`',
  '(or `$[`) in the submitted document, computed locally, so it can be compared against the',
  '`(Line: L, Col: C)` the service reports.',
  '',
  'Regenerate with `pnpm expr-error-survey`. `cases.json` beside this file is the same data',
  'machine-readable; `packages/engine/test/expr/errors.test.ts` parses each service message into',
  '`{kind, raw, position, echo}` and compares it field-by-field against our renderer, so a change on',
  'either side is a red test rather than stale prose.',
  '',
  'The `Grammar rows (re-probe)` group re-submits every rejecting row of',
  '`research/experiments/E02-grammar/survey.md` (E02-S01-T01) through this script so the parity',
  'table is generated by a single run and covers the six `ExprErrorCode`s known when E02-S01-T02 ran.',
  '',
];
for (const group of groups) {
  body.push(
    `## ${group}`,
    '',
    '| id | wrapper | inner | expr at | outcome | message | decides |',
    '|---|---|---|---|---|---|---|',
  );
  for (const row of cases.filter((c) => c.group === group)) {
    body.push(
      `| \`${row.id}\` | \`${row.wrapper}\` | \`${cell(clip(row.inner)) || '(empty)'}\` | ` +
        `Line ${row.openLine}, Col ${row.openCol} | ${row.outcome}${row.status === undefined ? '' : ` (${row.status})`} | ` +
        `${cell(clip(row.message ?? '(accepted)', 300))} | ${cell(row.decides)} |`,
    );
  }
  body.push('');
}

body.push('## Submitted documents', '');
for (const row of cases) {
  if (!body.includes(`### wrapper \`${row.wrapper}\``)) {
    body.push(`### wrapper \`${row.wrapper}\``, '', '```yaml', clip(row.yaml, 400), '```', '');
  }
}

await writeFile(path.join(OUT_DIR, 'survey.md'), redact(body.join('\n'), config), 'utf8');
await writeFile(
  path.join(OUT_DIR, 'cases.json'),
  redact(`${JSON.stringify({ generated: 'pnpm expr-error-survey', cases }, null, 2)}\n`, config),
  'utf8',
);
console.log(`\n-> ${path.join(OUT_DIR, 'survey.md')} + cases.json`);
