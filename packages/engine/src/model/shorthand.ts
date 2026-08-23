// E04-S01-T02 — the normalization boundary: what the service already desugars, and what is left.
//
// Measured across nine probes (`research/experiments/E04-normalization/`, C-E04-030..037), and the
// answer inverts the task's own instruction. It says to normalize "only the remainder"; the
// remainder in that sense is **empty** — every documented shorthand (`script`, `bash`, `pwsh`,
// `powershell`, `publish`, `download`, `checkout`) comes back as `task: …@version`, so a pass that
// rewrote `bash:` into `Bash@3` would be a second, divergent implementation of work the authority
// already did (C-E04-030).
//
// What *is* left is the opposite problem. Three of those shorthands desugar to a **bare GUID**
// (C-E04-031), and PLAN D4 emits `checkout` natively — so a model carrying only
// `task: 6d15af64-…@1` has lost the keyword E05 needs to dispatch on. This module recovers it.
//
// **Why this does not contradict the normalizer.** `normalize.ts` deliberately refuses to give the
// `checkout` and `download` GUIDs a *name*: they are agent-internal, 404 from the task catalogue,
// and an invented name would make its diff lie (C-E12-019). Recording "this step came from the
// `checkout` keyword" is a different fact — measured by submitting that keyword and reading the
// expansion (C-E04-032), and not a claim about the catalogue. `TASK_GUID_NAMES` keeps its single
// grounded entry; this table sits beside it and answers a different question (C-E04-033).

/** The authored keyword a step was desugared from, when it is recoverable. */
export type StepOrigin = 'checkout' | 'download' | 'publish';

/**
 * Agent-internal GUIDs, mapped to the keyword the author wrote.
 *
 * Each association is measured, not inferred from the name: the probe submitted that keyword and
 * read the GUID out of the expansion (C-E04-032).
 */
export const ORIGIN_BY_TASK_GUID: Readonly<Record<string, StepOrigin>> = {
  // `checkout: self` → inputs `{repository: self}`.
  '6d15af64-176c-496d-b583-fd2ae21d4df4': 'checkout',
  // `download: current` → inputs `{alias: current, artifact: …}`. **Not** the catalogue's
  // `DownloadPipelineArtifact@2`, which is a genuinely different task (C-E04-034).
  '30f35852-3f7e-4c0c-9a88-e127b4f97211': 'download',
  // `publish: <path>` → inputs `{path: …, artifactName: …}`. This one *does* have a catalogue name,
  // `PublishPipelineArtifact` (C-E12-019) — the origin keyword is still worth recording, because
  // the emitter dispatches on what the author wrote.
  'ecdc45f6-832d-4ad9-b52b-ee49e94659be': 'publish',
};

/**
 * The keyword a task reference was desugared from, or `undefined` for an ordinary task.
 *
 * Matching is case-insensitive on the GUID because a GUID has no canonical case and nothing
 * guarantees the service's rendering stays lower-case.
 */
export function stepOriginOf(taskName: string): StepOrigin | undefined {
  return ORIGIN_BY_TASK_GUID[taskName.toLowerCase()];
}

/**
 * Shorthands that reach the model **only** as canonical named tasks, with the name they arrive as.
 *
 * Exported as documentation rather than as a lookup: nothing needs to map back, because the name is
 * already the identity. It exists so a reader can see the whole measured matrix in one place, and
 * so a later task that wonders "do we desugar `bash:`?" finds the answer as data.
 */
export const DESUGARED_TO_NAMED_TASK: Readonly<Record<string, string>> = {
  script: 'CmdLine@2',
  bash: 'Bash@3',
  // Both spellings land on the same task and are told apart by the `pwsh: true` **input**, not by
  // the task reference (C-E04-037) — anything dispatching on the reference alone cannot see it.
  pwsh: 'PowerShell@2',
  powershell: 'PowerShell@2',
};

/**
 * `getPackage` is absent from both tables on purpose.
 *
 * Without a matching `resources.packages` entry the service rejects the pipeline outright —
 * `Cannot find package resource for pkg`, HTTP 400 (C-E04-035) — so the shorthand is resource-gated
 * rather than free-standing, and nothing reaches the model to normalize. Measuring its desugared
 * form needs a package resource provisioned in the test organization, which no current task does.
 */
export const UNMEASURED_SHORTHANDS: readonly string[] = ['getPackage'];
