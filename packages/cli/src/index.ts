// @azdo-emu/cli — the converter's command-line surface (docs/06 §1).
export const PACKAGE_NAME = '@azdo-emu/cli';

export * from './exit.js';
export * from './program.js';
export * from './config/index.js';

// E10-S02-T01 — the conversion itself. Exported because it is the package's whole product and the
// nightly drift harness (E11-S03-T01) drives it as a library: the command-line arm cannot reach
// the service expander, since nothing assembles `ConvertDeps.oracle` from `--org`/`--project`.
export {
  CONVERT_JSON_VERSION,
  SHELLCHECKRC,
  convert,
  type ConvertDeps,
  type ConvertFlags,
  type ConvertSummary,
} from './convert/index.js';

// E10-S04-T01 — the doctor engine.
export {
  PROBES,
  compareVersions,
  formatDoctor,
  probeTool,
  remediationFor,
  runDoctor,
  type DoctorOptions,
  type DoctorReport,
  type ProbeResult,
  type ProbeSpec,
  type ProbeStatus,
  type Runner,
  type ToolRequirement,
} from './doctor/probe.js';

// E10-S04-T02 — the doctor↔task contract.
export {
  TASK_TOOLS,
  aggregateTools,
  checkToolContract,
  requirementsFor,
  toolKey,
  type ContractViolation,
  type StepToolContext,
  type TaskToolRequirement,
} from './doctor/requirements.js';
