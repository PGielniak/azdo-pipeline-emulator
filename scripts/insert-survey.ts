// E03-S01-T04 grounding — the `${{ insert }}` merge directive.
//
// The task's **Ground** field names the "templates doc 'Insertion'" section. That section does not
// exist on the templates page: `${{ insert }}` is documented on **template-expressions**, under
// "Insertion", and all it establishes is the spelling and one example (C-E03-160). It says nothing
// about the question this task flags as needing a probe — what happens when an inserted key
// collides with a key already in the mapping — nor about insert in sequence position, non-mapping
// values, ordering, or two inserts in one mapping. Those are decided here.
//
// The `actions/runner` fork *does* implement this directive (it is the only one it knows,
// C-E03-115), so unlike T02/T03 there is a real second source. It is read and pinned, but it is the
// GitHub Actions dialect, so every branch it suggests is still submitted to the live oracle, which
// outranks it on divergence (PLAN D6).
//
// Probes whose outcome is genuinely unknown are declared `expected: 'either'` on purpose:
// pre-declaring an outcome for those would be model memory smuggled in as a harness assertion. The
// probes the doc already fixes keep a real expectation, so a broken harness fails loudly.
//
// Run: pnpm insert-survey [probe-name]
// Output:
//   research/experiments/E03-insert/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/directives/insert-<probe>.{input,final}.yml (expanded probes only)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

interface InsertProbe extends Probe {
  /** `'either'` = the question this probe exists to answer; record whatever the service says. */
  readonly expected: PreviewOutcome['kind'] | 'either';
}

const task = (script: string): string =>
  `      - task: CmdLine@2\n        inputs:\n          script: ${script}\n`;

const stageWithSteps = (parameters: string, steps: string): string =>
  `${parameters}stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n${steps}`;

/** One `object` parameter whose default is `body` (already indented four spaces). */
const objectParameter = (name: string, body: string): string =>
  `parameters:\n- name: ${name}\n  type: object\n  default:\n${body}`;

/** A root `variables:` mapping followed by a minimal stage — the doc's own insertion position. */
const withVariables = (parameters: string, variables: string): string =>
  `${parameters}variables:\n${variables}` + stageWithSteps('', task('echo probe'));

const documented = (name: string, asserts: string, yaml: string): InsertProbe => ({
  name,
  asserts,
  yaml,
  expected: 'expanded',
});

const open = (name: string, asserts: string, yaml: string): InsertProbe => ({
  name,
  asserts,
  yaml,
  expected: 'either',
});

const PROBES: readonly InsertProbe[] = [
  documented(
    'doc-canonical',
    "The template-expressions doc's own example: literal keys plus `${{ insert }}` fed an " +
      '`object` parameter, inside a `variables:` mapping.',
    withVariables(
      objectParameter('additionalVariables', '    TEST_SUITE: L0,L1\n'),
      '  configuration: debug\n  arch: x86\n  ${{ insert }}: ${{ parameters.additionalVariables }}\n',
    ),
  ),
  documented(
    'position',
    'A literal key on **both** sides of the directive. Fixes whether the merged keys land at the ' +
      "directive's own position or are appended to the end of the mapping.",
    withVariables(
      objectParameter('extra', '    MID_A: a\n    MID_B: b\n'),
      '  BEFORE: before\n  ${{ insert }}: ${{ parameters.extra }}\n  AFTER: after\n',
    ),
  ),
  open(
    'literal-mapping-value',
    'The value written as a literal mapping rather than an expression. The doc only ever shows an ' +
      'expression; the fork accepts a mapping token directly.',
    withVariables(
      '',
      '  BEFORE: before\n  ${{ insert }}:\n    LIT_A: a\n    LIT_B: b\n  AFTER: after\n',
    ),
  ),
  open(
    'empty-object',
    'An empty `object` parameter: does the directive contribute nothing, or does it leave a trace?',
    withVariables(
      'parameters:\n- name: extra\n  type: object\n  default: {}\n',
      '  BEFORE: before\n  ${{ insert }}: ${{ parameters.extra }}\n  AFTER: after\n',
    ),
  ),
  open(
    'object-order',
    'Keys authored out of lexical order. Records whether the merge preserves authored order the ' +
      'way `each` over a mapping does (C-E03-145) or sorts them.',
    withVariables(
      objectParameter('extra', '    ZETA: z\n    ALPHA: a\n    MIDDLE: m\n'),
      '  BASE: base\n  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'collision-literal-before',
    'THE flagged question, first half: a literal key, then an insert supplying the same key. ' +
      'Error, first-wins, or last-wins?',
    withVariables(
      objectParameter('extra', '    FOO: from-insert\n'),
      '  FOO: from-literal\n  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'collision-literal-after',
    'THE flagged question, second half: the insert first, then a literal key repeating it. If the ' +
      'two halves disagree, the rule is positional, not "the explicit key wins".',
    withVariables(
      objectParameter('extra', '    FOO: from-insert\n'),
      '  ${{ insert }}: ${{ parameters.extra }}\n  FOO: from-literal\n',
    ),
  ),
  open(
    'collision-case',
    'A collision that differs only in case (`FOO` literal vs `foo` inserted). Mapping keys are ' +
      'compared case-insensitively in the fork; Azure YAML keys are not obviously so.',
    withVariables(
      objectParameter('extra', '    foo: from-insert\n'),
      '  FOO: from-literal\n  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'two-inserts-disjoint',
    'Two `${{ insert }}` keys in one mapping with disjoint payloads. The keys are byte-identical, ' +
      'so this also re-tests C-E03-111 (identical directive keys accepted) for a second directive.',
    withVariables(
      'parameters:\n- name: first\n  type: object\n  default:\n    ONE: one\n' +
        '- name: second\n  type: object\n  default:\n    TWO: two\n',
      '  BASE: base\n  ${{ insert }}: ${{ parameters.first }}\n' +
        '  ${{ insert }}: ${{ parameters.second }}\n',
    ),
  ),
  open(
    'two-inserts-collision',
    'Two `${{ insert }}` keys whose payloads collide with each other — the collision question with ' +
      'no literal key involved at all.',
    withVariables(
      'parameters:\n- name: first\n  type: object\n  default:\n    FOO: from-first\n' +
        '- name: second\n  type: object\n  default:\n    FOO: from-second\n',
      '  BASE: base\n  ${{ insert }}: ${{ parameters.first }}\n' +
        '  ${{ insert }}: ${{ parameters.second }}\n',
    ),
  ),
  open(
    'job-mapping',
    'Insertion into a mapping with **well-known schema keys** (a job) rather than the loose ' +
      '`variables` mapping, carrying a nested mapping value.',
    objectParameter(
      'jobProps',
      '    displayName: Inserted Display Name\n    continueOnError: true\n' +
        '    workspace:\n      clean: all\n',
    ) +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n' +
      '    ${{ insert }}: ${{ parameters.jobProps }}\n    steps:\n' +
      task('echo probe'),
  ),
  open(
    'step-env',
    'Insertion into a step `env:` mapping — the deepest loose mapping in the schema, and the one ' +
      'E06 materializes.',
    objectParameter('envVars', '    FROM_INSERT: inserted\n') +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n' +
      '        env:\n          LITERAL: lit\n          ${{ insert }}: ${{ parameters.envVars }}\n',
  ),
  open(
    'sequence-position',
    'The directive as a sequence item. The fork rejects this with `The expression directive ' +
      "'insert' is not supported in this context`; does Azure?",
    objectParameter('extra', '    A: a\n') +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ insert }}: ${{ parameters.extra }}\n' +
      task('echo probe'),
  ),
  open(
    'sequence-position-valid',
    'The probe that actually *distinguishes* merge from splice, which `sequence-position` could ' +
      'not: its object had one key, so both readings produce the same document. This one supplies ' +
      'two keys that together form a **valid step**. Merging into the item yields one working ' +
      'step; splicing into the parent sequence yields two items, the second of which is not a ' +
      'step at all.',
    objectParameter('extra', '    script: echo merged\n    displayName: Merged\n') +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ insert }}: ${{ parameters.extra }}\n' +
      task('echo probe'),
  ),
  open(
    'value-string',
    'A `string` parameter as the value. The fork raises `Expected a mapping`.',
    withVariables(
      'parameters:\n- name: extra\n  type: string\n  default: plain\n',
      '  BEFORE: before\n  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'value-array',
    'An `object` parameter whose default is a **sequence**, not a mapping.',
    withVariables(
      'parameters:\n- name: extra\n  type: object\n  default:\n  - a\n  - b\n',
      '  BEFORE: before\n  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'value-scalar-literal',
    'A plain scalar written directly as the value, with no expression involved.',
    withVariables('', '  BEFORE: before\n  ${{ insert }}: plain-text\n'),
  ),
  open(
    'value-empty',
    'The directive key with an empty value — YAML null.',
    withVariables('', '  BEFORE: before\n  ${{ insert }}:\n  AFTER: after\n'),
  ),
  open(
    'chain-insert-between',
    'E03-S01-T02 left this unmeasured and handed it here: an `${{ insert }}` written **between** ' +
      'a false `${{ if }}` and its `${{ else }}`. If the `else` body appears the insert is an ' +
      'ordinary sibling under C-E03-128; if the document is rejected, a directive sibling breaks ' +
      'the chain where an ordinary key does not.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ insert }}: ${{ parameters.extra }}\n' +
        '  ${{ else }}:\n    PICK: from-else\n',
    ),
  ),
  open(
    'chain-insert-between-true',
    'The control for `chain-insert-between`: the same shape with the `if` winning, so the output ' +
      'also fixes the relative order of the branch body and the inserted keys.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: true\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ insert }}: ${{ parameters.extra }}\n' +
        '  ${{ else }}:\n    PICK: from-else\n',
    ),
  ),
  open(
    'chain-each-between',
    'The other half of the same open question: an `${{ each }}` between a false `${{ if }}` and ' +
      'its `${{ else }}`, in mapping position.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ each pair in parameters.extra }}:\n    ${{ pair.key }}: ${{ pair.value }}\n' +
        '  ${{ else }}:\n    PICK: from-else\n',
    ),
  ),
  open(
    'chain-each-between-sequence',
    'The sequence-position form of `chain-each-between`, because C-E03-128 had to be measured in ' +
      'both parent shapes and disagreement between them is exactly what would be missed.',
    stageWithSteps(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: scripts\n  type: object\n  default:\n  - mid-one\n  - mid-two\n',
      '      - ${{ if parameters.a }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-if\n' +
        '      - ${{ each s in parameters.scripts }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo ${{ s }}\n' +
        '      - ${{ else }}:\n' +
        '        - task: CmdLine@2\n          inputs:\n            script: echo from-else\n',
    ),
  ),
  open(
    'bare-sequence-item',
    'The directive as a **bare scalar** sequence item, with no colon and no value. This is the ' +
      'real "not a mapping key" position — `sequence-position` turned out still to be a mapping ' +
      'key, of the one-key mapping the item is.',
    stageWithSteps('', '      - ${{ insert }}\n' + task('echo probe')),
  ),
  open(
    'value-position',
    'The directive in **value** position. C-E03-112 says a directive keyword in a value is not a ' +
      'directive at all, so this should be an ordinary expression parse of the text `insert`.',
    withVariables('', '  BEFORE: before\n  KEY: ${{ insert }}\n'),
  ),
  open(
    'chain-insert-before',
    'Control for `chain-insert-between`: the same insert placed **before** the chain head instead ' +
      'of inside the chain. If this expands, the break is specifically about a directive sibling ' +
      'between two members, not about an insert being present in the mapping at all.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ insert }}: ${{ parameters.extra }}\n' +
        '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ else }}:\n    PICK: from-else\n',
    ),
  ),
  open(
    'chain-insert-after',
    'The other control: the insert placed **after** a complete chain.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ else }}:\n    PICK: from-else\n' +
        '  ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'chain-elseif-after-insert',
    'The same break tested against an `elseif` rather than an `else`, so the rule is not recorded ' +
      'from one keyword alone.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: false\n' +
        '- name: b\n  type: boolean\n  default: true\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  ${{ if parameters.a }}:\n    PICK: from-if\n' +
        '  ${{ insert }}: ${{ parameters.extra }}\n' +
        '  ${{ elseif parameters.b }}:\n    PICK: from-elseif\n',
    ),
  ),
  open(
    'nested-in-if-body',
    'An `${{ insert }}` inside the body of a winning `${{ if }}` — the ordinary composition of the ' +
      'two directives, as opposed to the sibling case that breaks.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: true\n' +
        '- name: extra\n  type: object\n  default:\n    MID: mid\n',
      '  BASE: base\n  ${{ if parameters.a }}:\n' +
        '    PICK: from-if\n    ${{ insert }}: ${{ parameters.extra }}\n',
    ),
  ),
  open(
    'orphan-else-mapping',
    'E03-S01-T02 measured its orphan rejection only in **sequence** position, so the second ' +
      "sentence of the orphan rejection (`Unexpected value '<key>'`) is unverified for a " +
      'mapping. This task makes a broken chain throw that error in mapping position too, so the ' +
      'mapping-position wording has to be measured rather than assumed to match.',
    withVariables('', '  BEFORE: before\n  ${{ else }}:\n    PICK: from-else\n'),
  ),
  open(
    'orphan-elseif-mapping',
    'The `elseif` half of `orphan-else-mapping`.',
    withVariables(
      'parameters:\n- name: a\n  type: boolean\n  default: true\n',
      '  BEFORE: before\n  ${{ elseif parameters.a }}:\n    PICK: from-elseif\n',
    ),
  ),
  open(
    'collision-from-each',
    'A key produced by `each` colliding with a literal key. Records whether ' +
      "`'X' is already defined` is a general mapping rule rather than something `insert` owns.",
    withVariables(
      objectParameter('extra', '    FOO: from-each\n'),
      '  FOO: from-literal\n' +
        '  ${{ each pair in parameters.extra }}:\n    ${{ pair.key }}: ${{ pair.value }}\n',
    ),
  ),
  open(
    'inside-each',
    'An insert whose source is a **loop binding** rather than a parameter, inside an `each` body.',
    objectParameter(
      'groups',
      '  - name: alpha\n    vars:\n      G: alpha-var\n' +
        '  - name: beta\n    vars:\n      G: beta-var\n',
    ) +
      'stages:\n- ${{ each group in parameters.groups }}:\n' +
      '  - stage: ${{ group.name }}\n    variables:\n' +
      '      ${{ insert }}: ${{ group.vars }}\n' +
      '    jobs:\n    - job: probe\n      steps:\n' +
      '        - task: CmdLine@2\n          inputs:\n            script: echo $(G)\n',
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

  const experimentDir = path.join('research', 'experiments', 'E03-insert', probe.name);
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
    await writeFile(path.join(fixtureDir, `insert-${probe.name}.input.yml`), probe.yaml, 'utf8');
    await writeFile(
      path.join(fixtureDir, `insert-${probe.name}.final.yml`),
      outcome.finalYaml,
      'utf8',
    );
  }

  console.log(`${probe.name.padEnd(28)} ${describe(outcome)}`);
}
