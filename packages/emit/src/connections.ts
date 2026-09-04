/**
 * Which service connections a pipeline references, and what running their tasks locally costs
 * (E08-S02-T01).
 *
 * E08-S01-T01 built the `.env` contract and left one hole: "nothing yet collects the connections a
 * pipeline references, because no step model exposes them". This is that collector, and the two
 * measurements that shape it both come from reading the tasks rather than from the schema.
 *
 *  - **Key on the declared input *type*, never on an input name** (C-E08-035). The connection input
 *    is `connectedServiceNameARM` on `AzureCLI@2` and `ConnectedServiceNameARM` on
 *    `AzurePowerShell@5` — same task family, different name *and* different case. What they share
 *    is `"type": "connectedService:AzureRM"`, so that prefix is the thing to match, and it
 *    generalizes to every other connection-taking task without a name list to maintain.
 *  - **A connection consumed in real-task mode cannot be `ambient`** (C-E08-036/037). The default
 *    mode reuses the developer's own `az` session (C-E08-005), but the real `AzureCLIV2` reads the
 *    endpoint scheme with `required = true` and then logs in unconditionally — and repoints
 *    `AZURE_CONFIG_DIR` at a throwaway directory, so an ambient session would be invisible even if
 *    the scheme read had passed. `ambient` stays correct for a *native* script step that calls `az`
 *    itself through `azdo_sc_login`; for a real task it is a mode that cannot work, and emitting it
 *    would produce a `.env` with no credential fields and a step that fails on the first line.
 *
 * The hazards this module reports are not fidelity notes. Both tasks **destroy a local session**
 * (C-E08-038/039), and a developer deserves to know that before the first run rather than after.
 */

import type { ManifestWarning, Step } from '@azdo-emu/engine';

import {
  connectionKind,
  type ConnectionKind,
  type ConnectionMode,
  type ServiceConnection,
} from './service-connection.js';
import { hasMacro, taskRef } from './task-ref.js';
import type { TaskDefinition } from './task-host.js';

/** C-E08-035: the declared-type prefix that marks an input as naming a service connection. */
export const CONNECTED_SERVICE_TYPE_PREFIX = 'connectedService:';

/** One place a pipeline named a connection. */
export interface ConnectionSite {
  /** The value as authored — a connection name, or a macro we cannot resolve. */
  readonly value: string;
  /** The declared input name it was bound to (not the alias, if the author wrote one). */
  readonly input: string;
  /** The endpoint kind after the `connectedService:` prefix, e.g. `AzureRM`. */
  readonly endpointType: string;
  /** `Name@version`, as the step writes it. */
  readonly taskRef: string;
  /** `StageId/JobId/step N`, the spelling the warnings list uses. */
  readonly path: string;
}

export interface CollectedConnections {
  readonly connections: readonly ServiceConnection[];
  readonly sites: readonly ConnectionSite[];
  readonly warnings: readonly ManifestWarning[];
}

/** A step plus where it sits, which the model does not carry on the step itself. */
export interface StepSite {
  readonly step: Step;
  readonly path: string;
}

/** Task definitions keyed by `Name@major` — the spelling `toolKey`/the vendor snapshot dirs use. */
export type TaskDefinitions = Readonly<Record<string, TaskDefinition>>;

/** `Name@major` for a `Name@version` reference. Mirrors the doctor registry's `toolKey`. */
function majorKey(reference: string): string {
  const at = reference.lastIndexOf('@');
  if (at <= 0) return reference;
  /* istanbul ignore next -- `split` on a non-empty string always yields a first element. */
  const major = reference.slice(at + 1).split('.')[0] ?? '';
  return `${reference.slice(0, at)}@${major}`;
}

/**
 * How a real task consumes an Azure service connection, where "real task" means one whose own
 * implementation reads `ENDPOINT_*` out of the environment.
 *
 * Only tasks verified by reading their source belong here. A task that is merely *suspected* of
 * reading an endpoint would get its connection forced to `sp`, asking the user for credentials on
 * a guess — the same failure C-E08-005 exists to avoid, in the other direction.
 */
export interface RealTaskEndpointUse {
  /**
   * Does the task *require* the endpoint in the environment, so that `ambient` cannot serve it?
   *
   * `true` for the two Azure tasks (C-E08-036/039). **`false` for `Docker@2`** (C-E08-043): its
   * `containerRegistry` input is not `required`, and a build with no connection is a supported
   * path. Hard-coding `true` here would force every Docker step's connection into `sp` mode and
   * demand credentials for a pipeline that needs none.
   */
  readonly requiresEndpoint: boolean;
  /** C-E08-040: false when the task rejects `spnCertificate`, so no PEM line is offered. */
  readonly certificateAuth: boolean;
  /**
   * What running this task locally destroys, or `undefined` when it was **checked and destroys
   * nothing** (C-E08-048).
   *
   * The distinction is deliberate: absent-because-safe and absent-because-unexamined would
   * otherwise look identical, and a reader arriving from `AzureCLI@2` will expect symmetry.
   */
  readonly hazard?: string;
  /**
   * A local-run delta that is not a hazard: the task runs, but does something measurably different
   * from the cloud. Surfaced in the warnings list (PLAN D10) rather than left for the user to find.
   */
  readonly delta?: string;
}

/**
 * The verified set. Two entries, both read at `v277` (`8ba25cfb…`) — see C-E08-036..041.
 *
 * Keyed by `Name@major` because a task's auth behaviour does not change with a patch release.
 */
export const REAL_TASK_ENDPOINT_USE: Readonly<Record<string, RealTaskEndpointUse>> = {
  'AzureCLI@2': {
    requiresEndpoint: true,
    certificateAuth: true,
    hazard:
      'ends with `az account clear` (C-E08-038) — harmless against its own throwaway profile, but ' +
      'a step with `useGlobalConfig: true` signs you out of `az` on this machine',
  },
  'AzurePowerShell@5': {
    requiresEndpoint: true,
    // C-E08-040: non-Windows hosts accept only SPNKey; a PEM field would be a credential the task
    // rejects. Windows hosts are out of scope (CLAUDE.md), so this is not host-conditional here.
    certificateAuth: false,
    hazard:
      'runs `Clear-AzContext -Scope CurrentUser -Force` before connecting (C-E08-039), which ' +
      'deletes your saved `Connect-AzAccount` session — there is no input that opts out',
  },
  'Docker@2': {
    // C-E08-043: `containerRegistry` is not a required input; building with no registry is a
    // supported path, so a connection here is not forced out of ambient mode.
    requiresEndpoint: false,
    // Not an AzureRM connection at all (C-E08-043); the field has no meaning for a registry and the
    // value is inert because the kind decides which fields are emitted.
    certificateAuth: true,
    // C-E08-048: checked, and it leaves `~/.docker` alone — three separate guards. Recorded as an
    // absence with a reason rather than as silence.
    delta:
      'without a `containerRegistry` connection the image name is **not** qualified with a ' +
      'registry (C-E08-047): the task only reads a docker config it wrote itself under the agent ' +
      'temp directory, never your `~/.docker/config.json`. Your `docker login` still authenticates ' +
      'the push — but an unqualified name pushes to Docker Hub, not to the registry you are logged ' +
      'in to. Set `containerRegistry`, or put the registry host in `repository:`',
  },
};

/**
 * Collect every service connection a pipeline references, with the mode each one can actually use.
 *
 * `definitions` supplies the `task.json` inputs; a step whose task is not in the map contributes
 * nothing, because without the declaration there is no way to tell a connection input from a string
 * one — and guessing from the name would miss `ConnectedServiceNameARM` in the case it is not
 * written (C-E08-035).
 */
export function collectConnections(
  steps: readonly StepSite[],
  definitions: TaskDefinitions,
): CollectedConnections {
  const sites: ConnectionSite[] = [];
  const warnings: ManifestWarning[] = [];
  /** name → the connection being accumulated; `usedBy` and the mode grow as sites are seen. */
  const byName = new Map<
    string,
    { mode: ConnectionMode; certificateAuth: boolean; kind: ConnectionKind; usedBy: string[] }
  >();

  for (const { step, path } of steps) {
    const reference = taskRef(step);
    const definition = definitions[majorKey(reference)];
    if (definition === undefined) continue;

    const resolution = resolveConnectionInputs(definition, step.inputs);
    for (const { declaration, value, endpointType } of resolution) {
      sites.push({
        value,
        input: declaration,
        endpointType,
        taskRef: reference,
        path,
      });

      // A macro is not a name: `ENDPOINT_DATA_$(azureSub)_SUBSCRIPTIONID` is a variable no task
      // reads, so emitting a block for it would be worse than emitting nothing.
      if (hasMacro(value)) {
        warnings.push({
          code: 'connection-macro-name',
          message:
            `${path}: ${reference} names its service connection with the macro '${value}', ` +
            'which is resolved at run time — no .env block could be generated for it. Fill in the ' +
            'ENDPOINT_* keys for the connection that macro resolves to (C-E08-001).',
        });
        continue;
      }
      if (value.length === 0) {
        // C-E08-034: requiredness is not enforced by the expansion, so an empty connection input
        // really does reach us; the task will throw at `getInput(name, true)`.
        warnings.push({
          code: 'connection-missing',
          message:
            `${path}: ${reference} declares '${declaration}' required and the step supplies no ` +
            'value; the task will fail with LIB_InputRequired (C-E08-034).',
        });
        continue;
      }

      const use = REAL_TASK_ENDPOINT_USE[majorKey(reference)];
      const existing = byName.get(value) ?? {
        mode: 'ambient' as ConnectionMode,
        certificateAuth: true,
        kind: connectionKind(endpointType),
        usedBy: [],
      };
      if (!existing.usedBy.includes(path)) existing.usedBy.push(path);
      if (use?.requiresEndpoint === true) {
        // C-E08-036/037: one consumer that *requires* the endpoint is enough to rule ambient out —
        // the keys have to be there for that step whatever the other steps do. A consumer that
        // merely *accepts* one (C-E08-043) leaves the connection ambient, because demanding
        // credentials a pipeline does not need is the failure C-E08-005 exists to avoid.
        existing.mode = 'sp';
        // C-E08-040: and one consumer that rejects certificates is enough to stop offering a PEM.
        existing.certificateAuth &&= use.certificateAuth;
      }
      byName.set(value, existing);
    }
  }

  const connections: ServiceConnection[] = [...byName.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({
      name,
      mode: entry.mode,
      scheme: 'serviceprincipal' as const,
      kind: entry.kind,
      certificateAuth: entry.certificateAuth,
      usedBy: entry.usedBy,
    }));

  warnings.push(...localSessionWarnings(sites));
  for (const { step, path } of steps) warnings.push(...dockerStepWarnings(step, path));
  return { connections, sites, warnings };
}

/** The declared connection inputs of one step, resolved through aliases (C-E08-030). */
function resolveConnectionInputs(
  definition: TaskDefinition,
  stepInputs: Readonly<Record<string, string>>,
): readonly { declaration: string; value: string; endpointType: string }[] {
  const keys = new Map(Object.keys(stepInputs).map((key) => [key.toLowerCase(), key]));
  const found: { declaration: string; value: string; endpointType: string }[] = [];

  for (const input of definition.inputs ?? []) {
    const type = input.type ?? '';
    if (!type.startsWith(CONNECTED_SERVICE_TYPE_PREFIX)) continue;

    let key = keys.get(input.name.toLowerCase());
    for (const alias of input.aliases ?? []) {
      if (key !== undefined) break;
      key = keys.get(alias.toLowerCase());
    }
    found.push({
      declaration: input.name,
      /* istanbul ignore next -- `key` came from `Object.keys(stepInputs)`, so the lookup is total. */
      value: key === undefined ? '' : (stepInputs[key] ?? ''),
      endpointType: type.slice(CONNECTED_SERVICE_TYPE_PREFIX.length),
    });
  }
  return found;
}

/**
 * Per-step warnings for `Docker@2`, computed from the step's own inputs (E08-S02-T02).
 *
 * These are deltas between what the author wrote and what the task will actually do. They are
 * emitted **conditionally** — only when the step's inputs can trigger them — because a converted
 * pipeline that warns about every possibility teaches the reader to skip the warnings list.
 *
 * Nothing here re-implements the task; the task is run for real (PLAN D4). The warnings exist
 * because these transformations are silent, and all three were confirmed by running the real
 * package (`research/experiments/E08-docker/real-task-run.md`).
 */
export function dockerStepWarnings(step: Step, path: string): readonly ManifestWarning[] {
  if (majorKey(taskRef(step)) !== 'Docker@2') return [];
  const warnings: ManifestWarning[] = [];
  const input = (name: string): string => {
    const key = Object.keys(step.inputs).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? '' : (step.inputs[key] ?? '');
  };

  // C-E08-049: `generateValidImageName` lower-cases and strips spaces. Confirmed live: a repository
  // of `E08 Parity` was pushed as `e08parity`.
  const repository = input('repository');
  const normalized = repository.toLowerCase().replaceAll(' ', '');
  if (repository.length > 0 && !hasMacro(repository) && normalized !== repository) {
    warnings.push({
      code: 'docker-image-name-normalized',
      message:
        `${path}: Docker@2 lower-cases the repository and strips its spaces (C-E08-049), so ` +
        `'${repository}' is built and pushed as '${normalized}'.`,
    });
  }

  // C-E08-050: a glob resolves to the *first* match of a walk rooted at System.DefaultWorkingDirectory.
  const dockerfile = input('Dockerfile');
  const command = input('command').toLowerCase() || 'buildandpush';
  const builds = command === 'build' || command === 'buildandpush';
  if (builds && (dockerfile === '' || dockerfile.includes('*') || dockerfile.includes('?'))) {
    warnings.push({
      code: 'docker-dockerfile-glob',
      message:
        `${path}: Docker@2 resolves ` +
        (dockerfile === '' ? "its default Dockerfile pattern '**/Dockerfile'" : `'${dockerfile}'`) +
        ' by walking System.DefaultWorkingDirectory and taking the **first** match (C-E08-050); ' +
        'with several Dockerfiles the one built depends on directory order, and the step’s ' +
        'workingDirectory does not narrow the search. Name the file exactly to be sure.',
    });
  }

  // C-E08-052: `buildAndPush` warns and drops `arguments`, so a converted step silently loses them.
  if (command === 'buildandpush' && input('arguments').length > 0) {
    warnings.push({
      code: 'docker-arguments-ignored',
      message:
        `${path}: Docker@2 ignores 'arguments' when command is buildAndPush (C-E08-052) — the ` +
        'task warns and drops them. Split the step into build and push to keep them.',
    });
  }

  // C-E08-051: the tag split is on newlines *and* commas, which surprises anyone who wrote a
  // comma inside a single intended tag.
  const tags = input('tags');
  if (tags.includes(',')) {
    warnings.push({
      code: 'docker-tags-split',
      message:
        `${path}: Docker@2 splits 'tags' on both newlines and commas (C-E08-051), so '${tags}' is ` +
        `${tags.split(/[\n,]+/).filter((t) => t.length > 0).length} separate tags.`,
    });
  }

  return warnings;
}

/**
 * One warning per task that destroys a local session, de-duplicated by task reference.
 *
 * Deliberately reported even when the pipeline uses the task twenty times: the hazard is a property
 * of the task, and a warnings list nobody reads to the end is the same as no warnings list
 * (PLAN D10, mirroring `dispositionWarnings`).
 */
export function localSessionWarnings(sites: readonly ConnectionSite[]): readonly ManifestWarning[] {
  const seen = new Set<string>();
  const warnings: ManifestWarning[] = [];
  for (const site of sites) {
    const key = majorKey(site.taskRef);
    const use = REAL_TASK_ENDPOINT_USE[key];
    if (use === undefined || seen.has(key)) continue;
    seen.add(key);
    if (use.hazard !== undefined) {
      warnings.push({
        code: 'local-session-clobber',
        message:
          `${key} run locally ${use.hazard}. It is run here for fidelity (PLAN D4), so the ` +
          'behaviour is the real task’s and cannot be patched out; sign back in afterwards.',
      });
    }
    if (use.delta !== undefined) {
      warnings.push({ code: 'local-task-delta', message: `${key} run locally ${use.delta}.` });
    }
  }
  return warnings;
}
