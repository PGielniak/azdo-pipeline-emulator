// E06-S04-T02 grounding — observe task.setvariable timing, output routing, and masking on a
// hosted agent. Preview cannot execute logging commands or the per-task environment/macro pass,
// so this queues one short Ubuntu run and retains only synthetic CASE lines from its logs.
//
// Run: node scripts/setvariable-realrun.ts
// Output: research/experiments/E06-setvariable/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E06-setvariable');
const PROBE_REPO_PATH = '/experiments/setvariable/setvariable.yml';
const PIPELINE_NAME = 'oracle-setvariable-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
jobs:
- job: producer
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      mask_value="synthetic-mask-$BUILD_BUILDID"
      echo "##vso[task.setvariable variable=plain]later-value"
      echo "##vso[task.setvariable variable=out;isOutput=true]output-value"
      echo "##vso[task.setvariable variable=masked;isSecret=true]$mask_value"
      printf 'CASE CURRENT_MACRO=%s\\n' '$(plain)'
      printf 'CASE CURRENT_ENV=%s\\n' "\${PLAIN-unset}"
      printf 'CASE CURRENT_OUTPUT=%s\\n' '$(setVars.out)'
      printf 'CASE CURRENT_SECRET=%s\\n' "$mask_value"
    name: setVars
    displayName: Set and observe in current task
  - bash: |
      printf 'CASE LATER_MACRO=%s\\n' '$(plain)'
      printf 'CASE LATER_ENV=%s\\n' "\${PLAIN-unset}"
      printf 'CASE LATER_OUTPUT=%s\\n' '$(setVars.out)'
      printf 'CASE LATER_SECRET=%s\\n' '$(masked)'
    displayName: Observe in following task
- job: consumer
  dependsOn: producer
  variables:
    imported: $[ dependencies.producer.outputs['setVars.out'] ]
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      printf 'CASE CROSS_JOB=%s\\n' '$(imported)'
    displayName: Observe dependency output
`;

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const org = config.orgUrl.replace(/\/+$/, '');
const project = encodeURIComponent(config.project);

interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
}

async function api(route: string, init: RequestInit = {}): Promise<ApiResponse> {
  const response = await fetch(`${org}/${project}/_apis/${route}`, {
    ...init,
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(config.pat),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

function require2xx(what: string, response: ApiResponse): void {
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `${what} failed: HTTP ${response.status} ${redact(response.text, config).slice(0, 400)}`,
    );
  }
}

interface PipelineRef {
  readonly id: number;
  readonly name: string;
}

interface RunRef {
  readonly id: number;
  readonly state: string;
  readonly result?: string;
}

interface TimelineRecord {
  readonly type: string;
  readonly name: string;
  readonly result?: string;
}

async function ensurePipeline(repo: RepoRef): Promise<PipelineRef> {
  const listed = await api('pipelines?api-version=7.1-preview.1');
  require2xx('list pipelines', listed);
  const existing = (listed.body as { value?: PipelineRef[] }).value?.find(
    (pipeline) => pipeline.name === PIPELINE_NAME,
  );
  if (existing !== undefined) return existing;

  const created = await api('pipelines?api-version=7.1-preview.1', {
    method: 'POST',
    body: JSON.stringify({
      folder: '\\',
      name: PIPELINE_NAME,
      configuration: {
        type: 'yaml',
        path: PROBE_REPO_PATH,
        repository: { id: repo.id, name: repo.name, type: 'azureReposGit' },
      },
    }),
  });
  require2xx('create pipeline', created);
  return created.body as PipelineRef;
}

async function queueRun(pipelineId: number, refName: string): Promise<RunRef> {
  const queued = await api(`pipelines/${pipelineId}/runs?api-version=7.1-preview.1`, {
    method: 'POST',
    body: JSON.stringify({ resources: { repositories: { self: { refName } } } }),
  });
  require2xx('queue run', queued);
  return queued.body as RunRef;
}

async function pollRun(pipelineId: number, runId: number): Promise<RunRef> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const response = await api(`pipelines/${pipelineId}/runs/${runId}?api-version=7.1-preview.1`);
    require2xx('get run', response);
    const run = response.body as RunRef;
    console.log(`run ${runId}: state=${run.state} result=${run.result ?? '-'}`);
    if (run.state === 'completed') return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not complete in time`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

async function timelineResults(runId: number): Promise<readonly TimelineRecord[]> {
  const timeline = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', timeline);
  return ((timeline.body as { records?: TimelineRecord[] }).records ?? []).filter(
    (record) => record.type === 'Task' && record.name !== 'Checkout',
  );
}

async function relevantLogs(runId: number): Promise<string> {
  const listed = await api(`build/builds/${runId}/logs?api-version=7.1`);
  require2xx('list logs', listed);
  const ids = (listed.body as { value?: { id: number }[] }).value ?? [];
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const { id } of ids) {
    const log = await api(`build/builds/${runId}/logs/${id}?api-version=7.1`);
    require2xx(`get log ${id}`, log);
    const logLines = (log.body as { value?: unknown }).value;
    const sourceLines = Array.isArray(logLines)
      ? logLines.filter((line): line is string => typeof line === 'string')
      : log.text.split('\n');
    for (const line of sourceLines) {
      if (!/^\d{4}-\d\d-\d\dT[\d:.]+Z CASE /.test(line)) continue;
      const observation = line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, '');
      if (!seen.has(observation)) {
        seen.add(observation);
        lines.push(line);
      }
    }
  }
  return lines.join('\n');
}

const repo = await defaultRepository(config);
const commit = await syncFiles(
  config,
  repo,
  repo.defaultBranch,
  '/experiments/setvariable',
  [{ path: PROBE_REPO_PATH, content: PROBE_YAML }],
  'E06-S04-T02 task.setvariable real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const queued = await queueRun(pipeline.id, repo.defaultBranch);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const tasks = await timelineResults(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E06-S04-T02 — task.setvariable timing and outputs (real run)',
  '',
  'This hosted-agent probe measures the current-task boundary, following-task macro/environment',
  'visibility, same-job output syntax, dependency output mapping, and secret masking. Preview',
  'cannot execute any of those logging-command effects.',
  '',
  `- Probe pipeline: \`${PIPELINE_NAME}\` → \`${PROBE_REPO_PATH}\``,
  `- Run: id ${finished.id}, state \`${finished.state}\`, result \`${finished.result ?? '-'}\``,
  '',
  '## Probe YAML',
  '',
  '```yaml',
  PROBE_YAML.trimEnd(),
  '```',
  '',
  '## Task results',
  '',
  '| task | result |',
  '|---|---|',
  ...tasks.map((task) => `| \`${task.name}\` | \`${task.result ?? '-'}\` |`),
  '',
  '## Relevant log lines',
  '',
  '```text',
  logs || '(none)',
  '```',
  '',
  '## Interpretation',
  '',
  '- The current task retains literal `$(plain)`/`$(setVars.out)` text and has no `PLAIN`',
  '  environment entry, while the following task sees the new plain value through both forms.',
  '- The output variable is available in the following same-job task as `$(setVars.out)` and in',
  "  the dependent job through `dependencies.producer.outputs['setVars.out']`.",
  '- Both the output immediately after secret registration and the next task’s macro expansion',
  '  render as `***`; the generated synthetic source value is not retained in this transcript.',
  '',
  'Regenerate with `node scripts/setvariable-realrun.ts`; this queues one hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'setvariable.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
