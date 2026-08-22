// E13-S01-T02 — precedence: **CLI > config > defaults** (docs/06 §2).
//
// The rule docs/06 §2 leaves open is what "wins" means for the map-valued keys — `parameters`,
// `repositories`, `tasks.overrides`. Decided in C-E13-012: maps merge **per key**, everything else
// replaces wholesale. `--parameter` is documented as repeatable, which only makes sense if each
// occurrence contributes an entry rather than redefining the set; `repositories` and
// `tasks.overrides` follow the same reading so the file behaves consistently.
import { DEFAULTS, type AzdoEmuConfig, type ResolvedSettings } from './types.js';

/** CLI-supplied settings: exactly the subset a command line can express. */
export interface CliSettings {
  readonly organization?: string | undefined;
  readonly project?: string | undefined;
  readonly parameters?: Readonly<Record<string, import('./types.js').ParameterValue>> | undefined;
  readonly targetOs?: ResolvedSettings['output']['targetOs'] | undefined;
  readonly checkoutMode?: ResolvedSettings['output']['checkoutMode'] | undefined;
  readonly execEnv?: ResolvedSettings['output']['execution']['environment'] | undefined;
  readonly sandboxImage?: string | undefined;
  readonly groupNames?: boolean | undefined;
}

/** Which layer a value came from — surfaced by `--json` and by `doctor` (E13-S04). */
export type Layer = 'cli' | 'config' | 'default';

export interface Resolution {
  readonly settings: ResolvedSettings;
  /** Layer that supplied each *scalar* key, by dotted path. Map keys are merged, so not listed. */
  readonly sources: Readonly<Record<string, Layer>>;
}

export function resolveSettings(cli: CliSettings, config: AzdoEmuConfig): Resolution {
  const sources: Record<string, Layer> = {};

  /** One scalar key, resolved CLI > config > default, remembering which layer answered. */
  const pick = <T>(
    key: string,
    fromCli: T | undefined,
    fromConfig: T | undefined,
    fallback: T,
  ): T => {
    if (fromCli !== undefined) {
      sources[key] = 'cli';
      return fromCli;
    }
    if (fromConfig !== undefined) {
      sources[key] = 'config';
      return fromConfig;
    }
    sources[key] = 'default';
    return fallback;
  };

  const settings: ResolvedSettings = {
    organization: pick(
      'organization',
      cli.organization,
      config.organization,
      DEFAULTS.organization,
    ),
    project: pick('project', cli.project, config.project, DEFAULTS.project),
    auth: {
      // No CLI flag sets these at convert time; `auth login --mode` is a separate command.
      azdo: pick('auth.azdo', undefined, config.auth?.azdo, DEFAULTS.auth.azdo),
      github: pick('auth.github', undefined, config.auth?.github, DEFAULTS.auth.github),
    },
    // Maps: per-key merge, CLI entries last so they win key by key (C-E13-012).
    parameters: { ...DEFAULTS.parameters, ...config.parameters, ...cli.parameters },
    repositories: { ...DEFAULTS.repositories, ...config.repositories },
    variableGroups: {
      listNames: pick(
        'variableGroups.listNames',
        cli.groupNames,
        config.variableGroups?.listNames,
        DEFAULTS.variableGroups.listNames,
      ),
    },
    tasks: {
      unknown: pick('tasks.unknown', undefined, config.tasks?.unknown, DEFAULTS.tasks.unknown),
      overrides: { ...DEFAULTS.tasks.overrides, ...config.tasks?.overrides },
      execute: pick('tasks.execute', undefined, config.tasks?.execute, DEFAULTS.tasks.execute),
    },
    output: {
      targetOs: pick(
        'output.targetOs',
        cli.targetOs,
        config.output?.targetOs,
        DEFAULTS.output.targetOs,
      ),
      checkoutMode: pick(
        'output.checkoutMode',
        cli.checkoutMode,
        config.output?.checkoutMode,
        DEFAULTS.output.checkoutMode,
      ),
      sharedWorkspace: pick(
        'output.sharedWorkspace',
        undefined,
        config.output?.sharedWorkspace,
        DEFAULTS.output.sharedWorkspace,
      ),
      execution: {
        environment: pick(
          'output.execution.environment',
          cli.execEnv,
          config.output?.execution?.environment,
          DEFAULTS.output.execution.environment,
        ),
        // `image: null` in the config is a *value* ("no override"), not an absent key, so it must
        // not fall through to the default — which happens to be null too, but the distinction
        // matters the moment the default changes.
        image: pick(
          'output.execution.image',
          cli.sandboxImage,
          config.output?.execution?.image,
          DEFAULTS.output.execution.image,
        ),
        dockerSocket: pick(
          'output.execution.dockerSocket',
          undefined,
          config.output?.execution?.dockerSocket,
          DEFAULTS.output.execution.dockerSocket,
        ),
      },
    },
  };

  return { settings, sources };
}
