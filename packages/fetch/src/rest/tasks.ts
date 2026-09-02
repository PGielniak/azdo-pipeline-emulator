/**
 * Installed task metadata (E09-S03-T05).
 *
 * Resolves a YAML `name@major` to the organization's installed task definition and caches its
 * `task.json` under docs/05 §4's `tasks/<TaskName>@<version>/`, for E07's real-task mode.
 *
 * The reference page for this endpoint is thin, so everything here is experiment-backed
 * (C-E09-085..089) with `microsoft/azure-pipelines-agent` as the code reference. Four measured
 * facts shape the code:
 *
 *  - **The list already *is* the metadata** (C-E09-085): each entry carries the whole `task.json` —
 *    inputs, execution, the lot — so metadata costs one call and no download.
 *  - **`version` is an object `{major, minor, patch, isTest}`, not a string** (C-E09-086). Matching
 *    `replacetokens@6` against `"6"` matches nothing.
 *  - **The list is unordered** (C-E09-087): `replacetokens` came back as majors `[3,4,6,7,5]`, so
 *    "latest" is computed, never taken as the last element. One `id` spans every major, and no two
 *    entries share a major, so `name@major` selects exactly one definition.
 *  - **The zip needs the exact `major.minor.patch`** (C-E09-088), so a download is necessarily two
 *    calls: list to learn the version, then fetch.
 */

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AzureDevOpsClient, RestError } from './client.js';
import { extractArchive } from '../repo/extract.js';

const CACHE_SUBDIR = '.cache/tasks';
const TASK_JSON = 'task.json';

/** C-E09-088: the service's own key for "no such task version". */
export const TASK_NOT_FOUND_TYPE_KEY = 'TaskDefinitionNotFoundException';

/** C-E09-086: an object, not a string. */
export interface TaskVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly isTest?: boolean;
}

export interface InstalledTask {
  readonly id: string;
  readonly name: string;
  readonly version: TaskVersion;
  /** C-E09-089: set for a marketplace extension; absent for an in-box task. */
  readonly contributionIdentifier?: string;
  /** C-E09-089: `true` for an in-box task. */
  readonly serverOwned?: boolean;
  readonly friendlyName?: string;
  /** The raw definition, i.e. what a `task.json` contains. Cached verbatim. */
  readonly definition: Readonly<Record<string, unknown>>;
}

export function versionString(version: TaskVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function parseVersion(value: unknown): TaskVersion | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (
    typeof row.major !== 'number' ||
    typeof row.minor !== 'number' ||
    typeof row.patch !== 'number'
  ) {
    return undefined;
  }
  return {
    major: row.major,
    minor: row.minor,
    patch: row.patch,
    ...(typeof row.isTest === 'boolean' ? { isTest: row.isTest } : {}),
  };
}

export function parseInstalledTask(value: unknown): InstalledTask | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string') return undefined;
  const version = parseVersion(row.version);
  if (version === undefined) return undefined;
  return {
    id: row.id,
    name: row.name,
    version,
    ...(typeof row.contributionIdentifier === 'string'
      ? { contributionIdentifier: row.contributionIdentifier }
      : {}),
    ...(typeof row.serverOwned === 'boolean' ? { serverOwned: row.serverOwned } : {}),
    ...(typeof row.friendlyName === 'string' ? { friendlyName: row.friendlyName } : {}),
    definition: row,
  };
}

/** List every installed task version. Organization-scoped — there is no project segment. */
export async function listInstalledTasks(
  client: AzureDevOpsClient,
): Promise<readonly InstalledTask[]> {
  const response = await client.request<{ value?: unknown }>({
    path: 'distributedtask/tasks',
    area: 'distributedtask',
    project: null,
  });
  const value = response.body?.value;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const task = parseInstalledTask(entry);
    return task === undefined ? [] : [task];
  });
}

/**
 * Select the entry a YAML `name@major` refers to.
 *
 * C-E09-086/087: names fold case (YAML is not case-sensitive about task names), the major is
 * compared numerically, and with `major` omitted the **highest** major is chosen by computation —
 * the service returns the versions unordered, so taking the last element would pick arbitrarily.
 */
export function selectTask(
  tasks: readonly InstalledTask[],
  name: string,
  major?: number,
): InstalledTask | undefined {
  const folded = name.toLowerCase();
  const candidates = tasks.filter((task) => task.name.toLowerCase() === folded);
  if (candidates.length === 0) return undefined;
  if (major !== undefined) {
    return candidates.find((task) => task.version.major === major);
  }
  return candidates.reduce((best, task) => (task.version.major > best.version.major ? task : best));
}

/** Split a YAML task reference: `replacetokens@6` → `{name, major}`. */
export function parseTaskReference(reference: string): { name: string; major?: number } {
  const at = reference.lastIndexOf('@');
  if (at <= 0) return { name: reference };
  const major = Number(reference.slice(at + 1));
  return Number.isInteger(major) && major >= 0
    ? { name: reference.slice(0, at), major }
    : { name: reference };
}

/** docs/05 §4: `.cache/tasks/<TaskName>@<version>/`. */
export function taskCacheDir(cacheDir: string, name: string, version: TaskVersion): string {
  return join(cacheDir, CACHE_SUBDIR, `${name}@${versionString(version)}`);
}

export interface CachedTask {
  readonly dir: string;
  readonly task: InstalledTask;
  /** False when the entry was already on disk, i.e. nothing was fetched. */
  readonly fetched: boolean;
}

/** Read a cached `task.json` without any network call — the `--frozen` entry point. */
export async function readCachedTask(
  cacheDir: string,
  name: string,
  version: TaskVersion,
): Promise<CachedTask | undefined> {
  const dir = taskCacheDir(cacheDir, name, version);
  let raw: string;
  try {
    raw = await readFile(join(dir, TASK_JSON), 'utf8');
  } catch {
    return undefined;
  }
  let task: InstalledTask | undefined;
  try {
    task = parseInstalledTask(JSON.parse(raw));
  } catch {
    return undefined;
  }
  return task === undefined ? undefined : { dir, task, fetched: false };
}

export interface CacheTaskOptions {
  readonly cacheDir: string;
  /** Skips the list call when the cache already holds this exact version. */
  readonly reference: string;
}

/**
 * Resolve a `name@major` reference and cache its `task.json`.
 *
 * The cached document is the raw definition the service returned, so real-task mode reads exactly
 * what the agent would (C-E09-085).
 */
export async function cacheTaskMetadata(
  client: AzureDevOpsClient,
  options: CacheTaskOptions,
): Promise<CachedTask> {
  const { name, major } = parseTaskReference(options.reference);
  const task = selectTask(await listInstalledTasks(client), name, major);
  if (task === undefined) {
    throw new RestError(
      `no installed task matches \`${options.reference}\`` +
        (major === undefined ? '' : ` (no version with major ${major})`),
      { url: 'distributedtask/tasks' },
    );
  }

  const dir = taskCacheDir(options.cacheDir, task.name, task.version);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, TASK_JSON), `${JSON.stringify(task.definition, null, 2)}\n`, 'utf8');
  return { dir, task, fetched: true };
}

export interface TaskZipDownload {
  readonly dir: string;
  readonly bytes: number;
  readonly files: number;
  /** False when the package was already unpacked, i.e. nothing was downloaded. */
  readonly fetched: boolean;
}

/** The unpacked package tree inside a task cache entry. */
export const TASK_TREE_DIR = 'tree';

/**
 * Download and unpack a task's package beside its cached `task.json` (real-task mode, docs/03 §6).
 *
 * C-E09-088: the route needs the exact `major.minor.patch`, so this takes a resolved `InstalledTask`
 * rather than a `name@major` string — the version has to come from the list call first.
 *
 * A complete entry is returned with **no request at all** (E07-S01-T01), which is what makes the
 * cache offline-reproducible; the marker is the unpacked tree rather than the zip, because a zip
 * present without a tree means an extraction that did not finish.
 */
export async function downloadTaskZip(
  client: AzureDevOpsClient,
  task: InstalledTask,
  cacheDir: string,
): Promise<TaskZipDownload> {
  const dir = taskCacheDir(cacheDir, task.name, task.version);
  const treeDir = join(dir, TASK_TREE_DIR);
  const existing = await countTree(treeDir);
  if (existing !== undefined) {
    return { dir, bytes: existing.bytes, files: existing.files, fetched: false };
  }

  const { bytes } = await client.requestBinary({
    path: `distributedtask/tasks/${encodeURIComponent(task.id)}/${versionString(task.version)}`,
    area: 'distributedtask',
    project: null,
    accept: 'application/zip',
  });

  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'task.zip'), bytes);
  const extracted = await extractArchive(bytes, 'zip', dir);
  return { dir, bytes: bytes.length, files: extracted.files, fetched: true };
}

/** `undefined` when the tree is absent or empty — either way there is nothing usable to reuse. */
async function countTree(treeDir: string): Promise<{ files: number; bytes: number } | undefined> {
  let files: number;
  try {
    const entries = await readdir(treeDir, { withFileTypes: true, recursive: true });
    files = entries.filter((entry) => entry.isFile()).length;
  } catch {
    return undefined;
  }
  if (files === 0) return undefined;
  let bytes: number;
  try {
    bytes = (await stat(join(treeDir, '..', 'task.zip'))).size;
  } catch {
    // The tree is what makes the entry usable; a missing zip beside it is not fatal.
    bytes = 0;
  }
  return { files, bytes };
}

/**
 * The lockfile pin for a resolved task (E07-S01-T01, docs/05 §4 `tasks`).
 *
 * Keyed by the reference as the YAML wrote it — `replacetokens@6` — because that is what a
 * re-convert looks up, while the *value* carries the exact `major.minor.patch` the download route
 * needs (C-E09-088). Pinning only the major would leave the download unaddressable.
 */
export function taskPin(
  task: InstalledTask,
  reference?: string,
): { key: string; id: string; version: string } {
  return {
    key: reference ?? `${task.name}@${task.version.major}`,
    id: task.id,
    version: versionString(task.version),
  };
}
