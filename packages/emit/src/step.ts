// E05-S01-T02 — step script emission: the `.sh` file each generated step becomes.
//
// The spec is docs/04 §12: exactly two shapes — a **script step**, emitted natively as readable
// bash, and **everything else**, emitted as a dispatch to real-task mode (E07) or a stub. This
// module owns the native half plus the header block (the debugging surface, identical in both
// shapes); the `run_task.sh` dispatcher and the real-task `INPUT_*` contract are E07's, so the
// non-native half is emitted here as a stub that dumps the step's resolved inputs and exits.
//
// Grounding: this is an internal spec (docs/04 §12, docs/03 §75), not Azure DevOps behavior —
// the agent has no concept of an emitted script file to copy. The one thing that *is* grounded is
// the macro-preservation requirement: `$( )` macros are expanded by the **runtime** just before
// each step runs (`azdo_expand_macros`, which rewrites the whole file text, C-E06-018/024), so the
// emitter must leave them intact in the body and never expand them itself (C-E06-018: "Macro
// syntax variables … get processed during runtime before a task runs").
//
// The fidelity label here is a per-kind default, not the final assignment: E05-S02-T02 computes
// the full per-step fidelity + warnings list, and E07-S03-T01 refines "not a script step" into
// `native` (checkout) vs `real-task` vs `stub`. Until then:
//   - `script` (CmdLine@2) and `bash` (Bash@3) run verbatim → `exact` (docs/04 §12).
//   - `pwsh`/`powershell` (PowerShell@2) run via `pwsh` on this host → `degraded` (docs/04 §241).
//   - every other task → `stub` (real-task mode is E07; the disposition registry is E07-S03-T01).
import type { Step } from '@azdo-emu/engine';

import { disposeStep, type DispositionOptions, type StepDisposition } from './disposition.js';
import { originStepLabel } from './scaffold.js';

/** The native script kinds the emitter produces readable bash for (PLAN D4, decision 49). */
export type NativeScriptKind = 'script' | 'bash' | 'pwsh' | 'powershell';

/** The fidelity label the header shows until E05-S02-T02/E07-S03-T01 assign the real one. */
export type DefaultFidelity = 'exact' | 'degraded' | 'stub';

/** The full `Name@version` spelling of a step's task reference (for the header and stub dump). */
export function taskRef(step: Step): string {
  return `${step.task.name}@${step.task.version}`;
}

/**
 * The native kind of a step, or `undefined` for a non-script task.
 *
 * The service desugars the shorthands to named tasks (`script`→`CmdLine@2`, `bash`→`Bash@3`,
 * `pwsh`/`powershell`→`PowerShell@2`, C-E04-030), so the task *name* (the part before `@`) is
 * already the identity — unlike `checkout`/`download`/`publish`, which arrive as bare GUIDs and are
 * recovered via `origin`. `pwsh` vs `powershell` is decided by the `pwsh: true` input, not by the
 * reference (C-E04-037).
 */
export function nativeScriptKind(step: Step): NativeScriptKind | undefined {
  switch (step.task.name) {
    case 'CmdLine':
      return 'script';
    case 'Bash':
      return 'bash';
    case 'PowerShell':
      return step.inputs.pwsh === 'true' ? 'pwsh' : 'powershell';
    default:
      return undefined;
  }
}

/** Whether the step is one of the four native script kinds (PLAN D4). */
export function isNativeScript(step: Step): boolean {
  return nativeScriptKind(step) !== undefined;
}

/**
 * The fidelity label shown in the header.
 *
 * **Now the registry's answer, not a guess** (E07-S03-T01). This used to hard-code "everything
 * non-script is `stub`", which was true only while real-task mode did not exist; leaving it that
 * way once the registry landed would have put a `stub` label on steps that really run their task.
 */
export function defaultFidelity(step: Step, options: DispositionOptions = {}): DefaultFidelity {
  return disposeStep(step, options).fidelity;
}

/** The short label for the header's `· <kind>` slot. */
function kindLabel(step: Step): string {
  const kind = nativeScriptKind(step);
  if (kind !== undefined) return kind;
  // A desugared shorthand reads as its keyword; an ordinary task reads as its name (docs/04 §12).
  return step.origin ?? taskRef(step);
}

/**
 * The one-line explanation beside the fidelity label (docs/04 §12's `— …`).
 *
 * Keyed on the **disposition**, not the fidelity, because `degraded` now covers two different
 * things — a PowerShell step running through `pwsh`, and a task running its real implementation —
 * and telling a reader "degraded" without saying which would be worse than saying nothing.
 */
function fidelityNote(disposition: StepDisposition): string {
  switch (disposition.disposition) {
    case 'native':
      return disposition.fidelity === 'exact'
        ? 'script steps run verbatim; see README §fidelity'
        : 'runs via pwsh on this host; see README §fidelity';
    case 'real-task':
      return 'runs the real task against the emulated task-lib; see README §fidelity';
    case 'stub':
      return 'inputs logged only; the step does not do the task’s work';
  }
}

/** True when the text contains an ADO macro opener `$(`. */
export function hasMacro(text: string): boolean {
  return text.includes('$(');
}

/** Whether any input value carries a `$(` macro (for the header NOTE). */
function stepHasMacro(step: Step): boolean {
  return Object.values(step.inputs).some(hasMacro);
}

const RULE = '─';
/** Total width of the rule line, after the `# ` prefix (chars, not bytes). */
const RULE_WIDTH = 78;

/** The displayName shown in the header: the friendly origin label for a defaulted-GUID shorthand. */
function displayLabel(step: Step): string {
  return originStepLabel(step) ?? step.displayName;
}

/** `# ── Step 030 · "Build solution" · script ──────…` (docs/04 §12). */
function ruleLine(step: Step, number: string): string {
  const head = `── Step ${number} · "${displayLabel(step)}" · ${kindLabel(step)} `;
  const pad = Math.max(2, RULE_WIDTH - [...head].length);
  return `# ${head}${RULE.repeat(pad)}`;
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** `# condition: <cond>      continueOnError: <bool>      timeout: <…>` (docs/04 §12). */
function conditionLine(step: Step): string {
  const condition = step.condition ?? 'succeeded()';
  const timeout =
    step.timeoutInMinutes === undefined ? 'job default' : `${step.timeoutInMinutes} min`;
  return `# condition: ${condition}      continueOnError: ${step.continueOnError}      timeout: ${timeout}`;
}

/** The provenance line `# from: <file>:<line>` (the `via …` template chain is bundle.json's, E03-S07-T01). */
function provenanceLine(step: Step): string {
  return `# from: ${step.provenance.file}:${step.provenance.range.line}`;
}

/** The header block common to every emitted step (docs/04 §12). */
function header(step: Step, number: string, disposition: StepDisposition): string {
  const lines = [
    '#!/usr/bin/env bash',
    ruleLine(step, number),
    provenanceLine(step),
    conditionLine(step),
    `# fidelity: ${disposition.fidelity} — ${fidelityNote(disposition)}`,
  ];
  if (stepHasMacro(step)) {
    lines.push('# NOTE: $(…) below is an ADO macro — run_step expands it just-in-time.');
  }
  // The registry's own warning rides in the header beside the step's, so a reader who opens one
  // script sees why *this* step degraded without going back to the README (PLAN D10).
  if (disposition.warning !== undefined) {
    lines.push(`# warning: ${disposition.warning}`);
  }
  for (const warning of step.warnings) {
    lines.push(`# warning: ${warning}`);
  }
  return `${lines.join('\n')}\n`;
}

// `runtime.sh` is the generated project's lib/ entry point, resolved at run time via
// `$AZDO_EMU_LIB` — shellcheck cannot follow it, and the directive says so (not a blanket disable).
const PREAMBLE =
  'set -euo pipefail\n' +
  '# shellcheck disable=SC1091  # runtime.sh is generated into the project lib/ at convert time\n' +
  'source "$AZDO_EMU_LIB/runtime.sh"\n';

/** The body of a native script step: the authored script, macros intact (C-E06-018/024). */
function nativeScriptBody(step: Step): string {
  const script = step.inputs.script ?? '';
  return ensureTrailingNewline(script);
}

/**
 * The body of a native pwsh/powershell step: the PowerShell script run through `pwsh` on this
 * host (docs/04 §241), inside a quoted heredoc so bash never expands the PowerShell `$` while the
 * runtime's textual macro pass still rewrites any `$( )` before execution. `errorActionPreference`
 * is the one preference input reproduced here, as the documented `$ErrorActionPreference`
 * (docs/03 §75); the remaining PowerShell@2 preference inputs are left to real-task mode (E07).
 */
function pwshBody(step: Step): string {
  const prefs: string[] = [];
  const errorActionPreference = step.inputs.errorActionPreference;
  if (errorActionPreference !== undefined && errorActionPreference !== '') {
    prefs.push(`$ErrorActionPreference = '${errorActionPreference}'`);
  }
  const script = step.inputs.script ?? '';
  return [
    "pwsh -NoLogo -NoProfile -Command - <<'AZDO_EMU_PWSH'",
    ...prefs,
    ensureTrailingNewline(script).replace(/\n$/, ''),
    'AZDO_EMU_PWSH',
    '',
  ].join('\n');
}

/**
 * The body of a non-script task until E07 lands: a stub that logs the task identity and dumps its
 * resolved inputs (macros intact — the runtime expands them). The `run_task.sh` dispatch and the
 * real-task `INPUT_*` contract are E07-S01/S03; this is the honest fallback in the meantime.
 */
function stubBody(step: Step): string {
  const lines = [
    `printf '%s\\n' 'azdo-emu: stub — ${taskRef(step)} (inputs only; the step does not run)'`,
    "cat <<'AZDO_EMU_STUB_INPUTS'",
    `task: ${taskRef(step)}`,
    ...Object.entries(step.inputs).map(([key, value]) => `  ${key}: ${value}`),
    'AZDO_EMU_STUB_INPUTS',
    '',
  ];
  return lines.join('\n');
}

/**
 * A real-task step: hand off to the runner E07-S01-T02 emits.
 *
 * The `INPUT_*` construction lives in `task-host.ts` and needs the task's own `task.json`, which
 * this module does not have — the emitter writes the dispatch, `run_task.sh` reads the cached
 * definition and builds the environment. Keeping the split means the `INPUT_*` contract has exactly
 * one implementation (C-E07-001..004) rather than one here and one there.
 */
/**
 * A `checkout:` step: call the runtime's own implementation (E06-S05-T02).
 *
 * Emitted natively because the runtime performs the checkout itself — there is no task package to
 * run. The input names are the `checkout` shorthand's, and each maps to one `azdo_checkout` flag;
 * an input the runtime has no flag for is passed through as a header note rather than dropped, so
 * an unhandled option is visible in the script instead of silently ignored.
 */
const CHECKOUT_FLAGS: Readonly<Record<string, string>> = {
  repository: '--repository',
  clean: '--clean',
  fetchDepth: '--fetch-depth',
  fetchTags: '--fetch-tags',
  lfs: '--lfs',
  submodules: '--submodules',
  path: '--path',
  persistCredentials: '--persist-credentials',
  fetchFilter: '--fetch-filter',
  sparseCheckoutDirectories: '--sparse-checkout-directories',
  sparseCheckoutPatterns: '--sparse-checkout-patterns',
};

function checkoutBody(step: Step): string {
  const args: string[] = [];
  const unmapped: string[] = [];
  for (const [key, value] of Object.entries(step.inputs)) {
    const flag = CHECKOUT_FLAGS[key];
    if (flag === undefined) {
      unmapped.push(key);
      continue;
    }
    args.push(`${flag} ${shellSingleQuote(value)}`);
  }
  return [
    ...unmapped.map(
      (key) => `# note: checkout input '${key}' has no runtime flag and is not applied`,
    ),
    `azdo_checkout ${args.join(' ')}`.trimEnd(),
    '',
  ].join('\n');
}

/** Single-quote a value so it reaches the runtime verbatim — an input is data, never shell. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function realTaskBody(step: Step): string {
  const inputs = Object.entries(step.inputs)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n');
  return [
    `# Real-task mode: run ${taskRef(step)} against the emulated task-lib.`,
    '# run_task.sh resolves the cached task.json, builds INPUT_* from these inputs, and execs the',
    "# task's own handler. The INPUT_* name transform is task-lib's (C-E07-001).",
    "azdo_run_task <<'AZDO_EMU_TASK_INPUTS'",
    `task: ${taskRef(step)}`,
    ...(inputs.length > 0 ? [inputs] : []),
    'AZDO_EMU_TASK_INPUTS',
    '',
  ].join('\n');
}

/**
 * Emit one step as the full `.sh` file content (docs/04 §12).
 *
 * `number` is the zero-padded `NNN-` prefix the scaffolder assigned (e.g. `"030"`), used in the
 * header's `Step 030` rule line so the file name and the header agree.
 */
export function emitStepScript(
  step: Step,
  number: string,
  options: DispositionOptions = {},
): string {
  // One decision, taken once, driving both the label and the body (E07-S03-T01). Before the
  // registry these were computed separately and could disagree.
  const disposition = disposeStep(step, options);
  const kind = nativeScriptKind(step);

  let body: string;
  if (kind === 'script' || kind === 'bash') {
    body = nativeScriptBody(step);
  } else if (kind === 'pwsh' || kind === 'powershell') {
    body = pwshBody(step);
  } else if (step.origin === 'checkout') {
    body = checkoutBody(step);
  } else if (disposition.disposition === 'real-task') {
    body = realTaskBody(step);
  } else {
    body = stubBody(step);
  }
  return `${header(step, number, disposition)}\n${PREAMBLE}\n${body}`;
}
