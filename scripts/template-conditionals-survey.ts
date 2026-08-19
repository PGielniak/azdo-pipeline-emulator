// E03-S01-T02 grounding — conditional insertion chains.
//
// The docs demonstrate sequence/mapping insertion and one if/elseif/else chain, but do not define
// chain boundaries, no-match behavior, nesting, or orphan clauses. These probes ask the preview
// service for those rules before the expander is implemented. Successful probes are also promoted
// to immutable input/finalYaml fixture pairs under fixtures/oracle/directives/.
//
// Run: node scripts/template-conditionals-survey.ts [probe-name]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, transcript, type Probe } from './oracle-transcript.ts';

const TRANSCRIPT_DIR = path.join('research', 'experiments', 'E03-conditionals');
const FIXTURE_DIR = path.join('fixtures', 'oracle', 'directives');
const MANIFEST = path.join(FIXTURE_DIR, 'MANIFEST.json');

interface ConditionalProbe extends Probe {
  readonly expected: 'expanded' | 'rejected';
  /** Expanded probes are committed as `<name>.input.yml` / `<name>.final.yml`. */
  readonly fixture?: true;
}

const probe = (
  name: string,
  asserts: string,
  yaml: string,
  expected: ConditionalProbe['expected'] = 'expanded',
): ConditionalProbe => ({
  name,
  asserts,
  yaml,
  expected,
  ...(expected === 'expanded' ? { fixture: true } : {}),
});

const PROBES: readonly ConditionalProbe[] = [
  probe(
    'sequence-if-wins',
    'Sequence chain: the first true `if` branch is spliced and later true `elseif`/`else` bodies are suppressed.',
    `steps:
- script: echo before
- \${{ if eq(1, 1) }}:
  - script: echo selected-if
- \${{ elseif eq(2, 2) }}:
  - script: echo not-elseif
- \${{ else }}:
  - script: echo not-else
- script: echo after
`,
  ),
  probe(
    'sequence-elseif-wins',
    'Sequence chain: false `if` clauses are skipped and the first true `elseif` body is spliced.',
    `steps:
- script: echo before
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- \${{ elseif eq(2, 2) }}:
  - script: echo selected-elseif
- \${{ elseif eq(3, 3) }}:
  - script: echo not-second-elseif
- \${{ else }}:
  - script: echo not-else
- script: echo after
`,
  ),
  probe(
    'sequence-else-wins',
    'Sequence chain: `else` is selected only when every preceding condition is false.',
    `steps:
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- \${{ elseif eq(2, 3) }}:
  - script: echo not-elseif
- \${{ else }}:
  - script: echo selected-else
`,
  ),
  probe(
    'sequence-no-match-no-else',
    'A sequence chain with no true condition and no `else` contributes no items; ordinary siblings remain ordered.',
    `steps:
- script: echo before
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- \${{ elseif eq(2, 3) }}:
  - script: echo not-elseif
- script: echo after
`,
  ),
  probe(
    'mapping-elseif-wins',
    'Mapping chain: only the winning branch entries are merged at the directive position, between ordinary siblings.',
    `steps:
- script: echo mapping
  env:
    BEFORE: before
    \${{ if eq(1, 2) }}:
      PICKED: if
      IF_ONLY: no
    \${{ elseif eq(2, 2) }}:
      PICKED: elseif
      ELSEIF_ONLY: yes
    \${{ else }}:
      PICKED: else
      ELSE_ONLY: no
    AFTER: after
`,
  ),
  probe(
    'mapping-no-match-no-else',
    'A mapping chain with no true condition and no `else` contributes no entries; surrounding keys remain.',
    `steps:
- script: echo mapping
  env:
    BEFORE: before
    \${{ if eq(1, 2) }}:
      NOT_IF: no
    \${{ elseif eq(2, 3) }}:
      NOT_ELSEIF: no
    AFTER: after
`,
  ),
  probe(
    'nested-sequence-chain',
    'A selected sequence body is recursively expanded, including its own nested elseif chain.',
    `steps:
- \${{ if eq(1, 1) }}:
  - script: echo outer-before
  - \${{ if eq(1, 2) }}:
    - script: echo nested-not-if
  - \${{ elseif eq(2, 2) }}:
    - script: echo nested-selected-elseif
  - \${{ else }}:
    - script: echo nested-not-else
  - script: echo outer-after
- \${{ else }}:
  - script: echo outer-not-else
`,
  ),
  probe(
    'nested-mapping-chain',
    'A selected sequence body is recursively expanded when it contains a mapping-position conditional chain.',
    `steps:
- \${{ if eq(1, 1) }}:
  - script: echo nested-mapping
    env:
      BEFORE: before
      \${{ if eq(1, 2) }}:
        PICKED: if
      \${{ else }}:
        PICKED: else
      AFTER: after
`,
  ),
  probe(
    'adjacent-independent-if',
    'An `if` begins a new chain even when adjacent to a previous unmatched if-only chain; its `else` belongs to the new chain.',
    `steps:
- \${{ if eq(1, 2) }}:
  - script: echo first-not-selected
- \${{ if eq(2, 2) }}:
  - script: echo second-selected
- \${{ else }}:
  - script: echo second-not-else
`,
  ),
  probe(
    'condition-truthiness-primitives',
    'Conditional clauses use expression truthiness: nonempty String/nonzero Number are true; empty String/zero/Null are false.',
    `steps:
- \${{ if 'text' }}:
  - script: echo selected-nonempty-string
- \${{ else }}:
  - script: echo not-nonempty-string
- \${{ if '' }}:
  - script: echo not-empty-string
- \${{ else }}:
  - script: echo selected-empty-string-else
- \${{ if 1 }}:
  - script: echo selected-nonzero-number
- \${{ else }}:
  - script: echo not-nonzero-number
- \${{ if 0 }}:
  - script: echo not-zero
- \${{ else }}:
  - script: echo selected-zero-else
- \${{ if variables.absent }}:
  - script: echo not-null
- \${{ else }}:
  - script: echo selected-null-else
`,
  ),
  probe(
    'condition-truthiness-collections',
    'Array and Object expression results are truthy in a conditional clause.',
    `parameters:
- name: payload
  type: object
  default:
    key: value
steps:
- \${{ if split('a,b', ',') }}:
  - script: echo selected-array
- \${{ else }}:
  - script: echo not-array
- \${{ if parameters.payload }}:
  - script: echo selected-object
- \${{ else }}:
  - script: echo not-object
`,
  ),
  probe(
    'condition-truthiness-empty-collections',
    'Empty Array and Object expression results remain truthy; collection truthiness does not depend on count.',
    `parameters:
- name: items
  type: object
  default: []
- name: payload
  type: object
  default: {}
steps:
- \${{ if parameters.items }}:
  - script: echo selected-empty-array
- \${{ else }}:
  - script: echo not-empty-array
- \${{ if parameters.payload }}:
  - script: echo selected-empty-object
- \${{ else }}:
  - script: echo not-empty-object
`,
  ),
  probe(
    'condition-short-circuit-after-if',
    'After a true `if`, later `elseif` conditions are not evaluated.',
    `steps:
- \${{ if true }}:
  - script: echo selected-if
- \${{ elseif lt(1, 'not-a-number') }}:
  - script: echo not-elseif
- \${{ else }}:
  - script: echo not-else
`,
  ),
  probe(
    'condition-short-circuit-after-elseif',
    'After a true `elseif`, later `elseif` conditions are not evaluated.',
    `steps:
- \${{ if false }}:
  - script: echo not-if
- \${{ elseif true }}:
  - script: echo selected-elseif
- \${{ elseif lt(1, 'not-a-number') }}:
  - script: echo not-later-elseif
- \${{ else }}:
  - script: echo not-else
`,
  ),
  probe(
    'orphan-else-sequence',
    'An `else` with no prior live conditional chain is rejected rather than treated as unconditional insertion.',
    `steps:
- \${{ else }}:
  - script: echo orphan
`,
    'rejected',
  ),
  probe(
    'orphan-elseif-sequence',
    'An `elseif` with no immediately preceding `if` is rejected.',
    `steps:
- \${{ elseif eq(1, 1) }}:
  - script: echo orphan
`,
    'rejected',
  ),
  probe(
    'interrupted-else-sequence',
    'An ordinary sequence sibling does not end a chain; a later `else` still belongs to the preceding false `if`.',
    `steps:
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- script: echo interruption
- \${{ else }}:
  - script: echo orphan
`,
  ),
  probe(
    'interrupted-elseif-sequence',
    'An ordinary sequence sibling does not end a chain; a later true `elseif` is selected and its following `else` is suppressed.',
    `steps:
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- script: echo interruption
- \${{ elseif eq(2, 2) }}:
  - script: echo selected-elseif
- \${{ else }}:
  - script: echo not-else
`,
  ),
  probe(
    'interrupted-else-after-true',
    'An intervening sequence sibling is retained after a true `if`, while the later `else` remains in that selected chain and is suppressed.',
    `steps:
- \${{ if eq(1, 1) }}:
  - script: echo selected-if
- script: echo interruption
- \${{ else }}:
  - script: echo not-else
`,
  ),
  probe(
    'interrupted-else-mapping',
    'An ordinary mapping key does not end a chain; a later `else` still belongs to the preceding false `if` and merges at its own position.',
    `steps:
- script: echo mapping
  env:
    \${{ if eq(1, 2) }}:
      NOT_IF: no
    BETWEEN: between
    \${{ else }}:
      SELECTED_ELSE: yes
    AFTER: after
`,
  ),
  probe(
    'duplicate-else-sequence',
    'Only one `else` may terminate a chain; a second adjacent `else` is rejected as orphaned.',
    `steps:
- \${{ if eq(1, 2) }}:
  - script: echo not-if
- \${{ else }}:
  - script: echo selected-else
- \${{ else }}:
  - script: echo duplicate
`,
    'rejected',
  ),
  probe(
    'sequence-mapping-body',
    'A selected mapping body in sequence position is inserted as one item, while a sequence body is flattened.',
    `steps:
- \${{ if eq(1, 1) }}:
    script: echo wrong-shape
`,
  ),
  probe(
    'mapping-sequence-body',
    'A conditional in mapping position requires a mapping body; a sequence body is rejected.',
    `steps:
- script: echo wrong-shape
  env:
    \${{ if eq(1, 1) }}:
    - A
`,
    'rejected',
  ),
];

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

interface ManifestRow {
  readonly taskId: 'E03-S01-T02';
  readonly claimIds: readonly string[];
  readonly inputSha256: string;
  readonly finalYamlSha256: string;
  readonly fetchedAt: string;
}

function fixtureClaimIds(name: string): readonly string[] {
  if (name.startsWith('nested-')) return ['C-E03-120', 'C-E03-121', 'C-E03-124'];
  if (name.startsWith('interrupted-') || name === 'adjacent-independent-if') {
    return ['C-E03-120', 'C-E03-123'];
  }
  if (name.startsWith('condition-truthiness-')) return ['C-E03-120', 'C-E03-125'];
  if (name.startsWith('condition-short-circuit-')) return ['C-E03-120', 'C-E03-121'];
  if (name === 'sequence-mapping-body') return ['C-E03-120', 'C-E03-122'];
  return ['C-E03-120', 'C-E03-121', 'C-E03-122'];
}

async function readManifest(): Promise<Record<string, ManifestRow>> {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST, 'utf8')) as {
      readonly fixtures?: Record<
        string,
        Omit<ManifestRow, 'taskId' | 'claimIds'> & Partial<Pick<ManifestRow, 'taskId' | 'claimIds'>>
      >;
    };
    return Object.fromEntries(
      Object.entries(parsed.fixtures ?? {}).map(([name, row]) => [
        name,
        {
          ...row,
          taskId: 'E03-S01-T02',
          claimIds: fixtureClaimIds(name),
        },
      ]),
    );
  } catch {
    return {};
  }
}

const only = process.argv[2];
const selected = only === undefined ? PROBES : PROBES.filter((item) => item.name === only);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${String(only)}; known: ${PROBES.map((item) => item.name).join(', ')}`,
  );
}

const config = configFromEnv(await loadEnvFile('.env.oracle'));
const manifest = await readManifest();
await mkdir(TRANSCRIPT_DIR, { recursive: true });
await mkdir(FIXTURE_DIR, { recursive: true });

let failures = 0;
for (const item of selected) {
  const outcome = await preview(config, { yamlOverride: item.yaml });
  await writeFile(
    path.join(TRANSCRIPT_DIR, `${item.name}.md`),
    transcript(item, config, outcome),
    'utf8',
  );

  const actual =
    outcome.kind === 'expanded'
      ? 'expanded'
      : outcome.kind === 'rejected'
        ? 'rejected'
        : outcome.kind;
  if (actual !== item.expected) {
    failures += 1;
    console.error(`FAIL ${item.name.padEnd(32)} expected ${item.expected}, got ${actual}`);
    continue;
  }

  if (item.fixture === true && outcome.kind === 'expanded') {
    const finalYaml = redact(outcome.finalYaml, config);
    await writeFile(path.join(FIXTURE_DIR, `${item.name}.input.yml`), item.yaml, 'utf8');
    await writeFile(path.join(FIXTURE_DIR, `${item.name}.final.yml`), finalYaml, 'utf8');
    manifest[item.name] = {
      taskId: 'E03-S01-T02',
      claimIds: fixtureClaimIds(item.name),
      inputSha256: sha256(item.yaml),
      finalYamlSha256: sha256(finalYaml),
      fetchedAt: new Date().toISOString().slice(0, 10),
    };
  }
  console.log(`${item.name.padEnd(32)} ${describe(outcome)}`);
}

const fixtures = Object.fromEntries(
  Object.entries(manifest).sort(([left], [right]) => left.localeCompare(right)),
);
await writeFile(MANIFEST, `${JSON.stringify({ fixtures }, null, 2)}\n`, 'utf8');
if (failures > 0) process.exit(1);
