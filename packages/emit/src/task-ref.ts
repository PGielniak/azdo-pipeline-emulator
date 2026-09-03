/**
 * Two facts every emit module needs about a step, in a module that depends on nothing else.
 *
 * They lived in `step.ts` and are re-exported from there, so nothing about the public surface
 * changed. They were split out in E08-S02-T01 because the connection collector needs both and
 * `step.ts` in turn needs the collector — a cycle that ESM tolerates and a reader should not have
 * to.
 */

import type { Step } from '@azdo-emu/engine';

/** The full `Name@version` spelling of a step's task reference (for the header and stub dump). */
export function taskRef(step: Step): string {
  return `${step.task.name}@${step.task.version}`;
}

/** True when the text contains an ADO macro opener `$(`. */
export function hasMacro(text: string): boolean {
  return text.includes('$(');
}
