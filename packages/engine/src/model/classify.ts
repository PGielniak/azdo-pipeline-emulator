// E04-S02-T02 — classify every variable the pipeline references.
//
// The output drives two things: the `.env.example` synthesis (docs/04 §10), which needs to know
// which names the user must supply, and the README's warnings list (E05-S02-T02). So the bias is
// toward *asking the user* rather than toward silence: a name we cannot account for becomes
// `env-required`, which prompts, instead of being dropped.
//
// Three grounding notes, because each one prevented a second implementation of something that
// already exists:
//
//   - The macro scanner mirrors `azdo__macro_scan` in `packages/runtime/lib/core.sh` — `$(` up to
//     the **first** `)` — so a name reported here is a name the runtime would look up (C-E04-087).
//   - Macro positions are step `inputs` and step `env` values, and nothing else (C-E04-088). A
//     `$(x)` in a `displayName` is not a macro position.
//   - The predefined table belongs to E04-S02-T03, which is scheduled *after* this task, so it is
//     an injected port rather than a table built here (C-E04-092).
import type { Job, Pipeline, Stage, Step } from './types.js';
import { foldVariableName, resolveVariables } from './variables.js';

export type VariableClass =
  /** Declared in a `variables:` block reachable from the referencing scope. */
  | 'inline'
  /** Possibly supplied by a declared variable group — never resolved (PLAN D7, C-E04-090). */
  | 'group-member'
  /** A service-supplied name, per the injected table (E04-S02-T03). */
  | 'predefined'
  /** Written by a `##vso[task.setvariable]` earlier in the pipeline (best-effort, C-E04-091). */
  | 'setvariable-produced'
  /** Unaccounted for: the user must supply it in `.env` (C-E04-089). */
  | 'env-required';

export const UNKNOWN_PREDEFINED = 'variable-unknown-predefined';

/**
 * Namespaces the service owns. A name in one of these that is **not** in the injected table is
 * warned about rather than silently demanded from the user.
 *
 * This heuristic is ours and is not a claim about the service (C-E04-092): it exists so that a
 * missing or stale predefined table shows up as a warning instead of as a `.env` entry the user
 * cannot possibly provide.
 */
export const PREDEFINED_PREFIXES: readonly string[] = [
  'build.',
  'system.',
  'agent.',
  'pipeline.',
  'environment.',
  'release.',
];

export interface VariableReference {
  /** The name as written, case preserved. */
  readonly name: string;
  /** Where it was found — a macro in an input/env value. */
  readonly via: 'input' | 'env';
  readonly stageId: string;
  readonly jobId: string;
  /** Ordinal of the referencing step. */
  readonly stepId: number;
}

export interface ClassifiedVariable {
  readonly name: string;
  readonly classification: VariableClass;
  /** Every place the name is referenced, in document order. */
  readonly references: readonly VariableReference[];
  /** For `group-member`: the declared groups it might come from. */
  readonly groups?: readonly string[];
  /** For `setvariable-produced`: the step ordinal that writes it, first writer wins. */
  readonly producedByStep?: number;
}

export interface ClassificationWarning {
  readonly code: string;
  readonly name: string;
  readonly message: string;
}

export interface Classification {
  /** By folded name (C-E06-003), so `$(BUILD.ID)` and `$(Build.Id)` are one entry. */
  readonly variables: ReadonlyMap<string, ClassifiedVariable>;
  readonly warnings: readonly ClassificationWarning[];
}

export interface ClassifyOptions {
  /**
   * Predefined variable names, folded or not — the set is folded on entry.
   *
   * Injected because E04-S02-T03 owns the table and lands after this task (C-E04-092). Empty by
   * default, in which case nothing is classed `predefined` and the prefix heuristic warns instead.
   */
  readonly predefined?: Iterable<string>;
}

/** `##vso[task.setvariable variable=NAME…]`, case-insensitive like the runtime's parser. */
const SETVARIABLE = /##vso\[task\.setvariable\s+([^\]]*)\]/gi;
const VARIABLE_PROPERTY = /(?:^|;)\s*variable=([^;\]]*)/i;

export function classifyVariables(
  pipeline: Pipeline,
  options: ClassifyOptions = {},
): Classification {
  const predefined = new Set([...(options.predefined ?? [])].map((name) => foldVariableName(name)));

  const references = collectReferences(pipeline);
  const produced = collectSetVariableWriters(pipeline);

  const variables = new Map<string, ClassifiedVariable>();
  const warnings: ClassificationWarning[] = [];

  for (const [folded, group] of groupReferences(references)) {
    const first = group[0];
    if (first === undefined) continue;

    // Resolution is per *referencing scope*: a name declared only in job A is not `inline` for a
    // reference in job B (C-E04-083). The first reference decides which scope to resolve in;
    // subsequent ones in other scopes would classify identically or be `env-required` there, and
    // reporting one class per name is what `.env.example` needs.
    const scope = scopeOf(pipeline, first.stageId, first.jobId);
    const resolved = resolveVariables(pipeline, scope.stage, scope.job);

    const entry = (classification: VariableClass, extra: Partial<ClassifiedVariable> = {}) =>
      variables.set(folded, { name: first.name, classification, references: group, ...extra });

    if (resolved.effective.has(folded)) {
      entry('inline');
      continue;
    }
    if (predefined.has(folded)) {
      entry('predefined');
      continue;
    }
    const writer = produced.get(folded);
    if (writer !== undefined) {
      entry('setvariable-produced', { producedByStep: writer });
      continue;
    }
    if (resolved.groups.length > 0) {
      entry('group-member', { groups: resolved.groups });
    } else {
      entry('env-required');
    }

    // Warned about *whatever* the class turned out to be: a `Build.*` name reaching `.env-required`
    // or `group-member` is the case this heuristic exists to surface (C-E04-092).
    if (!predefined.has(folded) && PREDEFINED_PREFIXES.some((p) => folded.startsWith(p))) {
      warnings.push({
        code: UNKNOWN_PREDEFINED,
        name: first.name,
        message: `\`${first.name}\` is in a namespace the service owns but is not a known predefined variable; it will be requested in \`.env\` unless the predefined table is out of date.`,
      });
    }
  }

  return { variables, warnings };
}

function groupReferences(
  references: readonly VariableReference[],
): ReadonlyMap<string, readonly VariableReference[]> {
  const grouped = new Map<string, VariableReference[]>();
  for (const reference of references) {
    const folded = foldVariableName(reference.name);
    const existing = grouped.get(folded);
    if (existing === undefined) grouped.set(folded, [reference]);
    else existing.push(reference);
  }
  return grouped;
}

function scopeOf(pipeline: Pipeline, stageId: string, jobId: string): { stage?: Stage; job?: Job } {
  const stage = pipeline.stages.find((candidate) => candidate.id === stageId);
  const job = stage?.jobs.find((candidate) => candidate.id === jobId);
  return { ...(stage === undefined ? {} : { stage }), ...(job === undefined ? {} : { job }) };
}

/** Every macro reference in a macro position — step `inputs` and step `env` (C-E04-088). */
export function collectReferences(pipeline: Pipeline): readonly VariableReference[] {
  const out: VariableReference[] = [];
  for (const stage of pipeline.stages) {
    for (const job of stage.jobs) {
      for (const step of job.steps) {
        for (const [via, values] of [
          ['input', Object.values(step.inputs)],
          ['env', Object.values(step.env)],
        ] as const) {
          for (const value of values) {
            for (const name of macroNames(value)) {
              out.push({ name, via, stageId: stage.id, jobId: job.id, stepId: step.id });
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Macro names in one value, in order — a hand-rolled scan rather than a regex, because it has to
 * mirror `azdo__macro_scan` exactly (C-E04-087).
 *
 * `$(` then everything up to the **first** `)`. When that candidate itself contains a `$(`, the
 * outer one is not a name: the runtime resolves the **inner** macro first (C-E06-024, the measured
 * `$(a$(b))` → `$(ainner)` case), so the scan restarts at the innermost opener and reports `b`. A
 * regex cannot express that — it consumes the closing paren and never revisits the inner opener,
 * which is how the first version of this silently reported nothing for a nested macro.
 */
export function macroNames(value: string): readonly string[] {
  const names: string[] = [];
  let at = 0;
  while (at < value.length) {
    const open = value.indexOf('$(', at);
    if (open < 0) break;
    const close = value.indexOf(')', open + 2);
    if (close < 0) break;

    const candidate = value.slice(open + 2, close);
    const nested = candidate.lastIndexOf('$(');
    if (nested >= 0) {
      // Restart at the innermost opener; the outer candidate never becomes a name.
      at = open + 2 + nested;
      continue;
    }

    const name = candidate.trim();
    if (name !== '') names.push(name);
    at = close + 1;
  }
  return names;
}

/**
 * Names written by a `##vso[task.setvariable]` in a step's script input, mapped to the first step
 * that writes them.
 *
 * Best-effort by construction (C-E04-091): a script that composes the command at run time, or a
 * program it invokes that emits one, cannot be seen — and a missed producer degrades to
 * `env-required`, which prompts the user rather than failing the conversion.
 */
export function collectSetVariableWriters(pipeline: Pipeline): ReadonlyMap<string, number> {
  const produced = new Map<string, number>();
  for (const stage of pipeline.stages) {
    for (const job of stage.jobs) {
      for (const step of job.steps) {
        for (const name of setVariableNames(step)) {
          const folded = foldVariableName(name);
          if (!produced.has(folded)) produced.set(folded, step.id);
        }
      }
    }
  }
  return produced;
}

function setVariableNames(step: Step): readonly string[] {
  const names: string[] = [];
  for (const value of Object.values(step.inputs)) {
    for (const match of value.matchAll(SETVARIABLE)) {
      const properties = match[1];
      if (properties === undefined) continue;
      const name = VARIABLE_PROPERTY.exec(properties)?.[1]?.trim();
      if (name !== undefined && name !== '') names.push(name);
    }
  }
  return names;
}
