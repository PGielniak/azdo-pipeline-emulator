// E03-S02-T01 grounding — template reference resolution: `relative`, `/absolute`, `@alias`, `@self`.
//
// What the docs settle, and what they leave open:
//
//  - The **templates** page states the path rule in two sentences: "Template paths can be an
//    absolute path within the repository or relative to the file that does the including" and "To
//    use an absolute path, the template path must start with a `/`. All other paths are considered
//    relative." (C-E03-195). It shows `../` traversal in its nested-hierarchy example but never
//    says what happens when `../` walks past the repository root.
//  - The same page documents `@alias` ("use `@` and the name you gave it in `resources`") and
//    `@self` ("refer to the repository where the original pipeline was found"), and states that
//    "Repositories are resolved only once, when the pipeline starts up" (C-E03-196/197).
//  - The **resources.repositories.repository** page gives the alias charset `[-_A-Za-z0-9]*` and
//    `ref` defaulting to `refs/heads/main` (C-E03-198).
//
// Nothing documented answers the questions the resolver actually has to encode: which repository a
// *bare* path inside a cross-repo template is read from (does `@alias` switch the resolution base
// for everything below it, or only for the one reference that carries it?), whether `@self` inside
// a cross-repo template returns to the root repo, what a cycle does, whether paths and aliases are
// case-sensitive, and what the service says when a path escapes the repository root. Those are the
// probes here.
//
// E12 already proved the two base cases from the other side and they are re-used rather than
// re-probed: a `yamlOverride` resolves as though it were the definition's own file at
// `/azure-pipelines.yml` (C-E12-011), and a reference inside a template resolves relative to that
// template's own directory (C-E12-012).
//
// Because the preview endpoint reads `template:` targets from the **repository**, not from the
// request body (C-E12-011), this script pushes two fixture trees before probing: one into the
// anchor repo (`/e03-refs/`) and one into the second repository `azdo-emu-templates`, which
// `scripts/oracle-provision.ts` creates. Probes whose outcome is genuinely unknown are declared
// `expected: 'either'` on purpose — pre-declaring those would be model memory smuggled in as a
// harness assertion.
//
// Run: pnpm reference-survey [probe-name]      (provision first: node scripts/oracle-provision.ts)
// Output:
//   research/experiments/E03-references/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/references/ref-<probe>.{input,final}.yml (expanded probes only)
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

/** Alias the probes declare for the second repository. */
const ALIAS = 'templates';
/** Repository `scripts/oracle-provision.ts` creates for the cross-repo half. */
const TEMPLATE_REPO = 'azdo-emu-templates';

interface ReferenceProbe extends Probe {
  /** `'either'` = the question this probe exists to answer; record whatever the service says. */
  readonly expected: PreviewOutcome['kind'] | 'either';
}

const ref = (target: string): string => `steps:\n- template: ${target}\n`;

/**
 * The two fixture trees are **committed files**, not literals in this script:
 * `fixtures/oracle/references/repos/{self,templates}/`. That is deliberate — the same trees are
 * mounted as local repositories by `packages/engine/test/template/reference.test.ts`, which replays
 * every probe below through the resolver and compares against the `finalYaml` captured here. If the
 * tree lived in this file, the unit tests would be asserting against a *copy* of the thing the
 * oracle measured, and the two could drift apart silently.
 *
 * Every leaf echoes a distinct token (`self-leaf`, `cross-leaf`), so the expanded document says
 * which file was actually read — which is the only thing these probes are asking.
 */
const REPO_FIXTURES = path.join('fixtures', 'oracle', 'references', 'repos');

/** Read one committed tree as the `{path, content}` pairs the push API wants. */
async function fixtureTree(repo: string): Promise<{ path: string; content: string }[]> {
  const root = path.join(REPO_FIXTURES, repo);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files: { path: string; content: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    files.push({
      // Repository-absolute, forward slashes: the same spelling the resolver normalizes to.
      path: '/' + path.relative(root, absolute).split(path.sep).join('/'),
      content: await readFile(absolute, 'utf8'),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** `resources:` block declaring the second repository under ALIAS. */
const resources = (alias = ALIAS, extra = ''): string =>
  `resources:\n  repositories:\n  - repository: ${alias}\n    type: git\n` +
  `    name: ${TEMPLATE_REPO}\n${extra}`;

const probe = (
  name: string,
  asserts: string,
  yaml: string,
  expected: ReferenceProbe['expected'],
): ReferenceProbe => ({ name, asserts, yaml, expected });

const PROBES: readonly ReferenceProbe[] = [
  // ---- path math in the anchor repo -------------------------------------------------------
  probe(
    'rel-from-root',
    "A bare relative path in the override resolves against the definition file's directory " +
      '(`/azure-pipelines.yml` → repo root), so `e03-refs/leaf.yml` is `/e03-refs/leaf.yml`.',
    ref('e03-refs/leaf.yml'),
    'expanded',
  ),
  probe(
    'abs-from-root',
    'A path starting with `/` is repository-absolute (C-E03-195).',
    ref('/e03-refs/leaf.yml'),
    'expanded',
  ),
  probe(
    'dot-slash',
    'Is an explicit `./` prefix accepted as relative, or does it fail the "starts with /" test ' +
      'and then fail as a literal path segment? Undocumented.',
    ref('./e03-refs/leaf.yml'),
    'either',
  ),
  probe(
    'backslash',
    'Windows-style separators: does the service normalize `\\` to `/`? Undocumented.',
    ref('e03-refs\\leaf.yml'),
    'either',
  ),
  probe(
    'case-mismatch',
    'Is the repository path lookup case-sensitive? Git trees are; the service might fold.',
    ref('/E03-REFS/LEAF.YML'),
    'either',
  ),
  probe(
    'nested-relative',
    "A bare name inside a template resolves against that template's own directory (C-E12-012), " +
      "restated here as this task's own fixture: `/e03-refs/outer.yml` → `/e03-refs/leaf.yml`.",
    ref('/e03-refs/outer.yml'),
    'expanded',
  ),
  probe(
    'parent-traversal',
    'The documented `../` form from the nested-hierarchy example, one level up from a subdirectory.',
    ref('/e03-refs/dir/deep-parent.yml'),
    'expanded',
  ),
  probe(
    'abs-from-template',
    'An absolute path inside a nested template is still repository-absolute, not relative to the ' +
      'template — the two would differ here.',
    ref('/e03-refs/dir/deep-abs.yml'),
    'expanded',
  ),
  probe(
    'escape-root-direct',
    '`../` from the root file walks above the repository root. Error, or clamped to the root?',
    ref('../outside.yml'),
    'either',
  ),
  probe(
    'escape-root-nested',
    'The same escape from two levels down, where the traversal is only illegal after the third ' +
      '`../` — proves whether the check is on the final path or on each step.',
    ref('/e03-refs/escape.yml'),
    'either',
  ),
  probe(
    'missing-file',
    'A well-formed path to a file that does not exist — captures the wording and whether the ' +
      'message names branch and commit.',
    ref('/e03-refs/no-such-file.yml'),
    'rejected',
  ),
  probe(
    'trailing-space',
    'Is the reference trimmed before resolution? YAML keeps no trailing space on a plain scalar, ' +
      'so this is quoted to make the space survive the parse.',
    'steps:\n- template: "/e03-refs/leaf.yml "\n',
    'either',
  ),
  // ---- cycles ------------------------------------------------------------------------------
  probe(
    'self-cycle',
    'A template that includes itself. Cycle detection, or the 100-level nesting limit?',
    ref('/e03-refs/self-cycle.yml'),
    'rejected',
  ),
  probe(
    'mutual-cycle',
    'Two templates including each other — the same question one step removed.',
    ref('/e03-refs/cycle-a.yml'),
    'rejected',
  ),
  probe(
    'diamond-not-cycle',
    'The same file included twice from one parent is a diamond, not a cycle, and must expand ' +
      'twice — the control that stops cycle detection from being "seen this path before".',
    'steps:\n- template: /e03-refs/leaf.yml\n- template: /e03-refs/leaf.yml\n',
    'expanded',
  ),
  // ---- @self -------------------------------------------------------------------------------
  probe(
    'self-alias-root',
    '`@self` on a reference from the root file — the alias is legal without any `resources:` block.',
    ref('/e03-refs/leaf.yml@self'),
    'either',
  ),
  probe(
    'self-alias-nested',
    '`@self` written inside a template that is itself in the anchor repo (a no-op that must ' +
      'still resolve).',
    ref('/e03-refs/self-alias.yml'),
    'either',
  ),
  probe(
    'self-alias-relative',
    'Does `@self` reset the resolution base to the repo root, or is the path still relative to ' +
      'the including file? A bare name plus `@self` distinguishes them.',
    ref('e03-refs/leaf.yml@self'),
    'either',
  ),
  probe(
    'self-alias-relative-nested',
    "Does `@self` reset the resolution base to the repository root, or keep the including file's " +
      'directory? `../leaf.yml@self` from `/e03-refs/dir/` resolves under "keep" and escapes the ' +
      'root under "reset" — the root-file spelling cannot tell the two apart.',
    ref('/e03-refs/dir/self-rel.yml'),
    'either',
  ),
  probe(
    'unknown-alias',
    'An alias that no `resources:` block declares — captures the rejection wording.',
    ref('/e03-refs/leaf.yml@nosuchalias'),
    'rejected',
  ),
  probe(
    'empty-alias',
    'A trailing `@` with no alias after it.',
    ref('/e03-refs/leaf.yml@'),
    'either',
  ),
  probe(
    'double-at',
    'Two `@` segments — proves whether the alias split is on the first or the last `@`.',
    ref('/e03-refs/leaf.yml@self@self'),
    'either',
  ),
  probe(
    'at-in-filename',
    'A path whose *filename* contains `@` but names no repository. If the split is on the last ' +
      '`@`, this is an unknown alias; if paths may contain `@`, it is a missing file.',
    ref('/e03-refs/we@ird.yml'),
    'either',
  ),
  // ---- @alias, cross-repo ------------------------------------------------------------------
  probe(
    'cross-alias-abs',
    'The headline cross-repo case: an absolute path in the aliased repository.',
    resources() + ref('/cross/leaf.yml@' + ALIAS),
    'expanded',
  ),
  probe(
    'cross-alias-rel',
    "A relative path with `@alias`, resolved against the *root file's* directory but in the " +
      'other repository.',
    resources() + ref('cross/leaf.yml@' + ALIAS),
    'either',
  ),
  probe(
    'cross-bare-inside',
    '**The central design question.** A bare name inside a template read from the aliased repo: ' +
      'does the repository context stay switched (reads `templates`), or fall back to the root ' +
      'repository (reads `self` and fails)?',
    resources() + ref('/cross/outer.yml@' + ALIAS),
    'either',
  ),
  probe(
    'cross-abs-inside',
    'An absolute path inside a cross-repo template — repository-absolute in *which* repository?',
    resources() + ref('/cross/abs.yml@' + ALIAS),
    'either',
  ),
  probe(
    'cross-back-to-self',
    'The documented `@self` scenario: a template in the shared repo reaching back into the ' +
      'consumer repository. Proves `@self` means the root pipeline\'s repo, not "current repo".',
    resources() + ref('/cross/back-to-self.yml@' + ALIAS),
    'either',
  ),
  probe(
    'cross-rel-outward',
    'The base-directory rule pointing outward: `cross/leaf.yml@templates` written in ' +
      '`/e03-refs/dir/`. Reaching `cross-leaf` proves a repository switch resets the base to `/` ' +
      "rather than carrying the including file's directory into the target repository.",
    resources() + ref('/e03-refs/dir/cross-rel.yml'),
    'either',
  ),
  probe(
    'cross-rel-self',
    'The base-directory question across a repository switch: `../e03-refs/leaf.yml@self` written ' +
      "in `/cross/rel-self.yml` (templates repo). Resolving proves the including file's directory " +
      'is carried into the target repository; a rejection proves `@self` resets the base to `/`.',
    resources() + ref('/cross/rel-self.yml@' + ALIAS),
    'either',
  ),
  probe(
    'alias-case',
    'Alias declared `templates`, referenced `@TEMPLATES` — is the alias lookup case-folding? ' +
      'Expression contexts fold (C-E02 alias work), so the two layers may disagree.',
    resources() + ref('/cross/leaf.yml@TEMPLATES'),
    'either',
  ),
  probe(
    'alias-ref-pinned',
    'An explicit `ref:` on the repository resource — the documented default is refs/heads/main.',
    resources(ALIAS, '    ref: refs/heads/main\n') + ref('/cross/leaf.yml@' + ALIAS),
    'either',
  ),
  probe(
    'alias-undeclared-repo',
    'An alias declared in `resources:` naming a repository that does not exist.',
    `resources:\n  repositories:\n  - repository: ghost\n    type: git\n    name: no-such-repo\n` +
      ref('/cross/leaf.yml@ghost'),
    'rejected',
  ),
  probe(
    'cross-missing-file',
    'A missing file in the aliased repo — does the error name the *other* repository?',
    resources() + ref('/cross/no-such-file.yml@' + ALIAS),
    'rejected',
  ),
];

function responseJson(outcome: PreviewOutcome): string {
  switch (outcome.kind) {
    case 'expanded':
      return JSON.stringify({ finalYaml: outcome.finalYaml }, null, 2) + '\n';
    case 'rejected':
      return JSON.stringify(outcome.body, null, 2) + '\n';
    case 'transport':
    case 'unauthenticated':
      return JSON.stringify(outcome, null, 2) + '\n';
  }
}

/** Push a fixture tree, reporting whether the push created a commit. */
async function push(
  config: OracleConfig,
  repo: RepoRef,
  scope: string,
  tree: readonly { path: string; content: string }[],
): Promise<void> {
  const commit = await syncFiles(
    config,
    repo,
    repo.defaultBranch,
    scope,
    tree.map((f) => ({ path: f.path, content: f.content })),
    'azdo-emu: E03-S02-T01 reference-resolution fixtures',
  );
  console.log(
    `${repo.name.padEnd(20)} ${scope.padEnd(12)} ${commit === undefined ? 'unchanged' : `pushed ${commit.slice(0, 8)}`}`,
  );
}

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);

const anchor = await defaultRepository(config);
const templateRepo = await (async (): Promise<RepoRef> => {
  const { authorizationHeader } = await import('../packages/fetch/src/oracle.ts');
  const org = config.orgUrl.replace(/\/+$/, '');
  const res = await fetch(
    `${org}/${encodeURIComponent(config.project)}/_apis/git/repositories?api-version=7.1`,
    { redirect: 'manual', headers: { Authorization: authorizationHeader(config.pat) } },
  );
  const body = JSON.parse(await res.text()) as {
    value?: { id: string; name: string; defaultBranch?: string }[];
  };
  const found = (body.value ?? []).find((r) => r.name === TEMPLATE_REPO);
  if (found === undefined) {
    throw new Error(
      `repository ${TEMPLATE_REPO} is missing — run node scripts/oracle-provision.ts`,
    );
  }
  return {
    id: found.id,
    name: found.name,
    defaultBranch: found.defaultBranch ?? 'refs/heads/main',
  };
})();

await push(config, anchor, '/e03-refs', await fixtureTree('self'));
await push(config, templateRepo, '/cross', await fixtureTree('templates'));

const requested = process.argv[2];
const selected =
  requested === undefined ? PROBES : PROBES.filter((entry) => entry.name === requested);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${requested}; known: ${PROBES.map((entry) => entry.name).join(', ')}`,
  );
}

for (const entry of selected) {
  // Sequential by construction: no parallel calls against the user's oracle organization.
  const outcome = await preview(config, { yamlOverride: entry.yaml });
  if (entry.expected !== 'either' && outcome.kind !== entry.expected) {
    throw new Error(`${entry.name}: expected ${entry.expected}, observed ${describe(outcome)}`);
  }

  const experimentDir = path.join('research', 'experiments', 'E03-references', entry.name);
  await mkdir(experimentDir, { recursive: true });
  await writeFile(path.join(experimentDir, 'probe.yml'), entry.yaml, 'utf8');
  await writeFile(
    path.join(experimentDir, 'response.json'),
    redact(responseJson(outcome), config),
    'utf8',
  );
  await writeFile(
    path.join(experimentDir, 'README.md'),
    `# oracle probe — ${entry.name}\n\n${entry.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- Outcome: **${describe(outcome)}**\n` +
      (entry.expected === 'either' ? '- Outcome was **not** predicted by this script.\n' : ''),
    'utf8',
  );

  if (outcome.kind === 'expanded') {
    await writeFile(path.join(experimentDir, 'final.yml'), outcome.finalYaml, 'utf8');
    const fixtureDir = path.join('fixtures', 'oracle', 'references');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, `ref-${entry.name}.input.yml`), entry.yaml, 'utf8');
    await writeFile(
      path.join(fixtureDir, `ref-${entry.name}.final.yml`),
      outcome.finalYaml,
      'utf8',
    );
  }

  console.log(`${entry.name.padEnd(24)} ${describe(outcome)}`);
}
