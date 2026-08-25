// E05-S01-T01 — the project scaffolder: what `convert` writes under `stages/`.
//
// This is a pure, deterministic plan of the generated directory tree (docs/04 §1). It owns the
// three things the tree layout is made of, and nothing else:
//
//   1. the `NNN-` numbering — `010`, `020`, … — which leaves gaps for hand-inserted debugging
//      steps (docs/04 §1: "Numbering (`010-`) leaves gaps …"),
//   2. the fs-safe slug of a `displayName` (fallback: the node's id, then the task name), and
//   3. collision handling, so two names that slug to the same directory still get distinct dirs.
//
// Grounding: this is an internal spec (docs/04 §1), not Azure DevOps behavior — the service has no
// filesystem to copy, so every naming rule here is ours. The slug edge cases (parentheses, slashes,
// matrix-key suffixes) are validated against the corpus in the test suite, which is the "validated
// against real pipelines" half of the task's Ground field. No research claim is recorded for the
// same reason E04-S03-T04 and E06-S06-T02 recorded none: there is no primary source to cite.
//
// The rules are decided here and in docs/06 §5 decision 60:
//   - `slugify` lower-cases and maps every run of non-`[a-z0-9]` to a single `-` (then trims),
//     which is why "Build src/app" → `build-src-app` and "Staging (runOnce)" → `staging-runonce`;
//     lower-casing is deliberate — two names differing only in case would collide on a
//     case-insensitive filesystem, and this repo has already been bitten by exactly that (C-E03-204).
//   - a stage/step is numbered by its 1-based ordinal within its parent (×10, zero-padded to 3); a
//     job is numbered by its *group's* ordinal, so the legs of one matrix/`parallel:` job share a
//     number and differ only by suffix.
//   - a matrix leg or `parallel:` slice appends `__<suffix>` to the job directory (docs/04 §1's
//     "matrix jobs: `010-BuildJob__linux_x64/`"); the suffix is slugged like any other name.
//   - a runOnce deployment job's steps are the union of its lifecycle hooks in fixed order
//     (`preDeploy → deploy → routeTraffic → postRouteTraffic → onFailure → onSuccess`, C-E04-146),
//     flattened into one `steps/` directory with the hook recorded per step so E08 can recover the
//     grouping; `rolling`/`canary` jobs carry no steps (they are a bare marker, E04-S03-T03).
import type { Job, Pipeline, Stage, Step } from '@azdo-emu/engine';

/**
 * The generated `.gitignore` (docs/04 §1 and docs/05 §4).
 *
 * `.cache/` is included even though docs/04 §1's comment lists only "`.env .work/ .artifacts/
 * logs`", because docs/05 §4 (the more recent, security-aware statement) requires it: cached repo
 * snapshots may contain private source and are treated as secret-adjacent. `logs` is omitted
 * because logs live under `.work/` (docs/04 §1), which is already ignored.
 */
export const GITIGNORE = '.env\n.work/\n.artifacts/\n.cache/\n';

/** The runOnce lifecycle hooks in their fixed authored order (C-E04-146). */
const RUNONCE_HOOK_ORDER = [
  'preDeploy',
  'deploy',
  'routeTraffic',
  'postRouteTraffic',
  'onFailure',
  'onSuccess',
] as const;

/** One step in the tree, plus the hook it came from (set only for a runOnce deployment job). */
export interface ScaffoldStep {
  /** Path relative to the project root, POSIX-separated, e.g. `stages/010-build/jobs/010-build/steps/010-build-solution.sh`. */
  readonly path: string;
  /** The `NNN-` number prefix of this step's file (e.g. `"010"`), for the header's `Step 030` rule line. */
  readonly number: string;
  /** The model step this file will emit (E05-S01-T02). */
  readonly step: Step;
  /** The runOnce hook this step lives in, when the job is a `runOnce` deployment. */
  readonly hook?: string;
}

export interface ScaffoldJob {
  /** The directory name, e.g. `010-build` or `010-build__linux-debug`. */
  readonly name: string;
  /** Path relative to the project root, e.g. `stages/010-build/jobs/010-build`. */
  readonly dir: string;
  readonly job: Job;
  readonly steps: readonly ScaffoldStep[];
}

export interface ScaffoldStage {
  readonly name: string;
  readonly dir: string;
  readonly stage: Stage;
  readonly jobs: readonly ScaffoldJob[];
}

/** The deterministic plan of the `stages/` subtree plus the generated `.gitignore`. */
export interface Scaffold {
  readonly stages: readonly ScaffoldStage[];
  readonly gitignore: string;
  /**
   * Every directory the scaffold creates, relative to the project root, in creation order
   * (parents before children). `.gitignore` is the only *file* this task owns; every other file
   * in docs/04 §1 belongs to a later emitter task.
   */
  readonly directories: readonly string[];
}

/**
 * The fs-safe slug of a name: lower-cased, every run of non-`[a-z0-9]` collapsed to one `-`,
 * leading/trailing `-` trimmed. Returns `''` for input with no alphanumeric characters, so callers
 * must fall back (see `slugOf`).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `010`, `020`, … — the 1-based ordinal × 10, zero-padded, leaving gaps for hand-inserted steps. */
export function number(ordinal: number): string {
  return String(ordinal * 10).padStart(3, '0');
}

/**
 * The slug for a stage/job/step, applying the displayName → id → kind-token fallback chain
 * (docs/04 §1: "Names are slugged `displayName` (fallback: task name)"). Steps always carry a
 * `displayName` (the builder defaults one, docs/01 §6), but a stage or job id may be the empty
 * string (C-E04-004), so the kind token is the last resort.
 */
function slugOf(displayName: string | undefined, id: string | undefined, kind: string): string {
  if (displayName !== undefined) {
    const slug = slugify(displayName);
    if (slug !== '') return slug;
  }
  if (id !== undefined) {
    const slug = slugify(id);
    if (slug !== '') return slug;
  }
  return kind;
}

/**
 * The `__<suffix>` part of a strategy-expanded job's directory name, or `undefined` for a plain job.
 *
 * A matrix leg carries its key in `matrixKey` (C-E04-110); a `parallel:` slice does not set
 * `matrixKey`, so its position is recovered from the `id` suffix the strategy expansion appended
 * (`<referenceName> <position>`, C-E04-121). The base job of an empty or runtime-expression matrix
 * is indistinguishable from a plain job (`id === referenceName`) and gets no suffix.
 */
function strategySuffix(job: Job): string | undefined {
  if (job.matrixKey !== undefined) return job.matrixKey;
  if (job.id === job.referenceName) return undefined;
  const prefix = `${job.referenceName} `;
  return job.id.startsWith(prefix) ? job.id.slice(prefix.length) : undefined;
}

/**
 * The steps of a job as `{ step, hook? }` entries, in emission order.
 */
function stepEntries(job: Job): readonly { step: Step; hook?: string }[] {
  if (job.kind === 'deployment' && job.strategy?.kind === 'runOnce') {
    const entries: { step: Step; hook?: string }[] = [];
    for (const hook of RUNONCE_HOOK_ORDER) {
      const hookSteps = job.strategy[hook]?.steps ?? [];
      for (const step of hookSteps) entries.push({ step, hook });
    }
    return entries;
  }
  return job.steps.map((step) => ({ step }));
}

/**
 * Group a stage's jobs by `referenceName`, preserving first-appearance order.
 *
 * A matrix job and a `parallel:` job are each *one* authored job that the model expands into
 * several `Job` objects sharing a `referenceName` (C-E04-136). The scaffolder must number the
 * *group* once and distinguish the legs by suffix, so the legs of `010-Build` are
 * `010-Build__linux-debug`, `010-Build__linux-release`, … — the shape docs/04 §1's
 * "`010-BuildJob__linux_x64/`" comment shows — rather than each leg consuming its own number
 * (`010-…`, `020-…`), which would misread the matrix as three authored jobs. Distinct jobs have
 * distinct `referenceName`s (the service rejects duplicate job names), so grouping on it never
 * merges two jobs; it only re-unites a job with its own legs.
 */
function jobGroups(jobs: readonly Job[]): readonly (readonly Job[])[] {
  const groups: Job[][] = [];
  const byReference = new Map<string, Job[]>();
  for (const job of jobs) {
    const existing = byReference.get(job.referenceName);
    if (existing === undefined) {
      const group = [job];
      byReference.set(job.referenceName, group);
      groups.push(group);
    } else {
      existing.push(job);
    }
  }
  return groups;
}

/** Append `-2`, `-3`, … until the candidate is not already taken. */
function uniquify(candidate: string, taken: ReadonlySet<string>): string {
  if (!taken.has(candidate)) return candidate;
  let i = 2;
  while (taken.has(`${candidate}-${i}`)) i += 1;
  return `${candidate}-${i}`;
}

/** The input that distinguishes a shorthand-desugared step, per origin, and its default when absent. */
export const ORIGIN_DISTINGUISHER: Readonly<
  Record<'checkout' | 'download' | 'publish', { readonly input: string; readonly fallback: string }>
> = {
  checkout: { input: 'repository', fallback: 'self' },
  download: { input: 'alias', fallback: 'current' },
  publish: { input: 'artifactName', fallback: 'artifact' },
};

/**
 * The readable label of a shorthand-desugared step whose `displayName` is the builder's GUID
 * default, or `undefined` for any other step (which uses its `displayName` as-is).
 *
 * `checkout`/`download`/`publish` arrive as a bare GUID task (C-E04-031) and the builder defaults
 * their `displayName` to that GUID (docs/01 §6) — `010-6d15af64-….sh` is not navigable. The
 * `displayName === task.name` guard is what tells an *authored* `displayName:` apart from the
 * defaulted GUID, so a user-written name still wins. Shared by the scaffolder (file names) and the
 * step emitter (header display), so the two stay consistent.
 */
export function originStepLabel(step: Step): string | undefined {
  if (step.origin === undefined || step.displayName !== step.task.name) return undefined;
  const { input, fallback } = ORIGIN_DISTINGUISHER[step.origin];
  return `${step.origin}-${slugify(step.inputs[input] ?? '') || fallback}`;
}

/**
 * The slug for a step file name (docs/04 §1's `010-checkout-self.sh`).
 */
function stepSlug(step: Step): string {
  return originStepLabel(step) ?? slugOf(step.displayName, step.name, 'step');
}

export function scaffold(pipeline: Pipeline): Scaffold {
  const stages: ScaffoldStage[] = [];
  const directories: string[] = [];
  const stageNames = new Set<string>();

  if (pipeline.stages.length > 0) directories.push('stages');

  pipeline.stages.forEach((stage, stageIndex) => {
    const stageSlug = slugOf(stage.displayName, stage.id, 'stage');
    const stageName = uniquify(`${number(stageIndex + 1)}-${stageSlug}`, stageNames);
    stageNames.add(stageName);
    const stageDir = `stages/${stageName}`;
    directories.push(stageDir);

    const jobsDir = `${stageDir}/jobs`;
    const jobs: ScaffoldJob[] = [];
    const jobNames = new Set<string>();
    let groupIndex = 0;

    jobGroups(stage.jobs).forEach((group) => {
      // Number the *group* (the authored job), not each leg — see `jobGroups`.
      groupIndex += 1;
      const groupNumber = number(groupIndex);
      const first = group[0]!;
      const jobSlug = slugOf(first.displayName, first.referenceName, 'job');

      for (const job of group) {
        const suffix = strategySuffix(job);
        const jobName = uniquify(
          suffix === undefined
            ? `${groupNumber}-${jobSlug}`
            : `${groupNumber}-${jobSlug}__${slugify(suffix) || 'leg'}`,
          jobNames,
        );
        jobNames.add(jobName);
        const jobDir = `${jobsDir}/${jobName}`;
        directories.push(jobDir);

        const entries = stepEntries(job);
        const steps: ScaffoldStep[] = [];
        if (entries.length > 0) {
          const stepsDir = `${jobDir}/steps`;
          directories.push(stepsDir);
          const stepNames = new Set<string>();
          entries.forEach((entry, stepIndex) => {
            const fileName = uniquify(
              `${number(stepIndex + 1)}-${stepSlug(entry.step)}.sh`,
              stepNames,
            );
            stepNames.add(fileName);
            steps.push({
              path: `${stepsDir}/${fileName}`,
              number: number(stepIndex + 1),
              step: entry.step,
              ...(entry.hook === undefined ? {} : { hook: entry.hook }),
            });
          });
        }

        jobs.push({ name: jobName, dir: jobDir, job, steps });
      }
    });

    stages.push({ name: stageName, dir: stageDir, stage, jobs });
  });

  return { stages, gitignore: GITIGNORE, directories };
}
