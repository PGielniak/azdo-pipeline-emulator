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
  // C-E08-059: the connection is read only when `CONNECTION_INPUT_RULES` says the task reaches it,
  // so by the time a site exists the endpoint really is required — `connectionType: None` never
  // produces one. That is what makes `true` honest here rather than a blanket demand for
  // credentials.
  'Kubernetes@1': {
    requiresEndpoint: true,
    certificateAuth: true,
    // C-E08-065: checked. `close()` unlinks the kubeconfig, but only the one `open()` wrote under
    // its own temp directory — the developer's `~/.kube/config` is never a candidate, because the
    // ARM and generic arms both *construct* the document rather than pointing at an existing file.
    delta:
      'writes its kubeconfig to a throwaway directory and exports `KUBECONFIG` at it, then deletes ' +
      'it in `close()` (C-E08-065). Your own kubeconfig is untouched — and equally, it is not what ' +
      'the task uses: `connectionType: None` is the only arm that leaves your ambient context in ' +
      'place (C-E08-060)',
  },
  'KubernetesManifest@1': {
    requiresEndpoint: true,
    certificateAuth: true,
    // C-E08-061: `connectionType: None` is tested for in `open()` but is not one of the picklist's
    // two options, so it is reachable only by writing it in YAML — which works, because the
    // expansion does not enforce picklists (C-E08-034).
    delta:
      'accepts an undocumented `connectionType: None` — its picklist offers only ' +
      '`kubernetesServiceConnection` and `azureResourceManager`, but `open()` still tests for ' +
      '`None` and returns before touching a kubeconfig (C-E08-061). That is the arm that uses your ' +
      'ambient kubectl context, and the `action: bake` arm needs no cluster at all',
  },
  'HelmDeploy@0': {
    requiresEndpoint: true,
    certificateAuth: true,
    // C-E08-066: three separate near-misses, each guarded, recorded as a checked absence.
    delta:
      'with `connectionType: None` and `install`/`upgrade` it points `KUBECONFIG` at your real ' +
      '`$HOME/.kube/config` and deploys through your current context (C-E08-066) — the one task ' +
      'in this set with a documented ambient path. It does **not** delete that file: `logout()` ' +
      'unlinks the kubeconfig it holds, but `isKubConfigLogoutRequired` excludes exactly the ' +
      '`None` and `logout` cases that could put your own path there',
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
 * When a task actually *reads* one of its declared connection inputs (E08-S02-T03).
 *
 * `collectConnections` used to walk every `connectedService:*` input a task declares, which was
 * right while the read tasks had exactly one apiece. The Kubernetes/Helm set breaks that: they
 * declare two, three or four connection inputs and read **one** of them, chosen at run time by
 * another input's value. Walking them all makes a `Kubernetes@1` step with
 * `connectionType: None` — a step that needs no connection at all — emit a `connection-missing`
 * warning claiming the task will fail with `LIB_InputRequired`, for an input `open()` returns
 * before ever reading (C-E08-060). A warning that is confidently wrong is worse than none.
 *
 * **The discriminator is the task's own dispatch, read in its source — not `visibleRule`.**
 * `visibleRule` is a hint for the web form and the agent does not evaluate it; it passes every
 * input it has, which is why C-E08-034 exists. The two diverge on the very first hard case:
 * `HelmDeploy@0` declares `azureSubscriptionEndpointForACR` with `"required": true` and **no**
 * `visibleRule`, yet `helmregistrylogin.ts` is the only reader and only the `save` command reaches
 * it (C-E08-063). A visibleRule-driven collector would demand a `.env` block for it on every
 * HelmDeploy step.
 *
 * Because it is a table of readings rather than a grammar, it also carries a fact a generic
 * evaluator would erase: **the selector's literal values differ between tasks.** `Kubernetes@1` and
 * `HelmDeploy@0` spell the arms `'Kubernetes Service Connection'` / `'Azure Resource Manager'` /
 * `'None'`; `KubernetesManifest@1` spells the same two `'kubernetesServiceConnection'` /
 * `'azureResourceManager'` and its picklist has no `'None'` at all — though its code still tests for
 * one (C-E08-061). Copying an arm value between tasks silently selects the other branch.
 */
export interface InputCondition {
  /** The gating input, matched case-insensitively through the step's own aliases. */
  readonly input: string;
  /** The declaration's default, applied when the step does not write the input. */
  readonly default?: string;
  /** The task reads the connection when the gate equals any of these (case-insensitive). */
  readonly equals?: readonly string[];
  /** …or when it equals none of these. */
  readonly notEquals?: readonly string[];
  /** …or, for a gate that is a name rather than a choice, when it is non-empty. */
  readonly nonEmpty?: boolean;
}

/** One declared connection input, and every condition that must hold for the task to read it. */
export interface ConnectionInputRule {
  readonly input: string;
  readonly when: readonly InputCondition[];
  /** The source reading this encodes — kept beside the rule so it cannot decay into folklore. */
  readonly because: string;
}

/**
 * The read set, per task, from source pinned at `v277` (`8ba25cfb…`) — C-E08-059..064.
 *
 * A task absent from this table keeps the old unconditional walk: over-collecting is the safe
 * direction when nobody has read the dispatch, and the alternative is guessing which input a task
 * ignores.
 */
export const CONNECTION_INPUT_RULES: Readonly<Record<string, readonly ConnectionInputRule[]>> = {
  // clusterconnection.ts:66-73 (`open()` returns at `None`) and :27-47 (`loadClusterType` sends
  // everything that is not the ARM arm to `generickubernetescluster`, which reads
  // `kubernetesServiceEndpoint`). kubernetessecret.ts:26/99-106 gate the two secret-side inputs,
  // reached only when `secretName` is non-empty (kubernetes.ts:58-62).
  'Kubernetes@1': [
    {
      input: 'kubernetesServiceEndpoint',
      when: [
        {
          input: 'connectionType',
          default: 'Kubernetes Service Connection',
          notEquals: ['None', 'Azure Resource Manager'],
        },
      ],
      because: 'clusterconnection.ts:44-46 → generickubernetescluster.getKubeConfig',
    },
    {
      input: 'azureSubscriptionEndpoint',
      when: [
        {
          input: 'connectionType',
          default: 'Kubernetes Service Connection',
          equals: ['Azure Resource Manager'],
        },
      ],
      because: 'clusterconnection.ts:38-43',
    },
    {
      input: 'dockerRegistryEndpoint',
      when: [
        { input: 'secretName', nonEmpty: true },
        { input: 'secretType', default: 'dockerRegistry', equals: ['dockerRegistry'] },
        {
          input: 'containerRegistryType',
          default: 'Azure Container Registry',
          equals: ['Container Registry'],
        },
      ],
      because: 'kubernetes.ts:58-62 → kubernetessecret.ts:99-106',
    },
    {
      input: 'azureSubscriptionEndpointForSecrets',
      when: [
        { input: 'secretName', nonEmpty: true },
        { input: 'secretType', default: 'dockerRegistry', equals: ['dockerRegistry'] },
        {
          input: 'containerRegistryType',
          default: 'Azure Container Registry',
          equals: ['Azure Container Registry'],
        },
      ],
      because: 'kubernetes.ts:58-62 → kubernetessecret.ts:99-103',
    },
  ],
  // clusterconnection.ts:25-49 and :64-73 — same shape, different spellings (C-E08-061), plus the
  // `bake` action, which returns before a connection is opened at all (run.ts:18-22).
  'KubernetesManifest@1': [
    {
      input: 'kubernetesServiceEndpoint',
      when: [
        { input: 'action', default: 'deploy', notEquals: ['bake'] },
        {
          input: 'connectionType',
          default: 'kubernetesServiceConnection',
          notEquals: ['None', 'azureResourceManager'],
        },
      ],
      because: 'clusterconnection.ts:46-48 → generickubernetescluster.getKubeConfig',
    },
    {
      input: 'azureSubscriptionEndpoint',
      when: [
        { input: 'action', default: 'deploy', notEquals: ['bake'] },
        {
          input: 'connectionType',
          default: 'kubernetesServiceConnection',
          equals: ['azureResourceManager'],
        },
      ],
      because: 'clusterconnection.ts:36-45',
    },
    {
      input: 'dockerRegistryEndpoint',
      when: [
        { input: 'action', default: 'deploy', equals: ['createSecret'] },
        { input: 'secretType', default: 'dockerRegistry', equals: ['dockerRegistry'] },
      ],
      because: 'actions/createSecret.ts:13-14',
    },
  ],
  // helm.ts:53-64 mirrors `Kubernetes@1`'s dispatch but adds a second gate: the ARM arm is taken
  // only when `azureSubscriptionEndpoint` is **also** non-empty, so a step that names
  // `connectionType: Azure Resource Manager` and no subscription silently falls through to the
  // generic reader (C-E08-062). `package`/`save` skip the kubeconfig entirely (helm.ts:42-45).
  'HelmDeploy@0': [
    {
      input: 'azureSubscriptionEndpoint',
      when: [
        { input: 'command', default: 'ls', notEquals: ['package', 'save'] },
        {
          input: 'connectionType',
          default: 'Azure Resource Manager',
          equals: ['Azure Resource Manager'],
        },
        { input: 'azureSubscriptionEndpoint', nonEmpty: true },
      ],
      because: 'helm.ts:57-61',
    },
    {
      input: 'kubernetesServiceEndpoint',
      when: [
        { input: 'command', default: 'ls', notEquals: ['package', 'save'] },
        {
          input: 'connectionType',
          default: 'Azure Resource Manager',
          notEquals: ['None'],
        },
      ],
      because: 'helm.ts:62-63 → generickubernetescluster.getKubeConfig',
    },
    {
      input: 'azureSubscriptionEndpointForACR',
      when: [{ input: 'command', default: 'ls', equals: ['save'] }],
      because:
        'helm.ts:82 (runHelmSaveCommand → "registry") → helmcommands/helmregistrylogin.ts:12',
    },
  ],
};

/** Does the step satisfy every condition guarding this connection input? */
function ruleApplies(
  rule: ConnectionInputRule,
  read: (name: string) => string,
  declaredDefault: (name: string) => string | undefined,
): boolean {
  for (const condition of rule.when) {
    // A macro cannot be resolved at convert time; treating it as "does not match" would drop a
    // connection the run may well need, so an unresolvable gate is taken as satisfied.
    let value = read(condition.input);
    if (hasMacro(value)) continue;
    if (value === '') value = declaredDefault(condition.input) ?? condition.default ?? '';
    if (condition.nonEmpty === true && value === '') return false;
    const equal = (candidate: string): boolean => candidate.toLowerCase() === value.toLowerCase();
    if (condition.equals !== undefined && !condition.equals.some(equal)) return false;
    if (condition.notEquals !== undefined && condition.notEquals.some(equal)) return false;
  }
  return true;
}

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
  /** Endpoint kinds already reported as unread, so the notice is stated once per kind. */
  const unknownKinds = new Set<string>();
  /** name → the connection being accumulated; `usedBy` and the mode grow as sites are seen. */
  const byName = new Map<
    string,
    { mode: ConnectionMode; certificateAuth: boolean; kind: ConnectionKind; usedBy: string[] }
  >();

  for (const { step, path } of steps) {
    const reference = taskRef(step);
    const definition = definitions[majorKey(reference)];
    if (definition === undefined) continue;

    const resolution = resolveConnectionInputs(definition, step.inputs, majorKey(reference));
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

      const kind = connectionKind(endpointType);
      if (kind === 'unknown' && !unknownKinds.has(endpointType)) {
        // C-E08-053: nobody has read this task's endpoint fields, so no block can be generated for
        // it. Said plainly, because the alternative — the pre-E08-S02-T03 AzureRM fallback — asked
        // for a subscription id that nothing would read.
        unknownKinds.add(endpointType);
        warnings.push({
          code: 'connection-kind-unknown',
          message:
            `${path}: ${reference} names a 'connectedService:${endpointType}' connection, an ` +
            'endpoint kind whose fields this converter has not read from task source (C-E08-053). ' +
            'No ENDPOINT_* lines are generated for it; supply them yourself if the task needs them.',
        });
      }

      const use = REAL_TASK_ENDPOINT_USE[majorKey(reference)];
      const existing = byName.get(value) ?? {
        mode: 'ambient' as ConnectionMode,
        certificateAuth: true,
        kind,
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
  warnings.push(...toolTaskWarnings(steps));
  for (const { step, path } of steps) warnings.push(...dockerStepWarnings(step, path));
  return { connections, sites, warnings };
}

/**
 * The connection inputs of one step that the task will actually read.
 *
 * Aliases are resolved here (C-E08-030) for the connection inputs *and* for the gates, because a
 * gate can carry an alias just as an input can — and a gate read under the wrong spelling falls back
 * to its default, which is how a `connectionType: None` step would be told to supply credentials.
 */
function resolveConnectionInputs(
  definition: TaskDefinition,
  stepInputs: Readonly<Record<string, string>>,
  taskKey: string,
): readonly { declaration: string; value: string; endpointType: string }[] {
  const keys = new Map(Object.keys(stepInputs).map((key) => [key.toLowerCase(), key]));
  const declarations = new Map(
    (definition.inputs ?? []).map((input) => [input.name.toLowerCase(), input]),
  );

  /** One input's authored value, through the declaration's aliases; '' when the step is silent. */
  const read = (name: string): string => {
    const declaration = declarations.get(name.toLowerCase());
    let key = keys.get(name.toLowerCase());
    for (const alias of declaration?.aliases ?? []) {
      if (key !== undefined) break;
      key = keys.get(alias.toLowerCase());
    }
    return key === undefined ? '' : (stepInputs[key] ?? '');
  };
  /** The `task.json` default, which beats the rule's own copy of it if the two ever drift. */
  const declaredDefault = (name: string): string | undefined => {
    const value = declarations.get(name.toLowerCase())?.defaultValue;
    return value === undefined ? undefined : String(value);
  };

  const rules = CONNECTION_INPUT_RULES[taskKey];
  const found: { declaration: string; value: string; endpointType: string }[] = [];

  for (const input of definition.inputs ?? []) {
    const type = input.type ?? '';
    if (!type.startsWith(CONNECTED_SERVICE_TYPE_PREFIX)) continue;

    if (rules !== undefined) {
      const rule = rules.find((entry) => entry.input.toLowerCase() === input.name.toLowerCase());
      // A connection input this task declares and no rule covers is one the source never reads —
      // every declared input of the three tabled tasks has a rule, so the absence is the answer.
      if (rule === undefined || !ruleApplies(rule, read, declaredDefault)) continue;
    }

    found.push({
      declaration: input.name,
      value: read(input.name),
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
 * Warnings that belong to a *task being present*, not to a connection being named (E08-S02-T03).
 *
 * `localSessionWarnings` keys on connection sites, which is right for the Azure and Docker tasks and
 * useless for these: `HelmInstaller@1` and `KubectlInstaller@0` declare no connection input at all,
 * so nothing they do would ever be reported. Their whole behaviour is a local-run delta, and the
 * biggest one stops them dead.
 *
 * De-duplicated by `Name@major`: the fact is a property of the task, and repeating it once per step
 * teaches the reader to skip the warnings list (PLAN D10).
 */
export function toolTaskWarnings(steps: readonly StepSite[]): readonly ManifestWarning[] {
  const seen = new Set<string>();
  const warnings: ManifestWarning[] = [];
  for (const { step } of steps) {
    const key = majorKey(taskRef(step));
    const notes = TOOL_TASK_NOTES[key];
    if (notes === undefined || seen.has(key)) continue;
    seen.add(key);
    for (const [code, message] of notes) warnings.push({ code, message: `${key} ${message}` });
  }
  return warnings;
}

/** C-E08-067..070: what these tasks do differently here, read from their source and measured. */
const TOOL_TASK_NOTES: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  'HelmInstaller@1': [
    [
      'tool-cache-download',
      'downloads a helm release into the tool cache and prepends it to PATH for later steps ' +
        '(C-E08-067). The generated project now provides `Agent.ToolsDirectory` so this works — ' +
        'before it did, every tool-lib task failed with `Agent.ToolsDirectory is not set` ' +
        '(C-E08-068). The download itself needs network access, and `helmVersionToInstall: latest` ' +
        'resolves it against the GitHub releases API on every run.',
    ],
  ],
  'KubectlInstaller@0': [
    [
      'tool-cache-download',
      'downloads a kubectl release into the tool cache and prepends it to PATH for later steps ' +
        '(C-E08-067/068). `kubectlVersion: latest` — the default — fetches ' +
        'https://dl.k8s.io/release/stable.txt first, so the version installed depends on the day ' +
        'the run happens, not on the pipeline.',
    ],
  ],
  'HelmDeploy@0': [
    [
      'image-metadata-warning',
      'prints a non-fatal `publishToImageMetadataStore failed … TypeError` on every run ' +
        '(C-E08-075): once `System.HostType` is seeded, the image-metadata helper goes on to read ' +
        '`Build.Reason`, which a local run deliberately leaves to you. The call is inside a catch, ' +
        'so the step still succeeds. Set `Build.Reason` in `.env` §1 to silence it.',
    ],
    [
      'helm-v4-version-probe',
      'detects the Helm major version by running `helm version --client --short`, and **Helm 4 ' +
        'rejects `--client`** — measured on this machine against helm v4.2.4: exit 1, empty ' +
        'stdout, `Error: unknown flag: --client` on stderr (C-E08-069). `isHelmV3orHigher()` reads ' +
        'that empty stdout and answers *false*, so `command: save` fails with ' +
        '"SaveSupportedInHelmsV3Only" against a Helm 4 CLI that supports it perfectly well. ' +
        'Install a Helm 3 CLI to reproduce the cloud behaviour.',
    ],
  ],
  'KubernetesManifest@1': [
    [
      'image-metadata-warning',
      'prints a non-fatal `publishToImageMetadataStore failed … TypeError` on every run ' +
        '(C-E08-075): once `System.HostType` is seeded, the image-metadata helper goes on to read ' +
        '`Build.Reason`, which a local run deliberately leaves to you. The call is inside a catch, ' +
        'so the step still succeeds. Set `Build.Reason` in `.env` §1 to silence it.',
    ],
    [
      'k8s-undefined-annotations',
      'annotates every resource it deploys with seven `azure-pipelines/*` annotations, and locally ' +
        'their values are the literal string `undefined` (C-E08-074) — read back off a live ' +
        'cluster: `azure-pipelines/run=undefined`, ' +
        '`runuri=undefinedundefined/_build/results?buildId=undefined`, and five more. They are ' +
        'written with `kubectl annotate --overwrite`, so against a **shared** cluster this ' +
        'overwrites what the real pipeline recorded. Fill in the run-identity variables in ' +
        '`.env` §1 if that matters.',
    ],
  ],
  'Kubernetes@1': [
    [
      'image-metadata-warning',
      'prints a non-fatal `publishToImageMetadataStore failed … TypeError` on every run ' +
        '(C-E08-075): once `System.HostType` is seeded, the image-metadata helper goes on to read ' +
        '`Build.Reason`, which a local run deliberately leaves to you. The call is inside a catch, ' +
        'so the step still succeeds. Set `Build.Reason` in `.env` §1 to silence it.',
    ],
    [
      'kubectl-version-default',
      'resolves its own kubectl before running: with the default `versionSpec: 1.13.2` it uses the ' +
        'kubectl already on PATH, but **any other `versionSpec`, or `checkLatest: true`, ' +
        'downloads that version into the tool cache instead** (C-E08-070) — so a step that pins a ' +
        'version stops using your local binary, and needs network access to run at all.',
    ],
  ],
};

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
