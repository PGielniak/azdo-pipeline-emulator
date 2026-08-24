// E04-S03-T04 — the `manifest.json` serializer (docs/04 §11).
//
// The manifest is the machine-readable record of a converted pipeline: the model graph plus the
// hooks later tasks fill (`env` from E08's service-connection contract, `tools` from the doctor
// prerequisites, `fidelity`/`disposition` from E05-S02-T02 / E07-S03-T01, and the warnings list).
// It is **versioned** (`schemaVersion`) so tooling that consumes it can refuse a shape it was not
// written for, and a JSON schema is committed beside it (`schema/manifest.schema.json`) so "the
// manifest is what we say it is" is a test, not a convention.
//
// One thing this serializer owns that is not new scope: the **expansion record** (E12-S01-T01's
// pointer). `resolveExpansion()` returns a typed `ExpansionManifestEntry` and this is where it is
// serialized. The type is mirrored here rather than imported because `engine → fetch` is the wrong
// dependency direction (the same port reasoning as decision 42(a)); the convert wiring (E10-S02-T01)
// passes the fetch entry straight through, and the schema's `oneOf` enforces the same discriminated
// shape so an offline entry cannot claim a service api-version or pipeline id.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveStageGraph } from './graph.js';
import type {
  DeploymentHook,
  DeploymentStrategy,
  Environment,
  Job,
  Pipeline,
  Stage,
  Step,
} from './types.js';
import type { VariableDeclaration } from './variables.js';

/** The manifest schema version this serializer emits. Bump on a breaking shape change. */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * Where a `finalYaml` came from, serialized into the manifest.
 *
 * Structurally identical to `packages/fetch`'s `ExpansionManifestEntry` (E12-S01-T01); keep the two
 * in sync. `degraded` is a literal (`false`/`true`) so the discriminated shape is enforceable both
 * in TypeScript and in the schema's `oneOf`.
 */
export type ManifestExpansion =
  | {
      readonly mode: 'service';
      readonly degraded: false;
      readonly requestHash: string;
      readonly finalYamlHash: string;
      readonly apiVersion: string;
      readonly pipelineId: number;
      readonly fromCache: boolean;
    }
  | {
      readonly mode: 'offline';
      readonly degraded: true;
      readonly requestHash: string;
      readonly finalYamlHash: string;
    };

/** A `.env` entry the generated project needs (E08's service-connection contract). */
export interface ManifestEnvEntry {
  readonly name: string;
  readonly secret: boolean;
  /** Why this entry exists — e.g. `service connection 'my-azure-sub'` (E08). */
  readonly origin?: string;
}

/** A tool prerequisite (doctor checks it). Filled by E07/E08. */
export interface ManifestTool {
  readonly cmd: string;
  readonly min?: string;
  /** Step paths this tool is needed by, `StageId/JobId/StepOrdinal`. */
  readonly neededBy: readonly string[];
}

/** A convert-time warning, surfaced in the generated README's warnings list (E05-S02-T02). */
export interface ManifestWarning {
  readonly code: string;
  readonly message: string;
  readonly location?: { readonly file: string; readonly line: number };
}

export interface ManifestStepTarget {
  readonly container: string;
  readonly commands?: string;
}

export interface ManifestSource {
  readonly file: string;
  readonly line: number;
}

export interface ManifestStep {
  /** Ordinal within its job, 1-based (the model's `Step.id`). */
  readonly id: number;
  readonly name?: string;
  readonly displayName: string;
  /** `Name@version`, joined back from the model's split `TaskReference`. */
  readonly task: string;
  readonly origin?: 'checkout' | 'download' | 'publish';
  readonly inputs: Readonly<Record<string, string>>;
  readonly condition?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly continueOnError: boolean;
  readonly timeoutInMinutes?: number;
  readonly retryCountOnTaskFailure: number;
  readonly enabled: boolean;
  readonly target?: ManifestStepTarget;
  readonly workingDirectory?: string;
  readonly failOnStderr: boolean;
  readonly fidelity?: 'exact' | 'equivalent' | 'degraded' | 'stub' | 'unsupported';
  readonly disposition?: 'native' | 'real-task' | 'stub';
  readonly source: ManifestSource;
  readonly warnings: readonly string[];
}

export interface ManifestVariable {
  readonly name: string;
  readonly value: string;
  readonly readonly: boolean;
  readonly group?: string;
}

export interface ManifestEnvironment {
  readonly name: string;
  readonly resourceName?: string;
  readonly resourceType?: string;
}

export interface ManifestDeploymentHook {
  readonly steps: readonly ManifestStep[];
}

export interface ManifestRunOnceStrategy {
  readonly kind: 'runOnce';
  readonly preDeploy?: ManifestDeploymentHook;
  readonly deploy?: ManifestDeploymentHook;
  readonly routeTraffic?: ManifestDeploymentHook;
  readonly postRouteTraffic?: ManifestDeploymentHook;
  readonly onSuccess?: ManifestDeploymentHook;
  readonly onFailure?: ManifestDeploymentHook;
}

export type ManifestDeploymentStrategy =
  ManifestRunOnceStrategy | { readonly kind: 'rolling' | 'canary' };

export interface ManifestJob {
  readonly id: string;
  readonly displayName?: string;
  readonly kind: 'agent' | 'server' | 'deployment';
  readonly dependsOn: readonly string[];
  readonly condition?: string;
  readonly matrixKey?: string;
  readonly maxParallel?: number;
  readonly variables: readonly ManifestVariable[];
  readonly steps: readonly ManifestStep[];
  readonly environment?: ManifestEnvironment;
  readonly strategy?: ManifestDeploymentStrategy;
  readonly autoDownloadArtifacts?: boolean;
}

export interface ManifestStage {
  readonly id: string;
  readonly displayName?: string;
  /** Effective dependency list: the sequential stage default is already applied (C-E04-123). */
  readonly dependsOn: readonly string[];
  readonly condition?: string;
  readonly variables: readonly ManifestVariable[];
  readonly jobs: readonly ManifestJob[];
}

export interface SerializedManifest {
  readonly schemaVersion: number;
  readonly expansion: ManifestExpansion;
  readonly pipeline: {
    readonly name?: string;
    readonly parameters: Readonly<Record<string, string>>;
  };
  readonly stages: readonly ManifestStage[];
  readonly env: readonly ManifestEnvEntry[];
  readonly tools: readonly ManifestTool[];
  readonly warnings: readonly ManifestWarning[];
  readonly unsupported: readonly string[];
}

export interface ManifestOptions {
  /** Required: how this pipeline was expanded (the convert wiring passes it through). */
  readonly expansion: ManifestExpansion;
  /** Aggregation hooks, filled by E07/E08. Default to empty rather than omitted. */
  readonly env?: readonly ManifestEnvEntry[];
  readonly tools?: readonly ManifestTool[];
  /** Convert-time warnings in addition to the per-step warnings the model already carries. */
  readonly warnings?: readonly ManifestWarning[];
  readonly unsupported?: readonly string[];
}

/**
 * Serialize the built model into the versioned manifest of docs/04 §11.
 *
 * The stage `dependsOn` is the **effective** list — the sequential default applied — because the
 * manifest drives emission and `doctor`, both of which want the resolved graph, not the authored
 * text. It is recomputed here via {@link resolveStageGraph} with a throwaway diagnostic list: the
 * builder already validated the graph (E04-S03-T02), so this call contributes no new diagnostics;
 * it is only the effective-dependency computation, kept in one place rather than re-derived.
 */
export function serializeManifest(
  pipeline: Pipeline,
  options: ManifestOptions,
): SerializedManifest {
  const stageNodes = resolveStageGraph(pipeline.stages, pipeline.provenance.file, []);
  const stages = pipeline.stages.map((stage, i) =>
    serializeStage(stage, stageNodes[i]?.dependsOn ?? []),
  );

  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    expansion: options.expansion,
    pipeline: {
      ...optional('name', pipeline.name),
      parameters: pipeline.parameters,
    },
    stages,
    env: options.env ?? [],
    tools: options.tools ?? [],
    warnings: options.warnings ?? [],
    unsupported: options.unsupported ?? [],
  };
}

function serializeStage(stage: Stage, dependsOn: readonly string[]): ManifestStage {
  return {
    id: stage.id,
    ...optional('displayName', stage.displayName),
    dependsOn,
    ...optional('condition', stage.condition),
    variables: serializeVariables(stage.variables),
    jobs: stage.jobs.map(serializeJob),
  };
}

function serializeJob(job: Job): ManifestJob {
  return {
    id: job.id,
    ...optional('displayName', job.displayName),
    kind: job.kind,
    // Authored == effective for jobs (no implicit dependency, C-E04-124).
    dependsOn: job.dependsOn,
    ...optional('condition', job.condition),
    ...optional('matrixKey', job.matrixKey),
    ...optional('maxParallel', job.maxParallel),
    variables: serializeVariables(job.variables),
    steps: job.steps.map(serializeStep),
    ...optional('environment', serializeEnvironment(job.environment)),
    ...optional('strategy', serializeStrategy(job.strategy)),
    ...optional('autoDownloadArtifacts', job.autoDownloadArtifacts),
  };
}

function serializeStep(step: Step): ManifestStep {
  return {
    id: step.id,
    ...optional('name', step.name),
    displayName: step.displayName,
    // Rejoined from the split `{name, version}`; round-trips because `parseTask` split on the *last* `@`.
    task: `${step.task.name}@${step.task.version}`,
    ...optional('origin', step.origin),
    inputs: step.inputs,
    ...optional('condition', step.condition),
    env: step.env,
    continueOnError: step.continueOnError,
    ...optional('timeoutInMinutes', step.timeoutInMinutes),
    retryCountOnTaskFailure: step.retryCountOnTaskFailure,
    enabled: step.enabled,
    ...optional('target', step.target),
    ...optional('workingDirectory', step.workingDirectory),
    failOnStderr: step.failOnStderr,
    ...optional('fidelity', step.fidelity),
    ...optional('disposition', step.disposition),
    source: { file: step.provenance.file, line: step.provenance.range.line },
    warnings: step.warnings,
  };
}

function serializeVariables(variables: readonly VariableDeclaration[]): ManifestVariable[] {
  return variables.map((variable) => ({
    name: variable.name,
    value: variable.value,
    readonly: variable.readonly,
    ...optional('group', variable.group),
  }));
}

function serializeEnvironment(
  environment: Environment | undefined,
): ManifestEnvironment | undefined {
  if (environment === undefined) return undefined;
  return {
    name: environment.name,
    ...optional('resourceName', environment.resourceName),
    ...optional('resourceType', environment.resourceType),
  };
}

function serializeStrategy(
  strategy: DeploymentStrategy | undefined,
): ManifestDeploymentStrategy | undefined {
  if (strategy === undefined) return undefined;
  if (strategy.kind !== 'runOnce') return { kind: strategy.kind };
  return {
    kind: 'runOnce',
    ...optional('preDeploy', serializeHook(strategy.preDeploy)),
    ...optional('deploy', serializeHook(strategy.deploy)),
    ...optional('routeTraffic', serializeHook(strategy.routeTraffic)),
    ...optional('postRouteTraffic', serializeHook(strategy.postRouteTraffic)),
    ...optional('onSuccess', serializeHook(strategy.onSuccess)),
    ...optional('onFailure', serializeHook(strategy.onFailure)),
  };
}

function serializeHook(hook: DeploymentHook | undefined): ManifestDeploymentHook | undefined {
  if (hook === undefined) return undefined;
  return { steps: hook.steps.map(serializeStep) };
}

/** Absolute path of the committed manifest schema (walks up from this module to the package root). */
export function manifestSchemaPath(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'schema', 'manifest.schema.json');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('manifest.schema.json not found (expected under packages/engine/schema)');
}

/** Read the committed manifest schema document (for tests and any tool that validates manifests). */
export function readManifestSchema(): Record<string, unknown> {
  return JSON.parse(readFileSync(manifestSchemaPath(), 'utf8')) as Record<string, unknown>;
}

/** Spread helper: omits the key entirely when the value is undefined, for `exactOptionalPropertyTypes`. */
function optional<K extends string, V>(key: K, value: V | undefined): Record<K, V> | object {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}
