// E13-S01-T02 — read and validate `azdo-emu.yaml` (docs/06 §2, C-E13-008).
//
// Parsed with plain `yaml`, *not* the engine's pipeline parser: this is our own file format, so the
// service quirks the engine enforces (anchors rejected, duplicate keys folded case-insensitively,
// one document per file — C-E01-021..028) have no business here. A user may absolutely use a YAML
// anchor in their own config.
//
// Validation is hand-written rather than schema-driven so every message can name the offending key
// and point at the line; the committed JSON schema (`schema/azdo-emu.schema.json`, C-E13-011) is for
// editors, and a test asserts the two agree.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { LineCounter, parseDocument, type Document } from 'yaml';
import { CliError } from '../exit.js';
import {
  AZDO_AUTH_MODES,
  CHECKOUT_MODES,
  DOCKER_SOCKET_MODES,
  EXECUTION_ENVIRONMENTS,
  GITHUB_AUTH_MODES,
  TARGET_OS,
  TASK_OVERRIDES,
  UNKNOWN_TASK_POLICIES,
  type AzdoEmuConfig,
  type ParameterValue,
} from './types.js';

/** The one file name docs/06 §2 defines. There is no `--config` flag in docs/06 §1. */
export const CONFIG_FILE_NAME = 'azdo-emu.yaml';

/** Accepted keys per mapping. Exported so the committed JSON schema can be checked against it. */
export const CONFIG_KEYS = {
  root: ['organization', 'project', 'auth', 'parameters', 'repositories', 'variableGroups', 'coverage', 'tasks', 'output'], // prettier-ignore
  auth: ['azdo', 'github'],
  variableGroups: ['listNames'],
  coverage: ['min'],
  tasks: ['unknown', 'overrides', 'execute'],
  output: ['targetOs', 'checkoutMode', 'sharedWorkspace', 'execution'],
  execution: ['environment', 'image', 'dockerSocket'],
  repositoryOverride: ['path'],
} as const;

export interface LoadedConfig {
  /** Absolute path of the file the values came from, or undefined when none exists. */
  readonly file: string | undefined;
  readonly config: AzdoEmuConfig;
}

/** Look for `azdo-emu.yaml` **next to the pipeline file** (docs/06 §2: "next to the pipeline"). */
export function discoverConfigFile(pipelineFile: string): string | undefined {
  const candidate = path.resolve(path.dirname(path.resolve(pipelineFile)), CONFIG_FILE_NAME);
  return existsSync(candidate) ? candidate : undefined;
}

/** Discover and load the config beside `pipelineFile`; an absent file is not an error. */
export function loadConfigFor(pipelineFile: string): LoadedConfig {
  const file = discoverConfigFile(pipelineFile);
  return file === undefined ? { file: undefined, config: {} } : loadConfigFile(file);
}

/** Read, parse and validate one config file. Every failure is a `CliError` (exit 1). */
export function loadConfigFile(file: string): LoadedConfig {
  let source: string;
  try {
    source = readFileSync(file, 'utf8');
  } catch (error) {
    throw new CliError(`cannot read ${file}`, { hint: (error as Error).message });
  }

  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  if (doc.errors.length > 0) {
    const first = doc.errors[0]!;
    throw new CliError(`${formatPosition(file, lineCounter, first.pos[0])}: ${first.message}`, {
      hint: `${CONFIG_FILE_NAME} must be valid YAML`,
    });
  }

  const value: unknown = doc.toJS({ maxAliasCount: -1 }) ?? {};
  const ctx: Ctx = { file, doc, lineCounter };
  return { file, config: validate(value, ctx) };
}

interface Ctx {
  readonly file: string;
  readonly doc: Document.Parsed;
  readonly lineCounter: LineCounter;
}

function validate(value: unknown, ctx: Ctx): AzdoEmuConfig {
  const root = requireRecord(value, [], ctx);
  known(root, [], CONFIG_KEYS.root, ctx);

  const auth = optionalRecord(root['auth'], ['auth'], ctx);
  const tasks = optionalRecord(root['tasks'], ['tasks'], ctx);
  const output = optionalRecord(root['output'], ['output'], ctx);
  const execution = optionalRecord(output?.['execution'], ['output', 'execution'], ctx);
  const variableGroups = optionalRecord(root['variableGroups'], ['variableGroups'], ctx);
  const coverage = optionalRecord(root['coverage'], ['coverage'], ctx);

  if (auth) known(auth, ['auth'], CONFIG_KEYS.auth, ctx);
  if (tasks) known(tasks, ['tasks'], CONFIG_KEYS.tasks, ctx);
  if (output) known(output, ['output'], CONFIG_KEYS.output, ctx);
  if (execution) known(execution, ['output', 'execution'], CONFIG_KEYS.execution, ctx);
  if (variableGroups) known(variableGroups, ['variableGroups'], CONFIG_KEYS.variableGroups, ctx);
  if (coverage) known(coverage, ['coverage'], CONFIG_KEYS.coverage, ctx);

  const config: Mutable<AzdoEmuConfig> = {};
  assign(config, 'organization', string(root['organization'], ['organization'], ctx));
  assign(config, 'project', string(root['project'], ['project'], ctx));

  const azdo = choice(auth?.['azdo'], ['auth', 'azdo'], AZDO_AUTH_MODES, ctx);
  const github = choice(auth?.['github'], ['auth', 'github'], GITHUB_AUTH_MODES, ctx);
  if (azdo !== undefined || github !== undefined) {
    config.auth = { ...(azdo ? { azdo } : {}), ...(github ? { github } : {}) };
  }

  const parameters = optionalRecord(root['parameters'], ['parameters'], ctx);
  if (parameters) config.parameters = parameters as Record<string, ParameterValue>;

  const repositories = optionalRecord(root['repositories'], ['repositories'], ctx);
  if (repositories) {
    const resolved: Record<string, { path: string }> = {};
    for (const [alias, entry] of Object.entries(repositories)) {
      const record = requireRecord(entry, ['repositories', alias], ctx);
      known(record, ['repositories', alias], CONFIG_KEYS.repositoryOverride, ctx);
      const value = string(record['path'], ['repositories', alias, 'path'], ctx);
      if (value === undefined) {
        throw error(
          ['repositories', alias],
          'needs a `path:` (the local working copy to use)',
          ctx,
        );
      }
      // Written *in the config*, so relative to the config file — a config stays valid however it
      // is invoked (C-E13-013).
      resolved[alias] = { path: path.resolve(path.dirname(ctx.file), value) };
    }
    config.repositories = resolved;
  }

  const listNames = boolean(variableGroups?.['listNames'], ['variableGroups', 'listNames'], ctx);
  if (listNames !== undefined) config.variableGroups = { listNames };

  const min = number(coverage?.['min'], ['coverage', 'min'], ctx);
  if (min !== undefined) {
    if (min < 0 || min > 100) {
      throw error(['coverage', 'min'], `must be a percentage between 0 and 100, got ${min}`, ctx);
    }
    config.coverage = { min };
  }

  const unknownPolicy = choice(
    tasks?.['unknown'],
    ['tasks', 'unknown'],
    UNKNOWN_TASK_POLICIES,
    ctx,
  );
  const overridesRecord = optionalRecord(tasks?.['overrides'], ['tasks', 'overrides'], ctx);
  const execute = stringList(tasks?.['execute'], ['tasks', 'execute'], ctx);
  const overrides = overridesRecord
    ? Object.fromEntries(
        Object.entries(overridesRecord).map(([task, action]) => [
          task,
          choice(action, ['tasks', 'overrides', task], TASK_OVERRIDES, ctx)!,
        ]),
      )
    : undefined;
  if (unknownPolicy !== undefined || overrides !== undefined || execute !== undefined) {
    config.tasks = {
      ...(unknownPolicy ? { unknown: unknownPolicy } : {}),
      ...(overrides ? { overrides } : {}),
      ...(execute ? { execute } : {}),
    };
  }

  const targetOs = choice(output?.['targetOs'], ['output', 'targetOs'], TARGET_OS, ctx);
  const checkoutMode = choice(output?.['checkoutMode'], ['output', 'checkoutMode'], CHECKOUT_MODES, ctx); // prettier-ignore
  const sharedWorkspace = boolean(output?.['sharedWorkspace'], ['output', 'sharedWorkspace'], ctx);
  const environment = choice(execution?.['environment'], ['output', 'execution', 'environment'], EXECUTION_ENVIRONMENTS, ctx); // prettier-ignore
  const dockerSocket = choice(execution?.['dockerSocket'], ['output', 'execution', 'dockerSocket'], DOCKER_SOCKET_MODES, ctx); // prettier-ignore
  const image =
    execution?.['image'] === null
      ? null
      : string(execution?.['image'], ['output', 'execution', 'image'], ctx);

  const executionConfig = {
    ...(environment ? { environment } : {}),
    ...(image !== undefined ? { image } : {}),
    ...(dockerSocket ? { dockerSocket } : {}),
  };
  const outputConfig = {
    ...(targetOs ? { targetOs } : {}),
    ...(checkoutMode ? { checkoutMode } : {}),
    ...(sharedWorkspace !== undefined ? { sharedWorkspace } : {}),
    ...(Object.keys(executionConfig).length > 0 ? { execution: executionConfig } : {}),
  };
  if (Object.keys(outputConfig).length > 0) config.output = outputConfig;

  return config;
}

// ---------------------------------------------------------------------------
// typed readers — each reports `file:line:col` and the key path it was reading
// ---------------------------------------------------------------------------

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Path = readonly (string | number)[];

function assign<K extends keyof AzdoEmuConfig>(
  config: Mutable<AzdoEmuConfig>,
  key: K,
  value: AzdoEmuConfig[K] | undefined,
): void {
  if (value !== undefined) config[key] = value;
}

function requireRecord(value: unknown, at: Path, ctx: Ctx): Record<string, unknown> {
  const record = optionalRecord(value, at, ctx);
  if (record === undefined) throw error(at, `expected a mapping, found ${describe(value)}`, ctx);
  return record;
}

function optionalRecord(value: unknown, at: Path, ctx: Ctx): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw error(at, `expected a mapping, found ${describe(value)}`, ctx);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, at: Path, ctx: Ctx): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string')
    throw error(at, `expected a string, found ${describe(value)}`, ctx);
  return value;
}

function boolean(value: unknown, at: Path, ctx: Ctx): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw error(at, `expected true or false, found ${describe(value)}`, ctx);
  }
  return value;
}

function number(value: unknown, at: Path, ctx: Ctx): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw error(at, `expected a number, found ${describe(value)}`, ctx);
  }
  return value;
}

function stringList(value: unknown, at: Path, ctx: Ctx): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw error(at, `expected a list, found ${describe(value)}`, ctx);
  return value.map((entry, index) => {
    const text = string(entry, [...at, index], ctx);
    if (text === undefined) throw error([...at, index], 'expected a string', ctx);
    return text;
  });
}

function choice<T extends string>(
  value: unknown,
  at: Path,
  allowed: readonly T[],
  ctx: Ctx,
): T | undefined {
  const text = string(value, at, ctx);
  if (text === undefined) return undefined;
  if (!allowed.includes(text as T)) {
    throw error(at, `expected one of ${allowed.join(', ')}, found ${JSON.stringify(text)}`, ctx);
  }
  return text as T;
}

/** Unknown keys are errors, not warnings: a typo'd key silently doing nothing is the worse failure. */
function known(
  record: Record<string, unknown>,
  at: Path,
  allowed: readonly string[],
  ctx: Ctx,
): void {
  for (const key of Object.keys(record)) {
    if (allowed.includes(key)) continue;
    const suggestion = nearest(key, allowed);
    throw error([...at, key], `unknown key${suggestion ? ` — did you mean \`${suggestion}\`?` : ''}`, ctx); // prettier-ignore
  }
}

function error(at: Path, message: string, ctx: Ctx): CliError {
  const key = at.length === 0 ? CONFIG_FILE_NAME : at.join('.');
  return new CliError(`${position(at, ctx)}: \`${key}\`: ${message}`, {
    hint: `see docs/06 §2, or ${path.join('schema', 'azdo-emu.schema.json')}`,
  });
}

/** `file:line:col` of the offending node, falling back to the file alone when it has no node. */
function position(at: Path, ctx: Ctx): string {
  const node: unknown = at.length === 0 ? ctx.doc.contents : ctx.doc.getIn(at, true);
  const range = (node as { range?: [number, number, number] } | undefined)?.range;
  return range ? formatPosition(ctx.file, ctx.lineCounter, range[0]) : ctx.file;
}

function formatPosition(file: string, lineCounter: LineCounter, offset: number): string {
  const { line, col } = lineCounter.linePos(offset);
  return `${file}:${line}:${col}`;
}

function describe(value: unknown): string {
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a mapping';
  return `${typeof value} ${JSON.stringify(value)}`;
}

/** One-edit-distance-ish suggestion, same spirit as the engine's did-you-mean. */
function nearest(key: string, candidates: readonly string[]): string | undefined {
  const lower = key.toLowerCase();
  return candidates.find(
    (candidate) =>
      candidate.toLowerCase() === lower ||
      candidate.toLowerCase().startsWith(lower.slice(0, 3)) ||
      lower.startsWith(candidate.toLowerCase().slice(0, 3)),
  );
}
