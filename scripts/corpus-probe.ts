// E12-S01-T02 grounding probe — how does the service resolve `template:` references when the
// root document arrived as `yamlOverride`?
//
// The override is not a file in the repository, so "relative to the file containing the
// reference" has no base to be relative *to*. The anchor pipeline's own YAML sits at the repo
// root, which makes repo-root-relative and file-relative indistinguishable — so the probe
// templates are pushed to a **subdirectory** (`/corpus/_probe/`) where the two answers differ.
//
// Whatever this answers decides the corpus layout: how template references are spelled in the
// fixtures, and therefore whether a fixture means the same thing locally and server-side.
//
// Run: node scripts/corpus-probe.ts
import path from 'node:path';
import { configFromEnv } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles } from './azdo-repo.ts';
import { loadEnvFile, runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E12-corpus');
const SCOPE = '/corpus/_probe';

const REPO_FILES = [
  {
    path: `${SCOPE}/steps.yml`,
    content: 'steps:\n- script: echo from-template\n  displayName: probe template step\n',
  },
  {
    path: `${SCOPE}/nested-a.yml`,
    content: 'steps:\n- script: echo from-a\n- template: nested-b.yml\n',
  },
  { path: `${SCOPE}/nested-b.yml`, content: 'steps:\n- script: echo from-b\n' },
];

const PROBES: readonly Probe[] = [
  {
    name: 'control-no-template',
    asserts:
      'CONTROL: an override with no template reference at all. A 200 here makes any 400 below ' +
      'attributable to the reference and not to the payload.',
    yaml: 'steps:\n- script: echo inline\n',
  },
  {
    name: 'template-repo-relative',
    asserts:
      'Reference spelled relative to the **repository root** (`corpus/_probe/steps.yml`). If ' +
      'this expands, the override behaves as though it were a file at the repo root.',
    yaml: 'steps:\n- template: corpus/_probe/steps.yml\n',
  },
  {
    name: 'template-root-absolute',
    asserts:
      'Reference spelled with a leading slash (`/corpus/_probe/steps.yml`) — the documented ' +
      '"root-relative" form. Corpus fixtures use whichever of these two forms works, because ' +
      'it must mean the same path locally and server-side.',
    yaml: 'steps:\n- template: /corpus/_probe/steps.yml\n',
  },
  {
    name: 'template-bare-name',
    asserts:
      'Reference to a bare file name that exists only inside `/corpus/_probe/`. Expected to ' +
      'FAIL: it discriminates "resolved from the repo root" from "resolved from wherever the ' +
      'referenced files happen to live".',
    yaml: 'steps:\n- template: steps.yml\n',
  },
  {
    name: 'template-nested-relative',
    asserts:
      'A template that itself references a sibling by bare name (`nested-b.yml` from inside ' +
      '`/corpus/_probe/nested-a.yml`). Unlike the override, a template IS a file, so this pins ' +
      'that nested references resolve relative to the containing template.',
    yaml: 'steps:\n- template: /corpus/_probe/nested-a.yml\n',
  },
];

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const repo = await defaultRepository(config);
const commit = await syncFiles(
  config,
  repo,
  repo.defaultBranch,
  SCOPE,
  REPO_FILES,
  'E12-S01-T02 corpus template-resolution probe fixtures',
);
console.log(
  commit === undefined
    ? `probe fixtures already current under ${SCOPE}`
    : `pushed probe fixtures under ${SCOPE} (commit ${commit.slice(0, 8)})`,
);

await runProbes(PROBES, OUT_DIR);
