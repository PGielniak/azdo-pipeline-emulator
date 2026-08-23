// E04-S01-T02 grounding — which step shorthands does the service desugar into canonical tasks?
//
// The epic's re-scope note says "part of the old normalization work is delegated" and cites one
// measured case (`script` → `CmdLine@2`). *Part* is doing a lot of work in that sentence, and it is
// exactly the wrong thing to guess in either direction: normalizing a shorthand the service already
// handles means writing a second, divergent implementation of it, while assuming one is handled
// when it is not leaves a raw shorthand in the model that E05 cannot emit.
//
// So every shorthand the task's **Do** names gets a probe, and the answer is read off the expansion
// rather than reasoned about: whatever comes back as `task: Name@version` is the service's job, and
// whatever survives as its shorthand key is ours.
//
// `checkout` is included deliberately even though PLAN D4 emits it natively: the question here is
// not who *runs* it but what shape the model receives, and if the service rewrites it into a task
// the model must know that before E05 tries to match on the keyword.
//
// Run: pnpm normalization-survey [probe-name]
// Output: research/experiments/E04-normalization/<probe>/{probe.yml,response.json,final.yml,README.md}
//         research/experiments/E04-normalization/matrix.md
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

const EXPERIMENTS = path.join('research', 'experiments', 'E04-normalization');

interface ShorthandProbe extends Probe {
  /** The shorthand keyword under test, as authored. */
  readonly keyword: string;
}

const probe = (keyword: string, asserts: string, step: string): ShorthandProbe => ({
  name: keyword,
  keyword,
  asserts,
  yaml: `steps:\n${step}`,
});

const PROBES: readonly ShorthandProbe[] = [
  probe(
    'script',
    'The one case already measured (C-E00-017/018, C-E04-002). Kept in the matrix as the control: ' +
      'if this stops coming back as `CmdLine@2` the whole delegation assumption has moved.',
    '- script: echo hello\n',
  ),
  probe(
    'bash',
    'Documented as a shortcut for `Bash@3`. Does the service rewrite it, or does the shorthand ' +
      'reach the agent intact?',
    '- bash: echo hello\n',
  ),
  probe('pwsh', 'Documented as `PowerShell@2` with `pwsh: true`.', '- pwsh: Write-Host hello\n'),
  probe('powershell', 'Documented as `PowerShell@2`.', '- powershell: Write-Host hello\n'),
  probe(
    'publish',
    'A shortcut for `PublishPipelineArtifact@1`. Its `artifact:` sibling names the artifact, so if ' +
      'the service desugars it the input names matter to E06-S05-T01.',
    '- publish: $(Build.ArtifactStagingDirectory)\n  artifact: drop\n',
  ),
  probe(
    'download',
    'A shortcut for `DownloadPipelineArtifact@2`, and the keyword E06-S05-T01 already implements ' +
      'the runtime half of. `current` is the documented spelling for this run.',
    '- download: current\n  artifact: drop\n',
  ),
  probe(
    'checkout',
    'PLAN D4 emits `checkout` natively, so what matters here is only the *shape* the model ' +
      'receives: if the service rewrites it into a task, E05 cannot match on the keyword.',
    '- checkout: self\n',
  ),
  probe(
    'getPackage',
    'The least-documented of the set. Included because the task names it, and because an ' +
      'unhandled shorthand is a silent hole rather than an error.',
    '- getPackage: pkg\n',
  ),
  probe(
    'task-explicit',
    'Control: an already-canonical `task:` step must pass through untouched, so a difference in ' +
      'any row above is attributable to the shorthand and not to the expansion in general.',
    '- task: CmdLine@2\n  inputs:\n    script: echo hello\n',
  ),
];

/** The step keys the expansion came back with, in document order. */
function stepKeys(finalYaml: string): string[] {
  const keys: string[] = [];
  // Steps in an expansion are always under one `steps:` at a fixed indent; the first key of each
  // `- ` item is the discriminator (`firstProperty`, C-E01-012).
  for (const match of finalYaml.matchAll(/^\s*-\s+([A-Za-z_][\w.-]*):/gm)) {
    const key = match[1];
    if (key !== undefined && key !== 'stage' && key !== 'job') keys.push(key);
  }
  return keys;
}

function responseJson(outcome: PreviewOutcome): string {
  return JSON.stringify(outcome, undefined, 2) + '\n';
}

const env = await loadEnvFile('.env.oracle');
const config: OracleConfig = configFromEnv(env);

const requested = process.argv[2];
const selected =
  requested === undefined ? PROBES : PROBES.filter((entry) => entry.name === requested);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${requested}; known: ${PROBES.map((entry) => entry.name).join(', ')}`,
  );
}

const rows: string[] = [];

for (const entry of selected) {
  // Sequential by construction: no parallel calls against the user's oracle organization.
  const outcome = await preview(config, { yamlOverride: entry.yaml });

  const dir = path.join(EXPERIMENTS, entry.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'probe.yml'), entry.yaml, 'utf8');
  await writeFile(path.join(dir, 'response.json'), redact(responseJson(outcome), config), 'utf8');

  let verdict = describe(outcome);
  let produced = '';
  if (outcome.kind === 'expanded') {
    await writeFile(path.join(dir, 'final.yml'), outcome.finalYaml, 'utf8');
    produced = stepKeys(outcome.finalYaml).join(', ');
    const task = /^\s*-\s+task:\s*(\S+)/m.exec(outcome.finalYaml)?.[1];
    verdict = task === undefined ? '**not desugared** — ours' : `desugared → \`${task}\``;
  }

  await writeFile(
    path.join(dir, 'README.md'),
    `# oracle probe — ${entry.name}\n\n${entry.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- Outcome: **${describe(outcome)}**\n` +
      `- Step keys in the expansion: \`${produced}\`\n` +
      `- Verdict: ${verdict}\n` +
      '- Not predicted by this script: every row is asking, not asserting.\n',
    'utf8',
  );

  rows.push(`| \`${entry.keyword}\` | ${describe(outcome)} | \`${produced}\` | ${verdict} |`);
  console.log(`${entry.name.padEnd(14)} ${describe(outcome).padEnd(24)} ${verdict}`);
}

if (requested === undefined) {
  await writeFile(
    path.join(EXPERIMENTS, 'matrix.md'),
    '# E04-S01-T02 — which step shorthands the service desugars\n\n' +
      'Each row is one `steps:` document submitted to `preview`. "Step keys in the expansion" is\n' +
      'the discriminating first key of every step that came back, so a row that still shows its\n' +
      'own shorthand keyword is one **we** have to normalize.\n\n' +
      '| Shorthand | Outcome | Step keys in the expansion | Verdict |\n|---|---|---|---|\n' +
      rows.join('\n') +
      '\n',
    'utf8',
  );
  console.log(`\nwrote ${path.join(EXPERIMENTS, 'matrix.md')}`);
}
