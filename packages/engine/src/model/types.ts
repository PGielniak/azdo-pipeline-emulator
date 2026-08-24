// E04-S01-T01 — the semantic model of docs/01 §6.
//
// This is the typed shape emission and `doctor` work from, built from the **service's** `finalYaml`
// rather than from a locally expanded DOM (PLAN D3; the epic's re-scope note). What that buys is
// stated in C-E04-001: every expansion the service returns is rooted at `stages:`, so the builder
// receives one shape and not the several the raw schema allows.
//
// **Fields this task does not populate are typed but marked, not omitted.** docs/01 §6 is the
// spec, and a type that silently lacked `disposition` or `matrixKey` would make the later tasks
// look optional. Each such field names the task that fills it, so a reader can tell "not built yet"
// from "deliberately absent".
import type { SourceRange } from '../frontend/parse.js';
import type { StepOrigin } from './shorthand.js';
import type { VariableDeclaration } from './variables.js';

/** Where a model node came from in the expanded document. */
export interface ModelProvenance {
  readonly file: string;
  readonly range: SourceRange;
}

/** `agent` runs steps on the machine; `server` is an agentless job; `deployment` is a strategy job. */
export type JobKind = 'agent' | 'server' | 'deployment';

/** Where a step runs. The service always delivers the object form (C-E04-062). */
export interface StepTarget {
  /** Container alias, or the literal `host`. */
  readonly container: string;
  /** Command-restriction mode, when the author set one. */
  readonly commands?: string;
}

/** `Name@version` as written in the expanded document. */
export interface TaskReference {
  readonly name: string;
  /** The text after `@`, kept verbatim: it may be a major (`2`) or a full version. */
  readonly version: string;
}

export interface Step {
  /** Ordinal within its job, 1-based — the `id` of docs/01 §6, not the authored `name`. */
  readonly id: number;
  /** The authored `name:`, which output variables reference. Absent when the author wrote none. */
  readonly name?: string;
  readonly displayName: string;
  readonly task: TaskReference;
  /**
   * The shorthand keyword the service desugared this step from, when it is recoverable.
   *
   * Only the three agent-internal GUIDs carry one (C-E04-031/032): `checkout`, `download` and
   * `publish` arrive as a bare GUID with the authored keyword gone, and PLAN D4 emits `checkout`
   * natively — so without this the emitter has nothing to dispatch on. A `bash:` step needs no
   * origin: it arrives as `Bash@3`, and the name is already the identity (C-E04-030).
   */
  readonly origin?: StepOrigin;
  readonly inputs: Readonly<Record<string, string>>;
  readonly condition?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly continueOnError: boolean;
  /** Minutes, as authored. `0` means "no limit" in Azure Pipelines and is preserved, not defaulted. */
  readonly timeoutInMinutes?: number;
  readonly retryCountOnTaskFailure: number;
  /**
   * Does this step run at all? `enabled: false` **survives expansion** — the step is still in the
   * document — so skipping it is the runner's job, not something already done for us (C-E04-064).
   */
  readonly enabled: boolean;
  /**
   * Where the step runs. Always the object form: the service normalizes the scalar shorthand, so
   * `target: host` arrives as `{container: 'host'}` and `host` is a container *name* rather than a
   * distinct kind (C-E04-062).
   */
  readonly target?: StepTarget;
  /**
   * Read from the task's **inputs**, not from the step mapping.
   *
   * `workingDirectory` is not a common step property — the schema page does not list it and the
   * expansion puts it in `inputs` (C-E04-061). It is surfaced here because docs/01 §6 puts it on
   * the model and every consumer wants it in one place, but the value comes from where it lives.
   */
  readonly workingDirectory?: string;
  /**
   * Also an input rather than a step property, and for a sharper reason: `failOnStderr` is the
   * Bash/PowerShell shortcuts' own flag and not an agent-level input at all (C-E06-033, C-E04-061).
   */
  readonly failOnStderr: boolean;
  readonly provenance: ModelProvenance;
  /** E07-S03-T01: `native | real-task | stub`. Unset until the disposition registry lands. */
  readonly disposition?: 'native' | 'real-task' | 'stub';
  /** E05-S02-T02 / PLAN §6: the fidelity label. Unset until the emitter assigns one. */
  readonly fidelity?: 'exact' | 'equivalent' | 'degraded' | 'stub' | 'unsupported';
  /** Convert-time notes for the README's warnings list (E05-S02-T02). */
  readonly warnings: readonly string[];
}

export interface Job {
  /**
   * The job's identity as the service wrote it.
   *
   * **May be the empty string** (C-E04-004): an explicitly authored but unnamed `- job:` keeps `''`
   * rather than receiving the synthetic `Job` the service invents for a bare `steps:` root. Nothing
   * deriving a path or a filename from this may assume it is non-empty.
   */
  readonly id: string;
  readonly displayName?: string;
  readonly kind: JobKind;
  readonly dependsOn: readonly string[];
  readonly condition?: string;
  /**
   * This scope's `variables:` **as authored**, not layered.
   *
   * The expansion resolves no precedence and collapses no duplicates (C-E04-080/081), so the raw
   * declarations are what arrives — including two entries of the same name. Use
   * `resolveVariables()` to layer root → stage → job.
   */
  readonly variables: readonly VariableDeclaration[];
  readonly steps: readonly Step[];
  readonly timeoutInMinutes?: number;
  readonly provenance: ModelProvenance;
  /** E04-S03: the matrix leg this job was expanded from. Unset before matrix expansion. */
  readonly matrixKey?: string;
  /**
   * E04-S03: `strategy.maxParallel` — the maximum number of simultaneous legs, recorded verbatim.
   *
   * It is a scheduling cap, not a shape change (C-E04-113): `0`/absent means "no limit", and it does
   * not merge or drop legs. Carried so E05 can surface it; the local runner is sequential anyway.
   */
  readonly maxParallel?: number;
  /** E04-S02-T04 / docs/01 §5: `container:` and `services:`. Carried raw until then. */
  readonly container?: string;
}

export interface Stage {
  readonly id: string;
  readonly displayName?: string;
  readonly dependsOn: readonly string[];
  readonly condition?: string;
  /** As authored; see `Job.variables`. */
  readonly variables: readonly VariableDeclaration[];
  readonly jobs: readonly Job[];
  readonly provenance: ModelProvenance;
}

export interface Pipeline {
  readonly name?: string;
  /** Root `parameters:` declarations, by name, with their default rendered as text. */
  readonly parameters: Readonly<Record<string, string>>;
  /** As authored; see `Job.variables`. */
  readonly variables: readonly VariableDeclaration[];
  readonly stages: readonly Stage[];
  readonly provenance: ModelProvenance;
}
