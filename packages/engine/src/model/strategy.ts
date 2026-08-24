// E04-S03-T01 — matrix & `parallel` strategy expansion.
//
// The service never expands `strategy:` (C-E04-118): the preview returns the authored block verbatim,
// so multiplying one job into its concrete legs is the *model's* work. This is the one structural
// transformation the builder does that the expansion did not already do, and the naming is measured,
// not assumed:
//
// - a matrix leg is named `<JobName> <key>` (space-separated, C-E04-110, confirmed by the timeline
//   records `Build Alpha`/`Build Beta` in C-E04-119);
// - a `parallel: N` slice is named `<JobName> <position>` with a **1-based** position, and carries
//   `System.JobPositionInPhase`/`System.TotalJobsInPhase` (C-E04-114/121);
// - inside a matrix leg `System.JobName` is the *key alone*, but that is a runtime-seeding fact
//   (C-E04-120) for E06 rather than a model-shape fact — the model's `id` is the full `<JobName> <key>`.
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingNode, PipelineNode, ScalarValue } from '../frontend/parse.js';
import type { Job } from './types.js';
import type { VariableDeclaration } from './variables.js';

/** The matrix is a `$[ … ]` runtime expression — its leg count is unknowable at convert time (C-E04-116). */
export const STRATEGY_RUNTIME_MATRIX = 'strategy-matrix-runtime-expression';

/** The two slice variables `parallel` injects, documented only on the jobs page (C-E04-114). */
const JOB_POSITION_VAR = 'System.JobPositionInPhase';
const TOTAL_JOBS_VAR = 'System.TotalJobsInPhase';

/**
 * Multiply `base` (a job whose node carries `strategy:`) into its concrete jobs.
 *
 * Returns `[base]` untouched when the node has no `strategy:`, when the matrix is a runtime
 * expression we cannot statically expand (C-E04-116, a warning is emitted), or when the strategy
 * shape is unreadable. `matrix` and `parallel` are mutually exclusive and the service rejects both
 * together (C-E04-115), so at most one branch fires.
 */
export function expandJobStrategy(
  node: MappingNode,
  base: Job,
  file: string,
  diagnostics: Diagnostic[],
): readonly Job[] {
  const strategy = entryValue(node, 'strategy');
  if (strategy?.kind !== 'mapping') return [base];

  const matrix = entryValue(strategy, 'matrix');
  if (matrix !== undefined) return expandMatrix(matrix, base, strategy, file, diagnostics);

  const parallel = entryValue(strategy, 'parallel');
  if (parallel !== undefined) return expandParallel(parallel, base);

  return [base];
}

function expandMatrix(
  matrix: PipelineNode,
  base: Job,
  strategy: MappingNode,
  file: string,
  diagnostics: Diagnostic[],
): readonly Job[] {
  const maxParallel = numberEntry(strategy, 'maxParallel');

  // `matrix: $[ … ]` is a runtime expression (C-E04-116): its legs depend on a prior job's output
  // variable, so the set is unknowable here. The job survives unexpanded and the degraded path is
  // the warning — docs/01 §2 says the converter prompts rather than fabricates a leg count.
  if (matrix.kind === 'scalar') {
    diagnostics.push({
      severity: 'warning',
      code: STRATEGY_RUNTIME_MATRIX,
      message:
        'The `matrix` strategy is a runtime expression and cannot be expanded at convert time; the job is emitted unexpanded.',
      file,
      range: matrix.pos.range,
      hint: "A matrix defined by a prior job's output variable needs a real run to know its legs (docs/01 §2).",
    });
    return [base];
  }
  if (matrix.kind !== 'mapping') return [base];

  const legs: Job[] = [];
  for (const entry of matrix.entries) {
    if (typeof entry.key.value !== 'string') continue;
    const key = entry.key.value;
    legs.push({
      ...base,
      id: withSuffix(base.id, key),
      matrixKey: key,
      // The key's mapping becomes job-level variables, in authored order (C-E04-112/122).
      variables: [...base.variables, ...matrixVariables(entry.value)],
      ...optional('maxParallel', maxParallel),
    });
  }

  // An empty matrix still produces one job (C-E04-117): the leg set is empty only when the mapping
  // has no entries, and "at least one job" means the base job with no injected variables.
  if (legs.length === 0) return [{ ...base, ...optional('maxParallel', maxParallel) }];
  return legs;
}

function expandParallel(parallel: PipelineNode, base: Job): readonly Job[] {
  const count = parallel.kind === 'scalar' ? parseCount(parallel.value) : undefined;
  // The service validates `parallel` before a pipeline reaches the model, so an unreadable count
  // should not occur; if it does, the base job survives rather than the builder guessing a slice set.
  if (count === undefined || count < 1) return [base];

  const slices: Job[] = [];
  for (let position = 1; position <= count; position += 1) {
    slices.push({
      ...base,
      // 1-based position in the name, exactly as the timeline showed `Slice 1`/`Slice 2` (C-E04-121).
      id: withSuffix(base.id, String(position)),
      variables: [
        ...base.variables,
        { name: JOB_POSITION_VAR, value: String(position), readonly: false },
        { name: TOTAL_JOBS_VAR, value: String(count), readonly: false },
      ],
    });
  }
  return slices;
}

/** A matrix entry's mapping (`{ varName: value }`) as job-level variable declarations (C-E04-112). */
function matrixVariables(node: PipelineNode): readonly VariableDeclaration[] {
  if (node.kind !== 'mapping') return [];
  const out: VariableDeclaration[] = [];
  for (const entry of node.entries) {
    if (typeof entry.key.value !== 'string' || entry.value.kind !== 'scalar') continue;
    out.push({ name: entry.key.value, value: text(entry.value.value), readonly: false });
  }
  return out;
}

/**
 * `<name> <suffix>` — the space-separated leg naming of C-E04-110/121. A job whose `id` is the empty
 * string (C-E04-004) has nothing to prefix, so the suffix is the whole name; that combination is
 * unmeasured and is a deliberate no-op rather than a synthesized base name.
 */
function withSuffix(name: string, suffix: string): string {
  return name === '' ? suffix : `${name} ${suffix}`;
}

function parseCount(value: ScalarValue): number | undefined {
  const parsed = Number(text(value));
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function numberEntry(node: MappingNode, key: string): number | undefined {
  const value = entryValue(node, key);
  if (value?.kind !== 'scalar') return undefined;
  const parsed = Number(text(value.value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function entryValue(node: MappingNode, key: string): PipelineNode | undefined {
  return node.entries.find((entry) => entry.key.value === key)?.value;
}

function text(value: ScalarValue): string {
  return value === null ? '' : String(value);
}

function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
