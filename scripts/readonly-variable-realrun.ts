// E06-S01-T01 grounding — determine the *effective* hosted-agent behavior when a task attempts
// to overwrite an `isReadOnly=true` variable. Preview cannot execute logging commands, so this
// queues one short Ubuntu run and reads its logs and timeline. The probe is idempotent: its YAML
// file and pipeline definition are reused on later runs.
//
// Run: node scripts/readonly-variable-realrun.ts
// Output: research/experiments/E06-readonly-variables/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

const OUT_DIR = path.join('research', 'experiments', 'E06-readonly-variables');
const PROBE_REPO_PATH = '/experiments/readonly-variable.yml';
const PIPELINE_NAME = 'oracle-readonly-variable-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
jobs:
- job: readonly
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "##vso[task.setvariable variable=readonlyProbe;isReadOnly=true]first"
      echo "##vso[task.setvariable variable=readonlyProbe]second"
    name: write
    continueOnError: true
  - bash: |
      printf 'READONLY_PROBE=%s\\n' '$(readonlyProbe)'
    name: observe
    condition: always()
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
    const result = await api(`pipelines/${pipelineId}/runs/${runId}?api-version=7.1-preview.1`);
    require2xx('get run', result);
    const run = result.body as RunRef;
    console.log(`run ${runId}: state=${run.state} result=${run.result ?? '-'}`);
    if (run.state === 'completed') return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not complete in time`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

interface TimelineRecord {
  readonly type: string;
  readonly name: string;
  readonly result?: string;
}

async function timelineResults(runId: number): Promise<readonly TimelineRecord[]> {
  const timeline = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', timeline);
  return ((timeline.body as { records?: TimelineRecord[] }).records ?? []).filter(
    (record) => record.type === 'Task',
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
      if (
        !/Overwriting readonly variable|Unable to process command .*readonlyProbe|READONLY_PROBE=(first|second)/i.test(
          line,
        )
      ) {
        continue;
      }
      const dedupeKey = line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s+/, '');
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
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
  '/experiments',
  [{ path: PROBE_REPO_PATH, content: PROBE_YAML }],
  'E06-S01-T01 readonly variable real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const requestedRunId = process.env.AZDO_READONLY_PROBE_RUN_ID;
const queued =
  requestedRunId === undefined
    ? await queueRun(pipeline.id, repo.defaultBranch)
    : { id: Number.parseInt(requestedRunId, 10), state: 'existing' };
if (!Number.isSafeInteger(queued.id)) {
  throw new Error('AZDO_READONLY_PROBE_RUN_ID must be a numeric run id');
}
console.log(requestedRunId === undefined ? `queued run ${queued.id}` : `reusing run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const tasks = await timelineResults(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E06-S01-T01 — read-only variable overwrite (real run)',
  '',
  'This probe establishes the **effective hosted-agent policy** for a variable first set with',
  '`isReadOnly=true` and then set again in the same step. Preview cannot answer this because',
  'only the agent executes logging commands.',
  '',
  `- Probe pipeline: \`${PIPELINE_NAME}\` → \`${PROBE_REPO_PATH}\``,
  `- Run: id ${finished.id}, state \`${finished.state}\`, result \`${finished.result ?? '-'}\``,
  '- First task has `continueOnError: true`; the `always()` observation task therefore executes',
  '  even if the overwrite is enforced as an error.',
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
  'Interpretation: `READONLY_PROBE=second` proves warning-and-overwrite; `first` with a task',
  'error (shown as `SucceededWithIssues` here only because `continueOnError` is true) proves',
  'enforced no-overwrite; `first` with a warning would prove the former local',
  'warn-and-ignore design.',
  '',
  'Regenerate with `node scripts/readonly-variable-realrun.ts`; this queues a new hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'readonly-variable.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
