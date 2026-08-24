// E04-S03-T01 grounding — determine the *effective* job naming and slice variables for the
// `matrix` and `parallel` strategies. Preview never expands `strategy:` (C-E12-018), so the only
// way to observe the multiplied jobs — their timeline names, `System.JobName` / `System.JobDisplayName`
// / `Agent.JobName` per leg, and the `System.JobPositionInPhase` / `System.TotalJobsInPhase` values —
// is to queue one short run and read its timeline and logs.
//
// Run: node scripts/matrix-parallel-realrun.ts
// Output: research/experiments/E04-strategy/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

const OUT_DIR = path.join('research', 'experiments', 'E04-strategy');
const PROBE_REPO_PATH = '/experiments/matrix-parallel.yml';
const PIPELINE_NAME = 'oracle-matrix-parallel-probe';
const POLL_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
jobs:
- job: Build
  strategy:
    matrix:
      Alpha:
        MATRIX_VAR: 'a'
      Beta:
        MATRIX_VAR: 'b'
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "SYSTEM_JOBNAME=$(System.JobName)"
      echo "SYSTEM_JOBDISPLAYNAME=$(System.JobDisplayName)"
      echo "AGENT_JOBNAME=$(Agent.JobName)"
      echo "MATRIX_VAR=$(MATRIX_VAR)"

- job: Slice
  strategy:
    parallel: 2
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "POSITION=$(System.JobPositionInPhase)"
      echo "TOTAL=$(System.TotalJobsInPhase)"
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

async function timelineJobs(runId: number): Promise<readonly TimelineRecord[]> {
  const timeline = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', timeline);
  return ((timeline.body as { records?: TimelineRecord[] }).records ?? []).filter(
    (record) => record.type === 'Job',
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
        !/SYSTEM_JOBNAME=|SYSTEM_JOBDISPLAYNAME=|AGENT_JOBNAME=|MATRIX_VAR=|POSITION=|TOTAL=/.test(
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
  'E04-S03-T01 matrix/parallel real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const requestedRunId = process.env.AZDO_MATRIX_PROBE_RUN_ID;
const queued =
  requestedRunId === undefined
    ? await queueRun(pipeline.id, repo.defaultBranch)
    : { id: Number.parseInt(requestedRunId, 10), state: 'existing' };
if (!Number.isSafeInteger(queued.id)) {
  throw new Error('AZDO_MATRIX_PROBE_RUN_ID must be a numeric run id');
}
console.log(requestedRunId === undefined ? `queued run ${queued.id}` : `reusing run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const jobs = await timelineJobs(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E04-S03-T01 — matrix & parallel naming and slice variables (real run)',
  '',
  'This probe establishes the **effective** job naming and slice variables for `strategy: matrix`',
  'and `strategy: parallel`. Preview never expands `strategy:` (C-E12-018), so the multiplied jobs',
  'are only observable by queueing a run and reading its timeline and logs.',
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
  '## Job records (timeline, type `Job`)',
  '',
  '| name | result |',
  '|---|---|',
  ...jobs.map((job) => `| \`${job.name}\` | \`${job.result ?? '-'}\` |`),
  '',
  '## Relevant log lines',
  '',
  '```text',
  logs || '(none)',
  '```',
  '',
  'Interpretation: `Build Alpha`/`Build Beta` in the Job records proves the space-separated naming',
  'of C-E04-110; `SYSTEM_JOBNAME` vs `SYSTEM_JOBDISPLAYNAME` per leg shows whether the identifier or',
  'only the display name gains the key; `POSITION`/`TOTAL` show whether `System.JobPositionInPhase`',
  'is 1-based.',
  '',
  'Regenerate with `node scripts/matrix-parallel-realrun.ts`; this queues a new hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'matrix-parallel.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
