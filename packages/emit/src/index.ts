// @azdo-emu/emit — the emitter: turns the E04 semantic model into a generated project.
export const PACKAGE_NAME = '@azdo-emu/emit';

export * from './scaffold.js';
export * from './step.js';
export * from './entrypoints.js';
export * from './env-example.js';
export * from './readme.js';
export * from './run-number.js';

// E07-S01-T02 — the task-lib emulation host.
export {
  inputEnvName,
  inputValueText,
  renderTaskRunner,
  resolveHandler,
  resolveTaskInputs,
  type HandlerKind,
  type InputResolution,
  type ResolvedHandler,
  type ResolvedInput,
  type TaskDefinition,
  type TaskInputDeclaration,
  type TaskRunnerOptions,
} from './task-host.js';

// E07-S03-T01 — the task disposition registry.
export {
  disposeStep,
  dispositionSummary,
  dispositionWarnings,
  type Disposition,
  type DispositionOptions,
  type Fidelity,
  type PackageAvailability,
  type StepDisposition,
} from './disposition.js';

// E07-S02-T01 — the stub emitter's policy surface.
export type { StepEmitOptions, StubPolicy } from './step.js';

// E08-S01-T01 — the service-connection `.env` contract.
export {
  authKey,
  connectionBlock,
  connectionKeys,
  connectionManifestEntry,
  connectionsSection,
  dataKey,
  schemeKey,
  type ConnectionManifestEntry,
  type ConnectionMode,
  type ConnectionScheme,
  type EnvKey,
  type ServiceConnection,
} from './service-connection.js';

// E08-S02-T01 — collecting the connections a pipeline references, and the local hazards of the
// tasks that consume them.
export {
  collectConnections,
  localSessionWarnings,
  CONNECTED_SERVICE_TYPE_PREFIX,
  REAL_TASK_ENDPOINT_USE,
  type CollectedConnections,
  type ConnectionSite,
  type RealTaskEndpointUse,
  type StepSite,
  type TaskDefinitions,
} from './connections.js';
export { loadVendoredTaskDefinitions, vendoredTasksDir } from './vendor.js';
