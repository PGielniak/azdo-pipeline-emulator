/**
 * The task disposition registry (E07-S03-T01).
 *
 * One question, asked once per step: **how does this task run here?** The answer drives both the
 * emitter's dispatch (`native` bash vs the E07 runner vs a stub) and the per-step fidelity label
 * PLAN §6 requires. Before this module the two were decided in different places — `step.ts`'s
 * `defaultFidelity` guessed "everything non-script is `stub`" because real-task mode did not exist
 * yet — and a registry that disagreed with the emitter would put a label on a step that is not what
 * the step actually does.
 *
 * The resolution order (Do, PLAN D4):
 *
 *  1. **native** — the four script kinds the emitter writes as readable bash, plus `checkout`, which
 *     the runtime performs itself. `CmdLine@2`/`Bash@3`/`PowerShell@2` land here **even though they
 *     have real Node handlers**: running their package would re-exec a script the emitter has
 *     already written natively (E07-S01-T03's "no double-exec").
 *  2. **real-task** — everything else, provided a package is available.
 *  3. **stub** — the degradation when it is not, always with a warning naming why (PLAN D10: every
 *     conversion emits a warnings list; nothing degrades silently).
 *
 * Grounding note: the tiers and the ordering are **internal design** (PLAN D4 + §6, docs/03 §6), not
 * Azure DevOps behavior, so this module carries no `C-` claims of its own. The one externally
 * grounded input is the `execution` shape it reads, which E07-S01-T02 pinned (C-E07-006).
 */

import type { Step } from '@azdo-emu/engine';

import { nativeScriptKind, type NativeScriptKind } from './step.js';
import { taskRef } from './task-ref.js';

/** How a step runs locally. */
export type Disposition = 'native' | 'real-task' | 'stub';

/** PLAN §6's tiers. `unsupported` is reserved for convert-time refusals, which no task reaches. */
export type Fidelity = 'exact' | 'degraded' | 'stub';

export interface StepDisposition {
  readonly disposition: Disposition;
  readonly fidelity: Fidelity;
  /** `script`/`bash`/`pwsh`/`powershell` for a native script step, `checkout` for a checkout. */
  readonly kind: string;
  /** One line for the README's warnings list; absent when nothing is degraded. */
  readonly warning?: string;
}

/**
 * Tasks the runtime performs itself rather than by running a package.
 *
 * `checkout` arrives as a bare GUID and is recovered through `step.origin` (docs/04 §12), which is
 * why it is matched on the origin rather than on the task name.
 */
const NATIVE_ORIGINS = new Set(['checkout']);

/** What the emitter can tell about a task package without downloading it. */
export interface PackageAvailability {
  /** The cached `task.json`, when E07-S01-T01 has fetched one. */
  readonly definition?: { readonly execution?: Readonly<Record<string, unknown>> };
  /** False when the package could not be downloaded — the reason is quoted into the warning. */
  readonly available?: boolean;
  readonly unavailableReason?: string;
}

export interface DispositionOptions {
  /** Keyed by `Name@major`, the spelling `taskRef` produces. */
  readonly packages?: Readonly<Record<string, PackageAvailability>>;
}

function fidelityForNative(kind: NativeScriptKind): Fidelity {
  // `script` and `bash` run verbatim; PowerShell runs through `pwsh` on this host (docs/04 §241).
  return kind === 'script' || kind === 'bash' ? 'exact' : 'degraded';
}

/**
 * Classify one step.
 *
 * A step with no package information resolves to `real-task` rather than `stub`: at convert time the
 * package may simply not have been fetched yet, and defaulting to `stub` would label a task that
 * will run perfectly well as one that does nothing. Only an *explicit* `available: false` degrades.
 */
export function disposeStep(step: Step, options: DispositionOptions = {}): StepDisposition {
  const scriptKind = nativeScriptKind(step);
  if (scriptKind !== undefined) {
    // E07-S01-T03: these have real Node handlers, and running them would double-exec a script the
    // emitter already wrote natively. The handler is deliberately not consulted.
    return { disposition: 'native', fidelity: fidelityForNative(scriptKind), kind: scriptKind };
  }

  if (step.origin !== undefined && NATIVE_ORIGINS.has(step.origin)) {
    return { disposition: 'native', fidelity: 'exact', kind: step.origin };
  }

  const reference = taskRef(step);
  const info = options.packages?.[reference];
  if (info?.available === false) {
    return {
      disposition: 'stub',
      fidelity: 'stub',
      kind: step.origin ?? reference,
      warning:
        `\`${reference}\` runs as a stub: ${info.unavailableReason ?? 'its package could not be fetched'}. ` +
        'Its inputs are logged and the step succeeds without doing the task’s work.',
    };
  }

  // E08-S02-T04: a task whose only handler is `PowerShell3` cannot run faithfully here, and this is
  // the place to say so — before the step is written, not after the run produces a wall of errors.
  //
  // The reason is not the shell. It is that the `PowerShell3` contract is "the agent imports
  // `VstsTaskSdk` from the task's own `ps_modules` and *then* dot-sources the script"; our host
  // execs `pwsh -File`, which imports nothing. Measured against the real `AzureFileCopy@6.278.1`
  // (C-E08-076): `Trace-VstsEnteringInvocation` on line 4 is undefined, and because PowerShell's
  // errors are non-terminating the script runs on through **19** more `is not recognized` errors
  // before dying on a null dereference. A stub with a reason is strictly better than that.
  if (info?.definition !== undefined && onlyPowerShellHandler(info.definition.execution)) {
    return {
      disposition: 'stub',
      fidelity: 'stub',
      kind: step.origin ?? reference,
      warning:
        `\`${reference}\` runs as a stub: it ships only a \`PowerShell3\` handler, whose contract is ` +
        'that the agent imports `VstsTaskSdk` from the task’s `ps_modules` before running the ' +
        'script (C-E08-076). This host runs `pwsh -File`, which imports nothing, so every ' +
        '`Get-VstsInput` in the task is undefined. Its inputs are logged and the step succeeds ' +
        'without doing the task’s work.',
    };
  }

  return { disposition: 'real-task', fidelity: 'degraded', kind: step.origin ?? reference };
}

/** True when the `execution` block names a PowerShell handler and no Node one. */
function onlyPowerShellHandler(execution: Readonly<Record<string, unknown>> | undefined): boolean {
  if (execution === undefined) return false;
  const keys = Object.keys(execution);
  if (keys.length === 0) return false;
  // Mirrors `resolveHandler`'s preference order: a Node handler wins, and we can run it.
  if (keys.some((key) => key.startsWith('Node'))) return false;
  return keys.some((key) => key.startsWith('PowerShell'));
}

/**
 * Every warning the registry produces for a pipeline, de-duplicated by task reference.
 *
 * A pipeline that uses the same unavailable task in twenty steps should say so once — a warnings
 * list nobody reads to the end is the same as no warnings list (PLAN D10).
 */
export function dispositionWarnings(
  steps: readonly Step[],
  options: DispositionOptions = {},
): readonly string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];
  for (const step of steps) {
    const warning = disposeStep(step, options).warning;
    if (warning === undefined || seen.has(warning)) continue;
    seen.add(warning);
    warnings.push(warning);
  }
  return warnings;
}

/** Counts for the README's fidelity summary — a table, never a percentage (PLAN D10). */
export function dispositionSummary(
  steps: readonly Step[],
  options: DispositionOptions = {},
): Readonly<Record<Disposition, number>> {
  const summary: Record<Disposition, number> = { native: 0, 'real-task': 0, stub: 0 };
  for (const step of steps) summary[disposeStep(step, options).disposition] += 1;
  return summary;
}
