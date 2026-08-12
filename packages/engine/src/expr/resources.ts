/**
 * The `resources` context, and the pipeline-resource metadata that is **not** in it.
 *
 * Learn documents twelve names of the form `resources.pipeline.<Alias>.runID` and calls them
 * "predefined variables" (C-E02-120). Read as a path they look like a context chain, and the
 * expressions doc's own repository example (`$[ resources.repositories.common.ref ]`) uses exactly
 * that spelling for a sibling family — so "pipeline resource metadata is a member of the `resources`
 * context" is the natural reading, and it is wrong. Two live runs with the metadata demonstrably
 * present in the run measured the three access paths side by side
 * (`research/experiments/E02-resources/real-run.md`):
 *
 * | access path                                          | pipeline resource | repository resource |
 * |------------------------------------------------------|:-----------------:|:-------------------:|
 * | `resources.<family>.<alias>.<field>` (the context)     |  **Null**         |  value              |
 * | `variables['resources.<family>.<alias>.<field>']`      |  value            |  **empty**          |
 * | `$(resources.<family>.<alias>.<field>')` macro / env    |  value            |  —                  |
 *
 * The two families are mirror images (C-E02-121/125). `convertToJson(resources)` dumps
 * `{"repositories": {…}, "containers": {…}}` and nothing else: there is no `pipeline` key, so every
 * documented pipeline field read through the chain null-propagates to empty while the *same dotted
 * name* in the flat `variables` table returns the value.
 *
 * Hence two builders, deliberately not merged:
 *
 *  - `resourcesContext` — what the `resources` context actually holds (repositories, containers).
 *  - `pipelineResourceVariables` — the flat dotted **variable** entries, handed to the caller as
 *    their own labelled set rather than pre-merged into `variablesContext`, because they are
 *    runtime-only: the compile-time `variables` table must not receive them (C-E02-120).
 */
import { objectValue, stringValue, type ExprObject, type ExprValue } from './value.js';

/**
 * A `repositories` entry as the service exposes it — the six fields measured in
 * `convertToJson(resources.repositories)`, matching the doc's `azure-devops` moniker list
 * (C-E02-123). `self` is present in every run, declared or not.
 */
export interface RepositoryResourcePin {
  readonly id?: string;
  readonly name?: string;
  readonly ref?: string;
  /**
   * Note the casing trap (C-E02-124): the implicit `self` entry reports `Git`, while a declared
   * repository reports its YAML `type:` **verbatim** (`git`). Keys fold case in this context but
   * values never do, so a pipeline comparing `type` has to cope with both. Callers pass through
   * whatever the pin recorded rather than normalising.
   */
  readonly type?: string;
  readonly url?: string;
  readonly version?: string;
}

/**
 * A `pipelines.<alias>` entry of `azdo-emu.lock.json` (docs/05 §4). The lockfile spells ids
 * `pipelineId`/`runId`; the service spells the same fields `pipelineID`/`runID`, so
 * `PIPELINE_VARIABLE_FIELDS` below is the mapping rather than a rename left to the caller.
 *
 * Every field is optional because the service omits what it has no value for, and omission is
 * observable: `projectName` is **absent** — not empty — when the resource declares no `project:`
 * (C-E02-122).
 */
export interface PipelineResourcePin {
  readonly projectName?: string;
  readonly projectId?: string;
  readonly pipelineName?: string;
  readonly pipelineId?: string | number;
  readonly runName?: string;
  readonly runId?: string | number;
  readonly runUri?: string;
  readonly sourceBranch?: string;
  readonly sourceCommit?: string;
  readonly sourceProvider?: string;
  readonly requestedFor?: string;
  readonly requestedForId?: string;
  /** Pinned for `fetch-artifacts.sh` (docs/05 §4); never exposed to expressions. */
  readonly artifacts?: readonly string[];
}

/**
 * Lockfile key → the field name the service uses in the variable, in the documented order
 * (C-E02-120). `projectName` leads because the doc lists it first, not because it is always there.
 */
const PIPELINE_VARIABLE_FIELDS: ReadonlyArray<[keyof PipelineResourcePin, string]> = [
  ['projectName', 'projectName'],
  ['projectId', 'projectID'],
  ['pipelineName', 'pipelineName'],
  ['pipelineId', 'pipelineID'],
  ['runName', 'runName'],
  ['runId', 'runID'],
  ['runUri', 'runURI'],
  ['sourceBranch', 'sourceBranch'],
  ['sourceCommit', 'sourceCommit'],
  ['sourceProvider', 'sourceProvider'],
  ['requestedFor', 'requestedFor'],
  ['requestedForId', 'requestedForID'],
];

/**
 * The flat `resources.pipeline.<alias>.<field>` variables a run exposes for its pinned pipeline
 * resources — **runtime only**: "These variables are available to your pipeline at runtime, and
 * therefore can't be used in template expressions" (C-E02-120). Returned as its own map so the
 * caller merges it into the runtime `variables` table and leaves the compile-time table alone.
 *
 * The path segment is singular `pipeline` even though the YAML block is `pipelines:` — mirroring the
 * YAML key produces a name that resolves to nothing (C-E02-126). A pin that carries no value for a
 * field yields **no entry**, which is how the service reports a resource with no `project:`
 * (C-E02-122).
 */
export function pipelineResourceVariables(
  pins: Readonly<Record<string, PipelineResourcePin>>,
): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [alias, pin] of Object.entries(pins)) {
    for (const [pinKey, field] of PIPELINE_VARIABLE_FIELDS) {
      const value = pin[pinKey];
      if (value === undefined) continue;
      variables[`resources.pipeline.${alias}.${field}`] = String(value);
    }
  }
  return variables;
}

/**
 * The environment variable the agent sets for a resource variable: upper-cased, with `.` → `_`.
 *
 * Hyphens survive. The alias charset is `[-_A-Za-z0-9]*` and the doc's own example output is
 * `RESOURCES_PIPELINE_OTHER-PROJECT-PIPELINE_PROJECTNAME`, so the tempting
 * `replace(/[^A-Z0-9]/g, '_')` would emit a name the agent never sets (C-E02-127).
 */
export function resourceVariableEnvName(variableName: string): string {
  return variableName.toUpperCase().split('.').join('_');
}

/**
 * The `resources` context itself: `repositories` keyed by alias, plus `containers`. Both are always
 * present — a run with no declared resources still dumps `{"repositories": {"self": {…}},
 * "containers": {}}` (C-E02-121).
 *
 * Policies are measured, not inherited (C-E02-123): alias and field names **fold case**
 * (`resources.repositories.SELF.REF` resolves), index and property syntax agree, and a miss —
 * unknown alias or unknown field — **null-propagates** rather than raising the way `parameters`
 * does (C-E02-087).
 *
 * `containers` entries are passed through as strings and not modelled: one measurement of one
 * container object exists (`image`, `environment`, `mapDockerSocket`, `options`, `volumes`,
 * `ports`) and no consumer yet — container jobs are E11/E14 (C-E02-125).
 */
export function resourcesContext(pins: {
  readonly repositories?: Readonly<Record<string, RepositoryResourcePin>>;
  readonly containers?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}): ExprObject {
  return objectValue(
    {
      repositories: stringMapObject(pins.repositories ?? {}),
      containers: stringMapObject(pins.containers ?? {}),
    },
    'ordinalIgnoreCase',
  );
}

/**
 * `<alias> → <field> → string`. Takes plain objects rather than an index-signature type so the
 * declared pin interfaces fit; a field the pin has no value for is dropped, which is how the service
 * reports one (C-E02-122), and the measured container object's `null` fields drop the same way.
 */
function stringMapObject(entries: Readonly<Record<string, object>>): ExprObject {
  const values: Record<string, ExprValue> = {};
  for (const [alias, fields] of Object.entries(entries)) {
    const inner: Record<string, ExprValue> = {};
    for (const [field, value] of Object.entries(fields) as [string, unknown][]) {
      if (value === undefined || value === null) continue;
      inner[field] = stringValue(String(value));
    }
    values[alias] = objectValue(inner, 'ordinalIgnoreCase');
  }
  return objectValue(values, 'ordinalIgnoreCase');
}
