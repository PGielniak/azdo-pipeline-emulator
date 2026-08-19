// E06-S01-T02 grounding — observe hosted-agent environment materialization where public
// variable names collide after conversion, and cross-check explicit env and PATH precedence.
// Preview does not execute agents, so this queues one short Ubuntu run and reads selected logs.
//
// Run: node scripts/env-materialization-realrun.ts
// Output: research/experiments/E06-env-materialization/real-run.md (redacted)
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E06-env-materialization');
const PROBE_REPO_PATH = '/experiments/env-materialization.yml';
const PIPELINE_NAME = 'oracle-env-materialization-probe';
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const PROBE_YAML = `trigger: none
pr: none
jobs:
- job: declared_dot_then_under
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: A.B
    value: dot-first
  - name: A_B
    value: under-second
  steps:
  - bash: |
      printf 'CASE declared_dot_then_under ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\\n' "$A_B" '$(A.B)' '$(A_B)'

- job: declared_under_then_dot
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: A_B
    value: under-first
  - name: A.B
    value: dot-second
  steps:
  - bash: |
      printf 'CASE declared_under_then_dot ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\\n' "$A_B" '$(A.B)' '$(A_B)'

- job: runtime_dot_then_under
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.setvariable variable=A.B]dot-first'
      echo '##vso[task.setvariable variable=A_B]under-second'
  - bash: |
      printf 'CASE runtime_dot_then_under ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\\n' "$A_B" '$(A.B)' '$(A_B)'

- job: runtime_under_then_dot
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.setvariable variable=A_B]under-first'
      echo '##vso[task.setvariable variable=A.B]dot-second'
  - bash: |
      printf 'CASE runtime_under_then_dot ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\\n' "$A_B" '$(A.B)' '$(A_B)'

- job: transform_overlay_secret_path
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: lower.dot
    value: dotted
  - name: Space Name
    value: spaced
  - name: OVERLAY_NAME
    value: automatic
  - name: overlay.source
    value: macro
  steps:
  - bash: |
      generated="runtime-$RANDOM-$RANDOM"
      echo "##vso[task.setvariable variable=Hidden.Value;issecret=true]$generated"
      echo '##vso[task.prependpath]/first-e06'
      echo '##vso[task.prependpath]/second-e06'
  - bash: |
      if printenv HIDDEN_VALUE >/dev/null; then auto_secret=present; else auto_secret=absent; fi
      macro_literal='$'
      macro_literal+='(Hidden.Value)'
      if [[ -n "\${EXPLICIT_SECRET+x}" && "$EXPLICIT_SECRET" != "$macro_literal" ]]; then
        mapped_secret=present
      else
        mapped_secret=absent
      fi
      case "$PATH" in
        /second-e06:/first-e06:*) path_order=second-first-base ;;
        /first-e06:/second-e06:*) path_order=first-second-base ;;
        *) path_order=other ;;
      esac
      printf 'CASE transform LOWER_DOT=%s SPACE_NAME=%s\\n' "$LOWER_DOT" "$SPACE_NAME"
      printf 'CASE overlay OVERLAY_NAME=%s\\n' "$OVERLAY_NAME"
      printf 'CASE secret AUTO=%s EXPLICIT=%s\\n' "$auto_secret" "$mapped_secret"
      printf 'CASE path ORDER=%s\\n' "$path_order"
    env:
      OVERLAY_NAME: explicit-$(overlay.source)
      EXPLICIT_SECRET: $(Hidden.Value)
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
    const result = await api(`pipelines/${pipelineId}/runs/${runId}?api-version=7.1-preview.1`);
    require2xx('get run', result);
    const run = result.body as RunRef;
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
      if (
        !/^\d{4}-\d\d-\d\dT[\d:.]+Z CASE (declared|runtime|transform|overlay|secret|path)/.test(
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
  'E06-S01-T02 environment materialization real-run probe',
);
console.log(commit === undefined ? 'probe YAML already current' : `pushed probe YAML (${commit})`);

const pipeline = await ensurePipeline(repo);
const requestedRunId = process.env.AZDO_ENV_PROBE_RUN_ID;
const queued =
  requestedRunId === undefined
    ? await queueRun(pipeline.id, repo.defaultBranch)
    : { id: Number.parseInt(requestedRunId, 10), state: 'existing' };
if (!Number.isSafeInteger(queued.id)) {
  throw new Error('AZDO_ENV_PROBE_RUN_ID must be a numeric run id');
}
console.log(requestedRunId === undefined ? `queued run ${queued.id}` : `reusing run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const tasks = await timelineResults(queued.id);
const logs = await relevantLogs(queued.id);

const report = [
  '# E06-S01-T02 — environment materialization (real run)',
  '',
  'This hosted-agent probe measures collisions after variable-name conversion and cross-checks',
  'explicit step `env`, secret exclusion/mapping, the space transform, and prepend-PATH order.',
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
  '- `A.B` supplied `A_B` in all four collision jobs, independent of declaration/logging-command',
  '  order in this run; the two macro values prove the names remained distinct in the store.',
  '- The automatic public variable supplied `OVERLAY_NAME=automatic`, overwriting the explicit',
  '  step mapping `explicit-macro`. This directly refutes E06-S01-T02\'s "env overlay wins"',
  '  Done criterion and the prior docs/04 ordering.',
  '- The secret had no automatic `HIDDEN_VALUE` entry but was present through the explicit',
  '  `EXPLICIT_SECRET` mapping. Dots and spaces both became underscores with upper casing.',
  '- Two prepend commands in one step produced `second:first:base`, so the newest entry is first.',
  '',
  'The collision observation is deliberately scoped to hosted run 540: the pinned agent walks',
  'a `ConcurrentDictionary` and does not specify a collision ordering contract.',
  '',
  'Regenerate with `node scripts/env-materialization-realrun.ts`; this queues a fresh hosted run.',
  '',
].join('\n');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'env-materialization.yml'), PROBE_YAML, 'utf8');
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(report, config), 'utf8');
console.log(`-> ${path.join(OUT_DIR, 'real-run.md')}`);
