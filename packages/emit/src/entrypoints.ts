// E05-S01-T03 — entry-point emission: `run.sh`, `run-stage.sh`, `run-job.sh`, and `conditions.sh`.
//
// Spec: docs/04 §2 (entry points & flags) and §3 (job execution model), plus the `run_step`
// signature of docs/04 §5. Ordering semantics are E04-S03-T02's graphs (C-E04-123/124/125 — a
// stage defaults to *sequential*, a job to *parallel*, `dependsOn: []` breaks the stage default).
// These are internal specs, not Azure DevOps behavior: the agent has no shell entry points, so the
// run layout, flag surface and variable seeding are ours (docs/06 §5 decision 62).
//
// The runner contract the emitted scripts satisfy is the runtime's (`packages/runtime/lib/core.sh`):
//   - `AZDO_STATE_DIR`, `AZDO_VAR_SCOPE` (per job), `AZDO_LOG_DIR`, `AZDO_RESULT_DIR`,
//     `AZDO_ARTIFACT_DIR`, `AZDO_ATTACHMENT_DIR`, `AZDO_OUTPUT_DIR`, `AZDO_STEP_NAME`,
//     `AZDO_EMU_LIB`, `AZDO_HAS_MULTIPLE_CHECKOUTS`;
//   - `System.DefaultWorkingDirectory`, `Build.SourcesDirectory`, `Agent.BuildDirectory`,
//     `Pipeline.Workspace` and `Agent.TempDirectory` seeded into the store before any step;
//   - `run_step --id --file --cond --display --wd --continue-on-error --fail-on-stderr --retries
//     --timeout` per step, with a compiled `cond_step_<NNN>`/`cond_job_<slug>`/`cond_stage` function.
import type { Diagnostic, ManifestWarning } from '@azdo-emu/engine';
import {
  compileBash,
  parseExpression,
  registryForSlot,
  resolveJobGraph,
  resolveStageGraph,
  type ExprSlot,
  type Pipeline,
  type Stage,
} from '@azdo-emu/engine';

import { synthesizeEnvExample } from './env-example.js';
import { DEFAULT_RUN_NUMBER_FORMAT, emitRunNumberInit } from './run-number.js';
import { slugify, type Scaffold, type ScaffoldJob, type ScaffoldStage } from './scaffold.js';
import { defaultFidelity } from './step.js';

/** Shell-single-quote a string into one literal word. */
export function shQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * A stable topological order over a validated (acyclic) dependency graph: at each step pick the
 * earliest-authored node whose dependencies are all already ordered. For the sequential stage
 * default this is exactly authored order; ties break toward authored order (docs/04 §3).
 */
export function topologicalOrder(
  nodes: readonly { id: string; dependsOn: readonly string[] }[],
): string[] {
  const ids = nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const remaining = new Set(ids);
  const order: string[] = [];
  while (remaining.size > 0) {
    const ready = ids.find(
      (id) =>
        remaining.has(id) &&
        (nodes[index.get(id)!]?.dependsOn.every((d) => !remaining.has(d)) ?? true),
    );
    /* istanbul ignore next -- the graph is validated acyclic by the model builder; this only guards
       a defensive non-termination if a caller passes an unvalidated graph. */
    if (ready === undefined) break;
    remaining.delete(ready);
    order.push(ready);
  }
  return order;
}

/** The condition function name for a stage, job (by referenceName), or step (by `NNN`). */
export function conditionFunctionName(kind: 'stage' | 'job' | 'step', key: string): string {
  if (kind === 'stage') return 'cond_stage';
  if (kind === 'job') return `cond_job_${slugify(key) || 'job'}`;
  return `cond_step_${key}`;
}

function slotFor(kind: 'stage' | 'job' | 'step'): ExprSlot {
  return kind === 'stage' ? 'stage-condition' : kind === 'job' ? 'job-condition' : 'step-condition';
}

/** One compiled condition function definition. */
export interface CompiledCondition {
  readonly fnName: string;
  readonly body: string;
}

/** Compile a condition (or the implicit `succeeded()`) into a `cond_*` function body. */
export function compileCondition(
  kind: 'stage' | 'job' | 'step',
  key: string,
  condition: string | undefined,
  diagnostics: Diagnostic[],
  file: string,
): CompiledCondition {
  const fnName = conditionFunctionName(kind, key);
  if (condition === undefined || condition === '') return { fnName, body: 'azdo_status_succeeded' };
  const parsed = parseExpression(condition, { registry: registryForSlot(slotFor(kind)) });
  if (!parsed.ok) {
    diagnostics.push({
      severity: 'error',
      code: 'emit-condition-parse',
      message: `${kind} condition is not a valid expression: ${parsed.error.message}`,
      file,
      range: { line: 1, col: 1, endLine: 1, endCol: 1 },
    });
    return { fnName, body: 'return 2' };
  }
  return {
    fnName,
    body: compileBash(parsed.node, { dependencyKind: kind === 'stage' ? 'stage' : 'job' }),
  };
}

/** All condition functions for a stage: one for the stage, one per job, one per step. */
export function compileStageConditions(
  stage: Stage,
  scaffoldStage: ScaffoldStage,
  file: string,
  diagnostics: Diagnostic[],
): CompiledCondition[] {
  const conditions: CompiledCondition[] = [
    compileCondition('stage', stage.id, stage.condition, diagnostics, file),
  ];
  for (const scaffoldJob of scaffoldStage.jobs) {
    conditions.push(
      compileCondition(
        'job',
        scaffoldJob.job.referenceName,
        scaffoldJob.job.condition,
        diagnostics,
        file,
      ),
    );
    for (const scaffoldStep of scaffoldJob.steps) {
      conditions.push(
        compileCondition(
          'step',
          scaffoldStep.number,
          scaffoldStep.step.condition,
          diagnostics,
          file,
        ),
      );
    }
  }
  return conditions;
}

/** The `conditions.sh` file for one stage. */
export function emitConditions(conditions: readonly CompiledCondition[]): string {
  return [
    '#!/usr/bin/env bash',
    '# Compiled conditions for this stage (E02-S05 compiler). Generated — do not edit.',
    "# A condition function's exit status is the truth: 0 True, 1 False, 2 evaluation error.",
    'set -euo pipefail',
    '# shellcheck disable=SC1091  # resolved at run time via $AZDO_EMU_LIB',
    'source "$AZDO_EMU_LIB/runtime.sh"',
    'source "$AZDO_EMU_LIB/expr.sh"',
    '',
    ...conditions.map((c) => `${c.fnName}() {\n  ${c.body}\n}`),
    '',
  ].join('\n');
}

/**
 * The predefined variables the runner seeds once per job (decision 62).
 *
 * Directories, plus one that is not: `System.HostType`. E08-S02-T03 found the real
 * `Kubernetes@1` package crashing at **module load** on
 * `tl.getVariable("System.HostType").toLowerCase()` — no guard, before a single input is read, on
 * every command and every `connectionType` (C-E08-072). A converted YAML pipeline is a build, which
 * is the documented value.
 */
const RUN_DIR_VARS = [
  ['System.DefaultWorkingDirectory', '"$AZDO_WORKSPACE_DIR/s"'],
  ['Build.SourcesDirectory', '"$AZDO_WORKSPACE_DIR/s"'],
  ['Agent.BuildDirectory', '"$AZDO_WORKSPACE_DIR"'],
  ['Pipeline.Workspace', '"$AZDO_WORKSPACE_DIR"'],
  ['Agent.TempDirectory', '"$AZDO_WORKSPACE_DIR/tmp"'],
  // C-E08-068 (E08-S02-T03): `azure-pipelines-tool-lib`'s `_getCacheRoot` throws
  // `Agent.ToolsDirectory is not set` before doing anything else, so without this every tool
  // installer — and `Kubernetes@1` on any non-default `versionSpec` — fails on its first line with
  // an error that names no task and no input. It is a directory, not a credential, so seeding it is
  // the whole fix (docs/06 §5 decision 79).
  //
  // Deliberately *not* seeded alongside it: `Agent.Version`. `assertAgent` throws only when the
  // variable is **set and lower** than the minimum — an unset value passes (C-E08-071) — so
  // supplying one buys nothing and would silently flip every other `assertAgent` gate in every task
  // from "unasserted" to "asserted at whatever number we picked".
  ['Agent.ToolsDirectory', '"$AZDO_WORKSPACE_DIR/tools"'],
  // C-E08-072: "Set to build if the pipeline is a build" — the vendored predefined-variables table
  // (C-E04-093). Not a `.env` question: a converted YAML pipeline is always a build.
  ['System.HostType', 'build'],
] as const;

/** The `run-job.sh` file. */
export function emitRunJob(job: ScaffoldJob, stage: ScaffoldStage): string {
  const scope = `job-${slugify(job.job.id) || 'job'}`;
  const checkoutCount = job.job.steps.filter((s) => s.origin === 'checkout').length;
  const lines: string[] = [
    '#!/usr/bin/env bash',
    `# ${job.job.id} sequencer (generated)`,
    'set -euo pipefail',
    '# shellcheck disable=SC1091',
    'source "$AZDO_EMU_LIB/runtime.sh"',
    'source "$AZDO_EMU_LIB/expr.sh"',
    '# shellcheck disable=SC1091',
    'source "$AZDO_STAGE_DIR/conditions.sh"',
    '',
    'AZDO_JOB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    '',
    '# Flags: --from-step NNN --to-step NNN --only-step NNN --no-condition',
    'from_step="" to_step="" only_step="" no_condition=false',
    'while (($# > 0)); do',
    '  case "$1" in',
    '    --from-step) from_step="$2"; shift 2 ;;',
    '    --to-step) to_step="$2"; shift 2 ;;',
    '    --only-step) only_step="$2"; shift 2 ;;',
    '    --no-condition) no_condition=true; shift ;;',
    '    *) printf \'unknown run-job option: %s\\n\' "$1" >&2; exit 2 ;;',
    '  esac',
    'done',
    '',
    `export AZDO_VAR_SCOPE=${shQuote(scope)}`,
    `AZDO_LOG_DIR="$AZDO_RUN_DIR/logs/${stage.name}/${job.name}"`,
    `AZDO_RESULT_DIR="$(azdo_result_dir ${shQuote(stage.stage.id)} ${shQuote(job.job.referenceName)})"`,
    `AZDO_OUTPUT_DIR="$AZDO_STATE_DIR/outputs/${stage.stage.id}/${job.job.referenceName}"`,
    `AZDO_HAS_MULTIPLE_CHECKOUTS=${checkoutCount > 1 ? 'true' : 'false'}`,
    'export AZDO_LOG_DIR AZDO_RESULT_DIR AZDO_OUTPUT_DIR AZDO_HAS_MULTIPLE_CHECKOUTS',
    'mkdir -p "$AZDO_LOG_DIR" "$AZDO_RESULT_DIR" "$AZDO_OUTPUT_DIR"',
    '',
    'if [[ -z "$(azdo_var System.DefaultWorkingDirectory)" ]]; then',
    // Root variables are available to every job, after which job-local writes shadow them
    // (C-E04-082/083, C-E05-017). The copy preserves value bytes and metadata, unlike an env bridge.
    '  azdo_var_scope_copy pipeline "$AZDO_VAR_SCOPE"',
    ...RUN_DIR_VARS.map(([name, value]) => `  azdo_var_set ${shQuote(name)} ${value}`),
    'fi',
    '',
  ];

  if (job.steps.length === 0) {
    lines.push('# no steps in this job', 'exit 0', '');
    return lines.join('\n');
  }

  for (const step of job.steps) {
    const id = step.number;
    const fileName = step.path.split('/').pop() ?? `${id}.sh`;
    const wd = step.step.workingDirectory ?? '$(System.DefaultWorkingDirectory)';
    const timeout =
      step.step.timeoutInMinutes === undefined ? 3600 : step.step.timeoutInMinutes * 60;
    lines.push(
      `id=${shQuote(id)}`,
      `if [[ -z "$from_step" || "$id" > "$from_step" || "$id" = "$from_step" ]] && [[ -z "$to_step" || "$id" < "$to_step" || "$id" = "$to_step" ]] && [[ -z "$only_step" || "$id" = "$only_step" ]]; then`,
      `  run_step --id ${shQuote(id)} --file "$AZDO_JOB_DIR/steps/${fileName}" --cond ${conditionFunctionName('step', id)} \\`,
      `    --display ${shQuote(step.step.displayName)} --wd ${shQuote(wd)} \\`,
      `    --continue-on-error ${step.step.continueOnError} --fail-on-stderr ${step.step.failOnStderr} \\`,
      `    --retries ${step.step.retryCountOnTaskFailure} --timeout ${timeout} \\`,
      '    ${no_condition:+--no-condition}',
      'fi',
      '',
    );
  }
  return lines.join('\n');
}

/** The `run-stage.sh` file. */
export function emitRunStage(stage: ScaffoldStage, jobOrder: readonly string[]): string {
  const lines: string[] = [
    '#!/usr/bin/env bash',
    `# ${stage.stage.id} stage orchestrator (generated)`,
    'set -euo pipefail',
    '# shellcheck disable=SC1091',
    'source "$AZDO_EMU_LIB/runtime.sh"',
    'source "$AZDO_EMU_LIB/expr.sh"',
    '# shellcheck disable=SC1091',
    'source "$AZDO_STAGE_DIR/conditions.sh"',
    '',
    'if ! cond_stage; then',
    '  printf \'Skipping stage %s due to condition.\\n\' "$AZDO_STAGE_ID"',
    '  azdo_stage_result_set "$AZDO_STAGE_ID" Skipped',
    ...stage.jobs.map(
      (job) => `  azdo_job_result_set "$AZDO_STAGE_ID" ${shQuote(job.job.referenceName)} Skipped`,
    ),
    '  exit 0',
    'fi',
    '',
  ];
  for (const referenceName of jobOrder) {
    const job = stage.jobs.find((j) => j.job.referenceName === referenceName);
    /* istanbul ignore next -- jobOrder comes from resolveJobGraph over the same stage.jobs. */
    if (job === undefined) continue;
    const cond = conditionFunctionName('job', referenceName);
    lines.push(
      `if ${cond}; then`,
      `  bash "$AZDO_STAGE_DIR/jobs/${job.name}/run-job.sh" "$@"`,
      'else',
      `  printf 'Skipping job %s due to condition.\\n' ${shQuote(referenceName)}`,
      `  azdo_job_result_set "$AZDO_STAGE_ID" ${shQuote(referenceName)} Skipped`,
      'fi',
      '',
    );
  }
  return lines.join('\n');
}

/** The `run.sh` file. */
export function emitRunScript(
  pipeline: Pipeline,
  plan: Scaffold,
  stageOrder: readonly string[],
  warnings?: ManifestWarning[],
): string {
  const stagesById = new Map(plan.stages.map((s) => [s.stage.id, s]));
  const listLines = plan.stages.flatMap((stage) => [
    `  echo ${shQuote(`- ${stage.stage.id}`)}`,
    ...stage.jobs.flatMap((job) => [
      `  echo ${shQuote(`    - ${job.job.referenceName}`)}`,
      ...job.steps.map(
        (step) =>
          `  echo ${shQuote(`      ${step.number}  ${step.step.displayName}  [${defaultFidelity(step.step)}]`)}`,
      ),
    ]),
  ]);
  const runNumber = emitRunNumberInit(
    pipeline.name ?? DEFAULT_RUN_NUMBER_FORMAT,
    pipeline.provenance.file,
  );
  const envAliases = synthesizeEnvExample(pipeline).envAliases;
  if (warnings !== undefined) warnings.push(...runNumber.warnings);
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# Generated pipeline runner — run.sh',
    'set -euo pipefail',
    'PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'export AZDO_EMU_LIB="$PROJECT_DIR/lib"',
    'export AZDO_ARTIFACT_DIR="$PROJECT_DIR/.artifacts"',
    'mkdir -p "$AZDO_ARTIFACT_DIR"',
    '# shellcheck disable=SC1091',
    'source "$AZDO_EMU_LIB/runtime.sh"',
    'source "$AZDO_EMU_LIB/expr.sh"',
    '',
    '# Exact `.env` spelling → variable-store name map (decision 67).',
    '# shellcheck disable=SC2034 # consumed indirectly by azdo_env_load in runtime.sh',
    'AZDO_ENV_ALIASES=(',
    ...envAliases.map(({ name, variable }) => `  ${shQuote(`${name}=${variable}`)}`),
    ')',
    '',
    '# Flags: --list --env-file FILE --resume',
    'list_only=false resume=false env_file=""',
    'while (($# > 0)); do',
    '  case "$1" in',
    '    --list) list_only=true; shift ;;',
    '    --resume) resume=true; shift ;;',
    '    --env-file) env_file="$2"; shift 2 ;;',
    '    *) printf \'unknown run.sh option: %s\\n\' "$1" >&2; exit 2 ;;',
    '  esac',
    'done',
    '',
    'if [[ "$list_only" = true ]]; then',
    '  echo "stages:"',
    ...listLines,
    '  exit 0',
    'fi',
    '',
    'WORK_DIR="$PROJECT_DIR/.work"',
    'COUNTER_FILE="$WORK_DIR/.state/run-counter"',
    'mkdir -p "$WORK_DIR/.state"',
    'run_number="$(cat "$COUNTER_FILE" 2>/dev/null || echo 0)"',
    'if [[ "$resume" != true ]]; then',
    '  run_number=$((run_number + 1))',
    '  echo "$run_number" > "$COUNTER_FILE"',
    'fi',
    'AZDO_RUN_DIR="$WORK_DIR/run-$run_number"',
    'export AZDO_RUN_DIR AZDO_STATE_DIR="$AZDO_RUN_DIR/state" AZDO_WORKSPACE_DIR="$AZDO_RUN_DIR/workspace" AZDO_ATTACHMENT_DIR="$AZDO_RUN_DIR/logs/attachments"',
    'mkdir -p "$AZDO_WORKSPACE_DIR/s" "$AZDO_WORKSPACE_DIR/tmp" "$AZDO_WORKSPACE_DIR/tools" "$AZDO_WORKSPACE_DIR/TestResults" "$AZDO_STATE_DIR" "$AZDO_ATTACHMENT_DIR"',
    '',
    'azdo_env_load "$PROJECT_DIR/.env" "${env_file:-}"',
    '',
    // The run number is rendered here and nowhere earlier: the format may read `.env`-supplied and
    // user-defined variables (C-E05-012), and `Build.BuildNumber` has to exist before the first
    // step reads it. Every job inherits the pipeline store before it starts (C-E05-017).
    ...runNumber.lines,
  ];
  for (const stageId of stageOrder) {
    const stage = stagesById.get(stageId);
    /* istanbul ignore next -- stageOrder comes from resolveStageGraph over the same pipeline.stages. */
    if (stage === undefined) continue;
    lines.push(
      `AZDO_STAGE_DIR="$PROJECT_DIR/${stage.dir}"`,
      `AZDO_STAGE_ID=${shQuote(stage.stage.id)}`,
      'export AZDO_STAGE_DIR AZDO_STAGE_ID',
      `bash "$AZDO_STAGE_DIR/run-stage.sh" "$@"`,
      '',
    );
  }
  lines.push('azdo_run_summary', 'exit "$(azdo_run_exit_code)"');
  return lines.join('\n');
}

/** Emit every entry point for a pipeline, keyed by project-relative path. */
export function emitEntrypoints(
  pipeline: Pipeline,
  plan: Scaffold,
  file: string,
  diagnostics: Diagnostic[],
  warnings?: ManifestWarning[],
): Map<string, string> {
  const files = new Map<string, string>();
  const stageGraph = resolveStageGraph(pipeline.stages, file, diagnostics);
  files.set('run.sh', emitRunScript(pipeline, plan, topologicalOrder(stageGraph), warnings));
  for (const stage of plan.stages) {
    const jobGraph = resolveJobGraph(stage.stage, file, diagnostics);
    files.set(
      `${stage.dir}/conditions.sh`,
      emitConditions(compileStageConditions(stage.stage, stage, file, diagnostics)),
    );
    files.set(`${stage.dir}/run-stage.sh`, emitRunStage(stage, topologicalOrder(jobGraph)));
    for (const job of stage.jobs) {
      files.set(`${job.dir}/run-job.sh`, emitRunJob(job, stage));
    }
  }
  return files;
}
