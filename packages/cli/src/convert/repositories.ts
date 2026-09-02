/**
 * E09-S02-T03 — the adapter that lets E03's reference resolution read from E09's fetched
 * repositories.
 *
 * `packages/fetch` resolves and pins repositories; `packages/engine` resolves `template:`
 * references against a `TemplateFetcher`. Neither depends on the other — `fetch` has no engine
 * dependency and adding one would invert the layering — so the join lives here, in the CLI, which
 * already composes both.
 *
 * Two read paths, because the two origins put different things on disk:
 *
 *  - a **working copy** (`self`, or an alias redirected by `repositories:` in `azdo-emu.yaml`) is a
 *    plain directory, and E03's own `localFetcher` reads it, case-exactly (C-E03-204);
 *  - a **bare mirror** (the ADO fetcher's preferred route, docs/05 §2) is a git object database, so
 *    a file is read with `git --git-dir <mirror> show <commit>:<path>` — no extraction step, no
 *    dependency, and the read is pinned to the same commit the lockfile carries.
 *
 * An **archive** snapshot — the Items `$format=zip` fallback, or GitHub's tarball — is not readable
 * without an extraction step, which is not in this task's Do. Those aliases resolve and pin
 * correctly; reading their files reports `archive-not-extracted` rather than pretending the file is
 * absent, so the difference between "no such template" and "we cannot open this snapshot yet" stays
 * visible. E09-S02-T04 closes it.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { localFetcher, type LocalRepositorySpec, type TemplateFetcher } from '@azdo-emu/engine';
import type { AliasResolutionResult, ResolvedRepository } from '@azdo-emu/fetch';

export const REPOSITORY_ARCHIVE_UNREADABLE = 'repository-archive-not-extracted';

export interface RepositoryFetcherResult {
  readonly fetcher: TemplateFetcher;
  /** Aliases whose snapshot is an archive we cannot yet read files out of. */
  readonly unreadable: readonly string[];
}

function isWorkingCopy(repository: ResolvedRepository): boolean {
  return repository.origin === 'self' || repository.origin === 'local-override';
}

function isBareMirror(repository: ResolvedRepository): boolean {
  return repository.method === 'bare-mirror';
}

/** `git show <commit>:<path>` — the path is repository-relative, with no leading slash. */
export function readFromMirror(
  mirrorDir: string,
  commit: string,
  repositoryPath: string,
): string | undefined {
  const relative = repositoryPath.replace(/^\/+/, '');
  try {
    return execFileSync('git', ['--git-dir', mirrorDir, 'show', `${commit}:${relative}`], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // A missing path and an unreadable object are the same answer here: no such file at this commit.
    return undefined;
  }
}

/**
 * Build a `TemplateFetcher` over an alias resolution.
 *
 * Alias lookup is delegated to `localFetcher` for every repository, so the case folding
 * (C-E03-213), the `self` alias (C-E03-197) and the not-found message shape (C-E03-207) all stay
 * with the one implementation that was measured against the service.
 */
export function repositoryFetcher(resolution: AliasResolutionResult): RepositoryFetcherResult {
  const specs: LocalRepositorySpec[] = resolution.repositories.map((repository) => ({
    alias: repository.alias,
    // Working copies read from their own root; mirrors and archives never reach `localFetcher.read`.
    root: isWorkingCopy(repository) ? repository.dir : path.join(repository.dir, '__unreadable__'),
    url: repository.url,
    ref: repository.ref,
    commit: repository.commit,
  }));
  const base = localFetcher(specs);

  const byFoldedAlias = new Map(
    resolution.repositories.map((repository) => [repository.alias.toLowerCase(), repository]),
  );
  const unreadable = resolution.repositories
    .filter((repository) => !isWorkingCopy(repository) && !isBareMirror(repository))
    .map((repository) => repository.alias);

  return {
    fetcher: {
      repository: base.repository,
      read: (location) => {
        const resolved = byFoldedAlias.get(location.repository.alias.toLowerCase());
        if (resolved === undefined) return undefined;
        if (isWorkingCopy(resolved)) return base.read(location);
        if (isBareMirror(resolved)) {
          return readFromMirror(
            path.join(resolved.dir, 'mirror.git'),
            resolved.commit,
            location.path,
          );
        }
        return undefined;
      },
    },
    unreadable,
  };
}
