// E02-S03-T03 grounding — where do the job status check functions exist, and with what arity?
//
// The status functions are the one family E02 cannot settle by reading a value out of an expanded
// pipeline: they are *runtime* functions, so `preview` never evaluates them. What preview can do is
// tell us where they are **legal** and how many arguments each accepts, because C-E02-015 showed
// the service parses `$[ ]` and `condition:` bodies at queue time with the same grammar.
//
// That matters because the two open sources disagree with each other:
//
//   * `microsoft/azure-pipelines-agent` `src/Agent.Worker/ExpressionManager.cs` registers all five
//     with `minParameters: 0, maxParameters: 0` — i.e. at the step level a job name argument is a
//     parse error, and `canceled()` reads `Agent.JobStatus`, not run-level cancellation.
//   * the expressions doc describes `succeeded('A')` / `failed('A', 'B')` argument forms "for a
//     job", and describes `canceled()` as "the pipeline is canceled".
//
// Both can be true at once only if arity is *placement-dependent*, which is not something to
// assume. Each probe below therefore fixes the expression and varies the slot it sits in.
//
// Run: node scripts/expr-status-survey.ts            (all probes)
//      node scripts/expr-status-survey.ts <id>       (one probe)
// Output: research/experiments/E02-status/survey.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-status');

/** Where the probe expression is placed. Conditions are runtime slots; vars split by syntax. */
type Placement =
  | 'step-condition'
  | 'job-condition'
  | 'stage-condition'
  | 'compile-var'
  | 'runtime-var'
  | 'if-directive';

interface Probe {
  readonly id: string;
  readonly group: string;
  readonly placement: Placement;
  readonly expr: string;
  /** What the answer decides in `status.ts` (or hands to a later task). */
  readonly decides: string;
}

function pipeline(probe: Probe): string {
  switch (probe.placement) {
    case 'step-condition':
      return `steps:
- script: echo done
  condition: ${probe.expr}
`;
    case 'job-condition':
      return `jobs:
- job: A
  steps:
  - script: echo a
- job: B
  dependsOn: A
  condition: ${probe.expr}
  steps:
  - script: echo b
`;
    case 'stage-condition':
      return `stages:
- stage: A
  jobs:
  - job: A1
    steps:
    - script: echo a
- stage: B
  dependsOn: A
  condition: ${probe.expr}
  jobs:
  - job: B1
    steps:
    - script: echo b
`;
    case 'compile-var':
      return `variables:
  probe: \${{ ${probe.expr} }}
steps:
- script: echo done
`;
    case 'runtime-var':
      return `variables:
  probe: $[ ${probe.expr} ]
steps:
- script: echo done
`;
    case 'if-directive':
      return `steps:
- \${{ if ${probe.expr} }}:
  - script: echo guarded
- script: echo done
`;
  }
}

const PROBES: readonly Probe[] = [
  // ---- Controls: is a condition body parsed at preview time at all? --------------------------
  {
    id: 'ctl-step-arity',
    group: 'Controls — is the condition body parsed?',
    placement: 'step-condition',
    expr: 'eq(1)',
    decides:
      'the single row every arity claim below depends on: if a known-bad arity in a step condition is accepted, preview does not gate conditions and no arity row means anything',
  },
  {
    id: 'ctl-job-arity',
    group: 'Controls — is the condition body parsed?',
    placement: 'job-condition',
    expr: 'eq(1)',
    decides: 'same control at the job level',
  },
  {
    id: 'ctl-stage-arity',
    group: 'Controls — is the condition body parsed?',
    placement: 'stage-condition',
    expr: 'eq(1)',
    decides: 'same control at the stage level',
  },
  {
    id: 'ctl-step-unknown-fn',
    group: 'Controls — is the condition body parsed?',
    placement: 'step-condition',
    expr: 'nosuchfunc()',
    decides: 'whether the function *name* is resolved in a condition, not just the syntax',
  },
  {
    id: 'ctl-step-syntax',
    group: 'Controls — is the condition body parsed?',
    placement: 'step-condition',
    expr: "eq(1, 'a'",
    decides: 'pure syntax error, the weakest form of gating',
  },

  // ---- The five functions, no arguments, in each runtime slot ---------------------------------
  {
    id: 'step-always',
    group: 'Zero-argument form per slot',
    placement: 'step-condition',
    expr: 'always()',
    decides: 'baseline: the agent registers this one, so it must be legal here',
  },
  {
    id: 'step-canceled',
    group: 'Zero-argument form per slot',
    placement: 'step-condition',
    expr: 'canceled()',
    decides: 'baseline',
  },
  {
    id: 'step-failed',
    group: 'Zero-argument form per slot',
    placement: 'step-condition',
    expr: 'failed()',
    decides: 'baseline',
  },
  {
    id: 'step-succeeded',
    group: 'Zero-argument form per slot',
    placement: 'step-condition',
    expr: 'succeeded()',
    decides: 'baseline',
  },
  {
    id: 'step-sof',
    group: 'Zero-argument form per slot',
    placement: 'step-condition',
    expr: 'succeededOrFailed()',
    decides: 'baseline',
  },
  {
    id: 'job-succeeded',
    group: 'Zero-argument form per slot',
    placement: 'job-condition',
    expr: 'succeeded()',
    decides: 'baseline at the job level',
  },
  {
    id: 'stage-succeeded',
    group: 'Zero-argument form per slot',
    placement: 'stage-condition',
    expr: 'succeeded()',
    decides: 'baseline at the stage level',
  },

  // ---- Arity: does the service enforce the agent's 0-parameter registration? ------------------
  {
    id: 'step-succeeded-arg',
    group: 'Arguments — step slot',
    placement: 'step-condition',
    expr: "succeeded('A')",
    decides:
      'the headline question: ExpressionManager.cs registers succeeded with maxParameters 0, so if the service accepts this the check is agent-side only and we must reject it ourselves at the step level or accept a divergence',
  },
  {
    id: 'step-failed-arg',
    group: 'Arguments — step slot',
    placement: 'step-condition',
    expr: "failed('A')",
    decides: 'same question for failed',
  },
  {
    id: 'step-sof-arg',
    group: 'Arguments — step slot',
    placement: 'step-condition',
    expr: "succeededOrFailed('A')",
    decides: 'same question for succeededOrFailed',
  },
  {
    id: 'step-always-arg',
    group: 'Arguments — step slot',
    placement: 'step-condition',
    expr: "always('A')",
    decides: 'the docs describe no argument form for always at any level',
  },
  {
    id: 'step-canceled-arg',
    group: 'Arguments — step slot',
    placement: 'step-condition',
    expr: "canceled('A')",
    decides: 'the docs describe no argument form for canceled at any level',
  },
  {
    id: 'job-succeeded-arg',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "succeeded('A')",
    decides: 'the documented job-name form; A is a real dependency here',
  },
  {
    id: 'job-succeeded-two-args',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "succeeded('A', 'A')",
    decides: 'upper arity: the docs say "job names" plural but state no maximum',
  },
  {
    id: 'job-succeeded-unknown',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "succeeded('nosuchjob')",
    decides:
      'whether a job name argument is validated against the dependency graph at compile time — if it is, the emitter must too',
  },
  {
    id: 'job-succeeded-nonstring',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: 'succeeded(1)',
    decides: 'whether the argument is typed as a String at parse time',
  },
  {
    id: 'job-failed-arg',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "failed('A')",
    decides: 'the documented job-name form for failed',
  },
  {
    id: 'job-sof-arg',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "succeededOrFailed('A')",
    decides: 'the documented job-name form for succeededOrFailed',
  },
  {
    id: 'job-always-arg',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "always('A')",
    decides: 'undocumented at every level — settles whether always is 0-arity everywhere',
  },
  {
    id: 'job-canceled-arg',
    group: 'Arguments — job slot',
    placement: 'job-condition',
    expr: "canceled('A')",
    decides: 'undocumented at every level — settles whether canceled is 0-arity everywhere',
  },
  {
    id: 'stage-succeeded-arg',
    group: 'Arguments — stage slot',
    placement: 'stage-condition',
    expr: "succeeded('A')",
    decides: 'the docs speak of "job names"; stage conditions take stage names by the same syntax',
  },

  // ---- Name casing -----------------------------------------------------------------------------
  {
    id: 'case-upper',
    group: 'Name casing',
    placement: 'step-condition',
    expr: 'SUCCEEDED()',
    decides: 'C-E02-011 found function names case-insensitive; confirm the status family follows',
  },
  {
    id: 'case-lower-sof',
    group: 'Name casing',
    placement: 'step-condition',
    expr: 'succeededorfailed()',
    decides: 'the camel-cased name folded flat',
  },

  // ---- Phase gating: the docs say "in conditions, but not in variable definitions" -------------
  {
    id: 'compile-always',
    group: 'Phase gating',
    placement: 'compile-var',
    expr: 'always()',
    decides:
      'whether the status family exists in the compile-time function table at all (E02-S04-T01 inherits the answer)',
  },
  {
    id: 'compile-succeeded',
    group: 'Phase gating',
    placement: 'compile-var',
    expr: 'succeeded()',
    decides: 'same question for the function with a documented step meaning',
  },
  {
    id: 'runtime-var-always',
    group: 'Phase gating',
    placement: 'runtime-var',
    expr: 'always()',
    decides:
      'the doc sentence "Use the following status check functions as expressions in conditions, but not in variable definitions" — is it enforced or advisory?',
  },
  {
    id: 'runtime-var-succeeded',
    group: 'Phase gating',
    placement: 'runtime-var',
    expr: 'succeeded()',
    decides: 'same question, the function whose value would actually vary',
  },
  {
    id: 'if-succeeded',
    group: 'Phase gating',
    placement: 'if-directive',
    expr: 'succeeded()',
    decides: '`${{ if }}` is compile-time — a status function there can never mean anything',
  },
  {
    id: 'step-condition-compile-wrapped',
    group: 'Phase gating',
    placement: 'step-condition',
    expr: '${{ succeeded() }}',
    decides:
      'a condition body wrapped in compile-time delimiters resolves in the compile-time table',
  },
  {
    id: 'step-bare-always',
    group: 'Phase gating',
    placement: 'step-condition',
    expr: 'always',
    decides: 'without parentheses: is the name also registered as a named value?',
  },

  // ---- Round 2. Round 1 turned up the row that reframes everything above: `nosuchfunc()` is
  // ACCEPTED in a step condition while `eq(1)` in the same slot is rejected, and step rejections
  // arrive wrapped in "Job <j>: Step <s> specifies condition <c> which is not valid. Reason: …"
  // while job/stage rejections are bare. So the slots are validated by different code paths with
  // different function tables, and "accepted in a step condition" is much weaker evidence than it
  // looks. These rows measure how much weaker. -----------------------------------------------
  {
    id: 'ctl-job-unknown-fn',
    group: 'Controls II — which table validates which slot',
    placement: 'job-condition',
    expr: 'nosuchfunc()',
    decides: 'does the job slot resolve function names, where the step slot did not?',
  },
  {
    id: 'ctl-stage-unknown-fn',
    group: 'Controls II — which table validates which slot',
    placement: 'stage-condition',
    expr: 'nosuchfunc()',
    decides: 'same question at the stage level',
  },
  {
    id: 'ctl-step-unknown-fn-arity',
    group: 'Controls II — which table validates which slot',
    placement: 'step-condition',
    expr: 'nosuchfunc(1, 2, 3)',
    decides:
      'if an unknown name takes any arity in a step condition, the step slot checks syntax only and every step-slot "accepted" row above is silent about arity',
  },
  {
    id: 'ctl-step-eq-3args',
    group: 'Controls II — which table validates which slot',
    placement: 'step-condition',
    expr: 'eq(1, 2, 3)',
    decides: 'the complement: a *known* name over-supplied in the step slot',
  },
  {
    id: 'ctl-runtime-var-eq',
    group: 'Controls II — which table validates which slot',
    placement: 'runtime-var',
    expr: 'eq(1, 1)',
    decides:
      'control for the two runtime-var rejections above: proves a runtime variable body is parsed and that it was the status *name* that failed, not the slot',
  },

  {
    id: 'job-always-zero',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: 'always()',
    decides: 'zero-argument baseline for the function whose one-argument form was rejected',
  },
  {
    id: 'job-canceled-zero',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: 'canceled()',
    decides: 'same baseline for canceled',
  },
  {
    id: 'job-bare-always',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: 'always',
    decides: 'the step slot accepted a bare `always`; does the slot that resolves names?',
  },
  {
    id: 'job-succeeded-three-args',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: "succeeded('A', 'A', 'A')",
    decides: 'confirms the upper bound is N and not 2',
  },
  {
    id: 'job-failed-two-args',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: "failed('A', 'A')",
    decides: 'N-ary for failed too',
  },
  {
    id: 'job-sof-two-args',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: "succeededOrFailed('A', 'A')",
    decides: 'N-ary for succeededOrFailed too',
  },
  {
    id: 'job-succeeded-empty-string',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: "succeeded('')",
    decides: 'is an empty job name rejected, i.e. is the argument validated as a name at all?',
  },
  {
    id: 'job-succeeded-var-arg',
    group: 'Arguments II — job and stage arity table',
    placement: 'job-condition',
    expr: "succeeded(variables['jobName'])",
    decides:
      'must the argument be a literal, or is it a general expression? decides whether the compiler can resolve names statically',
  },
  {
    id: 'stage-always-arg',
    group: 'Arguments II — job and stage arity table',
    placement: 'stage-condition',
    expr: "always('A')",
    decides: 'the job-slot arity split, re-measured in the stage slot',
  },
  {
    id: 'stage-canceled-arg',
    group: 'Arguments II — job and stage arity table',
    placement: 'stage-condition',
    expr: "canceled('A')",
    decides: 'the job-slot arity split, re-measured in the stage slot',
  },

  {
    id: 'job-not-succeeded',
    group: 'Neighbours — how status calls compose',
    placement: 'job-condition',
    expr: 'not(succeeded())',
    decides: 'a status call as an argument, in the slot that actually resolves names',
  },
  {
    id: 'job-and-succeeded',
    group: 'Neighbours — how status calls compose',
    placement: 'job-condition',
    expr: "and(succeeded(), eq(variables['Build.Reason'], 'Manual'))",
    decides: 'the documented idiom, end to end',
  },
  {
    id: 'job-not-canceled',
    group: 'Neighbours — how status calls compose',
    placement: 'job-condition',
    expr: 'not(canceled())',
    decides:
      "the doc's own recommended replacement for succeededOrFailed when dependencies are skipped",
  },
  {
    id: 'job-dependency-result',
    group: 'Neighbours — how status calls compose',
    placement: 'job-condition',
    expr: "in(dependencies.A.result, 'Succeeded', 'SucceededWithIssues', 'Skipped')",
    decides:
      'the explicit form the docs offer instead of the status functions — grounds the result spellings and hands E02-S04-T02 a live row',
  },
  {
    id: 'step-agent-jobstatus',
    group: 'Neighbours — how status calls compose',
    placement: 'step-condition',
    expr: "in(variables['Agent.JobStatus'], 'Succeeded', 'SucceededWithIssues')",
    decides:
      'the expansion the docs give for step-level succeeded(); if it is legal in the same slot, the doc\'s "equivalent to" is literal',
  },
];

/** Every `condition:` the service emitted, in document order — including ones it injected. */
function conditions(finalYaml: string): string {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'condition') found.push(String(value));
      else walk(value);
    }
  };
  walk(parse(finalYaml));
  return found.length === 0 ? '(no condition emitted)' : found.map((c) => `\`${c}\``).join(', ');
}

function probeVariable(finalYaml: string): string {
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

function steps(finalYaml: string): string {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const inputs = record.inputs as Record<string, unknown> | undefined;
    if (typeof inputs?.script === 'string') found.push(inputs.script);
    for (const value of Object.values(record)) walk(value);
  };
  walk(parse(finalYaml));
  return found.length === 0 ? '(no scripts)' : found.join(' + ');
}

function detailFor(probe: Probe, finalYaml: string): string {
  switch (probe.placement) {
    case 'compile-var':
    case 'runtime-var':
      return probeVariable(finalYaml);
    case 'if-directive':
      return steps(finalYaml);
    default:
      return conditions(finalYaml);
  }
}

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
      ? detailFor(probe, outcome.finalYaml)
      : outcome.kind === 'rejected'
        ? redact(outcome.message, config)
        : JSON.stringify(outcome);
  rows.push({ ...probe, verdict, detail });
  console.log(`${probe.id.padEnd(30)} ${verdict.padEnd(15)} ${cell(detail).slice(0, 80)}`);
}

const groups = [...new Set(rows.map((r) => r.group))];
const body = [
  '# E02-S03-T03 — job status check function survey (live service)',
  '',
  'Each row is one live `preview` call. The **placement** column is the slot the expression was',
  'submitted in, because the two open sources disagree about arity and only placement can',
  'reconcile them: `ExpressionManager.cs` registers all five status functions with',
  "`minParameters: 0, maxParameters: 0`, while the expressions doc documents `succeeded('A')`",
  'argument forms "for a job".',
  '',
  'Status functions are runtime-only, so **no row here shows an evaluated result** — preview never',
  'runs them. What a row shows is whether the slot accepts the expression, and for accepted',
  'condition rows the `condition:` values the service emitted (which also reveals the defaults it',
  'injects). Truth tables come from the agent source and the docs, not from these rows.',
  '',
  'Regenerate with `pnpm expr-status-survey`. Source of truth for C-E02-060..079 in',
  '`research/E02-expressions.md`.',
  '',
];
for (const group of groups) {
  body.push(
    `## ${group}`,
    '',
    '| id | placement | expression | outcome | emitted / message | decides |',
    '|---|---|---|---|---|---|',
  );
  for (const row of rows.filter((r) => r.group === group)) {
    body.push(
      `| \`${row.id}\` | ${row.placement} | \`${cell(row.expr)}\` | ${row.verdict} | ${cell(row.detail)} | ${cell(row.decides)} |`,
    );
  }
  body.push('');
}

await writeFile(path.join(OUT_DIR, 'survey.md'), redact(body.join('\n'), config), 'utf8');
console.log(`\n-> ${path.join(OUT_DIR, 'survey.md')}`);
