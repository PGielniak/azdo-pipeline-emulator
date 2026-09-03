/**
 * The vendored `task.json` snapshots, read off disk (E08-S02-T01).
 *
 * `scripts/refresh-tasks-meta.ts` writes `vendor/tasks-meta/<Name>@<major>/task.json` with a
 * `PROVENANCE.json` beside it, pinned to a release tag (C-E00-014/015). Until now nothing read
 * them at convert time; the connection collector needs the declarations, because a connection input
 * is identified by its declared **type**, not by its name (C-E08-035).
 *
 * This is deliberately not a task-definition *resolution* layer — E07-S01-T01's downloader owns
 * that question, and a step whose task is not vendored simply contributes no connection rather than
 * being guessed at. What is vendored is what has been read and pinned.
 *
 * The directory is resolved relative to this module, which lands at `packages/emit/src` from source
 * and `packages/emit/dist` from the bundle — one level under the package root either way, which is
 * the same shape `runtimeLibDir()` gets wrong-by-depth if written from the source tree alone
 * (see the note on that function).
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { TaskDefinition } from './task-host.js';
import type { TaskDefinitions } from './connections.js';

/** Where the snapshots live, relative to this module. */
export function vendoredTasksDir(): string {
  return path.join(import.meta.dirname, '..', 'vendor', 'tasks-meta');
}

/**
 * Every vendored `task.json`, keyed by its directory name (`Name@major`).
 *
 * A snapshot that cannot be read or parsed is skipped rather than thrown on: a broken vendor entry
 * should cost the pipeline the connections that task would have contributed, not the conversion.
 * `tasks-meta-vendor.test.ts` is what makes a broken snapshot fail, and it fails loudly.
 */
export function loadVendoredTaskDefinitions(dir = vendoredTasksDir()): TaskDefinitions {
  const definitions: Record<string, TaskDefinition> = {};
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return definitions;
  }

  for (const entry of entries) {
    try {
      const raw = readFileSync(path.join(dir, entry, 'task.json'), 'utf8');
      definitions[entry] = JSON.parse(raw) as TaskDefinition;
    } catch {
      /* not a snapshot directory, or an unreadable one — see the note above */
    }
  }
  return definitions;
}
