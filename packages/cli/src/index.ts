// @azdo-emu/cli — the converter's command-line surface (docs/06 §1).
export const PACKAGE_NAME = '@azdo-emu/cli';

export * from './exit.js';
export * from './program.js';
export * from './config/index.js';

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
