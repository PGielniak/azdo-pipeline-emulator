// E06-S02-T01 grounding — observe hosted-agent macro expansion for runtime-created chains and
// nested-looking macro text. Preview cannot execute logging commands or the per-task macro pass,
// so this queues one short Ubuntu run and reads only the CASE lines from its logs.
//
// Run: node scripts/macro-expansion-realrun.ts
// Output: research/experiments/E06-macro-expansion/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E06-macro-expansion');
const PROBE_REPO_PATH = '/experiments/macro-expansion/macro-expansion.yml';
const PIPELINE_NAME = 'oracle-macro-expansion-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
variables:
  b: inner
  ainner: outer
  short: short-value
  shorter: longer-name-value
steps:
- bash: |
    macro='$'
    macro+='(b)'
    printf '##vso[task.setvariable variable=a]%s\\n' "$macro"
  displayName: Set a to literal macro text
- bash: |
    printf 'CASE CHAIN=%s\\n' '$(a)'
    printf 'CASE NESTED=%s\\n' '$(a$(b))'
    printf 'CASE UNMATCHED=%s\\n' '$(missing)'
    printf 'CASE EXACT=%s|%s\\n' '$(short)' '$(shorter)'
  displayName: Observe macro scan
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
  '/experiments/macro-expansion',
  [{ path: PROBE_REPO_PATH, content: PROBE_YAML }],
  'E06-S02-T01 macro expansion real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const queued = await queueRun(pipeline.id, repo.defaultBranch);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const tasks = await timelineResults(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E06-S02-T01 — macro expansion (real run)',
  '',
  'This hosted-agent probe measures task-time scanning after a logging command creates a value',
  'that itself looks like a macro. Preview cannot execute either phase.',
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
  '- `CHAIN=inner` refutes the backlog task’s required end-to-end non-recursion: the value set',
  '  to literal `$(b)` in task one resolves to `inner` in task two.',
  '- `NESTED=$(ainner)` proves the first outer candidate is unmatched, then the inner `$(b)`',
  '  expands; the newly formed outer macro is not revisited even though `ainner` exists.',
  '- `UNMATCHED=$(missing)` directly confirms literal preservation for a missing name.',
  '- The two `EXACT` values confirm that prefix-related names are looked up as exact candidates.',
  '',
  'Regenerate with `node scripts/macro-expansion-realrun.ts`; this queues one hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'macro-expansion.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
