// E03-S06-T02 grounding — is a *mechanically inlined* override equivalent to the committed
// multi-file form the service would otherwise read?
//
// Why this has to be measured rather than reasoned about. The preview endpoint reads `template:`
// targets from the **repository**, not from the request body (C-E12-011), so an uncommitted edit to
// a template file is invisible to the expansion unless the bundler inlines the bytes into the one
// document the request *can* carry — the root `yamlOverride`. docs/02 §5.1 specifies the bundler as
// "a mechanical inliner, not an expander — it never evaluates `${{ }}`, never resolves a directive,
// and never binds a parameter". The open question that specification does not answer is whether a
// mechanical splice is *equivalent* for every reference shape, because a template's `parameters:`
// are scoped to that template: splicing its `steps:` into the parent leaves any
// `${{ parameters.x }}` inside resolving against the **parent's** parameter table instead.
//
// So the probe matrix is four shapes, not the single pair the task's Ground field asks for — one
// pair only answers the shape you happen to pick, and the boundary is the thing the inliner has to
// be built around:
//
//   plain     leaf declares no `parameters:`, reference passes none      (soundness base case)
//   defaults  leaf declares `parameters:` with defaults, none passed     (splice predicts divergence)
//   passed    leaf declares `parameters:`, reference passes values       (splice predicts divergence)
//   nested    root -> mid -> leaf, all parameterless                     (recursion + path rebasing)
//
// Two further shapes were added after the first four came back, because they are what the
// inliner's *guard* has to be built on — the first run showed the parameterized shapes rejected
// with `Key not found`, which raises the question of whether the trigger is declaring parameters
// or *using* them, and whether a parent that happens to declare the same name makes the failure
// silent instead of loud:
//
//   declared-unused  leaf declares `parameters:` but never reads one    (is declaring enough to break it?)
//   shadowed         leaf reads a name the *parent* also declares       (loud failure, or silent wrong value?)
//
// Each shape is submitted twice: `<shape>-committed` references the file in the repository, and
// `<shape>-inlined` is the same document with the reference replaced by the content a mechanical
// splice produces. Equivalence is judged on the **normalized** expansion (`normalizeExpandedYaml`,
// E03-S05-T01), not on raw text, so formatting differences are not read as divergence.
//
// One trap this script is deliberately built around (C-E12-011 again): a `yamlOverride` resolves as
// though it were the definition's own file at `/azure-pipelines.yml`, so a *relative* reference in
// the override would resolve against the repository root and miss a fixture pushed under
// `/e03-bundle/`. Every reference here is repository-absolute for that reason — a not-found 400
// would otherwise read as a divergence that is really a path bug in the harness.
//
// Run: pnpm bundle-survey [probe-name]      (provision first: node scripts/oracle-provision.ts)
// Output: research/experiments/E03-bundle/<probe>/{probe.yml,response.json,final.yml,README.md}
//         research/experiments/E03-bundle/comparison.md
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// From the built package, not from `src`: Node's type-stripping does not rewrite the engine's own
// `.js` specifiers back to `.ts`, so importing the source directly fails to resolve. `pnpm build`
// is a prerequisite of running this survey.
import { normalizeExpandedYaml } from '../packages/engine/dist/index.js';
import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles } from './azdo-repo.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

/** Where the fixture tree is pushed in the anchor repository. */
const FIXTURE_ROOT = '/e03-bundle';
const REPO_FIXTURES = path.join('fixtures', 'oracle', 'bundle', 'repos', 'self');
const EXPERIMENTS = path.join('research', 'experiments', 'E03-bundle');

interface BundleProbe extends Probe {
  /** Which of the four shapes this document is one half of. */
  readonly shape: string;
  /** `committed` reads the template from the repo; `inlined` carries the spliced bytes. */
  readonly form: 'committed' | 'inlined';
}

/** Read the committed fixture tree as the `{path, content}` pairs the push API wants. */
async function fixtureTree(): Promise<{ path: string; content: string }[]> {
  const entries = await readdir(REPO_FIXTURES, { recursive: true, withFileTypes: true });
  const files: { path: string; content: string }[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolute = path.join(entry.parentPath, entry.name);
    files.push({
      path: '/' + path.relative(REPO_FIXTURES, absolute).split(path.sep).join('/'),
      content: await readFile(absolute, 'utf8'),
    });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

const pair = (
  shape: string,
  asserts: string,
  committed: string,
  inlined: string,
): BundleProbe[] => [
  { name: `${shape}-committed`, asserts, yaml: committed, shape, form: 'committed' },
  { name: `${shape}-inlined`, asserts, yaml: inlined, shape, form: 'inlined' },
];

// The `inlined` halves are hand-written to be exactly what a *mechanical* splice produces: the
// referenced file's `steps:` items in place of the reference item, nothing bound, nothing dropped
// except the reference itself. Writing them by hand rather than by calling the inliner is the
// point — the probe has to be able to disagree with the implementation.
const PROBES: readonly BundleProbe[] = [
  ...pair(
    'plain',
    "Parameterless include: does splicing a template's `steps:` into the parent expand identically " +
      'to letting the service read the same file from the repository? This is the soundness base ' +
      'case for the whole bundler.',
    `steps:
- script: echo root-before
- template: ${FIXTURE_ROOT}/plain/leaf.yml
- script: echo root-after
`,
    `steps:
- script: echo root-before
- script: echo plain-leaf
  displayName: plain leaf
- script: echo root-after
`,
  ),
  ...pair(
    'defaults',
    'The template declares `parameters:` with a default and the reference passes none. A mechanical ' +
      'splice drops the declaration block (it is not legal inside a `steps:` list) and leaves ' +
      '`${{ parameters.greeting }}` resolving against the *parent* table. Does the service expand ' +
      'the inlined form at all, and if so to what?',
    `steps:
- template: ${FIXTURE_ROOT}/defaults/leaf.yml
`,
    `steps:
- script: echo \${{ parameters.greeting }}
  displayName: defaults leaf
`,
  ),
  ...pair(
    'passed',
    'The same, with a value passed at the reference. If the inlined half diverges here the bundler ' +
      'cannot mechanically inline a parameterized include, and must diagnose instead.',
    `steps:
- template: ${FIXTURE_ROOT}/passed/leaf.yml
  parameters:
    greeting: passed-value
`,
    `steps:
- script: echo \${{ parameters.greeting }}
  displayName: passed leaf
`,
  ),
  ...pair(
    'nested',
    'Root -> mid -> leaf, all parameterless. Recursion plus the path question: `mid.yml` names the ' +
      'leaf, and once both are inlined no reference is left to rebase. Confirms the recursive case ' +
      'is the plain case applied twice rather than a new shape.',
    `steps:
- script: echo root-before
- template: ${FIXTURE_ROOT}/nested/mid.yml
- script: echo root-after
`,
    `steps:
- script: echo root-before
- script: echo nested-mid-before
- script: echo nested-leaf
  displayName: nested leaf
- script: echo nested-mid-after
- script: echo root-after
`,
  ),
  ...pair(
    'declared-unused',
    'The leaf declares `parameters:` with a default but never reads it. If the inlined form is ' +
      'identical, the guard is "does the template *use* `${{ parameters.* }}`", not "does it ' +
      'declare any" — a materially wider sound subset.',
    `steps:
- template: ${FIXTURE_ROOT}/declared-unused/leaf.yml
`,
    `steps:
- script: echo declared-unused-leaf
  displayName: declared unused leaf
`,
  ),
  ...pair(
    'shadowed',
    'The dangerous one. The leaf reads `${{ parameters.greeting }}` and declares its own default; ' +
      'the **root** declares a parameter of the same name with a different value. Committed, the ' +
      "leaf's own scope wins. Inlined, the reference resolves against the root's table — and " +
      'because the name exists there, the service does not raise `Key not found`. If both halves ' +
      'return 200 with different values, a mechanical splice is **silently** wrong here, not ' +
      'loudly, and the guard cannot rely on the service to catch it.',
    `parameters:
- name: greeting
  type: string
  default: root-value
steps:
- template: ${FIXTURE_ROOT}/shadowed/leaf.yml
`,
    `parameters:
- name: greeting
  type: string
  default: root-value
steps:
- script: echo \${{ parameters.greeting }}
  displayName: shadowed leaf
`,
  ),
];

function responseJson(outcome: PreviewOutcome): string {
  return JSON.stringify(outcome, undefined, 2) + '\n';
}

/** The comparison this whole script exists to make: same shape, both forms, normalized. */
function verdict(
  committed: PreviewOutcome | undefined,
  inlined: PreviewOutcome | undefined,
): string {
  if (committed === undefined || inlined === undefined) return 'not run';
  if (committed.kind !== 'expanded' || inlined.kind !== 'expanded') {
    return `**not comparable** — committed: ${describe(committed)}; inlined: ${describe(inlined)}`;
  }
  const a = normalizeExpandedYaml(committed.finalYaml);
  const b = normalizeExpandedYaml(inlined.finalYaml);
  return a.text === b.text ? '**identical** (normalized)' : '**divergent** (normalized)';
}

const env = await loadEnvFile('.env.oracle');
const config: OracleConfig = configFromEnv(env);
const anchor = await defaultRepository(config);

await syncFiles(
  config,
  anchor,
  anchor.defaultBranch,
  FIXTURE_ROOT,
  await fixtureTree(),
  'azdo-emu: E03-S06-T02 bundler equivalence fixtures',
);

const requested = process.argv[2];
const selected =
  requested === undefined ? PROBES : PROBES.filter((entry) => entry.name === requested);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${requested}; known: ${PROBES.map((entry) => entry.name).join(', ')}`,
  );
}

const outcomes = new Map<string, PreviewOutcome>();

for (const entry of selected) {
  // Sequential by construction: no parallel calls against the user's oracle organization.
  const outcome = await preview(config, { yamlOverride: entry.yaml });
  outcomes.set(entry.name, outcome);

  const dir = path.join(EXPERIMENTS, entry.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'probe.yml'), entry.yaml, 'utf8');
  await writeFile(path.join(dir, 'response.json'), redact(responseJson(outcome), config), 'utf8');
  await writeFile(
    path.join(dir, 'README.md'),
    `# oracle probe — ${entry.name}\n\nShape \`${entry.shape}\`, form \`${entry.form}\`.\n\n` +
      `${entry.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- Outcome: **${describe(outcome)}**\n` +
      '- The outcome was **not** predicted by this script: every probe here is declared `either`,\n' +
      '  because the equivalence question is exactly what it is asking.\n',
    'utf8',
  );
  if (outcome.kind === 'expanded') {
    await writeFile(path.join(dir, 'final.yml'), outcome.finalYaml, 'utf8');
  }

  console.log(`${entry.name.padEnd(22)} ${describe(outcome)}`);
}

if (requested === undefined) {
  const shapes = [...new Set(PROBES.map((entry) => entry.shape))];
  const rows = shapes.map((shape) => {
    const committed = outcomes.get(`${shape}-committed`);
    const inlined = outcomes.get(`${shape}-inlined`);
    return `| \`${shape}\` | ${committed ? describe(committed) : '—'} | ${inlined ? describe(inlined) : '—'} | ${verdict(committed, inlined)} |`;
  });
  await writeFile(
    path.join(EXPERIMENTS, 'comparison.md'),
    '# E03-S06-T02 — committed vs mechanically inlined\n\n' +
      'Is a mechanical splice equivalent to the committed multi-file form? Comparison is on the\n' +
      '**normalized** expansion (`normalizeExpandedYaml`, E03-S05-T01), so formatting is not\n' +
      'mistaken for divergence.\n\n' +
      '| Shape | committed | inlined | verdict |\n|---|---|---|---|\n' +
      rows.join('\n') +
      '\n',
    'utf8',
  );
  console.log(`\nwrote ${path.join(EXPERIMENTS, 'comparison.md')}`);
}
