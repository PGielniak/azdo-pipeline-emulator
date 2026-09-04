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

import { collectConnections, REAL_TASK_ENDPOINT_USE, type TaskDefinitions } from './connections.js';
import { connectionKind } from './service-connection.js';
import { disposeStep, type DispositionOptions, type StepDisposition } from './disposition.js';
import { originStepLabel } from './scaffold.js';
import { resolveTaskInputs } from './task-host.js';
import { hasMacro, taskRef } from './task-ref.js';

export { hasMacro, taskRef } from './task-ref.js';

/** The native script kinds the emitter produces readable bash for (PLAN D4, decision 49). */
export type NativeScriptKind = 'script' | 'bash' | 'pwsh' | 'powershell';

/** The fidelity label the header shows until E05-S02-T02/E07-S03-T01 assign the real one. */
export type DefaultFidelity = 'exact' | 'degraded' | 'stub';

/**
 * What a stubbed step does, from `tasks.unknown` in `azdo-emu.yaml`.
 *
 * The config spells these `stub | fail | prompt` while docs/03 §4 describes the *results* as
 * "skip default / fail / prompt" — the same three behaviours under two vocabularies. `stub` is the
 * skip-result default.
 */
export type StubPolicy = 'stub' | 'fail' | 'prompt';

export interface StepEmitOptions extends DispositionOptions {
  /** Defaults to `stub`, the documented default (docs/03 §4). */
  readonly stubPolicy?: StubPolicy;
  /**
   * Vendored `task.json` declarations, keyed `Name@major` (E08-S02-T01).
   *
   * Used only to find the step's service connection, so the emitted script can preflight it before
   * handing control to a task that will otherwise fail with `LIB_EndpointAuthNotExist` — a message
   * that names no variable.
   */
  readonly taskDefinitions?: TaskDefinitions;
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
function stubBody(step: Step, policy: StubPolicy): string {
  // docs/03 §4 fixes the wording. It was reworded by E12-S02-T03 — "no local handler" was
  // transpiler-era vocabulary, and under real-task mode the reason is a missing *package* — so the
  // text is quoted rather than paraphrased.
  const warning = `##[warning] Task '${taskRef(step)}' was stubbed — no runnable implementation locally`;
  const inputsJson = JSON.stringify(step.inputs, Object.keys(step.inputs).sort(), 2);

  const lines = [
    `printf '%s\\n' ${shellSingleQuote(warning)}`,
    '# The fully resolved inputs, as JSON, so a reader can see exactly what the real task would',
    '# have received (docs/03 §4).',
    "cat <<'AZDO_EMU_STUB_INPUTS'",
    inputsJson,
    'AZDO_EMU_STUB_INPUTS',
  ];

  switch (policy) {
    case 'fail':
      lines.push(
        '# tasks.unknown = fail: the step fails, so a pipeline that depends on this task stops here',
        '# rather than continuing on a result the task never produced.',
        `printf '%s\\n' ${shellSingleQuote(`##vso[task.complete result=Failed;]stubbed task ${taskRef(step)}`)}`,
        'exit 1',
      );
      break;
    case 'prompt':
      lines.push(
        '# tasks.unknown = prompt: ask, but only when someone is there to answer. A pipeline run',
        '# without a terminal must not block forever, so a non-interactive run takes the skip path.',
        'if [[ -t 0 ]]; then',
        `  read -r -p "Run ${taskRef(step)} manually, then press Enter to continue (or Ctrl-C to abort): " _`,
        'else',
        `  printf '%s\\n' 'azdo-emu: no terminal to prompt on; treating the stub as skipped'`,
        'fi',
        '',
      );
      break;
    default:
      lines.push('# tasks.unknown = stub (default): the step succeeds without doing the work.', '');
  }
  return lines.join('\n');
}

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

/**
 * The `azdo_sc_preflight` line for a step whose task authenticates through a service connection.
 *
 * Emitted only for the tasks whose source has been read (`REAL_TASK_ENDPOINT_USE`), and only when
 * the connection resolves to a literal name: preflighting a macro would check the spelling of the
 * macro rather than of the connection it becomes (C-E08-031).
 *
 * It runs *before* `azdo_run_task` for a reason the Do field did not anticipate. There is no
 * ambient glue to write — `AzureCLI@2` reads its endpoint with `required = true` and logs in
 * unconditionally (C-E08-036) — so the only useful thing to do first is fail with the `.env` lines
 * named, and warn about the local session the task is about to clear (C-E08-038/039).
 */
function preflightLines(step: Step, options: StepEmitOptions): readonly string[] {
  const definitions = options.taskDefinitions;
  if (definitions === undefined) return [];
  const { sites } = collectConnections([{ step, path: '' }], definitions);
  const site = sites.find(
    (candidate) =>
      candidate.value.length > 0 &&
      !hasMacro(candidate.value) &&
      REAL_TASK_ENDPOINT_USE[connectionTaskKey(candidate.taskRef)] !== undefined,
  );
  if (site === undefined) return [];
  const key = connectionTaskKey(site.taskRef);
  const kind = connectionKind(site.endpointType);
  // C-E08-043: the endpoint kind decides which fields exist, so the preflight is told which to
  // check. Checking the AzureRM set against a registry connection would call a complete one broken.
  // C-E08-053: an endpoint kind nobody has read has no field set to check, so there is nothing to
  // preflight and a checked-against-the-wrong-set failure would be worse than silence.
  if (kind === 'unknown') return [];
  const NOTES: Readonly<Record<string, readonly [string, string]>> = {
    dockerregistry: [
      '# the ENDPOINT_AUTH blob is derived from the .env keys before the task runs (C-E08-044), and',
      '# a missing credential surfaces as a TypeError inside the task, not as a named error (C-E08-045).',
    ],
    // C-E08-054: the arm is chosen by a `.env` value, so the preflight checks one field set of two
    // and says which — and unlike the Azure tasks, nothing here is destroyed on the way out.
    kubernetes: [
      '# the fields it needs depend on ENDPOINT_DATA_<name>_AUTHORIZATIONTYPE (C-E08-054), and an',
      '# unfilled kubeconfig reaches kubectl as an unreachable cluster, not as a named error.',
    ],
    azurerm: [
      '# it has no ambient',
      '# path (C-E08-036) and clears a local session on the way out (C-E08-038/039).',
    ],
  };
  /* istanbul ignore next -- every kind reaching here has an entry; the fallback is belt-and-braces. */
  const [lead, why] = NOTES[kind] ?? NOTES.azurerm!;
  return [
    `# ${site.taskRef} authenticates through service connection '${site.value}';`,
    lead,
    why,
    `azdo_sc_preflight ${shellSingleQuote(site.value)} ${shellSingleQuote(key)} ${shellSingleQuote(kind)}`,
    '',
  ];
}

/** `Name@major`, the spelling `REAL_TASK_ENDPOINT_USE` is keyed by. */
function connectionTaskKey(reference: string): string {
  const at = reference.lastIndexOf('@');
  /* istanbul ignore next -- `taskRef` always produces `Name@version`. */
  if (at <= 0) return reference;
  /* istanbul ignore next -- `split` on a non-empty string always yields a first element. */
  return `${reference.slice(0, at)}@${reference.slice(at + 1).split('.')[0] ?? ''}`;
}

function realTaskBody(step: Step, options: StepEmitOptions): string {
  // C-E08-073 (E08-S02-T03): the *declared defaults* belong here, not just what the author wrote.
  // On a real agent the agent builds `INPUT_*` from the task's declaration, so an input the step
  // omits still arrives carrying its `task.json` default; task-lib never reads `task.json` itself.
  // Emitting only the authored inputs made every such default arrive as `undefined`, and
  // `resolveTaskInputs` — built for exactly this in E07-S01-T02 — was exported, tested, and called
  // by nothing. Found by running the real `Kubernetes@1`: it crashed in `clusterconnection.ts`
  // dereferencing a kubectl path that was undefined because `versionOrLocation` (declared default
  // `version`) never reached it.
  //
  // Aliases collapse to the declared name on the way through, which is also the agent's behaviour:
  // the task reads its declared spelling and an alias never becomes an `INPUT_` of its own.
  const definition = options.taskDefinitions?.[connectionTaskKey(taskRef(step))];
  const entries =
    definition === undefined
      ? Object.entries(step.inputs)
      : resolveTaskInputs(definition, step.inputs).inputs.map((input) => [input.name, input.value]);
  const inputs = entries
    // A value spanning lines cannot survive the `name: value` heredoc, and a declared default that
    // is empty adds a line the task reads as unset either way (C-E07-002) — but it must still be
    // emitted, because a task reading the environment directly does see it.
    .map(([key, value]) => `  ${key}: ${String(value).replace(/\r?\n/g, ' ')}`)
    .join('\n');
  return [
    ...preflightLines(step, options),
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
export function emitStepScript(step: Step, number: string, options: StepEmitOptions = {}): string {
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
    body = realTaskBody(step, options);
  } else {
    body = stubBody(step, options.stubPolicy ?? 'stub');
  }
  return `${header(step, number, disposition)}\n${PREAMBLE}\n${body}`;
}
