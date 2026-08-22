// E13-S01-T02 — the shape of `azdo-emu.yaml` (docs/06 §2, C-E13-008) and of the settings a command
// finally sees. Two distinct types on purpose: the file is all-optional, while `ResolvedSettings` is
// total — every key has a value, so no consumer downstream re-implements a default.

/** Authentication modes per docs/06 §2. */
export const AZDO_AUTH_MODES = ['interactive', 'az', 'pat'] as const;
export const GITHUB_AUTH_MODES = ['gh', 'pat'] as const;
export const TARGET_OS = ['linux', 'windows', 'macos'] as const;
export const CHECKOUT_MODES = ['clone', 'copy', 'worktree'] as const;
export const EXECUTION_ENVIRONMENTS = ['auto', 'sandbox', 'host'] as const;
export const DOCKER_SOCKET_MODES = ['auto', 'share', 'none'] as const;
export const UNKNOWN_TASK_POLICIES = ['stub', 'fail', 'prompt'] as const;
export const TASK_OVERRIDES = ['skip', 'stub', 'fail'] as const;

export type AzdoAuthMode = (typeof AZDO_AUTH_MODES)[number];
export type GithubAuthMode = (typeof GITHUB_AUTH_MODES)[number];
export type TargetOs = (typeof TARGET_OS)[number];
export type CheckoutMode = (typeof CHECKOUT_MODES)[number];
export type ExecutionEnvironment = (typeof EXECUTION_ENVIRONMENTS)[number];
export type DockerSocketMode = (typeof DOCKER_SOCKET_MODES)[number];
export type UnknownTaskPolicy = (typeof UNKNOWN_TASK_POLICIES)[number];
export type TaskOverride = (typeof TASK_OVERRIDES)[number];

/**
 * A parameter value as it leaves this layer: the raw string a user typed, or the structure parsed
 * from `@file.json` / written in the config file.
 *
 * Deliberately *not* coerced to the pipeline's declared parameter type — this layer never sees the
 * pipeline, so coercion belongs to the binder (C-E13-009/010).
 */
export type ParameterValue =
  | string
  | number
  | boolean
  | null
  | ParameterValue[]
  | {
      [key: string]: ParameterValue;
    };

/** `azdo-emu.yaml` — every key optional (docs/06 §2). */
export interface AzdoEmuConfig {
  readonly organization?: string;
  readonly project?: string;
  readonly auth?: { readonly azdo?: AzdoAuthMode; readonly github?: GithubAuthMode };
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
  readonly repositories?: Readonly<Record<string, { readonly path: string }>>;
  readonly variableGroups?: { readonly listNames?: boolean };
  readonly tasks?: {
    readonly unknown?: UnknownTaskPolicy;
    readonly overrides?: Readonly<Record<string, TaskOverride>>;
    readonly execute?: readonly string[];
  };
  readonly output?: {
    readonly targetOs?: TargetOs;
    readonly checkoutMode?: CheckoutMode;
    readonly sharedWorkspace?: boolean;
    readonly execution?: {
      readonly environment?: ExecutionEnvironment;
      readonly image?: string | null;
      readonly dockerSocket?: DockerSocketMode;
    };
  };
}

/** Settings after precedence resolution: total, with provenance for `--json` output and doctor. */
export interface ResolvedSettings {
  readonly organization: string | undefined;
  readonly project: string | undefined;
  readonly auth: { readonly azdo: AzdoAuthMode; readonly github: GithubAuthMode };
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly repositories: Readonly<Record<string, { readonly path: string }>>;
  readonly variableGroups: { readonly listNames: boolean };
  readonly tasks: {
    readonly unknown: UnknownTaskPolicy;
    readonly overrides: Readonly<Record<string, TaskOverride>>;
    readonly execute: readonly string[];
  };
  readonly output: {
    readonly targetOs: TargetOs;
    readonly checkoutMode: CheckoutMode;
    readonly sharedWorkspace: boolean;
    readonly execution: {
      readonly environment: ExecutionEnvironment;
      readonly image: string | null;
      readonly dockerSocket: DockerSocketMode;
    };
  };
}

/** The `defaults` layer of "CLI > config > defaults" — the values of docs/06 §2's example. */
export const DEFAULTS: ResolvedSettings = {
  organization: undefined,
  project: undefined,
  auth: { azdo: 'interactive', github: 'gh' },
  parameters: {},
  repositories: {},
  variableGroups: { listNames: true },
  tasks: { unknown: 'stub', overrides: {}, execute: [] },
  output: {
    targetOs: 'linux',
    checkoutMode: 'clone',
    sharedWorkspace: false,
    execution: { environment: 'auto', image: null, dockerSocket: 'auto' },
  },
};
