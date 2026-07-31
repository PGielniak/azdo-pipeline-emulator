// E00-S03-T02 — oracle spike: submit probe pipelines to the Pipelines preview endpoint and
// store redacted request/response transcripts under research/experiments/oracle-spike/.
//
// The saved responses ARE the grounding artifact for the oracle: they prove the route, the
// api-version, the `finalYaml` field name, and each failure mode we rely on. Re-running this
// script re-verifies all of it against the live service.
//
// Run: node scripts/oracle-probe.ts            (all probes)
//      node scripts/oracle-probe.ts five-line  (one probe by name)
//
// Requires .env.oracle at the repo root (see research/oracle-setup.md). previewRun is always
// true, so nothing is ever queued and the org needs no agents or parallelism.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';

const OUT_DIR = path.join('research', 'experiments', 'oracle-spike');

interface Probe {
  readonly name: string;
  /** What this probe establishes — copied into the transcript header. */
  readonly asserts: string;
  readonly yaml: string;
}

const PROBES: readonly Probe[] = [
  {
    name: 'five-line',
    asserts:
      'Baseline success pair: a 5-line pipeline expands to the service canonical form. ' +
      'Establishes route, api-version and that the 200 body carries exactly one field, finalYaml.',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: echo hello\n',
  },
  {
    name: 'malformed-yaml',
    asserts:
      'Ill-formed YAML is rejected at parse time with a positional message ' +
      '"<file> (Line: N, Col: M): <text>" — the format our diagnostics renderer mirrors.',
    yaml: 'steps:\n- script: echo one\n  - bad: indentation\n',
  },
  {
    name: 'unknown-root-key',
    asserts:
      'Well-formed YAML that violates the schema is rejected with the offending value named.',
    yaml: 'stepz:\n- script: echo hi\n',
  },
  {
    name: 'bad-expression',
    asserts:
      'Expression errors report a position *within the expression* in addition to line/col, ' +
      'and link the expressions documentation.',
    yaml: 'variables:\n  a: ${{ nosuchfunc(1) }}\nsteps:\n- script: echo hi\n',
  },
  {
    name: 'missing-template',
    asserts:
      'A template that does not resolve names the repository, branch and commit it searched. ' +
      'This message embeds the organization URL — the reason redaction is mandatory.',
    yaml: 'steps:\n- template: does-not-exist.yml\n',
  },
  {
    name: 'unknown-task',
    asserts:
      'An unresolvable task is rejected without line/col: the message identifies job and step ' +
      'instead, so not every rejection can be rendered as a source-positioned diagnostic.',
    yaml: 'steps:\n- task: NoSuchTask@9\n',
  },
];

async function loadEnvFile(file: string): Promise<Record<string, string | undefined>> {
  const merged: Record<string, string | undefined> = { ...process.env };
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return merged; // fall back to the ambient environment (CI supplies real secrets)
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    merged[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return merged;
}

function describe(outcome: PreviewOutcome): string {
  switch (outcome.kind) {
    case 'expanded':
      return `HTTP ${outcome.status} · expanded`;
    case 'rejected':
      return `HTTP ${outcome.status} · rejected · typeKey=${outcome.typeKey ?? '(none)'}`;
    case 'unauthenticated':
      return `HTTP ${outcome.status} · unauthenticated (redirect to sign-in)`;
    case 'transport':
      return `HTTP ${outcome.status} · unparseable body`;
  }
}

function transcript(probe: Probe, config: OracleConfig, outcome: PreviewOutcome): string {
  const payload =
    outcome.kind === 'expanded'
      ? `### Response — finalYaml\n\n\`\`\`yaml\n${outcome.finalYaml}\`\`\`\n`
      : outcome.kind === 'rejected'
        ? `### Response — error body\n\n\`\`\`json\n${JSON.stringify(outcome.body, null, 2)}\n\`\`\`\n`
        : `### Response\n\n\`\`\`\n${JSON.stringify(outcome, null, 2)}\n\`\`\`\n`;

  const body = [
    `# oracle probe — ${probe.name}`,
    '',
    probe.asserts,
    '',
    `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\``,
    `- Request body: \`{"previewRun": true, "yamlOverride": <below>}\``,
    `- Outcome: **${describe(outcome)}**`,
    '',
    '### Request — yamlOverride',
    '',
    '```yaml',
    probe.yaml.replace(/\n$/, ''),
    '```',
    '',
    payload,
  ].join('\n');

  return redact(body, config);
}

async function main(): Promise<void> {
  const env = await loadEnvFile('.env.oracle');
  const config = configFromEnv(env);
  const only = process.argv[2];
  const selected = only === undefined ? PROBES : PROBES.filter((p) => p.name === only);
  if (selected.length === 0) {
    throw new Error(`no probe named ${only}; known: ${PROBES.map((p) => p.name).join(', ')}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  for (const probe of selected) {
    const outcome = await preview(config, { yamlOverride: probe.yaml });
    const file = path.join(OUT_DIR, `${probe.name}.md`);
    await writeFile(file, transcript(probe, config, outcome), 'utf8');
    console.log(`${probe.name.padEnd(18)} ${describe(outcome)}  -> ${file}`);
  }
}

await main();
