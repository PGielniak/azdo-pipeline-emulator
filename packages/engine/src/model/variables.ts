// E04-S02-T01 — variable scope resolution and precedence.
//
// **This one is ours, and the probe is why we know.** Unlike the step shorthands, which the service
// desugars completely (C-E04-030), the expansion leaves variable scoping entirely alone: a document
// setting `a` at root, stage and job comes back with all three blocks intact (C-E04-080), and two
// entries of the same name in one scope both survive in authored order (C-E04-081). So layering and
// last-wins are the model's work, not something to read off an already-resolved answer.
//
// The order is the documented one (C-E04-082): job > stage > pipeline, then — outside the YAML and
// therefore outside this module — queue-time and the Pipeline settings UI. Those last two are the
// `.env` boundary (PLAN D7), which is exactly why the resolver layers three and stops.
//
// Case folding is not a choice made here: variable names are case-insensitive to match the agent's
// dictionary (C-E06-003), and the runtime store already folds them. A resolver that did not would
// hand the runtime two entries it will treat as one.
import type { Job, Pipeline, Stage } from './types.js';

/** One `variables:` entry as authored, before any layering. */
export interface VariableDeclaration {
  /** Empty for a `group:` entry, which names a group rather than a variable. */
  readonly name: string;
  readonly value: string;
  /** `readonly: true` survives expansion (C-E04-085); the runtime enforces it (C-E06-005/006). */
  readonly readonly: boolean;
  /** Set when this entry is `- group: <name>` rather than a name/value pair. */
  readonly group?: string;
}

export type VariableScope = 'pipeline' | 'stage' | 'job';

export interface ResolvedVariable {
  /** The name as authored by the **winning** declaration, case preserved for display. */
  readonly name: string;
  readonly value: string;
  readonly readonly: boolean;
  /** Which level the winner came from. */
  readonly scope: VariableScope;
}

export interface ResolvedVariables {
  /** Effective values, keyed by folded name (C-E06-003). */
  readonly effective: ReadonlyMap<string, ResolvedVariable>;
  /**
   * Variable groups referenced by any layer, in the order encountered, de-duplicated.
   *
   * Names only, never values: PLAN D7 forbids fetching group values, and an unauthorized group is
   * rejected by the service before it ever reaches us anyway (C-E04-086). E04-S02-T02's
   * classification and the `.env.example` synthesis (docs/04 §10) consume this.
   */
  readonly groups: readonly string[];
}

/** The agent's dictionary is case-insensitive (C-E06-003), so the resolver's keys are too. */
export function foldVariableName(name: string): string {
  return name.toLowerCase();
}

/**
 * Effective variables visible to `job` in `stage`.
 *
 * A job sees root + its own stage + itself, and never a sibling stage's or a sibling job's
 * (C-E04-083) — which is why this takes the specific stage and job rather than folding the whole
 * pipeline.
 */
export function resolveVariables(pipeline: Pipeline, stage?: Stage, job?: Job): ResolvedVariables {
  const effective = new Map<string, ResolvedVariable>();
  const groups: string[] = [];

  // Applied lowest precedence first, so a later layer simply overwrites — and within a layer, later
  // entries overwrite earlier ones, which *is* last-wins (C-E04-081/082).
  const layers: readonly [VariableScope, readonly VariableDeclaration[]][] = [
    ['pipeline', pipeline.variables],
    ['stage', stage?.variables ?? []],
    ['job', job?.variables ?? []],
  ];

  for (const [scope, declarations] of layers) {
    for (const declaration of declarations) {
      if (declaration.group !== undefined) {
        if (!groups.includes(declaration.group)) groups.push(declaration.group);
        continue;
      }
      if (declaration.name === '') continue;
      effective.set(foldVariableName(declaration.name), {
        name: declaration.name,
        value: declaration.value,
        readonly: declaration.readonly,
        scope,
      });
    }
  }

  return { effective, groups };
}

/** Convenience: the effective value of one name, or `undefined`. */
export function variableValue(resolved: ResolvedVariables, name: string): string | undefined {
  return resolved.effective.get(foldVariableName(name))?.value;
}
