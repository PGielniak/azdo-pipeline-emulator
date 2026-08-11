// Shared probe runner for oracle experiments (extracted from scripts/oracle-probe.ts in
// E01-S01-T02, transcript format unchanged so committed transcripts stay byte-identical).
//
// A "probe" is one pipeline YAML submitted to the preview endpoint with `previewRun: true`,
// stored as a redacted request/response transcript. The transcripts ARE the grounding
// artifact — re-running a script re-verifies its claims against the live service.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';

export interface Probe {
  readonly name: string;
  /** What this probe establishes — copied into the transcript header. */
  readonly asserts: string;
  readonly yaml: string;
}

export async function loadEnvFile(file: string): Promise<Record<string, string | undefined>> {
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

export function describe(outcome: PreviewOutcome): string {
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

export function transcript(probe: Probe, config: OracleConfig, outcome: PreviewOutcome): string {
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

/**
 * Run `probes` (or the single one named on the command line) sequentially — no parallel
 * hammering of the org — writing `<outDir>/<name>.md` per probe.
 */
export async function runProbes(
  probes: readonly Probe[],
  outDir: string,
  only = process.argv[2],
): Promise<void> {
  const env = await loadEnvFile('.env.oracle');
  const config = configFromEnv(env);
  const selected = only === undefined ? probes : probes.filter((p) => p.name === only);
  if (selected.length === 0) {
    throw new Error(`no probe named ${only}; known: ${probes.map((p) => p.name).join(', ')}`);
  }

  await mkdir(outDir, { recursive: true });
  for (const probe of selected) {
    const outcome = await preview(config, { yamlOverride: probe.yaml });
    const file = path.join(outDir, `${probe.name}.md`);
    await writeFile(file, transcript(probe, config, outcome), 'utf8');
    console.log(`${probe.name.padEnd(18)} ${describe(outcome)}  -> ${file}`);
  }
}
