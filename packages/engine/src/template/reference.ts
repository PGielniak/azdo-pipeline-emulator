/**
 * Template **reference resolution**: turning the text after `template:` into the identity of a
 * file in a repository, and refusing to follow it round in a circle.
 *
 * Everything here is grounded in 34 live preview probes against a **two-repository** oracle fixture
 * (`pnpm reference-survey`, `research/experiments/E03-references/`, claims `C-E03-195..218`). The
 * second repository is not a convenience: every question this module answers is "which repository
 * was that path read from", and one repository cannot tell the answers apart.
 *
 * Three measured rules shape the code more than the rest, and all three contradict the obvious
 * implementation:
 *
 *  - **Crossing a repository boundary resets the base directory to the repository root**
 *    (C-E03-215). A reference that stays in its own repository resolves against the including
 *    file's directory — even when it writes `@self` explicitly — but the moment the target
 *    repository differs, the including file's directory is discarded. The naive "base is always the
 *    including file's directory" model passes every probe written from a root pipeline file,
 *    because there the base *is* the root; it took a subdirectory fixture in each repository,
 *    pointing both ways, to see the difference.
 *  - **The alias splits on the *first* `@`** (C-E03-210). `a.yml@self@self` asks for a repository
 *    named `self@self`, and a file genuinely called `we@ird.yml` is unreachable. `lastIndexOf('@')`
 *    reproduces neither.
 *  - **There is no cycle detection in the service** (C-E03-208): a cycle simply recurses until it
 *    dies of `Maximum object depth exceeded`. We cannot do that — an emulator that recurses until
 *    the stack blows is a hang, not a behavior — so this module detects the repeat on
 *    `(repository, commit, path)` and reports *that* sentence at the file the service reports it
 *    at. Same observable result, terminating implementation; the divergence is in the mechanism and
 *    is deliberate.
 *
 * The fetcher is injected. The local-filesystem implementation below is what the converter uses
 * today; E08 supplies the remote one, and the seam is sized for it: `C-E03-196` says repositories
 * resolve **once, at pipeline start**, which is why a `RepositoryResource` carries a pinned commit
 * rather than a ref to be re-resolved per reference — and why `read` can be synchronous, since by
 * the time expansion runs, every repository is already fetched and pinned in the lockfile.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { SourceRange } from '../frontend/parse.js';

/** The alias for the repository the pipeline definition itself came from (C-E03-197). */
export const SELF_ALIAS = 'self';

/**
 * A repository, resolved and pinned. `url`, `ref` and `commit` are not decoration — they are the
 * three fields the service's own not-found sentence prints (C-E03-207), and reproducing that
 * sentence is the difference between a familiar error and a novel one.
 */
export interface RepositoryResource {
  /** Alias as declared in `resources.repositories`, or `self`. Compared case-insensitively. */
  readonly alias: string;
  /** Clone URL, as it appears in the service's not-found message. */
  readonly url: string;
  /** Full ref name; `refs/heads/main` when the resource omitted one (C-E03-198/218). */
  readonly ref: string;
  /** The 40-hex commit this repository is pinned to for the whole expansion (C-E03-196). */
  readonly commit: string;
}

/** A file in a repository: the unit of identity for cycle detection. */
export interface TemplateLocation {
  readonly repository: RepositoryResource;
  /** Repository-absolute and normalized: always starts with `/`, never contains `.` or `..`. */
  readonly path: string;
}

/**
 * How the service *names* a file in diagnostics: bare inside the definition's own repository, and
 * `<path>@<alias>` for anything else (C-E03-217). This string is what a `TemplateFrame.file`
 * carries, so error prefixes match the service's.
 */
export function locationName(location: TemplateLocation): string {
  const alias = location.repository.alias;
  return isSelfAlias(alias) ? location.path : `${location.path}@${alias}`;
}

function isSelfAlias(alias: string): boolean {
  return alias.toLowerCase() === SELF_ALIAS;
}

/** Two locations are the same file iff repository *and* path match (C-E03-209's diamond hinges on it). */
export function sameLocation(a: TemplateLocation, b: TemplateLocation): boolean {
  return sameRepository(a.repository, b.repository) && a.path === b.path;
}

/**
 * Repository identity is `url` + pinned `commit`, not the alias: two aliases may name one
 * repository, and `@self` inside the definition's own repo must compare *equal* to the frame's
 * repository or C-E03-215's base-directory rule would fire on a reference that never left home.
 * The URL folds case (Git hosts are not case-sensitive about it); the commit does not need to,
 * being hex from one source.
 */
function sameRepository(a: RepositoryResource, b: RepositoryResource): boolean {
  return a.url.toLowerCase() === b.url.toLowerCase() && a.commit === b.commit;
}

// ---------------------------------------------------------------------------------------------
// Parsing the reference text
// ---------------------------------------------------------------------------------------------

export interface ParsedReference {
  /** Everything before the first `@`. Not trimmed (C-E03-205). */
  readonly path: string;
  /**
   * Everything after the first `@`, or `undefined` when the text has no `@` at all. An **empty**
   * alias is not `undefined`: `a.yml@` is a real, legal reference that lands on `self`
   * (C-E03-212), and collapsing the two would lose that.
   */
  readonly alias: string | undefined;
}

/**
 * Split a reference into path and alias on the **first** `@` (C-E03-210).
 *
 * The consequence is worth stating because it looks like a bug and is not: a repository path
 * containing `@` cannot be referenced at all. `/dir/we@ird.yml` — a file that exists — is rejected
 * `No repository found by name ird.yml`, and there is no escape for it.
 */
export function parseReference(text: string): ParsedReference {
  const at = text.indexOf('@');
  if (at < 0) return { path: text, alias: undefined };
  return { path: text.slice(0, at), alias: text.slice(at + 1) };
}

// ---------------------------------------------------------------------------------------------
// Path math
// ---------------------------------------------------------------------------------------------

/**
 * The directory a relative reference in `filePath` resolves against, **as the service spells it**:
 * the text up to the last `/`, and `/` when that would be empty.
 *
 * The empty-vs-`/` distinction is measurable rather than cosmetic. It only ever shows through in
 * the rejection text, but it shows through exactly: from the root file `/azure-pipelines.yml` the
 * directory is `/`, so `../outside.yml` joins to `//../outside.yml`, while a repository switch uses
 * an empty base and produces a single-slash `/../…` (C-E03-200/215). Both strings appear verbatim
 * in probe output.
 */
export function directoryOf(filePath: string): string {
  const slash = filePath.lastIndexOf('/');
  if (slash < 0) return '';
  return slash === 0 ? '/' : filePath.slice(0, slash);
}

/**
 * Join a reference onto a base directory the way the service does: plain concatenation with a `/`,
 * **without** normalizing. The unnormalized string is kept because it is what the invalid-path
 * rejection prints (C-E03-200).
 */
export function joinReference(baseDirectory: string, reference: string): string {
  const separated = reference.replace(/\\/g, '/');
  // A leading `/` is repository-absolute and discards the base entirely, in the frame's repository
  // rather than the definition's (C-E03-201/216).
  if (separated.startsWith('/')) return separated;
  return `${baseDirectory}/${separated}`;
}

/**
 * Collapse `.`, `..` and repeated separators, or report that the path escaped the repository root.
 *
 * The check is on the **result**, not on each step: `/dir/sub/../leaf.yml` is legal and
 * `/dir/../../leaf.yml` is not, so a traversal may dip below the root count mid-string as long as
 * it does not end there — which is why this pops a stack rather than tracking a running depth
 * (C-E03-206). Case is preserved: repository lookup is case-**sensitive** (C-E03-204).
 */
export function normalizeRepositoryPath(joined: string): string | undefined {
  const segments: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return undefined; // walked above the repository root
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

export type ResolveResult =
  | { readonly kind: 'resolved'; readonly location: TemplateLocation }
  /** No `resources.repositories` entry (and not `self`) answers to this alias (C-E03-211). */
  | { readonly kind: 'unknown-alias'; readonly alias: string; readonly message: string }
  /** `..` walked above the repository root; `joined` is the unnormalized path the message prints. */
  | { readonly kind: 'invalid-path'; readonly joined: string; readonly message: string }
  /**
   * The target is already on the active include stack. `location` is the **repeated** file, which
   * is where the service locates its own message (C-E03-208) — not the file that wrote the
   * reference.
   */
  | { readonly kind: 'cycle'; readonly location: TemplateLocation; readonly message: string };

/** Resolves an alias to a pinned repository and reads files out of it. */
export interface TemplateFetcher {
  /**
   * The repository an alias names, or `undefined` when nothing declares it. Implementations must
   * fold case — the alias half of a reference is case-insensitive even though the path half is not
   * (C-E03-213/204) — and must answer `self` with the definition's own repository (C-E03-197).
   */
  readonly repository: (alias: string) => RepositoryResource | undefined;
  /** File contents, or `undefined` when the repository has no such file at its pinned commit. */
  readonly read: (location: TemplateLocation) => string | undefined;
}

/**
 * Resolve one `template:` reference written in `from`, given the files currently being expanded.
 *
 * `stack` is the **active** include chain, innermost last, and must contain `from`. Active rather
 * than visited is the whole distinction between a cycle and a diamond: including the same file
 * twice from one parent is legal and expands twice (C-E03-209).
 */
export function resolveReference(
  reference: string,
  from: TemplateLocation,
  fetcher: TemplateFetcher,
  stack: readonly TemplateLocation[] = [from],
): ResolveResult {
  const parsed = parseReference(reference);

  // No `@` at all keeps the including file's repository — which is *not* necessarily the
  // definition's, since a cross-repo template's own references stay in its repository (C-E03-216).
  // An explicit alias, empty or not, goes through the fetcher; empty means `self` (C-E03-212).
  const repository =
    parsed.alias === undefined
      ? from.repository
      : fetcher.repository(parsed.alias === '' ? SELF_ALIAS : parsed.alias);
  if (repository === undefined) {
    const alias = parsed.alias ?? '';
    return { kind: 'unknown-alias', alias, message: `No repository found by name ${alias}` };
  }

  // C-E03-215: the base survives only while the repository does. Note this compares the *resolved*
  // repositories, so writing `@self` from inside the definition's own repo keeps the base, while
  // omitting the alias from inside a cross-repo template also keeps it — the alias text is not what
  // decides, the repository is.
  const base = sameRepository(repository, from.repository) ? directoryOf(from.path) : '';

  const joined = joinReference(base, parsed.path);
  const normalized = normalizeRepositoryPath(joined);
  if (normalized === undefined) {
    return { kind: 'invalid-path', joined, message: `The file path ${joined} is invalid` };
  }

  const location: TemplateLocation = { repository, path: normalized };
  const repeated = stack.find((entry) => sameLocation(entry, location));
  if (repeated !== undefined) {
    // The service's sentence for a cycle, because the service never recognizes one: it recurses
    // until the depth limit fires (C-E03-208). Located at the repeated file, matching both the
    // self-inclusion and the mutual-inclusion probes.
    return { kind: 'cycle', location: repeated, message: 'Maximum object depth exceeded' };
  }
  return { kind: 'resolved', location };
}

/** `File <path> not found in repository <url> branch <ref> version <commit>.` (C-E03-207) */
export function notFoundMessage(location: TemplateLocation): string {
  const { url, ref, commit } = location.repository;
  return `File ${location.path} not found in repository ${url} branch ${ref} version ${commit}.`;
}

export const REFERENCE_UNKNOWN_ALIAS = 'template-reference-unknown-alias';
export const REFERENCE_INVALID_PATH = 'template-reference-invalid-path';
export const REFERENCE_CYCLE = 'template-reference-cycle';
export const REFERENCE_NOT_FOUND = 'template-reference-not-found';

export type LoadResult =
  | { readonly kind: 'loaded'; readonly location: TemplateLocation; readonly text: string }
  | { readonly kind: 'failed'; readonly diagnostic: Diagnostic };

/**
 * Resolve a reference and read the file behind it, reporting failures the way the service does.
 *
 * Attribution follows the probes rather than convention: a path, alias or missing-file failure is
 * located at the file that **wrote** the reference, while a cycle is located at the **repeated**
 * file (C-E03-208). `range` is the reference scalar's own range, matching how the service points at
 * the offending line.
 */
export function loadTemplate(
  reference: string,
  from: TemplateLocation,
  fetcher: TemplateFetcher,
  range: SourceRange,
  stack: readonly TemplateLocation[] = [from],
): LoadResult {
  const resolved = resolveReference(reference, from, fetcher, stack);
  const here = locationName(from);

  switch (resolved.kind) {
    case 'unknown-alias':
      return {
        kind: 'failed',
        diagnostic: diagnostic(REFERENCE_UNKNOWN_ALIAS, resolved.message, here, range),
      };
    case 'invalid-path':
      return {
        kind: 'failed',
        diagnostic: diagnostic(REFERENCE_INVALID_PATH, resolved.message, here, range),
      };
    case 'cycle':
      return {
        kind: 'failed',
        diagnostic: diagnostic(
          REFERENCE_CYCLE,
          resolved.message,
          locationName(resolved.location),
          range,
        ),
      };
    case 'resolved': {
      const text = fetcher.read(resolved.location);
      if (text === undefined) {
        return {
          kind: 'failed',
          diagnostic: diagnostic(
            REFERENCE_NOT_FOUND,
            notFoundMessage(resolved.location),
            here,
            range,
          ),
        };
      }
      return { kind: 'loaded', location: resolved.location, text };
    }
  }
}

function diagnostic(code: string, message: string, file: string, range: SourceRange): Diagnostic {
  // No help link, matching every reference rejection the survey captured — these are not
  // expression errors and the service does not append its "For more help" tail to them.
  return { severity: 'error', code, message, file, range };
}

// ---------------------------------------------------------------------------------------------
// Local-filesystem fetcher (E08 supplies the remote one)
// ---------------------------------------------------------------------------------------------

/** One repository checked out on disk. */
export interface LocalRepositorySpec {
  /** Alias as written in `resources.repositories`, or `self` for the definition's repository. */
  readonly alias: string;
  /** Absolute path of the working tree root; repository-absolute paths resolve under it. */
  readonly root: string;
  /** Defaults to a `file://` URL over `root`, so not-found messages stay well-formed. */
  readonly url?: string;
  /** Defaults to `refs/heads/main`, the documented default (C-E03-198). */
  readonly ref?: string;
  /** Defaults to `0`×40 — a local checkout has no pinned commit until E08's lockfile supplies one. */
  readonly commit?: string;
}

/**
 * A fetcher over local directories, one per alias.
 *
 * Case folding is applied to the **alias** only (C-E03-213). File lookup deliberately does *not*
 * fold: the service is case-sensitive about paths (C-E03-204), and on a case-insensitive host
 * filesystem this implementation will be more permissive than the service. That is a host
 * limitation rather than a modelled behavior, and it is one-directional — it accepts pipelines the
 * service would reject, never the reverse.
 */
export function localFetcher(repositories: readonly LocalRepositorySpec[]): TemplateFetcher {
  const byAlias = new Map<string, RepositoryResource>();
  const rootByAlias = new Map<string, string>();
  for (const spec of repositories) {
    const folded = spec.alias.toLowerCase();
    byAlias.set(folded, {
      alias: spec.alias,
      url: spec.url ?? `file://${spec.root}`,
      ref: spec.ref ?? 'refs/heads/main',
      commit: spec.commit ?? '0'.repeat(40),
    });
    rootByAlias.set(folded, spec.root);
  }

  return {
    repository: (alias) => byAlias.get(alias.toLowerCase()),
    read: (location) => {
      const root = rootByAlias.get(location.repository.alias.toLowerCase());
      if (root === undefined) return undefined;
      // `location.path` is normalized and proven to stay inside the repository by
      // `normalizeRepositoryPath`, so this join cannot escape `root`.
      const file = path.join(root, location.path);
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return undefined;
      }
    },
  };
}
