// E03-S01-T02 grounding — conditional insertion chains (`${{ if / elseif / else }}`).
//
// Microsoft Learn establishes only the *syntax* and the two parent shapes (C-E03-120/121). It says
// nothing about the rules this task has to implement: how a chain is grouped, whether an ordinary
// key between two directives breaks that grouping, what a second `if` does to a trailing `else`,
// whether chains nest, and what happens to an `elseif`/`else` with no `if` in front of it. Those
// are decided here against the preview oracle.
//
// Probes whose outcome is genuinely unknown are declared `expected: 'either'` **on purpose**:
// pre-declaring `rejected` for the orphan cases would be the model's memory smuggled in as a
// harness assertion. The probes whose outcome the docs already fix keep a real expectation, so a
// broken harness still fails loudly instead of recording nonsense.
//
// Run: pnpm if-survey [probe-name]
// Output:
//   research/experiments/E03-if/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/directives/if-<probe>.{input,final}.yml (expanded probes only)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

interface IfProbe extends Probe {
  /** `'either'` = the question this probe exists to answer; record whatever the service says. */
  readonly expected: PreviewOutcome['kind'] | 'either';
}

const task = (script: string): string =>
  `      - task: CmdLine@2\n        inputs:\n          script: ${script}\n`;

const stageWithSteps = (parameters: string, steps: string): string =>
  `${parameters}stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n${steps}`;

/** Two booleans, so a chain can be driven into any branch without changing its shape. */
const FLAGS = (a: boolean, b: boolean): string =>
  `parameters:\n- name: a\n  type: boolean\n  default: ${String(a)}\n` +
  `- name: b\n  type: boolean\n  default: ${String(b)}\n`;

const expanded = (name: string, asserts: string, yaml: string): IfProbe => ({
  name,
  asserts,
  yaml,
  expected: 'expanded',
});

const open = (name: string, asserts: string, yaml: string): IfProbe => ({
  name,
  asserts,
  yaml,
  expected: 'either',
});

const PROBES: readonly IfProbe[] = [
  expanded(
    'sequence-true',
    'A true `if` in sequence position splices its body items into the parent sequence in place.',
    stageWithSteps(
      FLAGS(true, false),
      task('echo before') +
        '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo taken\n' +
        task('echo after'),
    ),
  ),
  expanded(
    'sequence-false',
    'A false `if` in sequence position inserts nothing and leaves the surrounding items adjacent.',
    stageWithSteps(
      FLAGS(false, false),
      task('echo before') +
        '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo skipped\n' +
        task('echo after'),
    ),
  ),
  expanded(
    'mapping-chain-if',
    "The documented mapping form with the `if` branch winning; each body's keys join the parent.",
    'variables:\n  BASE: base\n' +
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
      '  ${{ elseif parameters.b }}:\n    PICK: from-elseif\n' +
      '  ${{ else }}:\n    PICK: from-else\n' +
      FLAGS(true, true) +
      stageWithSteps('', task('echo $(BASE)-$(PICK)')),
  ),
  expanded(
    'mapping-chain-elseif',
    'A false `if` with a true `elseif` selects the elseif body and no other.',
    'variables:\n  BASE: base\n' +
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
      '  ${{ elseif parameters.b }}:\n    PICK: from-elseif\n' +
      '  ${{ else }}:\n    PICK: from-else\n' +
      FLAGS(false, true) +
      stageWithSteps('', task('echo $(BASE)-$(PICK)')),
  ),
  expanded(
    'mapping-chain-else',
    'All conditions false selects the `else` body.',
    'variables:\n  BASE: base\n' +
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
      '  ${{ elseif parameters.b }}:\n    PICK: from-elseif\n' +
      '  ${{ else }}:\n    PICK: from-else\n' +
      FLAGS(false, false) +
      stageWithSteps('', task('echo $(BASE)-$(PICK)')),
  ),
  expanded(
    'sequence-chain-else',
    'The if/elseif/else chain works in sequence position too, one item per directive.',
    stageWithSteps(
      FLAGS(false, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ elseif parameters.b }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-elseif\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n',
    ),
  ),
  expanded(
    'no-else-all-false',
    'A chain with no `else` and every condition false contributes nothing at all.',
    stageWithSteps(
      FLAGS(false, false),
      task('echo before') +
        '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ elseif parameters.b }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-elseif\n' +
        task('echo after'),
    ),
  ),
  expanded(
    'nested-chain',
    'A chain inside the winning body of an outer chain expands with the outer branch selected.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - ${{ if parameters.b }}:\n' +
        '          - task: CmdLine@2\n            inputs:\n              script: echo inner-if\n' +
        '        - ${{ else }}:\n' +
        '          - task: CmdLine@2\n            inputs:\n              script: echo inner-else\n',
    ),
  ),
  expanded(
    'nested-chain-outer-false',
    'The same nesting with the outer condition false: the inner chain must not be evaluated at all.',
    stageWithSteps(
      FLAGS(false, true),
      task('echo before') +
        '      - ${{ if parameters.a }}:\n' +
        '        - ${{ if parameters.b }}:\n' +
        '          - task: CmdLine@2\n            inputs:\n              script: echo inner-if\n' +
        '        - ${{ else }}:\n' +
        '          - task: CmdLine@2\n            inputs:\n              script: echo inner-else\n' +
        task('echo after'),
    ),
  ),
  expanded(
    'two-chains-adjacent',
    'Two complete chains in a row: the second `if` must start a new chain, so its `else` binds to it.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo first-if\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo first-else\n' +
        '      - ${{ if parameters.b }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo second-if\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo second-else\n',
    ),
  ),
  open(
    'interrupted-chain',
    'An ordinary sequence item between a true `if` and an `else`: does adjacency gate the chain?',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        task('echo interrupt') +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n',
    ),
  ),
  open(
    'orphan-else',
    'An `else` with no `if` in front of it anywhere in the parent.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo orphan\n',
    ),
  ),
  open(
    'orphan-elseif',
    'An `elseif` with no preceding `if`.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ elseif parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo orphan\n',
    ),
  ),
  open(
    'elseif-after-else',
    'An `elseif` written after the `else` — does the chain have a terminator?',
    stageWithSteps(
      FLAGS(false, true),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n' +
        '      - ${{ elseif parameters.b }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-elseif\n',
    ),
  ),
  open(
    'condition-non-boolean',
    'A non-Boolean condition (a non-empty string) — is it converted the way `and`/`or` operands are?',
    stageWithSteps(
      '',
      task('echo before') +
        "      - ${{ if 'text' }}:\n" +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n',
    ),
  ),
  open(
    'interrupted-chain-false',
    'The control for `interrupted-chain`: same shape with a false `if`. If the `else` body appears, ' +
      'the chain survived the intervening item; if nothing appears, the `else` was dropped instead.',
    stageWithSteps(
      FLAGS(false, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        task('echo interrupt') +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n',
    ),
  ),
  open(
    'condition-empty-string',
    'The other half of `condition-non-boolean`: an empty string condition, which String->Boolean ' +
      'conversion (C-E02-020) makes False.',
    stageWithSteps(
      '',
      task('echo before') +
        "      - ${{ if '' }}:\n" +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n',
    ),
  ),
  open(
    'elseif-not-evaluated',
    'A taken `if` followed by an `elseif` whose condition would raise `Key not found`. Rejection ' +
      'means chain conditions are evaluated eagerly; expansion means later branches are not ' +
      'evaluated once one has won.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ elseif parameters.missing }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-elseif\n',
    ),
  ),
  open(
    'chain-shortcircuit-else',
    'A won `if`, a raising `elseif`, then an `else`. Resolving the `else` must not reach past the ' +
      'winner — this is the probe that fixes the *order* chain members are evaluated in.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ elseif parameters.missing }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-elseif\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n',
    ),
  ),
  open(
    'ctl-missing-parameter',
    'Control for `elseif-not-evaluated` and `untaken-body-not-evaluated`: the same ' +
      '`parameters.missing` read in a position that is definitely reached. Without this the two ' +
      'laziness probes prove nothing — an expansion could just mean the read is harmless.',
    stageWithSteps(
      FLAGS(true, false),
      '      - ${{ if parameters.missing }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo reached\n',
    ),
  ),
  open(
    'untaken-body-not-evaluated',
    'A false `if` whose body reads `parameters.missing`: is a losing branch body evaluated?',
    stageWithSteps(
      FLAGS(false, false),
      task('echo before') +
        '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ parameters.missing }}\n',
    ),
  ),
  open(
    'mapping-interrupted-chain',
    'The mapping form of the adjacency question: an ordinary key between `if` and `else`.',
    'variables:\n' +
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
      '  MIDDLE: middle\n' +
      '  ${{ else }}:\n    PICK: from-else\n' +
      FLAGS(false, false) +
      stageWithSteps('', task('echo $(MIDDLE)-$(PICK)')),
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
  if (probe.expected !== 'either' && outcome.kind !== probe.expected) {
    throw new Error(`${probe.name}: expected ${probe.expected}, observed ${describe(outcome)}`);
  }

  const experimentDir = path.join('research', 'experiments', 'E03-if', probe.name);
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
      `- Outcome: **${describe(outcome)}**\n` +
      (probe.expected === 'either' ? '- Outcome was **not** predicted by this script.\n' : ''),
    'utf8',
  );

  if (outcome.kind === 'expanded') {
    await writeFile(path.join(experimentDir, 'final.yml'), outcome.finalYaml, 'utf8');
    const fixtureDir = path.join('fixtures', 'oracle', 'directives');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, `if-${probe.name}.input.yml`), probe.yaml, 'utf8');
    await writeFile(path.join(fixtureDir, `if-${probe.name}.final.yml`), outcome.finalYaml, 'utf8');
  }

  console.log(`${probe.name.padEnd(26)} ${describe(outcome)}`);
}
