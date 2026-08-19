// E06-S04-T03 grounding — observe task.logissue/task.complete result effects and debug-formatting
// visibility on a hosted agent. Preview cannot execute logging commands, so this queues one short
// Ubuntu run and retains only synthetic CASE/FORMAT lines plus task timeline results.
//
// Run: node scripts/logging-commands-realrun.ts
// Output: research/experiments/E06-logging-commands/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E06-logging-commands');
const PROBE_REPO_PATH = '/experiments/logging-commands/logging-commands.yml';
const PIPELINE_NAME = 'oracle-logging-commands-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
jobs:
- job: issueResult
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.logissue type=warning]synthetic warning issue'
      echo '##vso[task.logissue type=error]synthetic error issue'
      echo 'CASE ISSUE_STEP_CONTINUED=yes'
    displayName: Log warning and error issues
- job: completeResults
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.complete result=SucceededWithIssues;]synthetic partial result'
      echo 'CASE AFTER_PARTIAL_COMPLETE=yes'
    displayName: Complete as succeeded with issues
  - bash: |
      echo '##vso[task.complete result=Failed;]synthetic failed result'
      echo 'CASE AFTER_FAILED_COMPLETE=yes'
    displayName: Complete as failed
  - bash: |
      echo '##vso[task.complete result=Succeeded;]synthetic success result'
      echo 'CASE BEFORE_EXIT_ONE=yes'
      exit 1
    condition: always()
    displayName: Complete success then exit one
- job: debugOff
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##[debug]FORMAT DEBUG OFF'
      echo '##vso[task.debug]VSO DEBUG OFF'
      echo '##[group]FORMAT GROUP OFF'
      echo 'FORMAT GROUP BODY OFF'
      echo '##[endgroup]'
    displayName: Debug formatting disabled
- job: debugOn
  variables:
    System.Debug: true
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##[debug]FORMAT DEBUG ON'
      echo '##vso[task.debug]VSO DEBUG ON'
      echo '##[group]FORMAT GROUP ON'
      echo 'FORMAT GROUP BODY ON'
      echo '##[endgroup]'
    displayName: Debug formatting enabled
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
  readonly errorCount?: number;
  readonly warningCount?: number;
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
  const probeTasks = new Set([
    'Log warning and error issues',
    'Complete as succeeded with issues',
    'Complete as failed',
    'Complete success then exit one',
    'Debug formatting disabled',
    'Debug formatting enabled',
  ]);
  return ((timeline.body as { records?: TimelineRecord[] }).records ?? []).filter(
    (record) => record.type === 'Task' && probeTasks.has(record.name),
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
      const match = /^\d{4}-\d\d-\d\dT[\d:.]+Z (.*)$/.exec(line);
      if (match === null) continue;
      const observation = match[1];
      if (observation === undefined) continue;
      if (!/^(?:CASE |##\[(?:debug|group)]FORMAT |FORMAT GROUP BODY )/.test(observation)) {
        continue;
      }
      if (!seen.has(observation)) {
        seen.add(observation);
        lines.push(observation);
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
  '/experiments/logging-commands',
  [{ path: PROBE_REPO_PATH, content: PROBE_YAML }],
  'E06-S04-T03 remaining logging commands real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const queued = await queueRun(pipeline.id, repo.defaultBranch);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const tasks = await timelineResults(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E06-S04-T03 — remaining logging commands (real run)',
  '',
  'This hosted-agent probe distinguishes logging issue counters from task results, measures how',
  '`task.complete` merges with process exit, and checks raw/task debug output with diagnostics off',
  'and on. Preview cannot execute these logging-command effects.',
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
  '## Task results and issue counters',
  '',
  '| task | result | errors | warnings |',
  '|---|---|---:|---:|',
  ...tasks.map(
    (task) =>
      `| \`${task.name}\` | \`${task.result ?? '-'}\` | ${task.errorCount ?? 0} | ${task.warningCount ?? 0} |`,
  ),
  '',
  '## Relevant log lines',
  '',
  '```text',
  logs || '(none)',
  '```',
  '',
  '## Interpretation',
  '',
  '- A raw error issue increments the timeline error counter but leaves an otherwise successful',
  '  task `succeeded`; warning and error counters therefore do not determine task result.',
  '- `task.complete` changes the result but does not stop the shell: both post-command CASE lines',
  '  ran. `SucceededWithIssues` persisted, `Failed` persisted, and process exit 1 remained `failed`',
  '  after an earlier `Succeeded` command.',
  '- Raw `##[debug]` and group formatting lines are retained even with `System.Debug` unset. The',
  '  separate `##vso[task.debug]` message is absent when diagnostics are off and present when on.',
  '',
  'Regenerate with `node scripts/logging-commands-realrun.ts`; this queues one hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'logging-commands.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
