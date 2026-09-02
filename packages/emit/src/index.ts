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
