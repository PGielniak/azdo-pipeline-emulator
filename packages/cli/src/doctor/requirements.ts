/**
 * The doctor↔task contract (E10-S04-T02).
 *
 * One registry says which external CLI each task shells out to, and one aggregation turns a
 * pipeline's steps into the `tools[]` the manifest carries and the doctor probes.
 *
 * **No entry carries a version floor, and that is the finding, not an omission** (C-E10-009). No
 * task in the priority set declares a minimum for the CLI it invokes: `demands` is `[]` on every
 * one that has the field. The tempting substitute is `minimumAgentVersion` — but that is a version
 * of the *Azure Pipelines agent*, not of the tool (C-E10-008), and reading `DockerV2`'s `2.172.0`
 * as "Docker ≥ 2.172.0" would demand a version that has never existed and report every installation
 * as outdated. The Ground field's "doctor never invents versions" is exactly this trap.
 *
 * So the doctor reports **presence**, not a floor, until a task research note supplies a real
 * minimum — at which point it goes in `min` here with its claim id.
 *
 * **The vendor matrices do not rescue this either** (C-E08-019). Kubernetes and Helm both publish
 * skew policies, but they state *supported-ness*, not *functionality*: neither says the older
 * version stops working, and a doctor that refused a kubectl a few minors behind would report a
 * perfectly functional setup as outdated. The bar for a `min` is evidence the tool **fails** below
 * it — a task-side version check, or a vendor statement that a feature the task uses arrived in a
 * given release. A support-lifecycle date is not that evidence (C-E08-020).
 */

import type { ToolRequirement } from './probe.js';

export interface TaskToolRequirement {
  readonly cmd: string;
  /**
   * Absent for every entry today (C-E10-009). When one is added it must cite a claim, because a
   * fabricated floor fails working setups.
   */
  readonly min?: string;
  /** Why this task needs the tool, and the claim or source that shows it. */
  readonly because: string;
}

/**
 * `Name@major` → the CLIs it invokes.
 *
 * Keyed by major only, because a task's tool dependency does not change with a patch release and
 * a per-patch registry would go stale on every upstream bump.
 */
export const TASK_TOOLS: Readonly<Record<string, readonly TaskToolRequirement[]>> = {
  'AzureCLI@2': [
    {
      cmd: 'az',
      because: "the task resolves `az` on PATH itself — `tl.which('az', false)` (C-E10-007)",
    },
  ],
  'AzurePowerShell@5': [
    {
      cmd: 'pwsh',
      because: 'its handler is PowerShell3 and it runs Az cmdlets in a PowerShell session',
    },
  ],
  'Docker@2': [
    { cmd: 'docker', because: 'the task shells out to the Docker CLI for build/push/login' },
  ],
  'DockerCompose@0': [{ cmd: 'docker', because: 'compose is invoked through the Docker CLI' }],
  'HelmDeploy@0': [
    { cmd: 'helm', because: 'the task drives the Helm CLI' },
    { cmd: 'kubectl', because: 'Helm resolves its cluster through the kubectl context' },
  ],
  'HelmInstaller@1': [{ cmd: 'helm', because: 'the installer produces a `helm` on PATH' }],
  'KubectlInstaller@0': [{ cmd: 'kubectl', because: 'the installer produces a `kubectl` on PATH' }],
  'Kubernetes@1': [{ cmd: 'kubectl', because: 'the task drives the kubectl CLI' }],
  'KubernetesManifest@1': [{ cmd: 'kubectl', because: 'manifests are applied through kubectl' }],
  'AzureCLI@1': [{ cmd: 'az', because: 'the V1 task invokes the same CLI as V2' }],
  'AzureFileCopy@6': [
    { cmd: 'azcopy', because: 'the task copies to blob/file storage through the AzCopy CLI' },
    { cmd: 'az', because: 'it authenticates the copy through the Azure CLI session' },
  ],
};

/** A step, reduced to what this module needs. */
export interface StepToolContext {
  /** `Name@major`, the spelling `TASK_TOOLS` is keyed by. */
  readonly taskRef: string;
  /** `StageId/JobId/StepOrdinal`, as the manifest's `neededBy` records it. */
  readonly path: string;
}

/** The `Name@major` key for a `Name@version` reference. */
export function toolKey(taskRef: string): string {
  const at = taskRef.lastIndexOf('@');
  if (at <= 0) return taskRef;
  const major = taskRef.slice(at + 1).split('.')[0] ?? '';
  return `${taskRef.slice(0, at)}@${major}`;
}

/** A registry of task → tools. Parameterised so the contract check is testable against a bad one. */
export type ToolRegistry = Readonly<Record<string, readonly TaskToolRequirement[]>>;

/** The requirements one task reference declares, or none. */
export function requirementsFor(
  taskRef: string,
  registry: ToolRegistry = TASK_TOOLS,
): readonly TaskToolRequirement[] {
  return registry[toolKey(taskRef)] ?? [];
}

/**
 * Aggregate a pipeline's steps into the manifest's `tools[]`.
 *
 * `neededBy` accumulates every step path that needs the tool and is de-duplicated: a pipeline using
 * `az` in twelve steps produces **one** entry listing twelve paths, not twelve entries — the doctor
 * output is meant to be read to the end.
 */
export function aggregateTools(
  steps: readonly StepToolContext[],
  registry: ToolRegistry = TASK_TOOLS,
): readonly ToolRequirement[] {
  const byCmd = new Map<string, { min?: string; neededBy: string[] }>();

  for (const step of steps) {
    for (const requirement of requirementsFor(step.taskRef, registry)) {
      const existing = byCmd.get(requirement.cmd);
      if (existing === undefined) {
        byCmd.set(requirement.cmd, {
          ...(requirement.min === undefined ? {} : { min: requirement.min }),
          neededBy: [step.path],
        });
        continue;
      }
      if (!existing.neededBy.includes(step.path)) existing.neededBy.push(step.path);
      // Two tasks needing the same tool keep the *higher* floor — the stricter requirement is the
      // one that must hold. Both being absent is the case today (C-E10-009).
      if (requirement.min !== undefined) {
        existing.min =
          existing.min === undefined || requirement.min > existing.min
            ? requirement.min
            : existing.min;
      }
    }
  }

  return [...byCmd.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cmd, entry]) => ({
      cmd,
      ...(entry.min === undefined ? {} : { min: entry.min }),
      neededBy: entry.neededBy,
    }));
}

/** A registry entry that would let a step fail at run time instead of at doctor time. */
export interface ContractViolation {
  readonly taskRef: string;
  readonly reason: string;
}

/**
 * The CI check the Do field asks for (C-E10-010).
 *
 * It runs over the registry itself, so a task added later cannot silently become a step that fails
 * with `command not found` at run time instead of failing the doctor before the run.
 */
export function checkToolContract(
  registry: ToolRegistry = TASK_TOOLS,
): readonly ContractViolation[] {
  const violations: ContractViolation[] = [];
  for (const [taskRef, requirements] of Object.entries(registry)) {
    if (!/^[^@]+@\d+$/.test(taskRef)) {
      violations.push({
        taskRef,
        reason: 'registry keys must be `Name@major`, with no minor part',
      });
    }
    if (requirements.length === 0) {
      violations.push({
        taskRef,
        reason: 'declares no tools; remove the entry or name what it needs',
      });
    }
    for (const requirement of requirements) {
      if (requirement.because.trim().length === 0) {
        violations.push({ taskRef, reason: `\`${requirement.cmd}\` has no reason recorded` });
      }
      // C-E10-008/009: a floor must come from a claim, never from `minimumAgentVersion`.
      if (requirement.min !== undefined && !/C-E\d{2}-\d{3}/.test(requirement.because)) {
        violations.push({
          taskRef,
          reason:
            `\`${requirement.cmd}\` declares min ${requirement.min} without citing a claim — ` +
            'doctor never invents versions',
        });
      }
    }
  }
  return violations;
}
