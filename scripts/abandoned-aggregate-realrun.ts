// E11-S04-T07 grounding — does an ABANDONED node move the *run* result?
//
// A stage or job whose condition errors completes `Abandoned` (C-E02-071). Our runtime records
// that state (C-E12-051), but `azdo_run_result` folds only *step* results, so locally the run
// aggregates as if the abandoned node were not there and `azdo_run_exit_code` returns 0. The
// exit-code contract is ours (docs/04 §3 + decision 56), which is a reason to decide it
// deliberately — not a reason to invent it when the service can be asked.
//
// The same run settles C-E12-052's `VERIFY`: a stage holding one skipped job and one abandoned job
// has a result, and that result says which of the two wins the fold.
//
// **Why this costs no hosted-agent parallelism.** Every job declares `pool: server`, so the
// orchestrator executes it. `Delay@1` with 0 minutes is the shortest always-succeeding server
// task. Every datum is a `result` on the timeline; nothing is echoed and no log is read.
//
// **The control is in the same run.** A run result only means something once the abandonment is
// shown to have happened, so `bad_stage`'s own record is read first: if it is not `abandoned`, the
// probe measured nothing and the script says so rather than reporting a tidy number.
//
// Owner-facing note: like `expr-status-realrun.ts` this writes to the org — one file under
// `/experiments/` and one extra pipeline definition (`oracle-abandon-probe`), both idempotent.
// Both are listed in the runbook cleanup set (`research/oracle-setup.md`).
//
// Run: node scripts/abandoned-aggregate-realrun.ts
// Output: research/experiments/E12-abandoned-aggregate/real-run.md (redacted)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { authorizationHeader, configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

const OUT_DIR = path.join('research', 'experiments', 'E12-abandoned-aggregate');

/**
 * Two probes, because the first one could not answer its own question.
 *
 * `aggregate` came back `failed` at run scope — but it also contained two stages that were
 * themselves `failed` (an abandoned job folds into its stage as Failed, measured in run 551), so a
 * service that ignored abandonment entirely would have reported `failed` just the same. `stage-only`
 * removes every failed stage, leaving one succeeded, one skipped and one abandoned, so its run
 * result is attributable to the abandoned stage alone. Both are kept: the first carries the fold
 * cells, the second carries the run cell.
 */
const PROBES = {
  aggregate: {
    file: 'abandoned-aggregate.yml',
    pipeline: 'oracle-abandon-probe',
    report: 'real-run.md',
  },
  'stage-only': {
    file: 'abandoned-stage-only.yml',
    pipeline: 'oracle-abandon-stage-probe',
    report: 'real-run-stage-only.md',
  },
} as const;

const probeArg = process.argv.includes('--probe')
  ? process.argv[process.argv.indexOf('--probe') + 1]
  : 'aggregate';
if (probeArg === undefined || !(probeArg in PROBES)) {
  throw new Error(`--probe must be one of: ${Object.keys(PROBES).join(', ')}`);
}
const probe = PROBES[probeArg as keyof typeof PROBES];

const PROBE_LOCAL = path.join(OUT_DIR, probe.file);
const PROBE_REPO_PATH = `/experiments/${probe.file}`;
const PIPELINE_NAME = probe.pipeline;
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
  readonly parentId?: string;
  readonly id?: string;
}

/**
 * Every record, unfiltered.
 *
 * The sibling harness (`expr-status-realrun.ts`) filters to `Phase` because its probe is
 * `jobs:`-at-root; this probe is `stages:`, a shape that harness has never driven, and stage
 * results live in a record type it does not touch. So the layers are discovered from the run
 * rather than assumed, and the report prints them all — a wrong guess about which layer carries
 * the datum is exactly the kind of error a tidy filter would hide.
 */
async function timeline(runId: number): Promise<TimelineRecord[]> {
  const res = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', res);
  const records = (res.body as { records?: TimelineRecord[] }).records ?? [];
  return [...records].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

const nameOf = (r: TimelineRecord): string => r.identifier ?? r.name;

// ---- run ----------------------------------------------------------------------------------------

const probeYaml = await readFile(PROBE_LOCAL, 'utf8');
const repo = await defaultRepository(config);
const refName = repo.defaultBranch;

const commit = await syncFiles(
  config,
  repo,
  refName,
  '/experiments',
  [{ path: PROBE_REPO_PATH, content: probeYaml }],
  'E11-S04-T07 abandoned-node run-aggregate probe',
);
console.log(commit === undefined ? 'probe file already current' : `pushed probe file (${commit})`);

const pipeline = await ensurePipeline(repo);
const queued = await queueRun(pipeline.id, refName);
console.log(`queued run ${queued.id}`);
const finished = await pollRun(pipeline.id, queued.id);
const records = await timeline(queued.id);

console.log('\n--- timeline records ---');
for (const r of records) {
  console.log(
    `  ${r.type.padEnd(12)} ${nameOf(r).padEnd(30)} state=${String(r.state).padEnd(11)} result=${String(r.result)}`,
  );
}

const stages = records.filter((r) => r.type === 'Stage');
const byName = (rs: TimelineRecord[], id: string): TimelineRecord | undefined =>
  rs.find((r) => nameOf(r).toLowerCase() === id.toLowerCase());

// The control, asserted before the datum is reported at all.
const badStage = byName(stages, 'bad_stage');
const controlHeld = badStage?.result === 'abandoned';
console.log(
  `\ncontrol: bad_stage result=${String(badStage?.result)} -> ${controlHeld ? 'HELD' : '**DID NOT HOLD — the run result below measures nothing**'}`,
);
console.log(`datum:   run result=${String(finished.result)}`);

const body = [
  '# E11-S04-T07 — does an abandoned node move the run result? (real run)',
  '',
  'A stage or job whose condition *errors* completes `Abandoned` (C-E02-071). Our runtime records',
  'that state (C-E12-051), but `azdo_run_result` folds only **step** results, so locally the run',
  'aggregates as if the abandoned node were not there and `azdo_run_exit_code` returns 0. The',
  'exit-code contract is ours (docs/04 §3 + docs/06 §5 decision 56) — which is a reason to decide',
  'it deliberately, not a reason to invent it while the service can be asked.',
  '',
  'Every job is agentless (`pool: server`, one `Delay@1` of 0 minutes), so the run consumes no',
  'hosted-agent parallelism and finishes in seconds. **Every datum is a `result` on the timeline**;',
  'nothing is echoed and no log is read.',
  '',
  '**The control is in the same run.** A run result means nothing until the abandonment is shown to',
  'have happened, so `bad_stage`’s own record is read first. If it is not `abandoned`, this probe',
  'measured nothing — the script says so instead of reporting a tidy number.',
  '',
  `- Probe pipeline: \`${PIPELINE_NAME}\` → \`${PROBE_REPO_PATH}\` (source of truth:`,
  `  \`${PROBE_LOCAL}\`, pushed by the script)`,
  `- Run: id ${finished.id}, state \`${finished.state}\`, **result \`${finished.result ?? '-'}\`**`,
  `- Control (\`bad_stage\` is really abandoned): **${controlHeld ? 'held' : 'DID NOT HOLD'}**`,
  '',
  `Regenerate with \`pnpm abandoned-aggregate-realrun${probeArg === 'aggregate' ? '' : ` --probe ${probeArg}`}\` (queues a fresh run).`,
  '',
  '## Stage records',
  '',
  '| stage | condition | result | what it settles |',
  '|---|---|---|---|',
];

const STAGE_SETTLES: Record<string, [string, string]> = {
  ok: [
    '(none — default)',
    'the control: a stage that plainly succeeds, so the run has something good in it',
  ],
  mixed: [
    '(none — default)',
    '**C-E12-052**: one skipped job + one abandoned job — which wins the stage fold?',
  ],
  all_abandoned: [
    '(none — default)',
    'what an abandoned job contributes **on its own**, so the fold rule is measured rather than inferred by subtracting `mixed`',
  ],
  bad_stage: [
    "gt(1, 'not-a-number')",
    '**the control for the run datum**: is a *stage* whose own condition errors `abandoned` too? C-E02-071 measured a **job**',
  ],
  skipped_stage: ['false', 'the contrast the whole task is about: conditioned out, not errored'],
};

for (const stage of stages) {
  const id = nameOf(stage);
  const [condition, settles] = STAGE_SETTLES[id.toLowerCase()] ?? ['—', ''];
  body.push(`| \`${id}\` | \`${condition}\` | \`${stage.result}\` | ${settles} |`);
}

body.push(
  '',
  '## Every timeline record',
  '',
  'Unfiltered on purpose: which layer carries the datum is discovered here rather than assumed.',
  'The sibling harness reads `Phase` records because its probe is `jobs:`-at-root; this probe is',
  '`stages:`, a shape that harness has never driven.',
  '',
  '| type | identifier | state | result |',
  '|---|---|---|---|',
  ...records.map(
    (r) => `| \`${r.type}\` | \`${nameOf(r)}\` | \`${r.state}\` | \`${r.result ?? '-'}\` |`,
  ),
  '',
);

await mkdir(OUT_DIR, { recursive: true });
await writeFile(path.join(OUT_DIR, probe.report), redact(body.join('\n'), config), 'utf8');
console.log(`\nwrote ${path.join(OUT_DIR, probe.report)}`);
