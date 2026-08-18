// E03-S01-T03 grounding — iterative insertion (`each`).
//
// The Microsoft Learn examples establish that `each` accepts sequences and mappings, exposes
// mapping entries through `.key`/`.value`, and is used with object/jobList parameters. They do not
// establish mapping order, nested-loop order, empty-loop behavior, structural `*List` values, or
// whether an index is available. These probes settle those rules against the preview oracle.
//
// Run: pnpm each-survey [probe-name]
// Output:
//   research/experiments/E03-each/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/directives/each-<probe>.{input,final}.yml (expanded probes only)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

interface EachProbe extends Probe {
  readonly expected: PreviewOutcome['kind'];
}

const task = (script: string): string =>
  `      - task: CmdLine@2\n        inputs:\n          script: ${script}\n`;

const stageWithSteps = (parameters: string, steps: string): string =>
  `${parameters}stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n${steps}`;

const expanded = (name: string, asserts: string, yaml: string): EachProbe => ({
  name,
  asserts,
  yaml,
  expected: 'expanded',
});

const rejected = (name: string, asserts: string, yaml: string): EachProbe => ({
  name,
  asserts,
  yaml,
  expected: 'rejected',
});

const PROBES: readonly EachProbe[] = [
  expanded(
    'sequence-scalars',
    'A sequence-valued object parameter is visited once per element, in sequence order.',
    stageWithSteps(
      'parameters:\n- name: items\n  type: object\n  default: [alpha, beta, gamma]\n',
      '      - ${{ each item in parameters.items }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ item }}\n',
    ),
  ),
  expanded(
    'sequence-objects',
    'Sequence elements retain their object shape and member access inside the loop body.',
    stageWithSteps(
      'parameters:\n- name: items\n  type: object\n  default:\n  - name: first\n    value: one\n  - name: second\n    value: two\n',
      '      - ${{ each item in parameters.items }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ item.name }}=${{ item.value }}\n',
    ),
  ),
  expanded(
    'mapping-pair-order',
    'Mapping iteration exposes `.key`/`.value`; emitted step order reveals the traversal order.',
    stageWithSteps(
      'parameters:\n- name: entries\n  type: object\n  default:\n    Zulu: z\n    alpha: a\n    Middle: m\n',
      '      - ${{ each pair in parameters.entries }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ pair.key }}=${{ pair.value }}\n',
    ),
  ),
  expanded(
    'mapping-numeric-key-order',
    'Quoted integer-like mapping keys test authored order that a JavaScript object would reorder.',
    stageWithSteps(
      "parameters:\n- name: entries\n  type: object\n  default:\n    '10': ten\n    '2': two\n    '01': leading\n",
      '      - ${{ each pair in parameters.entries }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ pair.key }}=${{ pair.value }}\n',
    ),
  ),
  expanded(
    'mapping-body',
    'An `each` in mapping position splices one mapping body per entry into the parent mapping.',
    'parameters:\n- name: entries\n  type: object\n  default:\n    FIRST: one\n    SECOND: two\n' +
      'variables:\n  BASE: base\n  ${{ each pair in parameters.entries }}:\n' +
      '    ${{ pair.key }}: ${{ pair.value }}\n' +
      stageWithSteps('', task('echo $(BASE)-$(FIRST)-$(SECOND)')),
  ),
  expanded(
    'nested-each',
    'Nested `each` loops use both outer and inner bindings and preserve lexicographic loop order.',
    stageWithSteps(
      'parameters:\n- name: fruits\n  type: object\n  default:\n  - name: apple\n    colors: [red, green]\n  - name: lemon\n    colors: [yellow]\n',
      '      - ${{ each fruit in parameters.fruits }}:\n' +
        '        - ${{ each color in fruit.colors }}:\n' +
        '          - task: CmdLine@2\n            inputs:\n              script: echo ${{ fruit.name }}-${{ color }}\n',
    ),
  ),
  expanded(
    'step-list',
    'A stepList parameter can be iterated and each bound step inserted structurally.',
    stageWithSteps(
      'parameters:\n- name: injected\n  type: stepList\n  default:\n  - task: CmdLine@2\n    inputs:\n      script: echo first\n  - task: CmdLine@2\n    inputs:\n      script: echo second\n',
      '      - ${{ each step in parameters.injected }}:\n        - ${{ step }}\n',
    ),
  ),
  expanded(
    'job-list-wrapping',
    'A jobList can be iterated as full jobs while nested step iteration wraps every job body.',
    'parameters:\n- name: buildJobs\n  type: jobList\n  default:\n' +
      '  - job: api\n    displayName: API\n    steps:\n' +
      '    - task: CmdLine@2\n      inputs:\n        script: echo api\n' +
      '  - job: web\n    displayName: Web\n    steps:\n' +
      '    - task: CmdLine@2\n      inputs:\n        script: echo web\n' +
      'stages:\n- stage: probe\n  jobs:\n' +
      '  - ${{ each job in parameters.buildJobs }}:\n' +
      '    - job: ${{ job.job }}\n      displayName: ${{ job.displayName }}\n      steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo setup\n' +
      '      - ${{ each step in job.steps }}:\n        - ${{ step }}\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo teardown\n',
  ),
  expanded(
    'empty-sequence',
    'Iterating an empty sequence inserts nothing and retains the surrounding item order.',
    stageWithSteps(
      'parameters:\n- name: items\n  type: object\n  default: []\n',
      task('echo before') +
        '      - ${{ each item in parameters.items }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ item }}\n' +
        task('echo after'),
    ),
  ),
  expanded(
    'collection-expression',
    'The collection operand is a full expression; `in` text inside string literals is not split.',
    stageWithSteps(
      '',
      "      - ${{ each item in split('a in b', ' in ') }}:\n" +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ item }}\n',
    ),
  ),
  expanded(
    'sequence-item-index',
    'Property access checks whether a sequence element receives a synthesized `.index` member.',
    stageWithSteps(
      'parameters:\n- name: items\n  type: object\n  default: [alpha, beta]\n',
      '      - ${{ each item in parameters.items }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ item }}:${{ item.index }}\n',
    ),
  ),
  rejected(
    'implicit-index-name',
    'A bare `index` inside a loop tests whether the service creates an implicit index named value.',
    stageWithSteps(
      'parameters:\n- name: items\n  type: object\n  default: [alpha]\n',
      '      - ${{ each item in parameters.items }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ index }}\n',
    ),
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

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const requested = process.argv[2];
const selected =
  requested === undefined ? PROBES : PROBES.filter((probe) => probe.name === requested);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${requested}; known: ${PROBES.map((probe) => probe.name).join(', ')}`,
  );
}

for (const probe of selected) {
  // Sequential by construction: no parallel calls against the user's oracle organization.
  const outcome = await preview(config, { yamlOverride: probe.yaml });
  if (outcome.kind !== probe.expected) {
    throw new Error(`${probe.name}: expected ${probe.expected}, observed ${describe(outcome)}`);
  }

  const experimentDir = path.join('research', 'experiments', 'E03-each', probe.name);
  await mkdir(experimentDir, { recursive: true });
  await writeFile(path.join(experimentDir, 'probe.yml'), probe.yaml, 'utf8');
  await writeFile(
    path.join(experimentDir, 'response.json'),
    redact(responseJson(outcome), config),
    'utf8',
  );
  await writeFile(
    path.join(experimentDir, 'README.md'),
    `# oracle probe — ${probe.name}\n\n${probe.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- Outcome: **${describe(outcome)}**\n`,
    'utf8',
  );

  if (outcome.kind === 'expanded') {
    await writeFile(path.join(experimentDir, 'final.yml'), outcome.finalYaml, 'utf8');
    const fixtureDir = path.join('fixtures', 'oracle', 'directives');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, `each-${probe.name}.input.yml`), probe.yaml, 'utf8');
    await writeFile(
      path.join(fixtureDir, `each-${probe.name}.final.yml`),
      outcome.finalYaml,
      'utf8',
    );
  }

  console.log(`${probe.name.padEnd(24)} ${describe(outcome)}`);
}
