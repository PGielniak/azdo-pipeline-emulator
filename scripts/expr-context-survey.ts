// E02-S04-T01 grounding — which expression *contexts* exist in which slot, and how is a
// wrong-slot context rejected?
//
// The expressions doc gives exactly one sentence on availability:
//
//   "In a compile-time expression (`${{ <expression> }}`), you have access to `parameters` and
//    statically defined `variables`. In a runtime expression (`$[ <expression> ]`), you have
//    access to more `variables` but no parameters."
//
// That sentence names two slots and three contexts. The pipeline has at least six slots and at
// least seven contexts, and C-E02-065 already measured that the *function* table differs per slot
// (status functions are legal in a condition and rejected in `${{ }}` and `$[ ]`). So the named
// value table is assumed here to be per-slot too, and every cell is measured rather than derived.
//
// The load-bearing question for the implementation is the **shape of the rejection**: if
// `${{ dependencies.probe }}` is rejected with the same sentence as `${{ nosuchcontext.probe }}`,
// then availability is nothing but a per-slot name set and `errors.ts` needs no new error kind. If
// it is a distinct sentence, we owe the renderer a seventh row. `ctl-*` vs `deps-*` decides it.
//
// Two rows are deliberately *not* evidence and are here to prove they are not: a step-slot probe
// (C-E02-060 / docs/06 §5 decision 17 — the step condition path resolves no names, so it accepts
// everything) and any runtime-slot *value* (preview parses `$[ ]` at queue time but never
// evaluates it, C-E02-015), which is why runtime rows report legality only.
//
// Run: node scripts/expr-context-survey.ts            (all probes)
//      node scripts/expr-context-survey.ts <id>       (one probe)
// Output: research/experiments/E02-context/survey.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-context');

/** The slot the probe expression sits in. Same vocabulary as `expr-status-survey.ts`. */
type Placement =
  | 'step-condition'
  | 'job-condition'
  | 'stage-condition'
  | 'compile-var'
  | 'runtime-var'
  | 'if-directive'
  // Added after the first batch: the root `variables:` block has no job scope, so a rejection
  // there does not prove the *runtime variable* table lacks a context — only that the root one
  // does. These two re-ask the same question from inside a job and inside a deployment job.
  | 'job-scoped-runtime-var'
  | 'deployment-job-condition'
  | 'deployment-scoped-runtime-var';

interface Probe {
  readonly id: string;
  readonly group: string;
  readonly placement: Placement;
  /** Bare expression text — the template adds `${{ }}` / `$[ ]` / condition framing. */
  readonly expr: string;
  /** What the answer decides in `context.ts` (or hands to a later task). */
  readonly decides: string;
  /** Optional top-level `parameters:` block, emitted before everything else. */
  readonly parameters?: string;
  /** Optional extra lines *inside* the `variables:` mapping (already indented two spaces). */
  readonly declaredVars?: string;
}

function pipeline(probe: Probe): string {
  const params = probe.parameters ?? '';
  const declared = probe.declaredVars ?? '';
  switch (probe.placement) {
    case 'step-condition':
      return `${params}steps:
- script: echo done
  condition: ${probe.expr}
`;
    case 'job-condition':
      return `${params}jobs:
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
      return `${params}stages:
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
      return `${params}variables:
${declared}  probe: \${{ ${probe.expr} }}
steps:
- script: echo done
`;
    case 'runtime-var':
      return `${params}variables:
${declared}  probe: $[ ${probe.expr} ]
steps:
- script: echo done
`;
    case 'if-directive':
      return `${params}steps:
- \${{ if ${probe.expr} }}:
  - script: echo guarded
- script: echo done
`;
    case 'job-scoped-runtime-var':
      return `${params}jobs:
- job: A
  steps:
  - script: echo a
- job: B
  dependsOn: A
  variables:
    probe: $[ ${probe.expr} ]
  steps:
  - script: echo b
`;
    case 'deployment-job-condition':
      return `${params}jobs:
- deployment: D
  environment: probe-env
  condition: ${probe.expr}
  strategy:
    runOnce:
      deploy:
        steps:
        - script: echo d
`;
    case 'deployment-scoped-runtime-var':
      return `${params}jobs:
- deployment: D
  environment: probe-env
  variables:
    probe: $[ ${probe.expr} ]
  strategy:
    runOnce:
      deploy:
        steps:
        - script: echo d
`;
  }
}

const PARAM = `parameters:
- name: myParam
  type: string
  default: paramValue
`;

const DECLARED = `  myVar: varValue
  'My.Var': dottedValue
`;

/** In a condition slot the probe has to be a predicate; keep the shape identical across rows. */
const guard = (expr: string): string => `eq(${expr}, 'x')`;

const PROBES: readonly Probe[] = [
  // ---- Controls: what an *unknown* context looks like in each slot ---------------------------
  {
    id: 'ctl-unknown-compile-var',
    group: 'Controls — the unknown-context baseline',
    placement: 'compile-var',
    expr: 'nosuchcontext.probe',
    decides:
      'the reference rejection every availability row below is compared against; if a wrong-slot context renders the same sentence, availability is a name set and errors.ts is untouched',
  },
  {
    id: 'ctl-unknown-runtime-var',
    group: 'Controls — the unknown-context baseline',
    placement: 'runtime-var',
    expr: 'nosuchcontext.probe',
    decides: 'same baseline for the runtime slot',
  },
  {
    id: 'ctl-unknown-job-condition',
    group: 'Controls — the unknown-context baseline',
    placement: 'job-condition',
    expr: guard('nosuchcontext.probe'),
    decides: 'same baseline for the job condition slot',
  },
  {
    id: 'ctl-unknown-stage-condition',
    group: 'Controls — the unknown-context baseline',
    placement: 'stage-condition',
    expr: guard('nosuchcontext.probe'),
    decides: 'same baseline for the stage condition slot',
  },
  {
    id: 'ctl-unknown-if-directive',
    group: 'Controls — the unknown-context baseline',
    placement: 'if-directive',
    expr: guard('nosuchcontext.probe'),
    decides: 'same baseline for the compile-time `if` slot',
  },
  {
    id: 'ctl-unknown-step-condition',
    group: 'Controls — the unknown-context baseline',
    placement: 'step-condition',
    expr: guard('nosuchcontext.probe'),
    decides:
      'NOT evidence — expected to be accepted because the step condition path resolves no names (C-E02-060, docs/06 §5 decision 17). Present so no later reader mistakes a step-slot 200 for availability',
  },

  // ---- parameters -----------------------------------------------------------------------------
  {
    id: 'parameters-compile-var',
    group: '`parameters`',
    placement: 'compile-var',
    expr: 'parameters.myParam',
    parameters: PARAM,
    decides: 'the documented compile-time availability of `parameters`, and its resolved value',
  },
  {
    id: 'parameters-runtime-var',
    group: '`parameters`',
    placement: 'runtime-var',
    expr: 'parameters.myParam',
    parameters: PARAM,
    decides:
      'the doc\'s "no parameters" claim for runtime expressions — whether it is enforced by the parser or merely advice',
  },
  {
    id: 'parameters-job-condition',
    group: '`parameters`',
    placement: 'job-condition',
    expr: guard('parameters.myParam'),
    parameters: PARAM,
    decides: 'whether a bare (runtime) job condition can read `parameters`',
  },
  {
    id: 'parameters-stage-condition',
    group: '`parameters`',
    placement: 'stage-condition',
    expr: guard('parameters.myParam'),
    parameters: PARAM,
    decides: 'the same at stage level',
  },
  {
    id: 'parameters-if-directive',
    group: '`parameters`',
    placement: 'if-directive',
    expr: guard('parameters.myParam'),
    parameters: PARAM,
    decides: 'the compile-time `if` slot, which E03 drives',
  },

  // ---- variables ------------------------------------------------------------------------------
  {
    id: 'variables-compile-var',
    group: '`variables`',
    placement: 'compile-var',
    expr: 'variables.myVar',
    declaredVars: DECLARED,
    decides: 'compile-time availability of statically defined `variables`, and the resolved value',
  },
  {
    id: 'variables-runtime-var',
    group: '`variables`',
    placement: 'runtime-var',
    expr: 'variables.myVar',
    declaredVars: DECLARED,
    decides: 'runtime availability of `variables`',
  },
  {
    id: 'variables-job-condition',
    group: '`variables`',
    placement: 'job-condition',
    expr: guard('variables.myVar'),
    decides: 'job condition availability of `variables`',
  },
  {
    id: 'variables-stage-condition',
    group: '`variables`',
    placement: 'stage-condition',
    expr: guard('variables.myVar'),
    decides: 'stage condition availability of `variables`',
  },
  {
    id: 'variables-if-directive',
    group: '`variables`',
    placement: 'if-directive',
    expr: guard('variables.myVar'),
    declaredVars: DECLARED,
    decides: 'compile-time `if` availability of `variables`',
  },

  // ---- dependencies ---------------------------------------------------------------------------
  {
    id: 'dependencies-compile-var',
    group: '`dependencies`',
    placement: 'compile-var',
    expr: 'dependencies.A.result',
    decides:
      'THE discriminating row: `dependencies` is a real context that cannot exist at compile time. Same sentence as ctl-unknown-compile-var ⇒ availability is a per-slot name set, nothing more',
  },
  {
    id: 'dependencies-runtime-var',
    group: '`dependencies`',
    placement: 'runtime-var',
    expr: 'dependencies.A.result',
    decides: 'whether `dependencies` is legal in a variable value at all, or only in conditions',
  },
  {
    id: 'dependencies-job-condition',
    group: '`dependencies`',
    placement: 'job-condition',
    expr: guard('dependencies.A.result'),
    decides: 'the documented job-level home of `dependencies`',
  },
  {
    id: 'dependencies-stage-condition',
    group: '`dependencies`',
    placement: 'stage-condition',
    expr: guard('dependencies.A.result'),
    decides: 'the documented stage-level home of `dependencies` (different shape, same name)',
  },
  {
    id: 'dependencies-if-directive',
    group: '`dependencies`',
    placement: 'if-directive',
    expr: guard('dependencies.A.result'),
    decides: 'whether the compile-time `if` slot shares the compile-var name table',
  },

  // ---- stageDependencies ----------------------------------------------------------------------
  {
    id: 'stagedependencies-compile-var',
    group: '`stageDependencies`',
    placement: 'compile-var',
    expr: 'stageDependencies.A.A1.result',
    decides: 'compile-time rejection shape for the second graph context',
  },
  {
    id: 'stagedependencies-runtime-var',
    group: '`stageDependencies`',
    placement: 'runtime-var',
    expr: 'stageDependencies.A.A1.result',
    decides: 'runtime variable legality',
  },
  {
    id: 'stagedependencies-job-condition',
    group: '`stageDependencies`',
    placement: 'job-condition',
    expr: guard('stageDependencies.A.A1.result'),
    decides: 'the documented job-level home of `stageDependencies`',
  },
  {
    id: 'stagedependencies-stage-condition',
    group: '`stageDependencies`',
    placement: 'stage-condition',
    expr: guard('stageDependencies.A.A1.result'),
    decides:
      'whether the stage slot also carries `stageDependencies` — the docs only ever use `dependencies` there, so a rejection would make job and stage conditions two different tables',
  },

  // ---- resources / pipeline / environment ------------------------------------------------------
  {
    id: 'resources-compile-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'compile-var',
    expr: "resources.pipeline.probe.runID",
    decides: 'compile-time availability of the pinned-run context E02-S04-T03 populates',
  },
  {
    id: 'resources-runtime-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'runtime-var',
    expr: "resources.pipeline.probe.runID",
    decides: 'runtime availability of the same',
  },
  {
    id: 'resources-job-condition',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'job-condition',
    expr: guard('resources.pipeline.probe.runID'),
    decides: 'condition availability of the same',
  },
  {
    id: 'pipeline-compile-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'compile-var',
    expr: 'pipeline.startTime',
    decides:
      'the `pipeline` context the counter/format doc examples use — the doc says `pipeline.startTime` "isn\'t available outside of expressions", which says nothing about which slot',
  },
  {
    id: 'pipeline-runtime-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'runtime-var',
    expr: 'pipeline.startTime',
    decides: 'the slot the doc example actually uses (`$[counter(format(...), 100)]`)',
  },
  {
    id: 'pipeline-job-condition',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'job-condition',
    expr: guard('pipeline.startTime'),
    decides: 'condition availability of `pipeline`',
  },
  {
    id: 'environment-compile-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'compile-var',
    expr: 'environment.name',
    decides: 'compile-time availability of the deployment-only `environment` context',
  },
  {
    id: 'environment-runtime-var',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'runtime-var',
    expr: 'environment.name',
    decides: 'runtime availability of `environment` in a non-deployment pipeline',
  },
  {
    id: 'environment-job-condition',
    group: '`resources` / `pipeline` / `environment`',
    placement: 'job-condition',
    expr: guard('environment.name'),
    decides: 'condition availability of `environment` outside a deployment job',
  },

  // ---- provider semantics: how a resolved context answers a lookup ------------------------------
  {
    id: 'variables-index-dotted',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: "variables['My.Var']",
    declaredVars: DECLARED,
    decides: 'that `variables` is FLAT and keyed by the literal dotted name (index syntax)',
  },
  {
    id: 'variables-property-dotted',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'variables.My.Var',
    declaredVars: DECLARED,
    decides:
      'whether the property chain `variables.My.Var` nests (would return dottedValue) or null-propagates (empty) — the flatness claim from the other side',
  },
  {
    id: 'variables-property-case',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'variables.MYVAR',
    declaredVars: DECLARED,
    decides: 'the key-comparison policy of the `variables` context object (expected ignore-case)',
  },
  {
    id: 'variables-missing',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'variables.noSuchVariable',
    declaredVars: DECLARED,
    decides: 'that a miss is Null rather than an error (the doc\'s "dictionary miss" sentence)',
  },
  {
    id: 'variables-predefined-compile',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: "variables['Build.SourceBranch']",
    decides:
      'the sharpest reading of "statically defined variables": is a predefined system variable in the compile-time context, and if so with what value',
  },
  {
    id: 'parameters-property-case',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'parameters.MYPARAM',
    parameters: PARAM,
    decides:
      'the key-comparison policy of the `parameters` context object — C-E02-024..027 measured NESTED parameter objects as ordinal case-SENSITIVE; whether the top-level context shares that policy is a separate cell and the provider must construct it correctly',
  },
  {
    id: 'parameters-index-syntax',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: "parameters['myParam']",
    parameters: PARAM,
    decides: 'that index and property syntax hit the same lookup for `parameters`',
  },
  {
    id: 'parameters-missing',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'parameters.noSuchParameter',
    parameters: PARAM,
    decides: 'whether an undeclared parameter is Null or an error',
  },
  {
    id: 'parameters-undeclared-block',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'parameters.myParam',
    decides:
      'whether `parameters` exists as an empty context when the pipeline declares no parameters block at all — decides whether the provider registers the name unconditionally',
  },
  {
    id: 'variables-bare',
    group: 'Provider semantics — what a resolved context returns',
    placement: 'compile-var',
    expr: 'variables',
    declaredVars: DECLARED,
    decides:
      'whether the bare context name is a legal expression, and how an Object stringifies into a variable value',
  },

  // ---- Second batch: gaps the first one opened -------------------------------------------------
  // The first batch measured `resources` legal in `$[ ]` and rejected in a job `condition:`, which
  // means "runtime" is not one table. Before recording that, rule out the cheaper explanation:
  // the root `variables:` block is not job-scoped, so its table may simply be a third thing.
  {
    id: 'variables-job-scoped-runtime-var',
    group: 'Second batch — is the runtime variable table job-scoped?',
    placement: 'job-scoped-runtime-var',
    expr: 'variables.myVar',
    decides: 'control: the new placement resolves contexts at all',
  },
  {
    id: 'dependencies-job-scoped-runtime-var',
    group: 'Second batch — is the runtime variable table job-scoped?',
    placement: 'job-scoped-runtime-var',
    expr: 'dependencies.A.result',
    decides:
      'whether `dependencies` is rejected in a runtime *variable* because variables never carry it, or only because the ROOT variables block has no dependency graph — the difference between one runtime table and two',
  },
  {
    id: 'resources-job-scoped-runtime-var',
    group: 'Second batch — is the runtime variable table job-scoped?',
    placement: 'job-scoped-runtime-var',
    expr: 'resources.pipeline.probe.runID',
    decides: 'whether `resources` survives into a job-scoped runtime variable too',
  },
  {
    id: 'pipeline-stage-condition',
    group: 'Second batch — do job and stage conditions share one table?',
    placement: 'stage-condition',
    expr: guard('pipeline.startTime'),
    decides: '`pipeline` was accepted in a job condition; if the stage slot agrees they are one table',
  },
  {
    id: 'resources-stage-condition',
    group: 'Second batch — do job and stage conditions share one table?',
    placement: 'stage-condition',
    expr: guard('resources.pipeline.probe.runID'),
    decides: '`resources` was rejected in a job condition; confirms the stage slot matches',
  },
  {
    id: 'stagedependencies-if-directive',
    group: 'Second batch — do job and stage conditions share one table?',
    placement: 'if-directive',
    expr: guard('stageDependencies.A.A1.result'),
    decides: 'completes the compile-time row for the second graph context',
  },
  {
    id: 'environment-deployment-condition',
    group: 'Second batch — is `environment` deployment-job-only?',
    placement: 'deployment-job-condition',
    expr: guard('environment.name'),
    decides:
      'whether `environment` is rejected everywhere or only outside a deployment job — i.e. whether the name table also varies by JOB KIND, which would add a dimension E04/E10 must carry',
  },
  {
    id: 'environment-deployment-runtime-var',
    group: 'Second batch — is `environment` deployment-job-only?',
    placement: 'deployment-scoped-runtime-var',
    expr: 'environment.name',
    decides: 'the same question in the deployment job\'s own runtime variable slot',
  },
  {
    id: 'variables-deployment-runtime-var',
    group: 'Second batch — is `environment` deployment-job-only?',
    placement: 'deployment-scoped-runtime-var',
    expr: 'variables.myVar',
    decides: 'control: the deployment placement resolves contexts at all',
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

/** The `probe` variable, wherever the service put it — root, job, or deployment job. */
function probeVariable(finalYaml: string): string {
  const show = (value: unknown): string =>
    value === undefined || value === null ? '(empty)' : `\`${String(value)}\``;

  let found: string | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    const vars = record.variables;
    if (Array.isArray(vars)) {
      for (const entry of vars) {
        const row = entry as { name?: unknown; value?: unknown };
        if (row.name === 'probe') {
          found = show(row.value);
          return;
        }
      }
    } else if (vars !== null && typeof vars === 'object' && 'probe' in vars) {
      found = show((vars as Record<string, unknown>).probe);
      return;
    }
    for (const value of Object.values(record)) walk(value);
  };
  walk(parse(finalYaml));
  return found ?? '(probe variable absent)';
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
    case 'job-scoped-runtime-var':
    case 'deployment-scoped-runtime-var':
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
  console.log(`${probe.id.padEnd(34)} ${verdict.padEnd(15)} ${cell(detail).slice(0, 90)}`);
}

const groups = [...new Set(rows.map((r) => r.group))];
const body = [
  '# E02-S04-T01 — expression context availability survey (live service)',
  '',
  'Each row is one live `preview` call. The **placement** column is the slot the expression was',
  'submitted in; the expression itself is held as close to constant as the slot allows (a condition',
  "row wraps the context read in `eq(…, 'x')` so it is a predicate).",
  '',
  'The expressions doc spends one sentence on availability — "In a compile-time expression you have',
  'access to `parameters` and statically defined `variables`. In a runtime expression you have',
  'access to more `variables` but no parameters." — which names two slots and three contexts. This',
  'table measures seven contexts across six slots, because C-E02-065 already established that the',
  '*function* table is per-slot and there is no reason to assume the named-value table is not.',
  '',
  '**Two kinds of row are deliberately not evidence.** A `step-condition` row is accepted whatever',
  'you put in it — that path resolves no names (C-E02-060, docs/06 §5 decision 17). And a',
  '`runtime-var` row shows *legality only*: preview parses `$[ ]` at queue time (C-E02-015) but',
  'never evaluates it, so the emitted value is the unevaluated expression, not a result.',
  '`compile-var` rows do carry real values, because `${{ }}` is expanded into the returned YAML.',
  '',
  'Regenerate with `pnpm expr-context-survey`. Source of truth for C-E02-080..089 in',
  '`research/E02-expressions.md`.',
  '',
];

for (const group of groups) {
  body.push(`## ${group}`, '', '| id | placement | expression | outcome | detail | decides |', '|---|---|---|---|---|---|');
  for (const row of rows.filter((r) => r.group === group)) {
    body.push(
      `| \`${row.id}\` | ${row.placement} | \`${cell(row.expr)}\` | **${row.verdict}** | ${cell(row.detail)} | ${cell(row.decides)} |`,
    );
  }
  body.push('');
}

const file = path.join(OUT_DIR, 'survey.md');
await writeFile(file, redact(body.join('\n'), config), 'utf8');
console.log(`\n${rows.length} probes -> ${file}`);
