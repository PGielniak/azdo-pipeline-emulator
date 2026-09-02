/**
 * The task-lib emulation host (E07-S01-T02).
 *
 * PLAN D4 replaced N per-task transpilers with one host: a non-script task runs its **real**
 * implementation against an emulated `azure-pipelines-task-lib`. That is possible because task-lib
 * reads inputs out of the process environment and nowhere else (C-E07-005) — there is no file, no
 * IPC and no agent handshake in the input path. So the host's whole job is to construct the right
 * environment and invoke the handler.
 *
 * Four measured details shape it, and three of them silently produce wrong values if missed:
 *
 *  - **The name transform replaces dots *and* spaces** (C-E07-001). The task's own Ground field says
 *    "spaces→`_`, uppercase, prefix `INPUT_`" and omits the dots — but both task-lib and the agent
 *    replace `.` too, so an input named `sonar.projectKey` would otherwise be handed to the task
 *    under a name it never reads. The agent uses one `ConvertToEnvVariableFormat` for inputs and
 *    variables alike, which is why this matches the runtime's existing `azdo__env_name` (C-E06-008).
 *  - **An empty value is never stored** (C-E07-002): `_loadData`'s `if (value)` guard means an empty
 *    `INPUT_X` is not vaulted (so `getInput` returns `undefined`) *and* not deleted from
 *    `process.env` (so a task reading the environment directly still sees it). The host emits it for
 *    the second half and does not count it as "set" for the first.
 *  - **`getBoolInput` accepts only the literal `true`** (C-E07-003), case-insensitively. Normalizing
 *    a YAML boolean to `1` would invert every boolean input a task reads.
 *  - **`getDelimitedInput` drops empty segments** (C-E07-004), so the host must *not* pre-trim
 *    multi-line inputs: doing so would change what a task using plain `getInput` sees.
 */

/** One input as the task's `task.json` declares it. */
export interface TaskInputDeclaration {
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string | number | boolean;
  readonly required?: boolean;
}

/** The subset of `task.json` this host reads. */
export interface TaskDefinition {
  readonly name: string;
  readonly inputs?: readonly TaskInputDeclaration[];
  readonly execution?: Readonly<Record<string, unknown>>;
}

export interface ResolvedInput {
  readonly name: string;
  readonly envName: string;
  readonly value: string;
  /** True when the value came from the step; false when it came from the declaration's default. */
  readonly fromStep: boolean;
  /** C-E07-002: an empty value is emitted but `getInput` will not see it. */
  readonly emptyForGetInput: boolean;
}

export interface InputResolution {
  readonly inputs: readonly ResolvedInput[];
  /** Step inputs the task does not declare — passed through, and reported. */
  readonly undeclared: readonly string[];
  /** Declared, `required`, and resolved to nothing — the task will throw `LIB_InputRequired`. */
  readonly missingRequired: readonly string[];
}

/**
 * C-E07-001: `name.replace(/\./g,'_').replace(/ /g,'_').toUpperCase()`, prefixed `INPUT_`.
 *
 * Identical on both sides — task-lib's `_getVariableKey` and the agent's
 * `ConvertToEnvVariableFormat` — so an emulation host that gets this wrong is wrong against both.
 */
export function inputEnvName(name: string): string {
  return `INPUT_${name.replace(/\./g, '_').replace(/ /g, '_').toUpperCase()}`;
}

/** How the host renders a YAML scalar for an input value. */
export function inputValueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  // C-E07-003: `getBoolInput` compares against the literal "TRUE"; `1` would read as false.
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/**
 * Merge a step's inputs with the task's declared defaults.
 *
 * Declaration order is preserved so the emitted runner is stable and diffable; undeclared step
 * inputs follow, because a task may read an input its `task.json` omits and dropping it would be a
 * silent behavior change.
 */
export function resolveTaskInputs(
  definition: TaskDefinition,
  stepInputs: Readonly<Record<string, unknown>> = {},
): InputResolution {
  const declared = definition.inputs ?? [];
  const stepKeys = new Map(Object.keys(stepInputs).map((key) => [key.toLowerCase(), key]));
  const inputs: ResolvedInput[] = [];
  const missingRequired: string[] = [];
  const consumed = new Set<string>();

  for (const declaration of declared) {
    // The service folds input-name case when binding a step, so the lookup does too.
    const stepKey = stepKeys.get(declaration.name.toLowerCase());
    if (stepKey !== undefined) consumed.add(stepKey);
    const provided = stepKey === undefined ? undefined : stepInputs[stepKey];
    const value =
      provided === undefined ? inputValueText(declaration.defaultValue) : inputValueText(provided);

    if (declaration.required === true && value.length === 0) {
      missingRequired.push(declaration.name);
    }
    inputs.push({
      name: declaration.name,
      envName: inputEnvName(declaration.name),
      value,
      fromStep: stepKey !== undefined,
      emptyForGetInput: value.length === 0,
    });
  }

  const undeclared: string[] = [];
  for (const key of Object.keys(stepInputs)) {
    if (consumed.has(key)) continue;
    undeclared.push(key);
    const value = inputValueText(stepInputs[key]);
    inputs.push({
      name: key,
      envName: inputEnvName(key),
      value,
      fromStep: true,
      emptyForGetInput: value.length === 0,
    });
  }

  return { inputs, undeclared, missingRequired };
}

/** C-E07-006: the handler kinds a `task.json` `execution` block can name. */
export type HandlerKind = 'node' | 'powershell' | 'process' | 'unknown';

export interface ResolvedHandler {
  readonly kind: HandlerKind;
  /** The `execution` key chosen, e.g. `Node20_1`. */
  readonly key: string;
  /** `target` for node/powershell, `script` for a process handler. */
  readonly target: string;
}

/** Newest Node first: a task declaring several runtimes should run on the most current one. */
const NODE_KEYS = ['Node24', 'Node20_1', 'Node16', 'Node10', 'Node'] as const;
const POWERSHELL_KEYS = ['PowerShell3', 'PowerShell'] as const;

/**
 * Pick the handler to invoke from a `task.json` `execution` block.
 *
 * The preference order is ours, not the agent's — the agent picks by what the *agent* supports,
 * and we pick by what this host runs. Recorded as a local decision rather than a claim.
 */
export function resolveHandler(definition: TaskDefinition): ResolvedHandler {
  const execution = definition.execution ?? {};
  const targetOf = (key: string): string => {
    const block = execution[key];
    if (block === null || typeof block !== 'object') return '';
    const record = block as Record<string, unknown>;
    const target = record.target ?? record.script;
    return typeof target === 'string' ? target : '';
  };

  for (const key of NODE_KEYS) {
    if (key in execution) return { kind: 'node', key, target: targetOf(key) };
  }
  for (const key of POWERSHELL_KEYS) {
    if (key in execution) return { kind: 'powershell', key, target: targetOf(key) };
  }
  if ('Process' in execution)
    return { kind: 'process', key: 'Process', target: targetOf('Process') };

  const first = Object.keys(execution)[0];
  return first === undefined
    ? { kind: 'unknown', key: '', target: '' }
    : { kind: 'unknown', key: first, target: targetOf(first) };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface TaskRunnerOptions {
  readonly definition: TaskDefinition;
  readonly resolution: InputResolution;
  readonly handler: ResolvedHandler;
  /** Where the unpacked package lives, relative to the generated project. */
  readonly packageDir: string;
}

/**
 * Emit the bash that sets the environment and invokes the handler.
 *
 * Every value is single-quoted, so a value containing `$`, backticks or a newline reaches the task
 * verbatim — an input is data, and the one thing this host must never do is let it become shell.
 */
export function renderTaskRunner(options: TaskRunnerOptions): string {
  const { definition, resolution, handler, packageDir } = options;
  const lines: string[] = [
    '#!/usr/bin/env bash',
    '# Generated by azdo-emu — real-task mode (E07-S01-T02).',
    `# Task: ${definition.name}`,
    `# Handler: ${handler.key || '(none declared)'} -> ${handler.target || '(no target)'}`,
    '#',
    '# INPUT_* names follow task-lib `_getVariableKey`: dots and spaces become underscores, then',
    '# the name is upper-cased (C-E07-001). Values are single-quoted so an input is never shell.',
    'set -euo pipefail',
    '',
  ];

  for (const input of resolution.inputs) {
    const note = input.emptyForGetInput
      ? '   # empty: getInput() will not see this (C-E07-002)'
      : '';
    lines.push(`export ${input.envName}=${shellQuote(input.value)}${note}`);
  }
  if (resolution.inputs.length > 0) lines.push('');

  if (resolution.missingRequired.length > 0) {
    lines.push(
      '# The task declares these inputs required and nothing supplied them; task-lib will throw',
      '# LIB_InputRequired at the first getInput(name, true). Reported here rather than hidden.',
      ...resolution.missingRequired.map((name) => `#   required input not supplied: ${name}`),
      '',
    );
  }

  const target = `${packageDir.replace(/\/+$/, '')}/${handler.target}`;
  switch (handler.kind) {
    case 'node':
      lines.push(`exec node ${shellQuote(target)} "$@"`);
      break;
    case 'powershell':
      lines.push(`exec pwsh -NoLogo -NonInteractive -File ${shellQuote(target)} "$@"`);
      break;
    case 'process':
      lines.push(`exec ${shellQuote(target)} "$@"`);
      break;
    default:
      lines.push(
        `echo "azdo-emu: task ${definition.name} declares no handler this host can run" >&2`,
        'exit 1',
      );
  }
  return `${lines.join('\n')}\n`;
}
