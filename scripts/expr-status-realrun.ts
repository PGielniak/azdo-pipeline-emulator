// E02-S03-T03 grounding — the one status-function cell no other source can answer.
//
// `preview` never evaluates status functions, and the *job-level* status engine is server-side and
// closed (`azure-pipelines-agent`'s ExpressionManager.cs covers the step level only). The docs
// state what `succeeded()` does for succeeded and failed dependencies but never say what happens
// when a dependency is **Skipped** — they only hint, by spelling `'Skipped'` out explicitly in
// every `dependencies.<x>.result` example and by recommending `not(canceled())` "when previous
// jobs in the dependency graph are skipped". That hint is not a measurement, so this script makes
// one: it queues a real run whose every job is agentless and reads the answer off the timeline.
//
// **Why this costs no hosted-agent parallelism.** Every job in the probe pipeline declares
// `pool: server`, so it executes on the orchestrator. `Delay@1` with 0 minutes is the shortest
// always-succeeding server task. The datum is each probe job's own *result*: a job whose condition
// evaluated False is `Skipped`, one whose condition evaluated True is `Succeeded`. Nothing is
// echoed and no log is read.
//
// Owner-facing note: alongside `oracle-provision.ts` this is the only script that writes to the
// org — it pushes one file under `/experiments/` and creates one extra pipeline definition
// (`oracle-status-probe`), both idempotent, then queues runs. Listed in the runbook cleanup set.
//
// Run: node scripts/expr-status-realrun.ts
// Output: research/experiments/E02-status/real-run.md (redacted)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-status');
const PROBE_LOCAL = path.join(OUT_DIR, 'status-skipped.yml');
const PROBE_REPO_PATH = '/experiments/status-skipped.yml';
const PIPELINE_NAME = 'oracle-status-probe';
/** Long enough for agentless jobs (seconds in practice), short enough to fail loudly. */
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const org = config.orgUrl.replace(/\/+$/, '');
const project = encodeURIComponent(config.project);

async function api(
  route: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${org}/${project}/_apis/${route}`, {
    ...init,
    redirect: 'manual', // an invalid PAT answers 302 to a sign-in page, not 401 (C-E00-025)
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

function require2xx(what: string, res: { status: number; text: string }): void {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${what} failed: HTTP ${res.status} ${redact(res.text, config).slice(0, 400)}`);
  }
}

interface PipelineRef {
  readonly id: number;
  readonly name: string;
}

/** Find the probe pipeline, or create it pointing at the file just pushed. Idempotent. */
async function ensurePipeline(repo: RepoRef): Promise<PipelineRef> {
  const list = await api('pipelines?api-version=7.1-preview.1');
  require2xx('list pipelines', list);
  const existing = (list.body as { value?: PipelineRef[] }).value?.find(
    (p) => p.name === PIPELINE_NAME,
  );
  if (existing !== undefined) {
    console.log(`pipeline ${PIPELINE_NAME} already exists (id ${existing.id})`);
    return existing;
  }

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
  const pipeline = created.body as PipelineRef;
  console.log(`created pipeline ${PIPELINE_NAME} (id ${pipeline.id})`);
  return pipeline;
}

interface RunRef {
  readonly id: number;
  readonly state: string;
  readonly result?: string;
}

async function queueRun(pipelineId: number, refName: string): Promise<RunRef> {
  const res = await api(`pipelines/${pipelineId}/runs?api-version=7.1-preview.1`, {
    method: 'POST',
    body: JSON.stringify({ resources: { repositories: { self: { refName } } } }),
  });
  require2xx('queue run', res);
  return res.body as RunRef;
}

async function pollRun(pipelineId: number, runId: number): Promise<RunRef> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const res = await api(`pipelines/${pipelineId}/runs/${runId}?api-version=7.1-preview.1`);
    require2xx('get run', res);
    const run = res.body as RunRef;
    console.log(`  run ${runId}: state=${run.state} result=${run.result ?? '-'}`);
    if (run.state === 'completed') return run;
    if (Date.now() > deadline) throw new Error(`run ${runId} did not complete in time`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

interface TimelineRecord {
  readonly type: string;
  readonly name: string;
  readonly identifier?: string;
  readonly state?: string;
  readonly result?: string;
  readonly order?: number;
}

/**
 * **Phase** records, not Job records — this distinction is the whole experiment.
 *
 * A `Job` record exists only for a job that actually materialized, so a job whose condition
 * evaluated False is simply absent from that layer and "absent" would be indirect evidence. The
 * `Phase` layer carries one record per YAML job either way, with an explicit
 * `result: skipped | succeeded`, keyed by the YAML job name in `identifier`. That result *is* the
 * value the condition evaluated to.
 */
async function phaseResults(
  runId: number,
): Promise<{ phases: TimelineRecord[]; materialized: Set<string> }> {
  const res = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', res);
  const records = (res.body as { records?: TimelineRecord[] }).records ?? [];
  const phases = records
    .filter((r) => r.type === 'Phase')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  // Job identifiers are stage-qualified (`<job>.<stage>`); strip the stage to compare with phases.
  const materialized = new Set(
    records
      .filter((r) => r.type === 'Job')
      .map((r) => (r.identifier ?? r.name).replace(/\.[^.]*$/, '')),
  );
  return { phases, materialized };
}

/** The `condition:` each job carried, read back out of the probe YAML for the report. */
function conditionsByJob(yamlText: string): Map<string, string> {
  const doc = parse(yamlText) as { jobs?: { job?: string; condition?: unknown }[] };
  const map = new Map<string, string>();
  for (const job of doc.jobs ?? []) {
    if (typeof job.job === 'string') {
      map.set(job.job, job.condition === undefined ? '(none — default)' : String(job.condition));
    }
  }
  return map;
}

// ---- run --------------------------------------------------------------------------------------

const probeYaml = await readFile(PROBE_LOCAL, 'utf8');
const repo = await defaultRepository(config);
const refName = repo.defaultBranch;

const commit = await syncFiles(
  config,
  repo,
  refName,
  '/experiments',
  [{ path: PROBE_REPO_PATH, content: probeYaml }],
  'E02-S03-T03 status-function real-run probe',
);
console.log(commit === undefined ? 'probe file already current' : `pushed probe file (${commit})`);

const pipeline = await ensurePipeline(repo);
const queued = await queueRun(pipeline.id, refName);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const { phases, materialized } = await phaseResults(queued.id);

const conditions = conditionsByJob(probeYaml);
const nameOf = (record: TimelineRecord): string => record.identifier ?? record.name;

for (const phase of phases) {
  const id = nameOf(phase);
  console.log(
    `  ${id.padEnd(34)} ${String(phase.result).padEnd(10)} ` +
      `condition=${phase.result === 'skipped' ? 'False' : 'True'}`,
  );
}

const body = [
  '# E02-S03-T03 — job status functions over a SKIPPED dependency (real run)',
  '',
  'The only E02 experiment that is a **run**, not a preview. Preview never evaluates status',
  'functions and the job-level engine is server-side and closed, so the behaviour of',
  '`succeeded()` / `succeededOrFailed()` when a dependency was *skipped* — the cell the docs only',
  'hint at — can be measured no other way.',
  '',
  'Every job is agentless (`pool: server`, one `Delay@1` of 0 minutes), so the run consumes no',
  'hosted-agent parallelism. **The datum is each job’s own result**: `skipped` means its',
  'condition evaluated False, `succeeded` means it evaluated True. No log is read.',
  '',
  'The results below come from the timeline’s **Phase** records, not its Job records. A `Job`',
  'record exists only for a job that actually materialized, so a job whose condition was False is',
  'simply missing from that layer — "absent" would be indirect evidence. The `Phase` layer carries',
  'one record per YAML job either way, with an explicit result, so each row is a direct reading of',
  'what the condition evaluated to. The `materialized` column shows whether a `Job` record also',
  'appeared, and agrees with the phase result on every row.',
  '',
  `- Probe pipeline: \`${PIPELINE_NAME}\` → \`${PROBE_REPO_PATH}\` (source of truth:`,
  `  \`${PROBE_LOCAL}\`, pushed by the script)`,
  `- Run: id ${finished.id}, state \`${finished.state}\`, result \`${finished.result ?? '-'}\``,
  '',
  'Regenerate with `pnpm expr-status-realrun` (queues a fresh run; results are expected to be',
  'identical run to run).',
  '',
  '| job | condition | phase result | condition evaluated | job record? | what it settles |',
  '|---|---|---|---|---|---|',
];

/** Reader-facing note per job, written here rather than in the YAML so the YAML stays runnable. */
const SETTLES: Record<string, string> = {
  dep_skipped: 'the dependency under test — `condition: false` makes it Skipped without an agent',
  dep_ok: 'the control dependency',
  skipped_succeeded: '**the headline cell**: `succeeded()` over a skipped dependency',
  skipped_succeeded_named: 'same, with the dependency named explicitly',
  skipped_succeededorfailed:
    '`succeededOrFailed()` over a skipped dependency — the docs recommend `not(canceled())` here, implying this is False',
  skipped_succeededorfailed_named: 'same, with the dependency named explicitly',
  skipped_failed: '`failed()` over a skipped dependency — Skipped is not Failed, but measure it',
  skipped_failed_named: 'same, with the dependency named explicitly',
  skipped_always: '`always()` is documented as unconditionally True; confirms the run is healthy',
  skipped_canceled: '`canceled()` in a run that was never canceled',
  skipped_not_canceled: 'the replacement the docs recommend for the skipped-dependency case',
  skipped_result_is_skipped:
    'independent confirmation that the dependency really did record `Skipped`',
  ok_succeeded: 'control: `succeeded()` over a succeeded dependency',
  ok_failed: 'control: `failed()` over a succeeded dependency',
  ok_succeededorfailed:
    'control: `succeededOrFailed()` over a succeeded dependency — the commonest real-world case, measured rather than inferred from the mixed row',
  ok_canceled: 'control: `canceled()` over a succeeded dependency',
  mixed_succeeded: '`succeeded()` over {Succeeded, Skipped} — all-of vs any-of',
  mixed_succeededorfailed:
    '`succeededOrFailed()` over {Succeeded, Skipped} — the docs say "True whether **any** of those jobs succeeded or failed", which a one-dependency probe cannot test',
  mixed_succeeded_named_ok:
    'do arguments **narrow** the set? names only the succeeded dependency while a skipped one is still in the graph',
  mixed_succeededorfailed_named_ok: 'same question for `succeededOrFailed`',
  mixed_succeeded_named_both:
    'names both dependencies explicitly — should match the no-argument form',
  mixed_not_canceled: 'the recommended replacement, over a mixed graph',
  dep_abandon:
    'an attempt to fail a job without an agent: `gt` errors on an unconvertible operand (C-E02-022) and a condition that throws is evaluated orchestrator-side. It does **not** produce Failed — the result is `abandoned`, a sixth TaskResult the docs never list',
  abandon_succeeded: '`succeeded()` over an abandoned dependency',
  abandon_failed:
    '`failed()` over an **abandoned** dependency — False, so an errored condition is not "failed"',
  abandon_failed_named: 'same, with the dependency named explicitly',
  abandon_succeededorfailed: '`succeededOrFailed()` over an abandoned dependency',
  abandon_always: '`always()` over an abandoned dependency',
  abandon_canceled: '`canceled()` over an abandoned dependency, in a run that was never canceled',
  abandon_result: 'confirms `dependencies.<x>.result` is not `Failed` for an abandoned job',
  dep_fail: 'a genuinely Failed dependency: the server task itself errors on an unparseable input',
  fail_succeeded: '`succeeded()` over a failed dependency',
  fail_failed: '`failed()` over a failed dependency',
  fail_failed_named: 'same, with the dependency named explicitly',
  fail_succeededorfailed:
    '`succeededOrFailed()` over a failed dependency — the Failed half of its name',
  fail_always: '`always()` over a failed dependency',
  fail_result_is_failed: 'independent confirmation that the dependency really did record `Failed`',
  nodep_succeeded:
    'a job with no dependencies: all-of over an empty set. The conditions doc says such a job runs by default, so this should be True',
  nodep_succeededorfailed:
    'the same for `succeededOrFailed`, whose rule is any-of (C-E02-068) — any-of over an empty set would be False, which would make a dependency-free job with this condition never run',
  nodep_failed: 'any-of over an empty set for `failed`',
  case_named:
    'the dependency name argument in the wrong case — decides whether the lookup folds case, which C-E02-027 showed differs per context',
  unknown_named:
    'a name that is not a dependency at all — preview accepts it, so the runtime verdict decides whether the emitter must validate names itself',
};

for (const phase of phases) {
  const id = nameOf(phase);
  const evaluated = phase.result === 'skipped' ? '**False**' : '**True**';
  body.push(
    `| \`${id}\` | \`${conditions.get(id) ?? '(unknown)'}\` | ${phase.result ?? phase.state} | ` +
      `${evaluated} | ${materialized.has(id) ? 'yes' : 'no'} | ${SETTLES[id] ?? ''} |`,
  );
}
body.push('');

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, 'real-run.md'), redact(body.join('\n'), config), 'utf8');
console.log(`\n-> ${path.join(OUT_DIR, 'real-run.md')}`);
