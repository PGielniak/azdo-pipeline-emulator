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

import type { ConnectionMode, ServiceConnection } from './service-connection.js';
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
  /** C-E08-036/039: the task requires the endpoint in the environment; `ambient` cannot serve it. */
  readonly requiresEndpoint: true;
  /** C-E08-040: false when the task rejects `spnCertificate`, so no PEM line is offered. */
  readonly certificateAuth: boolean;
  /** What running this task locally destroys, phrased for a developer's own machine. */
  readonly hazard: string;
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
    { mode: ConnectionMode; certificateAuth: boolean; usedBy: string[] }
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
        usedBy: [],
      };
      if (!existing.usedBy.includes(path)) existing.usedBy.push(path);
      if (use !== undefined) {
        // C-E08-036/037: one real-task consumer is enough to rule ambient out for the connection —
        // the keys have to be there for that step whatever the other steps do.
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
      certificateAuth: entry.certificateAuth,
      usedBy: entry.usedBy,
    }));

  warnings.push(...localSessionWarnings(sites));
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
    warnings.push({
      code: 'local-session-clobber',
      message:
        `${key} run locally ${use.hazard}. It is run here for fidelity (PLAN D4), so the ` +
        'behaviour is the real task’s and cannot be patched out; sign back in afterwards.',
    });
  }
  return warnings;
}
