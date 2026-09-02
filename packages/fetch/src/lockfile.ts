/**
 * `azdo-emu.lock.json` — the whole schema, and the `--frozen` guarantee (E09-S03-T06).
 *
 * docs/05 §4 specifies the file; E00-S04-T02 already owned the `expansion` field alone
 * (`expansion-cache.ts`). This module owns the rest — `root`, `parameters`, `repositories`,
 * `pipelines`, `tasks` — and, more importantly, the two operations the lockfile exists for:
 *
 *  - **write**, deterministically, so two converts from the same inputs produce byte-identical
 *    files (the task's Done criterion), and
 *  - **verify**, so `--frozen` fails *before* the first network call rather than part-way through a
 *    conversion, naming every pin the cache cannot satisfy.
 *
 * Determinism is not incidental here. A lockfile is a diffable artifact the user commits, so a map
 * whose key order followed insertion order would churn the file on every convert and make the
 * reproducibility criterion untestable. Every map is therefore emitted with sorted keys, and the
 * top-level field order is fixed rather than object-literal order.
 *
 * `convertedAt` is the one field that cannot be deterministic — it is a timestamp — so it is
 * excluded from the comparison a reproducibility check makes (`lockfileFingerprint`), and callers
 * that want byte-identical files pass the previous value through.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ExpansionLockEntry } from './expansion-cache.js';
import { repoCacheDir, type AdoRepoCoordinates } from './repo/ado-git.js';
import { githubRepoCacheDir, type GitHubRepoCoordinates } from './repo/github.js';
import { artifactCacheDir } from './rest/runs.js';
import { taskCacheDir, type TaskVersion } from './rest/tasks.js';

export const LOCKFILE_NAME = 'azdo-emu.lock.json';
export const LOCKFILE_VERSION = 1 as const;

/** docs/05 §4: `{url, ref, commit}` plus the type for anything that is not `self`. */
export interface RepositoryPin {
  readonly type?: 'azdo' | 'github';
  readonly url: string;
  readonly ref: string;
  readonly commit: string;
}

/** docs/05 §4, widened by E02-S04-T03 to carry all twelve predefined variables. */
export interface PipelinePin {
  readonly projectId?: string;
  readonly projectName?: string;
  readonly pipelineId: number;
  readonly pipelineName?: string;
  readonly runId: number;
  readonly runName?: string;
  readonly runUri?: string;
  readonly sourceBranch?: string;
  readonly sourceCommit?: string;
  readonly sourceProvider?: string;
  readonly requestedFor?: string;
  readonly requestedForId?: string;
  readonly artifacts?: readonly string[];
}

export interface TaskPin {
  readonly id: string;
  readonly version: string;
}

export interface RootPin {
  readonly file: string;
  readonly sha256: string;
}

export interface Lockfile {
  readonly version: typeof LOCKFILE_VERSION;
  readonly convertedAt: string;
  readonly root?: RootPin;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly repositories?: Readonly<Record<string, RepositoryPin>>;
  readonly pipelines?: Readonly<Record<string, PipelinePin>>;
  readonly tasks?: Readonly<Record<string, TaskPin>>;
  readonly expansion?: ExpansionLockEntry;
}

export class LockfileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LockfileError';
  }
}

/** Fixed field order for one pin, so a re-write is byte-identical whatever built the object. */
function ordered<T extends object>(value: T, keys: readonly (keyof T & string)[]): T {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out as T;
}

function sortedMap<T extends object>(
  map: Readonly<Record<string, T>> | undefined,
  keys: readonly (keyof T & string)[],
): Record<string, T> | undefined {
  if (map === undefined) return undefined;
  const out: Record<string, T> = {};
  for (const key of Object.keys(map).sort()) out[key] = ordered(map[key]!, keys);
  return out;
}

const REPOSITORY_KEYS = ['type', 'url', 'ref', 'commit'] as const;
const PIPELINE_KEYS = [
  'projectId',
  'projectName',
  'pipelineId',
  'pipelineName',
  'runId',
  'runName',
  'runUri',
  'sourceBranch',
  'sourceCommit',
  'sourceProvider',
  'requestedFor',
  'requestedForId',
  'artifacts',
] as const;
const TASK_KEYS = ['id', 'version'] as const;

/**
 * Canonical form: fixed top-level field order, every map key-sorted, **every pin's own fields in a
 * fixed order too**, absent fields omitted.
 *
 * The per-pin ordering is not cosmetic. Sorting only the map keys still left a `pipelines.<alias>`
 * object whose field order followed whichever code path built it — so a lockfile written from a
 * freshly fetched pin and one written from a re-read pin differed by field order alone, and "two
 * converts from lock → identical output hashes" failed. That is exactly the bug this guarantee
 * exists to prevent, and it was caught by the Done-criterion test rather than by inspection.
 */
export function canonicalizeLockfile(lockfile: Lockfile): Record<string, unknown> {
  const out: Record<string, unknown> = {
    version: lockfile.version,
    convertedAt: lockfile.convertedAt,
  };
  if (lockfile.root !== undefined) {
    out.root = { file: lockfile.root.file, sha256: lockfile.root.sha256 };
  }
  if (lockfile.parameters !== undefined) {
    const parameters: Record<string, string> = {};
    for (const key of Object.keys(lockfile.parameters).sort()) {
      parameters[key] = lockfile.parameters[key]!;
    }
    out.parameters = parameters;
  }
  const repositories = sortedMap(lockfile.repositories, REPOSITORY_KEYS);
  if (repositories !== undefined) out.repositories = repositories;
  const pipelines = sortedMap(lockfile.pipelines, PIPELINE_KEYS);
  if (pipelines !== undefined) out.pipelines = pipelines;
  const tasks = sortedMap(lockfile.tasks, TASK_KEYS);
  if (tasks !== undefined) out.tasks = tasks;
  if (lockfile.expansion !== undefined) {
    out.expansion = ordered(lockfile.expansion, [
      'requestHash',
      'finalYamlHash',
      'apiVersion',
      'pipelineId',
      'storedAt',
    ]);
  }
  return out;
}

export function serializeLockfile(lockfile: Lockfile): string {
  return `${JSON.stringify(canonicalizeLockfile(lockfile), null, 2)}\n`;
}

/**
 * Hash of everything a re-convert should reproduce.
 *
 * `convertedAt` is deliberately excluded: it is a wall-clock stamp, so including it would make the
 * reproducibility criterion untestable by construction.
 */
export function lockfileFingerprint(lockfile: Lockfile): string {
  const canonical = canonicalizeLockfile(lockfile);
  delete canonical.convertedAt;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseRepositories(value: unknown): Record<string, RepositoryPin> | undefined {
  const map = asRecord(value);
  if (map === undefined) return undefined;
  const out: Record<string, RepositoryPin> = {};
  for (const [alias, raw] of Object.entries(map)) {
    const pin = asRecord(raw);
    if (
      pin === undefined ||
      typeof pin.url !== 'string' ||
      typeof pin.ref !== 'string' ||
      typeof pin.commit !== 'string'
    ) {
      throw new LockfileError(`repositories.${alias} must carry url, ref and commit`);
    }
    out[alias] = {
      ...(pin.type === 'azdo' || pin.type === 'github' ? { type: pin.type } : {}),
      url: pin.url,
      ref: pin.ref,
      commit: pin.commit,
    };
  }
  return out;
}

function parsePipelines(value: unknown): Record<string, PipelinePin> | undefined {
  const map = asRecord(value);
  if (map === undefined) return undefined;
  const out: Record<string, PipelinePin> = {};
  for (const [alias, raw] of Object.entries(map)) {
    const pin = asRecord(raw);
    if (pin === undefined || typeof pin.pipelineId !== 'number' || typeof pin.runId !== 'number') {
      throw new LockfileError(`pipelines.${alias} must carry a numeric pipelineId and runId`);
    }
    const artifacts = Array.isArray(pin.artifacts)
      ? pin.artifacts.filter((name): name is string => typeof name === 'string')
      : undefined;
    const strings = [
      'projectId',
      'projectName',
      'pipelineName',
      'runName',
      'runUri',
      'sourceBranch',
      'sourceCommit',
      'sourceProvider',
      'requestedFor',
      'requestedForId',
    ] as const;
    const optional: Record<string, string> = {};
    for (const key of strings) if (typeof pin[key] === 'string') optional[key] = pin[key];
    out[alias] = {
      ...optional,
      pipelineId: pin.pipelineId,
      runId: pin.runId,
      ...(artifacts === undefined ? {} : { artifacts }),
    };
  }
  return out;
}

function parseTasks(value: unknown): Record<string, TaskPin> | undefined {
  const map = asRecord(value);
  if (map === undefined) return undefined;
  const out: Record<string, TaskPin> = {};
  for (const [reference, raw] of Object.entries(map)) {
    const pin = asRecord(raw);
    if (pin === undefined || typeof pin.id !== 'string' || typeof pin.version !== 'string') {
      throw new LockfileError(`tasks['${reference}'] must carry id and version`);
    }
    out[reference] = { id: pin.id, version: pin.version };
  }
  return out;
}

/** Parse a lockfile document, refusing anything structurally wrong rather than half-reading it. */
export function parseLockfile(text: string): Lockfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new LockfileError(`${LOCKFILE_NAME} is not valid JSON`, { cause: error });
  }
  const document = asRecord(parsed);
  if (document === undefined) throw new LockfileError(`${LOCKFILE_NAME} must be a JSON object`);
  if (document.version !== LOCKFILE_VERSION) {
    throw new LockfileError(
      `${LOCKFILE_NAME} has version ${String(document.version)}; this build understands ${LOCKFILE_VERSION}`,
    );
  }

  const lockfile: {
    -readonly [K in keyof Lockfile]: Lockfile[K];
  } = {
    version: LOCKFILE_VERSION,
    convertedAt: typeof document.convertedAt === 'string' ? document.convertedAt : '',
  };

  const root = asRecord(document.root);
  if (root !== undefined && typeof root.file === 'string' && typeof root.sha256 === 'string') {
    lockfile.root = { file: root.file, sha256: root.sha256 };
  }

  const parameters = asRecord(document.parameters);
  if (parameters !== undefined) {
    lockfile.parameters = Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [key, String(value)]),
    );
  }

  const repositories = parseRepositories(document.repositories);
  if (repositories !== undefined) lockfile.repositories = repositories;
  const pipelines = parsePipelines(document.pipelines);
  if (pipelines !== undefined) lockfile.pipelines = pipelines;
  const tasks = parseTasks(document.tasks);
  if (tasks !== undefined) lockfile.tasks = tasks;

  const expansion = asRecord(document.expansion);
  if (expansion !== undefined) lockfile.expansion = expansion as unknown as ExpansionLockEntry;

  return lockfile;
}

export async function readLockfile(lockfilePath: string): Promise<Lockfile | undefined> {
  let text: string;
  try {
    text = await readFile(lockfilePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return parseLockfile(text);
}

/**
 * Write the lockfile, preserving any field this build does not own.
 *
 * The `expansion` entry is written separately by `expansion-cache.ts`, and a future field may be
 * added by a later task, so an unknown top-level key is carried through rather than dropped —
 * silently deleting a pin another part of the tool wrote would break `--frozen` in a way that looks
 * like a cache miss.
 */
export async function writeLockfile(lockfilePath: string, lockfile: Lockfile): Promise<void> {
  let existing: Record<string, unknown>;
  try {
    existing = (JSON.parse(await readFile(lockfilePath, 'utf8')) as Record<string, unknown>) ?? {};
  } catch {
    // No lockfile yet, or one this build cannot read — either way there is nothing to carry.
    existing = {};
  }
  const canonical = canonicalizeLockfile(lockfile);
  const known = new Set([
    'version',
    'convertedAt',
    'root',
    'parameters',
    'repositories',
    'pipelines',
    'tasks',
    'expansion',
  ]);
  const carried: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(existing)) {
    if (!known.has(key)) carried[key] = value;
  }
  const merged = { ...canonical, ...Object.fromEntries(Object.entries(carried).sort()) };

  await mkdir(dirname(lockfilePath), { recursive: true });
  await writeFile(lockfilePath, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

/**
 * Add or replace one task pin, preserving every other section (E07-S01-T01).
 *
 * A convert resolves tasks one at a time, so this is a read-modify-write rather than a whole-file
 * rewrite: rebuilding the document from just the tasks it happened to see would drop the repository
 * and pipeline pins the same convert wrote earlier.
 */
export async function pinTask(
  lockfilePath: string,
  reference: string,
  pin: TaskPin,
  convertedAt: string,
): Promise<Lockfile> {
  const existing = (await readLockfile(lockfilePath)) ?? {
    version: LOCKFILE_VERSION,
    convertedAt,
  };
  const updated: Lockfile = {
    ...existing,
    convertedAt,
    tasks: { ...existing.tasks, [reference]: pin },
  };
  await writeLockfile(lockfilePath, updated);
  return updated;
}

/** One pin `--frozen` could not satisfy from cache. */
export interface MissingPin {
  readonly kind: 'repository' | 'pipeline-artifact' | 'task' | 'expansion';
  readonly key: string;
  readonly expectedPath: string;
}

export interface VerifyOptions {
  readonly cacheDir: string;
  readonly organization?: { readonly orgUrl: string; readonly project: string };
  /** Injected so the check is a pure function of the filesystem in tests. */
  readonly exists?: (path: string) => Promise<boolean>;
}

const defaultExists = async (path: string): Promise<boolean> => {
  const { access } = await import('node:fs/promises');
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/** Repository pins are keyed by their own url, so the cache path is derivable without the config. */
function repositoryCachePath(
  cacheDir: string,
  pin: RepositoryPin,
  organization: { readonly orgUrl: string; readonly project: string } | undefined,
): string {
  if (pin.type === 'github' || /github\.com/i.test(pin.url)) {
    const segments = new URL(pin.url).pathname.split('/').filter(Boolean);
    const coordinates: GitHubRepoCoordinates = {
      owner: segments[0] ?? 'unknown',
      repo: segments[1] ?? 'unknown',
    };
    return githubRepoCacheDir(cacheDir, coordinates, pin.commit);
  }
  // `<org>/<project>/_git/<repo>` — the shape the ADO fetcher builds and the lockfile records.
  const match = /^(https?:\/\/[^/]+\/[^/]+)\/([^/]+)\/_git\/([^/?#]+)$/.exec(pin.url);
  const coordinates: AdoRepoCoordinates =
    match === null
      ? {
          orgUrl: organization?.orgUrl ?? pin.url,
          project: organization?.project ?? 'unknown',
          repository: 'unknown',
        }
      : {
          orgUrl: decodeURIComponent(match[1]!),
          project: decodeURIComponent(match[2]!),
          repository: decodeURIComponent(match[3]!),
        };
  return repoCacheDir(cacheDir, coordinates, pin.commit);
}

/**
 * Check every pin against the cache **before** any network call.
 *
 * `--frozen` promises a fully offline convert (docs/05 §4). Discovering the third of five
 * repositories is missing half-way through means a partial output and a confusing error, so this
 * reports **all** missing pins at once and the caller refuses up front.
 */
export async function verifyLockfile(
  lockfile: Lockfile,
  options: VerifyOptions,
): Promise<readonly MissingPin[]> {
  const exists = options.exists ?? defaultExists;
  const missing: MissingPin[] = [];

  for (const [alias, pin] of Object.entries(lockfile.repositories ?? {})) {
    // A working copy is pinned with an all-zero commit and has nothing in the cache to check.
    if (/^0{40}$/.test(pin.commit)) continue;
    const path = repositoryCachePath(options.cacheDir, pin, options.organization);
    if (!(await exists(join(path, 'snapshot.json')))) {
      missing.push({ kind: 'repository', key: alias, expectedPath: path });
    }
  }

  for (const [alias, pin] of Object.entries(lockfile.pipelines ?? {})) {
    for (const artifact of pin.artifacts ?? []) {
      const path = artifactCacheDir(options.cacheDir, alias, pin.runId, artifact);
      if (!(await exists(path))) {
        missing.push({
          kind: 'pipeline-artifact',
          key: `${alias}/${artifact}`,
          expectedPath: path,
        });
      }
    }
  }

  for (const [reference, pin] of Object.entries(lockfile.tasks ?? {})) {
    const name = reference.includes('@')
      ? reference.slice(0, reference.lastIndexOf('@'))
      : reference;
    const parts = pin.version.split('.').map(Number);
    const version: TaskVersion = {
      major: parts[0] ?? 0,
      minor: parts[1] ?? 0,
      patch: parts[2] ?? 0,
    };
    const path = taskCacheDir(options.cacheDir, name, version);
    if (!(await exists(join(path, 'task.json')))) {
      missing.push({ kind: 'task', key: reference, expectedPath: path });
    }
  }

  if (lockfile.expansion !== undefined) {
    const path = join(options.cacheDir, '.cache/expansion', lockfile.expansion.requestHash);
    if (!(await exists(join(path, 'final.yml')))) {
      missing.push({ kind: 'expansion', key: lockfile.expansion.requestHash, expectedPath: path });
    }
  }

  return missing;
}

/**
 * The message `--frozen` prints when the cache cannot satisfy the lock.
 *
 * Every missing pin is listed, because fixing them one convert at a time is the failure mode this
 * whole check exists to avoid.
 */
export function frozenFailureMessage(missing: readonly MissingPin[]): string {
  const lines = [
    `--frozen cannot proceed: ${missing.length} pinned item${missing.length === 1 ? '' : 's'} ` +
      'not in the cache.',
    '',
    ...missing.map((pin) => `  ${pin.kind} ${pin.key}\n    expected at ${pin.expectedPath}`),
    '',
    'Run convert without --frozen once to populate the cache, then retry.',
  ];
  return lines.join('\n');
}
