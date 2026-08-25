// E03-S04-T03 grounding — does the service reject the mutations our strict validator rejects?
//
// The task's **Ground** field asks for exactly this: "confirm the service also rejects the injected
// mutations by submitting 3 of them through the oracle preview and recording the error responses."
// The reason it matters is asymmetry. A validator that rejects something the service accepts turns
// a working pipeline into a conversion failure — the worst failure mode this project has, because
// the user cannot tell our bug from their mistake. Rejecting *more* than the service is not
// "strict", it is wrong.
//
// So the three mutations are chosen to be the three shapes a strict post-expansion validator is
// most likely to get wrong, one per failure family:
//
//   unknown-key   a property that is not in the schema at all, at stage level
//   bad-type      a property whose value is the wrong YAML type
//   unknown-task  a `task:` reference to something that does not exist
//
// Each is injected into a **known-good expansion** — a committed corpus `final.yml`, which the
// service itself produced — so the only difference between the accepted and rejected documents is
// the mutation. Anything else the service says about the document would otherwise be noise.
//
// Run: pnpm strict-validation-survey [probe-name]
// Output: research/experiments/E03-strict-validation/<probe>/{probe.yml,response.json,README.md}
//         research/experiments/E03-strict-validation/matrix.md
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

const EXPERIMENTS = path.join('research', 'experiments', 'E03-strict-validation');
/** The base document: a corpus expansion the service produced, and therefore accepts (C-E03-001). */
const BASE = path.join('fixtures', 'oracle', '10-monorepo-triggers-pools.final.yml');

interface MutationProbe extends Probe {
  /** What the mutation does to the base document. */
  readonly mutate: (base: string) => string;
  /** The diagnostic family our validator reports for it. */
  readonly family: string;
}

const PROBES: readonly MutationProbe[] = [
  {
    name: 'unknown-key',
    family: 'SCHEMA_UNKNOWN_KEY',
    asserts:
      'A property that is in no schema form, injected at stage level. If the service accepts it, ' +
      'our unknown-key rejection is stricter than the authority and must be downgraded.',
    mutate: (base) => base.replace(/^(- stage: .*)$/m, '$1\n  notAStageKey: whatever'),
    yaml: '',
  },
  {
    name: 'bad-type',
    family: 'SCHEMA_TYPE',
    asserts:
      'A property whose value is the wrong type: `condition:` given a mapping where the schema ' +
      'says string. The question is whether the service type-checks the expanded document at all, ' +
      'or only its shape.',
    mutate: (base) => base.replace(/^(- stage: .*)$/m, '$1\n  condition:\n    not: a-string'),
    yaml: '',
  },
  {
    name: 'unknown-task',
    family: 'SCHEMA_UNKNOWN_TASK',
    asserts:
      'A `task:` reference to a task that does not exist. Our validator carries a vendored task ' +
      'catalogue; this asks whether the service resolves task references during preview at all.',
    mutate: (base) => base.replace(/task: [A-Za-z0-9-]+@\d+/, 'task: NoSuchTask@9'),
    yaml: '',
  },
];

/** The transcript's `response.json`: the rejection body when there is one, else the expansion. */
function responseJson(outcome: PreviewOutcome): string {
  if (outcome.kind === 'rejected') return `${JSON.stringify(outcome.body, undefined, 2)}\n`;
  if (outcome.kind === 'expanded')
    return `${JSON.stringify({ finalYaml: outcome.finalYaml }, undefined, 2)}\n`;
  return `${JSON.stringify(outcome, undefined, 2)}\n`;
}

const env = await loadEnvFile('.env.oracle');
const config: OracleConfig = configFromEnv(env);
const requested = process.argv[2];
const base = await readFile(BASE, 'utf8');
const rows: string[] = [];

for (const entry of PROBES) {
  if (requested !== undefined && requested !== entry.name) continue;

  const yaml = entry.mutate(base);
  if (yaml === base) throw new Error(`${entry.name}: mutation did not change the base document`);

  const outcome: PreviewOutcome = await preview(config, { yamlOverride: yaml });
  const dir = path.join(EXPERIMENTS, entry.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'probe.yml'), yaml, 'utf8');
  await writeFile(path.join(dir, 'response.json'), redact(responseJson(outcome), config), 'utf8');

  const verdict =
    outcome.kind === 'expanded'
      ? '**accepted** — our rejection would be stricter than the service'
      : '**rejected** — the service agrees';

  await writeFile(
    path.join(dir, 'README.md'),
    `# oracle probe — ${entry.name}\n\n${entry.asserts}\n\n` +
      `- Base document: \`${BASE}\` (a committed corpus expansion, so the service accepts it unmutated)\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- Outcome: **${describe(outcome)}**\n` +
      `- Our diagnostic family: \`${entry.family}\`\n` +
      `- Verdict: ${verdict}\n` +
      '- Outcome was **not** predicted by this script: every probe is asking, not asserting.\n',
    'utf8',
  );

  rows.push(`| \`${entry.name}\` | \`${entry.family}\` | ${describe(outcome)} | ${verdict} |`);
  console.log(`${entry.name.padEnd(14)} ${describe(outcome)}`);
}

if (requested === undefined) {
  await writeFile(
    path.join(EXPERIMENTS, 'matrix.md'),
    '# E03-S04-T03 — does the service reject what our strict validator rejects?\n\n' +
      'Each row injects one mutation into a **known-good expansion** (a committed corpus\n' +
      '`final.yml`, which the service itself produced), so the mutation is the only difference\n' +
      'between an accepted and a rejected document. A row that comes back *accepted* is a\n' +
      'diagnostic family we must not raise as an error on an expanded document.\n\n' +
      '| Mutation | Our family | Outcome | Verdict |\n|---|---|---|---|\n' +
      rows.join('\n') +
      '\n',
    'utf8',
  );
  console.log(`\nwrote ${path.join(EXPERIMENTS, 'matrix.md')}`);
}
