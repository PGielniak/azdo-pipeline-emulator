// E03-S01-T05 grounding — scalar interpolation: lone expression vs mixed content.
//
// What the two docs actually settle, and what they leave open:
//
//  - The **expressions** page's conversion table gives the three stringification rules this task
//    names: `Null → ''`, `True → 'True'` / `False → 'False'`, and Number "to a string with no
//    thousands separator and no decimal separator" (C-E03-175). That last sentence is the reason
//    the task's Ground field calls out `0.5`/`1.0` specifically: read literally it says `0.5`
//    renders `05`, which cannot be right, so the actual float format has to be measured.
//  - The **template-expressions** page states structural insertion only for the sequence case
//    ("When you insert an array into an array, you flatten the nested array") and shows a lone
//    `${{ parameters.x }}` sequence item. It never states the mapping case, never distinguishes a
//    lone expression from mixed content, and never mentions expressions in keys — even though its
//    own `each` example is built on `${{ pair.key }}: ${{ pair.value }}` (C-E03-176).
//
// So: what a lone expression does with each value kind, what mixed content does with each value
// kind, what a *key* expression does, and where the boundary between the two lies (whitespace,
// adjacency, the documented `${{` escape) are all measured here rather than assumed.
//
// Probes whose outcome is genuinely unknown are declared `expected: 'either'` on purpose:
// pre-declaring an outcome for those would be model memory smuggled in as a harness assertion.
//
// Run: pnpm interpolation-survey [probe-name]
// Output:
//   research/experiments/E03-interpolation/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/directives/interp-<probe>.{input,final}.yml (expanded probes only)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

interface InterpolationProbe extends Probe {
  /** `'either'` = the question this probe exists to answer; record whatever the service says. */
  readonly expected: PreviewOutcome['kind'] | 'either';
}

/** A job whose single step carries an `env:` mapping — the loosest mapping in the schema. */
const envStep = (parameters: string, env: string): string =>
  `${parameters}stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n` +
  '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n' +
  `        env:\n${env}`;

/** The whole `env:` mapping written as one value, so a structural result has somewhere to land. */
const envValue = (parameters: string, value: string): string =>
  `${parameters}stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n` +
  '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n' +
  `        env: ${value}\n`;

const objectParameter = (name: string, body: string): string =>
  `parameters:\n- name: ${name}\n  type: object\n  default:\n${body}`;

const documented = (name: string, asserts: string, yaml: string): InterpolationProbe => ({
  name,
  asserts,
  yaml,
  expected: 'expanded',
});

const open = (name: string, asserts: string, yaml: string): InterpolationProbe => ({
  name,
  asserts,
  yaml,
  expected: 'either',
});

const PROBES: readonly InterpolationProbe[] = [
  // -------------------------------------------------------------------------------------------
  // Lone expression → structural insertion
  // -------------------------------------------------------------------------------------------
  open(
    'lone-object-value',
    'A mapping value that is exactly one expression returning an **object**. docs/02 §3 says this ' +
      'is inserted structurally rather than stringified; the template-expressions page states the ' +
      'array case only, so the mapping case is measured here.',
    envValue(
      objectParameter('envVars', '    ALPHA: a\n    BETA: b\n'),
      '${{ parameters.envVars }}',
    ),
  ),
  open(
    'lone-object-nested',
    'The same, with a nested object and array inside. Fixes whether the inserted structure is ' +
      'kept whole and typed, or flattened/stringified at some depth.',
    objectParameter(
      'jobProps',
      '    workspace:\n      clean: all\n    dependsOn: []\n    displayName: Nested\n',
    ) +
      'stages:\n- stage: probe\n  jobs:\n  - job: first\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo one\n' +
      '  - job: probe\n    ${{ insert }}: ${{ parameters.jobProps }}\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n',
  ),
  documented(
    'lone-array-sequence-item',
    "The template-expressions page's own Insertion example: a lone `${{ parameters.x }}` as a " +
      'sequence item, fed a `stepList`. Establishes the baseline this task generalizes from.',
    'parameters:\n- name: preBuild\n  type: stepList\n  default:\n' +
      '  - script: echo pre-one\n  - script: echo pre-two\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ parameters.preBuild }}\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n',
  ),
  documented(
    'lone-array-flatten',
    '"When you insert an array into an array, you flatten the nested array" — the doc\'s one ' +
      'structural sentence, tested on a plain string array in `dependsOn`.',
    'parameters:\n- name: deps\n  type: object\n  default:\n  - alpha\n  - beta\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: alpha\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo a\n' +
      '  - job: beta\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo b\n' +
      '  - job: probe\n    dependsOn: ${{ parameters.deps }}\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n',
  ),
  open(
    'lone-object-sequence-item',
    'A lone expression in **sequence** position whose value is an object, not an array. Does it ' +
      'become one item, or is an object rejected where the doc only ever shows an array?',
    'parameters:\n- name: extraStep\n  type: object\n  default:\n' +
      '    script: echo from-object\n    displayName: From Object\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ parameters.extraStep }}\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n',
  ),

  // -------------------------------------------------------------------------------------------
  // Lone expression → scalar kinds. `env:` values are the loosest scalar position in the schema,
  // so what comes back is the engine's own rendering rather than a schema coercion.
  // -------------------------------------------------------------------------------------------
  open(
    'lone-boolean',
    'A lone expression returning a **Boolean**, both from a typed parameter and as a literal. ' +
      "The committed `insert-job-mapping` pair already shows a job's `continueOnError: true` " +
      'coming back as `True` once it passes through the engine — this pins the same question for ' +
      'a lone scalar, and for both truth values.',
    envStep(
      'parameters:\n- name: flag\n  type: boolean\n  default: true\n',
      '          FROM_PARAM: ${{ parameters.flag }}\n' +
        '          LITERAL_TRUE: ${{ true }}\n' +
        '          LITERAL_FALSE: ${{ false }}\n',
    ),
  ),
  open(
    'lone-number',
    'A lone expression returning a **Number**, in the four shapes the conversion table\'s "no ' +
      'thousands separator and no decimal separator" sentence cannot all be true of at once: ' +
      '`0.5`, `1.0`, `1000000`, and a negative.',
    envStep(
      '',
      '          HALF: ${{ 0.5 }}\n' +
        '          ONE_POINT_ZERO: ${{ 1.0 }}\n' +
        '          MILLION: ${{ 1000000 }}\n' +
        '          NEGATIVE: ${{ -1.25 }}\n',
    ),
  ),
  open(
    'lone-null',
    'A lone expression returning **Null** (a `variables` miss, which null-propagates per ' +
      'C-E02-08x). Does the key survive with an empty value, or vanish, or reject?',
    envStep('', '          BEFORE: before\n          PROBE: ${{ variables.nosuchvariable }}\n'),
  ),
  open(
    'lone-version',
    'A lone expression returning a **Version** literal. The table says Major.Minor[.Build[.Rev]].',
    envStep('', '          PROBE: ${{ 1.2.3 }}\n'),
  ),
  open(
    'lone-empty-string',
    'A lone expression returning the empty String — distinct from Null, and the pair that shows ' +
      'whether the two are still distinguishable in the output.',
    envStep('', "          BEFORE: before\n          PROBE: ${{ '' }}\n"),
  ),
  open(
    'lone-string-numeric',
    'A lone expression returning a String that *looks* numeric (`0123`). docs/02 §3 says the ' +
      'result is not re-parsed as YAML; if that holds, this stays a string rather than becoming 123.',
    envStep('', "          PROBE: ${{ '0123' }}\n"),
  ),
  open(
    'lone-string-yamlish',
    'The stronger no-re-parse probe: a String whose text is itself YAML (`a: b`). Re-parsing ' +
      'would turn one scalar into a mapping; not re-parsing keeps the two characters. **This ' +
      "spelling never reaches the engine** — `PROBE: ${{ 'a: b' }}` is not valid YAML in the " +
      'first place, because the `: ` inside the plain scalar ends the key. Kept as the transcript ' +
      'showing that, with `lone-string-yamlish-quoted` doing the actual work.',
    envStep('', "          PROBE: ${{ 'a: b' }}\n"),
  ),
  open(
    'lone-string-yamlish-quoted',
    'The corrected form of `lone-string-yamlish`: the host scalar is double-quoted, so the ' +
      'document parses and the engine really is asked to place a String whose text is YAML.',
    envStep('', '          PROBE: "${{ \'a: b\' }}"\n'),
  ),
  open(
    'lone-object-value-quoted',
    'Is "exactly one expression" a property of the *text* or of the YAML **style**? The same ' +
      'structural insertion as `lone-object-value`, with the host scalar double-quoted and no ' +
      'surrounding whitespace. If quoting alone demoted it to mixed content it would reject the ' +
      'way `whitespace-around-lone-object` does.',
    envValue(
      objectParameter('envVars', '    ALPHA: a\n    BETA: b\n'),
      '"${{ parameters.envVars }}"',
    ),
  ),
  open(
    'whitespace-around-lone-string',
    'The positive control for `whitespace-around-lone-object`: the same surrounding spaces with a ' +
      'String result, which cannot fail conversion. Whether the spaces survive says directly ' +
      'whether the service trims the host scalar before deciding, or treats the whole thing as ' +
      'mixed content and keeps the literal text.',
    envStep('', '          PROBE: "  ${{ \'x\' }}  "\n'),
  ),

  // -------------------------------------------------------------------------------------------
  // Mixed content → stringify and concatenate
  // -------------------------------------------------------------------------------------------
  open(
    'mixed-boolean',
    'Boolean in **mixed content**: `pre-${{ true }}-post`. The conversion table says `True`; this ' +
      'checks the casing survives into the document rather than being lower-cased by YAML output.',
    envStep(
      '',
      '          TRUE_MID: pre-${{ true }}-post\n          FALSE_MID: pre-${{ false }}-post\n',
    ),
  ),
  open(
    'mixed-null',
    'Null in mixed content → the empty string, leaving the literal text either side touching.',
    envStep('', '          PROBE: pre-${{ variables.nosuchvariable }}-post\n'),
  ),
  open(
    'mixed-number',
    'The float-rendering question in mixed content, where the answer cannot be confused with a ' +
      "YAML serializer's own number formatting: `0.5`, `1.0`, `1000000`, `-1.25` inside text.",
    envStep(
      '',
      '          HALF: v${{ 0.5 }}\n' +
        '          ONE_POINT_ZERO: v${{ 1.0 }}\n' +
        '          MILLION: v${{ 1000000 }}\n' +
        '          NEGATIVE: v${{ -1.25 }}\n',
    ),
  ),
  open(
    'mixed-version',
    'Version in mixed content, including a four-segment literal.',
    envStep('', '          THREE: v${{ 1.2.3 }}\n          FOUR: v${{ 1.2.3.4 }}\n'),
  ),
  open(
    'mixed-two-expressions',
    'Two expressions separated by literal text, and two written **adjacent** with nothing between ' +
      'them. The adjacent case is the boundary: each half looks lone, the scalar is not.',
    envStep(
      '',
      "          SEPARATED: ${{ 'a' }} then ${{ 'b' }}\n" +
        "          ADJACENT: ${{ 'a' }}${{ 'b' }}\n",
    ),
  ),
  open(
    'mixed-object',
    'An **object** in mixed content. There is no documented Object→String conversion, so this is ' +
      'either a rejection or some undocumented rendering; either answer is a rule we must encode.',
    envStep(objectParameter('obj', '    A: a\n'), '          PROBE: pre-${{ parameters.obj }}\n'),
  ),
  open(
    'mixed-array',
    'The array half of `mixed-object`. `join` documents "complex objects are converted to empty ' +
      'string" for its elements, which may or may not be the same rule.',
    envStep(
      'parameters:\n- name: list\n  type: object\n  default:\n  - a\n  - b\n',
      '          PROBE: pre-${{ parameters.list }}\n',
    ),
  ),
  open(
    'whitespace-around-lone-object',
    'THE boundary probe: an object expression with **surrounding spaces inside the scalar**. If ' +
      'the lone-expression test trims, this is a structural insertion; if it does not, this is ' +
      'mixed content and an object has to be stringified. Our `loneExpression` trims, so a ' +
      'rejection here would mean that helper is wrong for exactly the case it was written for.',
    envValue(objectParameter('envVars', '    ALPHA: a\n'), "'  ${{ parameters.envVars }}  '"),
  ),
  open(
    'block-scalar-expression',
    'A block scalar carrying an expression. C-E02-109 measured the *error* shape here (one ' +
      '`format` whose literal keeps real newlines); this measures the value, and whether the ' +
      'trailing newline of the block survives the round trip.',
    'parameters:\n- name: who\n  type: string\n  default: world\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: |\n' +
      '            echo one\n            echo ${{ parameters.who }}\n            echo three\n',
  ),

  // -------------------------------------------------------------------------------------------
  // The documented `${{` escape — the case a naive lone-expression test gets wrong
  // -------------------------------------------------------------------------------------------
  documented(
    'escape-literal',
    "The doc's own escape spelling, `${{ 'my${{value' }}`. It is a lone expression whose result " +
      'contains the opening delimiter, so it proves the quote-aware scan of C-E03-117 is required ' +
      'and that the result is not re-scanned for expressions.',
    envStep('', "          PROBE: ${{ 'my${{value' }}\n"),
  ),
  documented(
    'escape-literal-quote',
    "The doc's second escape spelling, with a doubled single quote inside the escaped string.",
    envStep('', "          PROBE: ${{ 'my${{value with a '' single quote too' }}\n"),
  ),

  // -------------------------------------------------------------------------------------------
  // Expressions in mapping keys
  // -------------------------------------------------------------------------------------------
  documented(
    'key-string',
    "The `each` example's own idiom, `${{ pair.key }}: ${{ pair.value }}`, reduced to a single " +
      'literal string key expression. The baseline for the key cases below.',
    envStep('', "          ${{ 'PROBE' }}: value\n"),
  ),
  open(
    'key-boolean',
    'A **Boolean** in key position. The docs/02 §8 ambiguity list names "Boolean stringification ' +
      'casing in keys" explicitly as an open question; this closes it.',
    envStep('', '          ${{ true }}: value\n'),
  ),
  open(
    'key-number',
    'A **Number** in key position, in the two shapes that render differently under any plausible ' +
      'reading of the conversion table.',
    envStep('', '          ${{ 1.0 }}: one\n          ${{ 0.5 }}: half\n'),
  ),
  open(
    'key-null',
    "A **Null** in key position. `Null → ''` would produce an empty key, which YAML permits and " +
      'the pipeline schema may not.',
    envStep('', '          BEFORE: before\n          ${{ variables.nosuchvariable }}: value\n'),
  ),
  open(
    'key-object',
    'An **object** in key position — the case with no conversion at all. Rejection wording is the ' +
      'evidence we need if it rejects.',
    envStep(objectParameter('obj', '    A: a\n'), '          ${{ parameters.obj }}: value\n'),
  ),
  open(
    'key-mixed-object',
    'The two key-position failure modes side by side: `key-object` is a **lone** object key and ' +
      'rejects `Expected a scalar value`. If a key goes through the same `format` synthesis as a ' +
      'value, an object in **mixed** key content should instead give the conversion sentence — ' +
      'which would mean key position has two different rejections, not one.',
    envStep(objectParameter('obj', '    A: a\n'), '          PRE_${{ parameters.obj }}: value\n'),
  ),
  open(
    'key-mixed',
    'Mixed content in key position: literal text plus an expression. If keys go through the same ' +
      '`format` synthesis as values, this concatenates like any other scalar.',
    envStep(
      'parameters:\n- name: suffix\n  type: string\n  default: TAIL\n',
      '          PRE_${{ parameters.suffix }}: value\n',
    ),
  ),
  open(
    'key-boolean-nonloose',
    'The Boolean key question again in a mapping with a **known schema**, where an unexpected key ' +
      'is a hard error — so the rendered spelling is visible in the rejection even if `env:` were ' +
      'to accept anything.',
    'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    ${{ true }}: value\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n',
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

  const experimentDir = path.join('research', 'experiments', 'E03-interpolation', probe.name);
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
    await writeFile(path.join(fixtureDir, `interp-${probe.name}.input.yml`), probe.yaml, 'utf8');
    await writeFile(
      path.join(fixtureDir, `interp-${probe.name}.final.yml`),
      outcome.finalYaml,
      'utf8',
    );
  }

  console.log(`${probe.name.padEnd(30)} ${describe(outcome)}`);
}
