// E03-S02-T01 — reference resolution.
//
// Two suites, and the second is the one that matters. The first is ordinary path-math unit testing.
// The second **replays every oracle probe through the resolver**: the trees the service read
// (`fixtures/oracle/references/repos/{self,templates}/`) are the same committed files mounted here
// as local repositories, so a probe's chain is followed locally and compared against the
// `finalYaml` the service returned for it. That is only possible because the survey script pushes
// those exact files rather than literals of its own — running `pnpm reference-survey` after editing
// a fixture reports the tree as changed, which is the drift alarm.
//
// The comparison is on **which leaf was reached**, because that is the entire question a reference
// resolver answers. Each leaf echoes a distinct token, so "the service reached `cross-leaf` and we
// reached `cross-leaf`" is a real parity assertion and not a restatement of the input.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  directoryOf,
  joinReference,
  loadTemplate,
  localFetcher,
  locationName,
  normalizeRepositoryPath,
  notFoundMessage,
  parseReference,
  resolveReference,
  type LocalRepositorySpec,
  type TemplateLocation,
} from '../../src/template/reference.js';
import type { SourceRange } from '../../src/frontend/parse.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const probeDir = join(repoRoot, 'research', 'experiments', 'E03-references');
const repoFixtures = join(repoRoot, 'fixtures', 'oracle', 'references', 'repos');

// ---------------------------------------------------------------------------------------------
// Path math
// ---------------------------------------------------------------------------------------------

describe('parseReference', () => {
  // C-E03-210: the split is on the FIRST `@`, which is what makes `we@ird.yml` unreachable.
  it.each([
    ['leaf.yml', 'leaf.yml', undefined],
    ['/dir/leaf.yml@templates', '/dir/leaf.yml', 'templates'],
    ['/dir/leaf.yml@self@self', '/dir/leaf.yml', 'self@self'],
    ['/dir/we@ird.yml', '/dir/we', 'ird.yml'],
    ['/dir/leaf.yml@', '/dir/leaf.yml', ''],
    ['@templates', '', 'templates'],
  ])('%s → path %j alias %j', (text, path, alias) => {
    expect(parseReference(text)).toEqual({ path, alias });
  });

  it('does not trim (C-E03-205)', () => {
    expect(parseReference('/e03-refs/leaf.yml ').path).toBe('/e03-refs/leaf.yml ');
  });
});

describe('directoryOf', () => {
  // The `/` vs `''` distinction is measurable: it is the difference between the service printing
  // `//../outside.yml` and `/../outside.yml` in its rejection (C-E03-200).
  it.each([
    ['/azure-pipelines.yml', '/'],
    ['/e03-refs/escape.yml', '/e03-refs'],
    ['/e03-refs/dir/deep-parent.yml', '/e03-refs/dir'],
    ['bare.yml', ''],
  ])('%s → %j', (file, expected) => {
    expect(directoryOf(file)).toBe(expected);
  });
});

describe('joinReference', () => {
  it('keeps an absolute path and discards the base (C-E03-201)', () => {
    expect(joinReference('/e03-refs/dir', '/e03-refs/leaf.yml')).toBe('/e03-refs/leaf.yml');
  });

  it('normalizes backslashes to forward slashes (C-E03-203)', () => {
    expect(joinReference('/', 'e03-refs\\leaf.yml')).toBe('//e03-refs/leaf.yml');
  });

  // The exact strings the service echoed back, unnormalized, in the two escape rejections.
  it.each([
    ['/', '../outside.yml', '//../outside.yml'],
    ['/e03-refs', '../../../outside.yml', '/e03-refs/../../../outside.yml'],
    ['', '../e03-refs/leaf.yml', '/../e03-refs/leaf.yml'],
  ])('base %j + %j → %j', (base, reference, expected) => {
    expect(joinReference(base, reference)).toBe(expected);
  });
});

describe('normalizeRepositoryPath', () => {
  it.each([
    ['//e03-refs/leaf.yml', '/e03-refs/leaf.yml'],
    ['//./e03-refs/leaf.yml', '/e03-refs/leaf.yml'],
    ['/e03-refs/dir/../leaf.yml', '/e03-refs/leaf.yml'],
    ['/e03-refs/leaf.yml ', '/e03-refs/leaf.yml '],
    ['/E03-REFS/LEAF.YML', '/E03-REFS/LEAF.YML'],
  ])('%j → %j', (joined, expected) => {
    expect(normalizeRepositoryPath(joined)).toBe(expected);
  });

  // C-E03-206: the check is on the result, so a traversal may dip and recover.
  it('accepts a traversal that recovers before the end', () => {
    expect(normalizeRepositoryPath('/a/b/../../c/leaf.yml')).toBe('/c/leaf.yml');
  });

  it.each(['//../outside.yml', '/e03-refs/../../../outside.yml', '/../e03-refs/leaf.yml'])(
    'rejects %j as escaping the repository root',
    (joined) => {
      expect(normalizeRepositoryPath(joined)).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Oracle replay
// ---------------------------------------------------------------------------------------------

const SELF: LocalRepositorySpec = { alias: 'self', root: join(repoFixtures, 'self') };
const TEMPLATES: LocalRepositorySpec = {
  alias: 'templates',
  root: join(repoFixtures, 'templates'),
};

/** C-E12-011: a `yamlOverride` resolves as though it were the definition's own file. */
const ROOT_PATH = '/azure-pipelines.yml';
const RANGE: SourceRange = { line: 1, col: 1, endLine: 1, endCol: 1 };

interface Probe {
  readonly name: string;
  readonly yaml: string;
  /** The service's `finalYaml`, present only for probes it expanded. */
  readonly final: string | undefined;
  /** The service's rejection message, present only for probes it rejected. */
  readonly message: string | undefined;
}

function probes(): readonly Probe[] {
  return readdirSync(probeDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const dir = join(probeDir, name);
      const read = (file: string): string | undefined => {
        try {
          return readFileSync(join(dir, file), 'utf8');
        } catch {
          return undefined;
        }
      };
      const response = read('response.json');
      const body =
        response === undefined ? undefined : (JSON.parse(response) as { message?: string });
      return {
        name,
        yaml: read('probe.yml') ?? '',
        final: read('final.yml'),
        message: read('final.yml') === undefined ? body?.message : undefined,
      };
    });
}

/** Every `- script: echo <token>` in a document, in order — "which leaf was reached". */
function echoTokens(yaml: string): string[] {
  return [...yaml.matchAll(/echo\s+([\w-]+)/g)].map((match) => match[1] ?? '');
}

/**
 * The repositories a probe declares. Parsed from the probe's own `resources:` block rather than
 * registered unconditionally, so `unknown-alias` fails here for the reason it failed at the
 * service: nothing declared it.
 */
function fetcherFor(yaml: string) {
  const document = parse(yaml) as
    { resources?: { repositories?: { repository?: string; name?: string }[] } } | undefined;
  const declared = document?.resources?.repositories ?? [];
  const specs: LocalRepositorySpec[] = [SELF];
  for (const entry of declared) {
    // Only the repository this fixture actually mirrors can be mounted; a resource naming something
    // else is a resource-resolution failure, not a reference one (see the skip list below).
    if (entry.repository !== undefined && entry.name === 'azdo-emu-templates') {
      specs.push({ ...TEMPLATES, alias: entry.repository });
    }
  }
  return localFetcher(specs);
}

interface Followed {
  readonly tokens: string[];
  readonly failure: { readonly file: string; readonly message: string } | undefined;
}

/**
 * Follow a probe's `template:` chain with the resolver, collecting the `echo` tokens of every leaf
 * actually reached, or the first failure. Depth-first and in document order, which is the order the
 * service's `finalYaml` presents its steps in.
 */
function follow(probe: Probe): Followed {
  const fetcher = fetcherFor(probe.yaml);
  const self = fetcher.repository('self');
  if (self === undefined) throw new Error('self is always mounted');
  const tokens: string[] = [];
  let failure: Followed['failure'];

  const visit = (text: string, at: TemplateLocation, stack: readonly TemplateLocation[]): void => {
    if (failure !== undefined) return;
    const document = parse(text) as { steps?: unknown[] } | undefined;
    for (const step of document?.steps ?? []) {
      if (failure !== undefined) return;
      const item = step as { template?: unknown; script?: unknown };
      if (typeof item.script === 'string') {
        tokens.push(...echoTokens(item.script));
        continue;
      }
      if (typeof item.template !== 'string') continue;
      const loaded = loadTemplate(item.template, at, fetcher, RANGE, stack);
      if (loaded.kind === 'failed') {
        failure = { file: loaded.diagnostic.file, message: loaded.diagnostic.message };
        return;
      }
      visit(loaded.text, loaded.location, [...stack, loaded.location]);
    }
  };

  const root: TemplateLocation = { repository: self, path: ROOT_PATH };
  visit(probe.yaml, root, [root]);
  return { tokens, failure };
}

/**
 * Probes whose outcome this module does not own.
 *
 * `alias-undeclared-repo` declares a resource naming a repository that does not exist. The service
 * rejects it with `The repository <name> in project <guid> could not be retrieved…` — no file
 * prefix at all, because it fails while *resolving resources*, before any reference is looked at
 * (C-E03-211). That belongs to E08's fetcher, not to path math, and a local mirror has nothing to
 * mount for it.
 */
const NOT_OURS = new Set(['alias-undeclared-repo']);

/** The service prefixes every reference rejection with the file that wrote it: `<file>: <message>`. */
function splitServiceMessage(message: string): { file: string; body: string } {
  const at = message.indexOf(': ');
  return { file: message.slice(0, at), body: message.slice(at + 2) };
}

describe('oracle replay — every reference probe', () => {
  const all = probes().filter((probe) => !NOT_OURS.has(probe.name));

  it('found the committed transcripts', () => {
    // Guards against the suite silently passing on an empty directory.
    expect(all.length).toBe(33); // 34 probes, less the one E08 owns
    expect(all.filter((probe) => probe.final !== undefined)).toHaveLength(21);
  });

  const expanded = all.filter((probe) => probe.final !== undefined);
  const rejected = all.filter((probe) => probe.final === undefined);

  describe.each(expanded)('$name (service expanded)', (probe) => {
    it('reaches the same leaves the service reached', () => {
      const followed = follow(probe);
      expect(followed.failure).toBeUndefined();
      expect(followed.tokens).toEqual(echoTokens(probe.final ?? ''));
      // Not vacuous: every expanded probe ends at a leaf that echoes something.
      expect(followed.tokens.length).toBeGreaterThan(0);
    });
  });

  describe.each(rejected)('$name (service rejected)', (probe) => {
    it('fails the same way, at the same file', () => {
      const followed = follow(probe);
      expect(followed.failure).toBeDefined();
      const service = splitServiceMessage(probe.message ?? '');
      expect(followed.failure?.file).toBe(service.file);

      const notFound =
        /^File (?<path>.*) not found in repository (?<url>\S+) branch (?<ref>\S+) version (?<commit>[0-9a-f]{40})\.$/.exec(
          service.body,
        );
      if (notFound?.groups === undefined) {
        // Path, alias and cycle rejections carry nothing run-specific: compare them verbatim.
        expect(followed.failure?.message).toBe(service.body);
        return;
      }
      // A not-found message names the repository's URL, branch and pinned commit, which change
      // with every fixture push — so this asserts the two halves we own instead of a frozen SHA:
      // the *path we resolved to* is the path the service looked for, and our sentence rebuilds
      // the service's byte-for-byte from those fields (C-E03-207).
      const { path, url, ref, commit } = notFound.groups;
      expect(followed.failure?.message).toContain(`File ${path ?? ''} not found in repository`);
      expect(
        notFoundMessage({
          repository: { alias: 'self', url: url ?? '', ref: ref ?? '', commit: commit ?? '' },
          path: path ?? '',
        }),
      ).toBe(service.body);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The rules the replay proves, restated as direct assertions
// ---------------------------------------------------------------------------------------------

describe('path lookup is case-sensitive, from the tree and not from the host (C-E03-204, E03-S02-T05)', () => {
  // The `case-mismatch` probe (`/E03-REFS/LEAF.YML` against a tree spelling it `/e03-refs/leaf.yml`)
  // is rejected by the service, HTTP 400. The resolver used to pass the joined path to
  // `readFileSync` and let the host answer, so the probe replayed correctly on Linux and *wrongly*
  // on macOS, where APFS is case-insensitive — the same pipeline, two answers, and CI red on
  // macOS only.
  //
  // Honest limit of these assertions: on a case-sensitive filesystem they also hold for the old
  // implementation, because there the host agrees with the tree. macOS CI is what actually gates
  // the fix; what these add locally is the *positive* half — that requiring an exact directory
  // entry does not start rejecting paths that are simply spelled correctly.
  const fetcher = localFetcher([SELF]);
  const self = fetcher.repository('self');
  if (self === undefined) throw new Error('fixtures not mounted');
  const read = (path: string): string | undefined => fetcher.read({ repository: self, path });

  it('reads a file whose spelling matches the tree', () => {
    expect(read('/e03-refs/leaf.yml')).toContain('echo');
  });

  it('reads a nested file, every segment matching', () => {
    expect(read('/e03-refs/dir/self-rel.yml')).toContain('template');
  });

  it('does not fold an unusual character in an exactly-matching name (C-E03-210)', () => {
    // `we@ird.yml` is unreachable *through a reference* because the alias splits on the first `@`;
    // the file itself is ordinary, and the segment walk must still find it byte for byte.
    expect(read('/e03-refs/we@ird.yml')).toBeDefined();
  });

  it('misses a file segment spelled in another case — the probe the service rejected', () => {
    expect(read('/E03-REFS/LEAF.YML')).toBeUndefined();
    expect(read('/e03-refs/LEAF.yml')).toBeUndefined();
  });

  it('misses a directory segment spelled in another case', () => {
    expect(read('/E03-REFS/leaf.yml')).toBeUndefined();
    expect(read('/e03-refs/DIR/self-rel.yml')).toBeUndefined();
  });

  it('misses when a middle segment is a file rather than a directory', () => {
    // `readdirSync` throws ENOTDIR here; the walk answers "absent" instead of propagating.
    expect(read('/e03-refs/leaf.yml/nested.yml')).toBeUndefined();
  });

  it('misses a name that differs only by a trailing space (C-E03-205 does not trim)', () => {
    expect(read('/e03-refs/leaf.yml ')).toBeUndefined();
  });
});

describe('the repository-switch rule (C-E03-215)', () => {
  const fetcher = localFetcher([SELF, TEMPLATES]);
  const self = fetcher.repository('self');
  const templates = fetcher.repository('templates');
  if (self === undefined || templates === undefined) throw new Error('fixtures not mounted');

  const inSelfSubdir: TemplateLocation = { repository: self, path: '/e03-refs/dir/self-rel.yml' };
  const inTemplates: TemplateLocation = { repository: templates, path: '/cross/rel-self.yml' };

  it('keeps the including file’s directory when the repository does not change', () => {
    const result = resolveReference('../leaf.yml@self', inSelfSubdir, fetcher);
    expect(result).toMatchObject({ kind: 'resolved', location: { path: '/e03-refs/leaf.yml' } });
  });

  it('resets the base to the repository root when the repository changes', () => {
    // `/cross` is discarded, so `../` escapes — exactly the rejection the service produced.
    const result = resolveReference('../e03-refs/leaf.yml@self', inTemplates, fetcher);
    expect(result).toMatchObject({
      kind: 'invalid-path',
      message: 'The file path /../e03-refs/leaf.yml is invalid',
    });
  });

  it('resets the base pointing outward too', () => {
    const from: TemplateLocation = { repository: self, path: '/e03-refs/dir/cross-rel.yml' };
    const result = resolveReference('cross/leaf.yml@templates', from, fetcher);
    expect(result).toMatchObject({ kind: 'resolved', location: { path: '/cross/leaf.yml' } });
  });

  it('keeps a cross-repo frame in its own repository for bare and absolute paths (C-E03-216)', () => {
    const from: TemplateLocation = { repository: templates, path: '/cross/outer.yml' };
    for (const reference of ['leaf.yml', '/cross/leaf.yml']) {
      const result = resolveReference(reference, from, fetcher);
      expect(result).toMatchObject({
        kind: 'resolved',
        location: { path: '/cross/leaf.yml', repository: { alias: 'templates' } },
      });
    }
  });
});

describe('aliases', () => {
  const fetcher = localFetcher([SELF, TEMPLATES]);
  const self = fetcher.repository('self');
  if (self === undefined) throw new Error('fixtures not mounted');
  const root: TemplateLocation = { repository: self, path: ROOT_PATH };

  it('folds case on the alias but not on the path (C-E03-213/204)', () => {
    expect(resolveReference('/cross/leaf.yml@TEMPLATES', root, fetcher)).toMatchObject({
      kind: 'resolved',
      location: { path: '/cross/leaf.yml' },
    });
    expect(resolveReference('/E03-REFS/LEAF.YML', root, fetcher)).toMatchObject({
      kind: 'resolved',
      location: { path: '/E03-REFS/LEAF.YML' },
    });
  });

  it('treats an empty alias as self (C-E03-212)', () => {
    expect(resolveReference('/e03-refs/leaf.yml@', root, fetcher)).toMatchObject({
      kind: 'resolved',
      location: { path: '/e03-refs/leaf.yml', repository: { alias: 'self' } },
    });
  });

  it('reports an unknown alias with the service’s sentence (C-E03-211)', () => {
    expect(resolveReference('/e03-refs/leaf.yml@nosuchalias', root, fetcher)).toMatchObject({
      kind: 'unknown-alias',
      message: 'No repository found by name nosuchalias',
    });
  });
});

describe('cycles', () => {
  const fetcher = localFetcher([SELF, TEMPLATES]);
  const self = fetcher.repository('self');
  if (self === undefined) throw new Error('fixtures not mounted');
  const root: TemplateLocation = { repository: self, path: ROOT_PATH };

  it('detects a repeat on the active stack and locates it at the repeated file (C-E03-208)', () => {
    const cycling: TemplateLocation = { repository: self, path: '/e03-refs/self-cycle.yml' };
    const result = resolveReference('self-cycle.yml', cycling, fetcher, [root, cycling]);
    expect(result).toMatchObject({ kind: 'cycle', message: 'Maximum object depth exceeded' });
    expect(result.kind === 'cycle' && locationName(result.location)).toBe(
      '/e03-refs/self-cycle.yml',
    );
  });

  it('allows a diamond, because detection is on the active stack not a visited set (C-E03-209)', () => {
    const first = loadTemplate('/e03-refs/leaf.yml', root, fetcher, RANGE, [root]);
    expect(first.kind).toBe('loaded');
    // The stack is back to just the root once the first include has been left.
    const second = loadTemplate('/e03-refs/leaf.yml', root, fetcher, RANGE, [root]);
    expect(second.kind).toBe('loaded');
  });
});

describe('locationName (C-E03-217)', () => {
  const fetcher = localFetcher([SELF, TEMPLATES]);
  const self = fetcher.repository('self');
  const templates = fetcher.repository('templates');
  if (self === undefined || templates === undefined) throw new Error('fixtures not mounted');

  it('is bare in self and alias-suffixed elsewhere', () => {
    expect(locationName({ repository: self, path: '/e03-refs/leaf.yml' })).toBe(
      '/e03-refs/leaf.yml',
    );
    expect(locationName({ repository: templates, path: '/cross/rel-self.yml' })).toBe(
      '/cross/rel-self.yml@templates',
    );
  });
});
