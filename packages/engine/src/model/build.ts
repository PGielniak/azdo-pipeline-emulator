// E04-S01-T01 — build the semantic model from the service's expanded `finalYaml`.
//
// The input contract is measured, not assumed. Across the 147 expansions this epic inherits plus
// two probes run for it, the service returns **one** shape: rooted at `stages:`, with a root
// `steps:` wrapped as `__default` → `Job` → `task: CmdLine@2` (C-E04-001/002) and a root `jobs:`
// wrapped in `__default` while keeping its own job names (C-E04-003).
//
// So why does this builder still wrap? Because `--offline-expand` exists. The retained local engine
// (PLAN D3/D4) makes no such guarantee, and a builder that asserted the invariant would turn the
// fallback into a crash instead of a conversion. The wrapping is therefore written as a fallback
// path with a diagnostic-free happy case, not as normalization the default path needs.
//
// One measured detail drives a real decision in here: **a job id may be the empty string**
// (C-E04-004). An explicitly authored but unnamed `- job:` keeps `''`; only a job the *service*
// invents gets the synthetic `Job`. The builder preserves that rather than substituting a default,
// because inventing one here would hide it from E05, which is where a filename actually has to be
// chosen.
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingNode, ParseResult, PipelineNode, ScalarValue } from '../frontend/parse.js';
import type {
  Job,
  JobKind,
  ModelProvenance,
  Pipeline,
  Stage,
  Step,
  TaskReference,
} from './types.js';

export const MODEL_NOT_A_MAPPING = 'model-root-not-a-mapping';
export const MODEL_EMPTY = 'model-empty-pipeline';
export const MODEL_BAD_TASK = 'model-step-task-invalid';
export const MODEL_NO_STEPS_CONTAINER = 'model-job-has-no-steps';

/** The synthetic names the service supplies when it wraps a root `steps:` (C-E04-002). */
export const SYNTHETIC_STAGE_ID = '__default';
export const SYNTHETIC_JOB_ID = 'Job';

export interface BuildResult {
  /** Undefined only when the document could not yield a pipeline at all. */
  readonly pipeline: Pipeline | undefined;
  readonly diagnostics: readonly Diagnostic[];
}

export function buildPipeline(parsed: ParseResult): BuildResult {
  const diagnostics: Diagnostic[] = [];
  const root = parsed.root;

  if (root === undefined) {
    diagnostics.push(diagnostic(MODEL_EMPTY, 'The expanded pipeline is empty.', parsed.file));
    return { pipeline: undefined, diagnostics };
  }
  if (root.kind !== 'mapping') {
    diagnostics.push(
      diagnostic(
        MODEL_NOT_A_MAPPING,
        `The expanded pipeline must be a mapping, found a ${root.kind}.`,
        parsed.file,
        provenanceOf(parsed.file, root),
      ),
    );
    return { pipeline: undefined, diagnostics };
  }

  const provenance = provenanceOf(parsed.file, root);
  const stages = buildStages(root, parsed.file, diagnostics);

  return {
    pipeline: {
      ...optional('name', scalarEntry(root, 'name')),
      parameters: parameterDefaults(root),
      variables: variableMap(entryValue(root, 'variables')),
      stages,
      provenance,
    },
    diagnostics,
  };
}

/**
 * `stages:` if present; otherwise wrap whatever shorthand the document is rooted at.
 *
 * The wrapping mirrors what the service does (C-E04-002/003) so an offline-expanded document and a
 * service-expanded one produce the *same* model — which is the property that makes
 * `--offline-expand` a fallback rather than a second dialect.
 */
function buildStages(root: MappingNode, file: string, diagnostics: Diagnostic[]): readonly Stage[] {
  const stagesNode = entryValue(root, 'stages');
  if (stagesNode?.kind === 'sequence') {
    return stagesNode.items
      .filter((item): item is MappingNode => item.kind === 'mapping')
      .map((item) => buildStage(item, file, diagnostics));
  }

  const jobsNode = entryValue(root, 'jobs');
  if (jobsNode?.kind === 'sequence') {
    return [syntheticStage(root, file, jobsNode.items, diagnostics)];
  }

  const stepsNode = entryValue(root, 'steps');
  if (stepsNode?.kind === 'sequence') {
    const job = syntheticJob(root, file, stepsNode, diagnostics);
    return [
      {
        id: SYNTHETIC_STAGE_ID,
        dependsOn: [],
        variables: {},
        jobs: [job],
        provenance: provenanceOf(file, root),
      },
    ];
  }

  diagnostics.push(
    diagnostic(
      MODEL_EMPTY,
      'The expanded pipeline declares no `stages:`, `jobs:` or `steps:`.',
      file,
      provenanceOf(file, root),
    ),
  );
  return [];
}

function syntheticStage(
  root: MappingNode,
  file: string,
  items: readonly PipelineNode[],
  diagnostics: Diagnostic[],
): Stage {
  return {
    id: SYNTHETIC_STAGE_ID,
    dependsOn: [],
    variables: {},
    jobs: items
      .filter((item): item is MappingNode => item.kind === 'mapping')
      .map((item) => buildJob(item, file, diagnostics)),
    provenance: provenanceOf(file, root),
  };
}

/** The job the service invents for a bare `steps:` root: id `Job`, agent kind (C-E04-002). */
function syntheticJob(
  root: MappingNode,
  file: string,
  stepsNode: PipelineNode,
  diagnostics: Diagnostic[],
): Job {
  return {
    id: SYNTHETIC_JOB_ID,
    kind: 'agent',
    dependsOn: [],
    variables: {},
    steps: buildSteps(stepsNode, file, diagnostics),
    provenance: provenanceOf(file, root),
  };
}

function buildStage(node: MappingNode, file: string, diagnostics: Diagnostic[]): Stage {
  const jobsNode = entryValue(node, 'jobs');
  const jobs =
    jobsNode?.kind === 'sequence'
      ? jobsNode.items
          .filter((item): item is MappingNode => item.kind === 'mapping')
          .map((item) => buildJob(item, file, diagnostics))
      : [];

  return {
    id: scalarEntry(node, 'stage') ?? '',
    ...optional('displayName', scalarEntry(node, 'displayName')),
    dependsOn: dependsOn(node),
    ...optional('condition', scalarEntry(node, 'condition')),
    variables: variableMap(entryValue(node, 'variables')),
    jobs,
    provenance: provenanceOf(file, node),
  };
}

function buildJob(node: MappingNode, file: string, diagnostics: Diagnostic[]): Job {
  const kind = jobKind(node);
  // `deployment:` names the job the same way `job:` does; a deployment's steps live under its
  // strategy, which is E04-S03's to flatten — until then a deployment job carries no steps rather
  // than pretending the strategy's are its own.
  const id = kind === 'deployment' ? (scalarEntry(node, 'deployment') ?? '') : jobId(node);
  const stepsNode = entryValue(node, 'steps');

  if (stepsNode === undefined && kind !== 'deployment') {
    diagnostics.push(
      diagnostic(
        MODEL_NO_STEPS_CONTAINER,
        `Job \`${id}\` declares no \`steps:\`.`,
        file,
        provenanceOf(file, node),
        'An agentless (server) job legitimately has none; an agent job with no steps does nothing.',
      ),
    );
  }

  return {
    id,
    ...optional('displayName', scalarEntry(node, 'displayName')),
    kind,
    dependsOn: dependsOn(node),
    ...optional('condition', scalarEntry(node, 'condition')),
    variables: variableMap(entryValue(node, 'variables')),
    steps: stepsNode === undefined ? [] : buildSteps(stepsNode, file, diagnostics),
    ...optional('timeoutInMinutes', numberEntry(node, 'timeoutInMinutes')),
    ...optional('container', scalarEntry(node, 'container')),
    provenance: provenanceOf(file, node),
  };
}

/**
 * `job:` may be written with no value, in which case the parser yields `null` and the service's own
 * expansion prints `''` (C-E04-004). Both mean the same thing and both become the empty string —
 * the distinction that matters is that neither becomes `Job`.
 */
function jobId(node: MappingNode): string {
  return scalarEntry(node, 'job') ?? '';
}

function jobKind(node: MappingNode): JobKind {
  if (entryValue(node, 'deployment') !== undefined) return 'deployment';
  // `pool: server` is how an agentless job is spelled; anything else runs on an agent.
  const pool = entryValue(node, 'pool');
  if (pool?.kind === 'scalar' && text(pool.value).toLowerCase() === 'server') return 'server';
  return 'agent';
}

function buildSteps(node: PipelineNode, file: string, diagnostics: Diagnostic[]): readonly Step[] {
  if (node.kind !== 'sequence') return [];
  const steps: Step[] = [];
  let ordinal = 0;
  for (const item of node.items) {
    if (item.kind !== 'mapping') continue;
    ordinal += 1;
    steps.push(buildStep(item, ordinal, file, diagnostics));
  }
  return steps;
}

function buildStep(
  node: MappingNode,
  ordinal: number,
  file: string,
  diagnostics: Diagnostic[],
): Step {
  const provenance = provenanceOf(file, node);
  const taskText = scalarEntry(node, 'task');
  const task = parseTask(taskText);
  if (task === undefined) {
    diagnostics.push(
      diagnostic(
        MODEL_BAD_TASK,
        taskText === undefined
          ? `Step ${ordinal} declares no \`task:\`.`
          : `Step ${ordinal} has an unreadable \`task:\` value \`${taskText}\`.`,
        file,
        provenance,
        'The service desugars every step shorthand into `task: Name@version` (C-E04-002); a step without one did not come from an expansion.',
      ),
    );
  }

  const name = scalarEntry(node, 'name');
  return {
    id: ordinal,
    ...optional('name', name),
    displayName: scalarEntry(node, 'displayName') ?? task?.name ?? `Step ${ordinal}`,
    task: task ?? { name: '', version: '' },
    inputs: stringMap(entryValue(node, 'inputs')),
    ...optional('condition', scalarEntry(node, 'condition')),
    env: stringMap(entryValue(node, 'env')),
    continueOnError: booleanEntry(node, 'continueOnError') ?? false,
    ...optional('timeoutInMinutes', numberEntry(node, 'timeoutInMinutes')),
    retryCountOnTaskFailure: numberEntry(node, 'retryCountOnTaskFailure') ?? 0,
    ...optional('workingDirectory', scalarEntry(node, 'workingDirectory')),
    provenance,
    warnings: [],
  };
}

/** `Name@version`, split on the **last** `@` so a name containing one is still readable. */
function parseTask(value: string | undefined): TaskReference | undefined {
  if (value === undefined || value.length === 0) return undefined;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at === value.length - 1) return undefined;
  return { name: value.slice(0, at), version: value.slice(at + 1) };
}

/** `dependsOn:` is a scalar or a sequence of scalars; both normalize to a list. */
function dependsOn(node: MappingNode): readonly string[] {
  const value = entryValue(node, 'dependsOn');
  if (value === undefined) return [];
  if (value.kind === 'scalar') return [text(value.value)];
  if (value.kind !== 'sequence') return [];
  return value.items.filter((item) => item.kind === 'scalar').map((item) => text(item.value));
}

/**
 * `variables:` has two spellings — a mapping of name to value, and a sequence of
 * `{name, value}` / `{group}` / `{template}` entries. Both collapse to a flat map here; the
 * classification E04-S02-T02 owns (group vs inline vs `.env`-required) is not attempted, so a
 * `group:` entry contributes nothing rather than a wrong name.
 */
function variableMap(node: PipelineNode | undefined): Record<string, string> {
  if (node === undefined) return {};
  if (node.kind === 'mapping') return stringMap(node);
  if (node.kind !== 'sequence') return {};

  const out: Record<string, string> = {};
  for (const item of node.items) {
    if (item.kind !== 'mapping') continue;
    const name = scalarEntry(item, 'name');
    if (name === undefined) continue;
    out[name] = scalarEntry(item, 'value') ?? '';
  }
  return out;
}

/** Root `parameters:` as name → default text; a parameter with no default maps to `''`. */
function parameterDefaults(root: MappingNode): Record<string, string> {
  const node = entryValue(root, 'parameters');
  if (node === undefined) return {};
  if (node.kind === 'mapping') return stringMap(node);
  if (node.kind !== 'sequence') return {};

  const out: Record<string, string> = {};
  for (const item of node.items) {
    if (item.kind !== 'mapping') continue;
    const name = scalarEntry(item, 'name');
    if (name === undefined) continue;
    const value = entryValue(item, 'default');
    out[name] = value?.kind === 'scalar' ? text(value.value) : '';
  }
  return out;
}

function stringMap(node: PipelineNode | undefined): Record<string, string> {
  if (node?.kind !== 'mapping') return {};
  const out: Record<string, string> = {};
  for (const entry of node.entries) {
    if (typeof entry.key.value !== 'string') continue;
    if (entry.value.kind !== 'scalar') continue;
    out[entry.key.value] = text(entry.value.value);
  }
  return out;
}

function entryValue(node: MappingNode, key: string): PipelineNode | undefined {
  return node.entries.find((entry) => entry.key.value === key)?.value;
}

function scalarEntry(node: MappingNode, key: string): string | undefined {
  const value = entryValue(node, key);
  if (value?.kind !== 'scalar') return undefined;
  // A valueless key (`job:`) parses as null and means the empty string here (C-E04-004).
  return value.value === null ? '' : text(value.value);
}

function booleanEntry(node: MappingNode, key: string): boolean | undefined {
  const value = scalarEntry(node, key);
  if (value === undefined) return undefined;
  // Pipeline scalars are strings even where the schema says boolean (C-E01-015).
  return value.toLowerCase() === 'true';
}

function numberEntry(node: MappingNode, key: string): number | undefined {
  const value = scalarEntry(node, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: ScalarValue): string {
  return value === null ? '' : String(value);
}

/** Spread helper: omits the key entirely when the value is undefined, for `exactOptionalPropertyTypes`. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function provenanceOf(file: string, node: PipelineNode): ModelProvenance {
  return { file, range: node.pos.range };
}

function diagnostic(
  code: string,
  message: string,
  file: string,
  provenance?: ModelProvenance,
  hint?: string,
): Diagnostic {
  return {
    severity: 'error',
    code,
    message,
    file,
    range: provenance?.range ?? { line: 1, col: 1, endLine: 1, endCol: 1 },
    ...(hint === undefined ? {} : { hint }),
  };
}
