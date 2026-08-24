// E04-S03-T03 grounding — verify the deployment job output-variable naming quirk on a hosted agent.
//
// Preview can desugar the steps but never executes them, and the runOnce output-variable key is a
// *runtime* fact: docs/01 §3 flags the "job-name nuance" between runOnce and matrix, and the doc
// page asserts the first segment is the **job name** for runOnce (not the lifecycle hook). The only
// way to observe the effective key is to set an output variable in a runOnce deploy hook and read it
// back from a later stage through `stageDependencies`. Both spellings are read — the job-name key
// and the hook-name key — so the experiment proves which one the service actually registers.
//
// Run: node scripts/deployment-output-realrun.ts
// Output: research/experiments/E04-deployment/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E04-deployment');
const PROBE_REPO_PATH = '/experiments/deployment-output.yml';
const PIPELINE_NAME = 'oracle-deployment-output-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
stages:
- stage: StageA
  jobs:
  - deployment: A1
    pool:
      vmImage: ubuntu-latest
    environment: corpus-staging
    strategy:
      runOnce:
        deploy:
          steps:
          - bash: echo "##vso[task.setvariable variable=myOutputVar;isOutput=true]deployment-value"
            name: setvarStep
          - bash: echo "CASE SAME_JOB=$(setvarStep.myOutputVar)"
- stage: StageB
  dependsOn: StageA
  variables:
    jobNameKey: $[stageDependencies.StageA.A1.outputs['A1.setvarStep.myOutputVar']]
    hookNameKey: $[stageDependencies.StageA.A1.outputs['deploy.setvarStep.myOutputVar']]
  jobs:
  - job: B1
    pool:
      vmImage: ubuntu-latest
    steps:
    - bash: |
        echo "CASE JOBNAME_KEY=[$(jobNameKey)]"
        echo "CASE HOOKNAME_KEY=[$(hookNameKey)]"
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

async function authorizeEnvironment(environmentName: string, pipelineId: number): Promise<void> {
  const list = await api(
    `distributedtask/environments?name=${encodeURIComponent(environmentName)}&api-version=7.1`,
  );
  require2xx('list environments', list);
  const existing = ((list.body as { value?: { id: number; name: string }[] }).value ?? []).find(
    (e) => e.name === environmentName,
  );
  if (existing === undefined) throw new Error(`environment ${environmentName} not found`);
  const authorized = await api(
    `pipelines/pipelinepermissions/environment/${existing.id}?api-version=7.1-preview.1`,
    {
      method: 'PATCH',
      body: JSON.stringify({ pipelines: [{ id: pipelineId, authorized: true }] }),
    },
  );
  require2xx(`authorize environment ${environmentName} for pipeline ${pipelineId}`, authorized);
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
  '/experiments',
  [{ path: PROBE_REPO_PATH, content: PROBE_YAML }],
  'E04-S03-T03 deployment output-variable naming real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
await authorizeEnvironment('corpus-staging', pipeline.id);
const queued = await queueRun(pipeline.id, repo.defaultBranch);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const jobs = await timelineJobs(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E04-S03-T03 — runOnce output-variable naming (real run)',
  '',
  'This hosted-agent probe establishes the **effective** output-variable key for a runOnce deployment',
  'job read from a later stage via `stageDependencies`. The doc asserts the first segment is the',
  '**job name** (`A1.setvarStep.myOutputVar`), not the lifecycle hook (`deploy.setvarStep.myOutputVar`);',
  'preview cannot execute the setvariable, so the only way to observe the registered key is to queue',
  'a run and read both spellings back.',
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
  'Interpretation: `SAME_JOB` shows the output variable is set and readable in the same hook;',
  '`JOBNAME_KEY` and `HOOKNAME_KEY` show which of the two `stageDependencies` spellings resolves. A',
  'non-empty `JOBNAME_KEY` with an empty `HOOKNAME_KEY` proves the job-name quirk; the opposite would',
  'refute the doc.',
  '',
  'Regenerate with `node scripts/deployment-output-realrun.ts`; this queues a hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'deployment-output.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
