// L6 — the real-run harness (E11-S05-T01).
//
// Every tier below this one compares the emulator against *itself*: L1/L2 test modules, L4 tests
// the runtime's helpers, L5 runs a generated project in a controlled image and asserts a manifest
// we wrote. None of them can tell a faithful emulation from a confidently wrong one. This tier
// runs **the same fixture on the real service and locally**, extracts the same three classes of
// fact from each, and diffs them.
//
// The fixture is `fixtures/e2e/01-shell-artifacts/`, **shared with L5 and read from its own
// directory rather than copied**, so the two tiers cannot drift apart. It is template-free
// (C-E12-028) — no `${{ }}` — so the local side needs no expansion service, and it already carries
// all three fact classes plus a negative: a job that must *not* run.
//
// The three facts, and why these three:
//   - **step results sequence** — the emulator's job is to reach the same per-step outcome in the
//     same order. Compared by (job, ordinal) rather than by display name, because an unnamed step
//     is named differently on each side and a name-keyed compare would silently drop the pair.
//   - **markers** — the fixture's `E2E-MARKER` lines are its variable dump: pipeline/stage/job
//     variable precedence, a cross-job output variable, and the downloaded artifact's content.
//     Compared as an exact set, so an extra or missing line is a failure, not a near-miss.
//   - **artifact contents** — sha256 per relative path. Never archive bytes: the service returns a
//     zip whose compression and timestamps guarantee a byte compare can never match.
//
// **The comparator's first job is proving it compared the right rows.** A service timeline carries
// records with no local counterpart (job initialization, the implicit checkout, post-job cleanup).
// Dropping them by a loose rule would also drop a real authored step whose name shifted, and the
// report would then claim a parity that does not exist. So the dropped set is listed by exact
// name, the count is asserted, and **an unrecognized record fails the run rather than being
// dropped**.
//
// Owner-facing note: unlike every earlier probe in this repo, this one **consumes hosted-agent
// parallelism** — the fixture declares `vmImage: ubuntu-latest` and cannot be agentless, because
// artifacts and step logs are the point. One file under `/e2e/` and one pipeline definition
// (`oracle-l6-shell-artifacts`), both idempotent, both in the runbook cleanup set.
//
// Run: `pnpm realrun [--local-only] [--keep]`
// Output: research/experiments/E11-realrun/report.md (redacted)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { parse } from 'yaml';

export const FIXTURE = path.join('fixtures', 'e2e', '01-shell-artifacts', 'azure-pipelines.yml');
export const ARTIFACT_NAME = 'drop';
export const OUT_DIR = path.join('research', 'experiments', 'E11-realrun');

/**
 * Timeline records the service creates that no authored step corresponds to.
 *
 * Pinned by **exact name** from the committed capture under `OUT_DIR`, so this list can be checked
 * against its source. A name in neither this set nor the authored steps is an error, never a drop:
 * see `partitionServiceSteps`.
 *
 * **`Checkout` and `Download Pipeline Artifact` are deliberately absent.** Both look agent-internal
 * and in this fixture both are *authored* — `verify` declares `checkout: none` and
 * `download: current`, neither with a `displayName`. Listing them here silently deleted two real
 * steps and shifted every later ordinal in that job; the harness reported a clean four-row
 * comparison over the wrong rows (C-E12-058). Only the implicit checkout is internal, and it is
 * distinguishable by shape: it names a repo and a target path (`isCheckoutRecord`).
 */
export const AGENT_INTERNAL_STEPS: readonly string[] = [
  'Initialize job',
  'Finalize Job',
  'Report build status',
  // The post-job twin of an authored `checkout: none`. Bare, because there is no repo to name —
  // and it is internal while the bare `Checkout` beside it is the *authored* step. Measured from
  // run 553; the pair is the sharpest case for why this list is names and not a prefix rule.
  'Post-job: Checkout',
];

/**
 * The checkout records, whose name embeds the repository and target path
 * (`Checkout <repo>@<ref> to <dir>`, and its `Post-job:` twin). A pattern rather than a literal
 * because the variable half is the *oracle repo's* name, which must not be pinned into source —
 * but deliberately anchored, so it cannot swallow an authored step.
 */
export function isCheckoutRecord(name: string): boolean {
  return /^(Post-job: )?Checkout \S+@\S+ to \S+$/.test(name);
}

export interface StepFact {
  /** The YAML job name, so the key survives a display-name change on either side. */
  readonly job: string;
  /** Position within the job's authored step list, 0-based. */
  readonly ordinal: number;
  readonly displayName: string;
  readonly result: string;
}

export interface ArtifactFact {
  readonly path: string;
  readonly sha256: string;
}

export interface RunFacts {
  readonly steps: readonly StepFact[];
  readonly markers: readonly string[];
  readonly artifacts: readonly ArtifactFact[];
  /**
   * Jobs that did **not** run, by name.
   *
   * Without this the fixture's negative — a job whose condition must keep it from running — is
   * never actually compared: it contributes no steps on either side, so a union-keyed comparison
   * has nothing to iterate and reports parity by *mutual absence*. That is the same error the
   * unexpected-record guard exists to prevent, on the negative side. Both sides record the fact
   * directly and neither needs folding: the service writes a `Phase` record with `result: skipped`,
   * the local runtime writes a `.job-result` marker (E11-S04-T06).
   */
  readonly skippedJobs: readonly string[];
}

// ---- fixture ------------------------------------------------------------------------------------

export interface AuthoredJob {
  readonly job: string;
  readonly stepNames: readonly (string | undefined)[];
}

/**
 * The authored jobs and their step display names, straight from the fixture.
 *
 * `undefined` where a step declares no `displayName` — the two such steps here (`checkout: none`
 * and `download: current`) are exactly the pair that cannot be name-matched across sides, which is
 * why the comparison key is positional.
 */
export function authoredJobs(yamlText: string): readonly AuthoredJob[] {
  const doc = parse(yamlText) as {
    stages?: { jobs?: { job?: string; steps?: Record<string, unknown>[] }[] }[];
  };
  const jobs: AuthoredJob[] = [];
  for (const stage of doc.stages ?? []) {
    for (const job of stage.jobs ?? []) {
      if (typeof job.job !== 'string') continue;
      jobs.push({
        job: job.job,
        stepNames: (job.steps ?? []).map((s) =>
          typeof s['displayName'] === 'string' ? s['displayName'] : undefined,
        ),
      });
    }
  }
  return jobs;
}

// ---- local side ---------------------------------------------------------------------------------

/**
 * One summary record per step: scope, id, display, result, duration, log path — one field per
 * line, in completion order (`azdo_summary_record`). The scope is `job-<name>`, which is how a
 * local row is attributed to its YAML job.
 */
export function parseLocalSummary(dir: string): readonly StepFact[] {
  const perJob = new Map<string, number>();
  const facts: StepFact[] = [];
  const files = readdirSync(dir)
    .filter((f) => /^[0-9]+$/.test(f))
    .sort();
  for (const file of files) {
    const [scope, , display, result] = readFileSync(path.join(dir, file), 'utf8').split('\n');
    const job = (scope ?? '').replace(/^job-/, '');
    const ordinal = perJob.get(job) ?? 0;
    perJob.set(job, ordinal + 1);
    facts.push({ job, ordinal, displayName: display ?? '', result: result ?? '' });
  }
  return facts;
}

// ---- service side -------------------------------------------------------------------------------

export interface TimelineRecord {
  readonly id?: string;
  readonly parentId?: string;
  readonly type: string;
  readonly name: string;
  readonly identifier?: string;
  readonly result?: string;
  readonly order?: number;
}

/** Jobs the service records as not having run: a `Phase` with a non-running result. */
export function serviceSkippedJobs(records: readonly TimelineRecord[]): readonly string[] {
  return [
    ...new Set(
      records
        .filter((r) => r.type === 'Phase' && ['skipped', 'abandoned'].includes(r.result ?? ''))
        .map((r) => r.name),
    ),
  ].sort();
}

export interface Partitioned {
  readonly steps: readonly StepFact[];
  readonly dropped: readonly string[];
  /** Records matching neither an authored step nor the pinned internal list. Never dropped. */
  readonly unexpected: readonly string[];
}

/**
 * Turn a service timeline into the same `StepFact[]` the local side produces.
 *
 * A `Task` record's parent is a `Job` record whose `identifier` is `<job>.<stage>`-ish; the YAML
 * job name is its first segment. Records are ordered within their job by `order`, and the ordinal
 * is assigned after the internal records are removed — so ordinals line up with the authored list.
 */
export function partitionServiceSteps(
  records: readonly TimelineRecord[],
  authored: readonly AuthoredJob[],
): Partitioned {
  const jobNames = new Set(authored.map((j) => j.job.toLowerCase()));
  const authoredNames = new Set(
    authored.flatMap((j) => j.stepNames.filter((n): n is string => n !== undefined)),
  );
  const internal = new Set(AGENT_INTERNAL_STEPS);

  // A `Job` record's `name` **is** the YAML job name; its `identifier` is
  // `<stage>.<job>.__default`, so the job is the *middle* segment there, not the first (measured
  // from run 553 — the first segment is the stage, and reading it as the job attributed every
  // Task to a job that does not exist, which the harness reported as 12 unrecognized records
  // rather than as a tidy empty comparison). `name` is used, `identifier` is the cross-check.
  const jobOf = new Map<string, string>();
  for (const r of records) {
    if (r.type !== 'Job' || r.id === undefined) continue;
    if (jobNames.has(r.name.toLowerCase())) jobOf.set(r.id, r.name);
  }

  const dropped: string[] = [];
  const unexpected: string[] = [];
  const kept = new Map<string, TimelineRecord[]>();

  for (const r of records) {
    if (r.type !== 'Task') continue;
    const job = r.parentId === undefined ? undefined : jobOf.get(r.parentId);
    if (job === undefined) {
      // A Task whose parent is not one of the fixture's jobs. Not silently ignored either.
      unexpected.push(`${r.name} (parent is not a fixture job)`);
      continue;
    }
    if (internal.has(r.name) || isCheckoutRecord(r.name)) {
      dropped.push(r.name);
      continue;
    }
    if (!authoredNames.has(r.name) && !isUnnamedStepName(r.name)) {
      unexpected.push(`${r.name} (in job ${job})`);
      continue;
    }
    kept.set(job, [...(kept.get(job) ?? []), r]);
  }

  // **Grouped before sorting, never after.** `order` restarts at 1 inside each job, so a single
  // global sort interleaves two jobs' steps and every ordinal after the first is then attached to
  // the wrong step — a comparator that would report differences where there are none, and miss
  // real ones. Caught by the ordinal test rather than by reading the API docs.
  const steps: StepFact[] = [];
  for (const [job, list] of kept) {
    [...list]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((r, ordinal) => {
        steps.push({ job, ordinal, displayName: r.name, result: r.result ?? '' });
      });
  }
  return { steps, dropped, unexpected };
}

/**
 * The service's own name for a step the author left unnamed.
 *
 * `checkout: none` and `download: current` carry no `displayName`, so each side invents one — the
 * service uses a readable phrase, the emitter a GUID (C-E12-057). Recognized here so the pair is
 * *compared* rather than reported as an unexpected record; the names themselves are a reported
 * difference, not a matching key.
 */
export function isUnnamedStepName(name: string): boolean {
  return /^(Checkout|Download|Bash|CmdLine|Command[Ll]ine|Script)\b/.test(name);
}

/** Jobs the local runtime records as not having run, from the `.job-result` markers it writes. */
export function localSkippedJobs(resultsDir: string): readonly string[] {
  const jobs: string[] = [];
  let stages: readonly string[];
  try {
    stages = readdirSync(resultsDir);
  } catch {
    // No results tree at all — a run that never started. Nothing skipped, rather than an error.
    return jobs;
  }
  for (const stage of stages) {
    const stageDir = path.join(resultsDir, stage);
    if (!statSync(stageDir).isDirectory()) continue;
    for (const job of readdirSync(stageDir)) {
      const marker = path.join(stageDir, job, '.job-result');
      try {
        if (['Skipped', 'Abandoned'].includes(readFileSync(marker, 'utf8').trim())) jobs.push(job);
      } catch {
        // No marker: the job ran. Its steps are the comparison.
      }
    }
  }
  return jobs.sort();
}

// ---- comparison ---------------------------------------------------------------------------------

export interface Difference {
  readonly fact: string;
  readonly service: string;
  readonly local: string;
}

export interface Comparison {
  readonly parity: boolean;
  readonly differences: readonly Difference[];
  readonly compared: number;
}

const key = (s: StepFact): string => `${s.job}[${s.ordinal}]`;

export function compareFacts(
  service: RunFacts,
  local: RunFacts,
  forbiddenMarkers: readonly string[] = [],
): Comparison {
  const differences: Difference[] = [];
  let compared = 0;

  // The negative, asserted rather than inferred from an empty union. A marker the fixture says
  // must never be printed is checked *present-or-absent on each side*, so "neither side has it"
  // is a measurement with a row in the report instead of silence.
  for (const marker of forbiddenMarkers) {
    compared += 1;
    const onService = service.markers.includes(marker);
    const onLocal = local.markers.includes(marker);
    if (onService || onLocal) {
      differences.push({
        fact: `forbidden marker ${JSON.stringify(marker)} must not appear`,
        service: onService ? '**present**' : 'absent',
        local: onLocal ? '**present**' : 'absent',
      });
    }
  }

  // And the job that carries it: both sides must agree on *which* jobs did not run.
  const serviceSkipped = [...service.skippedJobs].sort().join(', ');
  const localSkipped = [...local.skippedJobs].sort().join(', ');
  compared += 1;
  if (serviceSkipped !== localSkipped) {
    differences.push({
      fact: 'jobs that did not run',
      service: serviceSkipped === '' ? '(none)' : serviceSkipped,
      local: localSkipped === '' ? '(none)' : localSkipped,
    });
  }

  // Step results, keyed positionally within the job.
  const localSteps = new Map(local.steps.map((s) => [key(s), s]));
  const serviceSteps = new Map(service.steps.map((s) => [key(s), s]));
  for (const k of new Set([...serviceSteps.keys(), ...localSteps.keys()])) {
    compared += 1;
    const s = serviceSteps.get(k);
    const l = localSteps.get(k);
    if (s === undefined || l === undefined) {
      differences.push({
        fact: `step ${k} present`,
        service: s === undefined ? '(absent)' : s.displayName,
        local: l === undefined ? '(absent)' : l.displayName,
      });
      continue;
    }
    if (s.result.toLowerCase() !== l.result.toLowerCase()) {
      differences.push({ fact: `step ${k} result`, service: s.result, local: l.result });
    }
  }

  // Markers, as an exact set.
  const serviceMarkers = new Set(service.markers);
  const localMarkers = new Set(local.markers);
  for (const m of new Set([...serviceMarkers, ...localMarkers])) {
    compared += 1;
    if (serviceMarkers.has(m) === localMarkers.has(m)) continue;
    differences.push({
      fact: `marker ${JSON.stringify(m)}`,
      service: serviceMarkers.has(m) ? 'present' : '(absent)',
      local: localMarkers.has(m) ? 'present' : '(absent)',
    });
  }

  // Artifact contents, by relative path.
  const localArtifacts = new Map(local.artifacts.map((a) => [a.path, a.sha256]));
  const serviceArtifacts = new Map(service.artifacts.map((a) => [a.path, a.sha256]));
  for (const p of new Set([...serviceArtifacts.keys(), ...localArtifacts.keys()])) {
    compared += 1;
    const s = serviceArtifacts.get(p);
    const l = localArtifacts.get(p);
    if (s !== l) {
      differences.push({ fact: `artifact ${p}`, service: s ?? '(absent)', local: l ?? '(absent)' });
    }
  }

  return { parity: differences.length === 0, differences, compared };
}

// ---- shared helpers -----------------------------------------------------------------------------

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;

/**
 * The fixture's `E2E-MARKER` lines — its variable dump — from either side's log.
 *
 * **Anchored after the timestamp, not searched for as a substring.** A service job log embeds the
 * pipeline *source* and the template-evaluation trace, so every `echo "E2E-MARKER …"` in the YAML
 * appears in the log too (C-E12-060). A substring match collected those as if they were output,
 * and the set then differed from the local one on every row while both runs had in fact printed
 * exactly the same five lines. The service prefixes each line with an ISO timestamp; the local
 * runner does not; after stripping it, a real marker line *starts* with the marker.
 */
export function markersIn(text: string): readonly string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trimEnd().replace(TIMESTAMP, ''))
        .filter((line) => line.startsWith('E2E-MARKER')),
    ),
  ].sort();
}

export function hashTree(root: string): readonly ArtifactFact[] {
  const facts: ArtifactFact[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      facts.push({
        path: path.relative(root, full).split(path.sep).join('/'),
        sha256: createHash('sha256').update(readFileSync(full)).digest('hex'),
      });
    }
  };
  walk(root);
  return facts.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Strip the archive's own wrapper directory.
 *
 * A Pipeline Artifact zip contains `<artifactName>/…`, so every path would otherwise differ from
 * the local store's by that one segment. Measured from the real archive rather than assumed
 * (C-E12-059); if the prefix is ever absent the paths are returned unchanged.
 */
export function stripArtifactPrefix(
  facts: readonly ArtifactFact[],
  name: string,
): readonly ArtifactFact[] {
  const prefix = `${name}/`;
  if (!facts.every((f) => f.path.startsWith(prefix))) return facts;
  return facts.map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
}

// ---- local driver -------------------------------------------------------------------------------

export function runLocally(root = '.', keep = false): RunFacts {
  const work = mkdtempSync(path.join(tmpdir(), 'azdo-emu-l6-'));
  try {
    const project = path.join(work, 'proj');
    const cli = path.join(path.resolve(root), 'packages', 'cli', 'dist', 'bin.js');
    execFileSync(
      'node',
      [cli, 'convert', path.join(path.resolve(root), FIXTURE), '-o', project, '--offline-expand'],
      { encoding: 'utf8' },
    );
    writeFileSync(path.join(project, '.env'), readFileSync(path.join(project, '.env.example')));

    let log = '';
    try {
      log = execFileSync('bash', ['run.sh'], { cwd: project, encoding: 'utf8' });
    } catch (error) {
      log = (error as { stdout?: string }).stdout ?? '';
    }

    const state = path.join(project, '.work', 'run-1', 'state');
    return {
      steps: parseLocalSummary(path.join(state, 'summary')),
      markers: markersIn(log),
      artifacts: hashTree(path.join(project, '.artifacts', ARTIFACT_NAME)),
      skippedJobs: localSkippedJobs(path.join(state, 'results')),
    };
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

// ---- service driver -----------------------------------------------------------------------------

import {
  authorizationHeader,
  configFromEnv,
  redact,
  type OracleConfig,
} from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

const PROBE_REPO_PATH = '/e2e/01-shell-artifacts.yml';
const PIPELINE_NAME = 'oracle-l6-shell-artifacts';
/** A hosted run is minutes, not seconds — unlike every agentless probe in this repo. */
const POLL_TIMEOUT_MS = 1_200_000;
const POLL_INTERVAL_MS = 15_000;

interface ApiResult {
  readonly status: number;
  readonly body: unknown;
  readonly text: string;
}

function makeApi(config: OracleConfig) {
  const org = config.orgUrl.replace(/\/+$/, '');
  const project = encodeURIComponent(config.project);
  return async function api(route: string, init: RequestInit = {}): Promise<ApiResult> {
    const url = route.startsWith('https://') ? route : `${org}/${project}/_apis/${route}`;
    const response = await fetch(url, {
      ...init,
      redirect: 'manual', // a lapsed PAT answers 302 to a sign-in page, not 401 (C-E00-025)
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
  };
}

function require2xx(what: string, res: ApiResult, config: OracleConfig): void {
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${what} failed: HTTP ${res.status} ${redact(res.text, config).slice(0, 400)}`);
  }
}

export interface ServiceRun {
  readonly facts: RunFacts;
  readonly runId: number;
  readonly result: string;
  readonly records: readonly TimelineRecord[];
  readonly partition: Partitioned;
  readonly artifactRoute: string;
}

/* istanbul ignore next -- every line here is network I/O; the pure half above is what tests drive. */
export async function runOnService(
  authored: readonly AuthoredJob[],
  keep: boolean,
  reuseRunId?: number,
): Promise<ServiceRun> {
  const config = configFromEnv(await loadEnvFile('.env.oracle'));
  const api = makeApi(config);

  // Re-reading a finished run costs no agent minutes, so a change to the *extraction* — which is
  // where this harness's bugs actually live — never needs a new run. `--reuse-run <id>`.
  if (reuseRunId !== undefined) {
    console.log(`reusing completed run ${reuseRunId} (no agent minutes)`);
    return collectFromRun(api, config, reuseRunId, authored, keep);
  }

  // Pushed by reading the L5 fixture's own path — never a copy, so the two tiers cannot drift.
  const probeYaml = readFileSync(FIXTURE, 'utf8');
  const repo: RepoRef = await defaultRepository(config);
  const refName = repo.defaultBranch;
  await syncFiles(
    config,
    repo,
    refName,
    '/e2e',
    [{ path: PROBE_REPO_PATH, content: probeYaml }],
    'E11-S05-T01 L6 real-run fixture (shared with L5)',
  );

  const list = await api('pipelines?api-version=7.1-preview.1');
  require2xx('list pipelines', list, config);
  let pipeline = (list.body as { value?: { id: number; name: string }[] }).value?.find(
    (p) => p.name === PIPELINE_NAME,
  );
  if (pipeline === undefined) {
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
    require2xx('create pipeline', created, config);
    pipeline = created.body as { id: number; name: string };
  }
  console.log(`pipeline ${PIPELINE_NAME} (id ${pipeline.id})`);

  const queued = await api(`pipelines/${pipeline.id}/runs?api-version=7.1-preview.1`, {
    method: 'POST',
    body: JSON.stringify({ resources: { repositories: { self: { refName } } } }),
  });
  require2xx('queue run', queued, config);
  const runId = (queued.body as { id: number }).id;
  console.log(`queued run ${runId} (hosted — this spends agent minutes)`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let result: string;
  for (;;) {
    const res = await api(`pipelines/${pipeline.id}/runs/${runId}?api-version=7.1-preview.1`);
    require2xx('get run', res, config);
    const run = res.body as { state: string; result?: string };
    console.log(`  run ${runId}: state=${run.state} result=${run.result ?? '-'}`);
    if (run.state === 'completed') {
      result = run.result ?? '';
      break;
    }
    if (Date.now() > deadline) throw new Error(`run ${runId} did not complete in time`);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return collectFromRun(api, config, runId, authored, keep, result);
}

/** Everything read *off* a finished run: timeline, logs, artifact. No queueing, no minutes. */
/* istanbul ignore next -- network I/O. */
async function collectFromRun(
  api: (route: string, init?: RequestInit) => Promise<ApiResult>,
  config: OracleConfig,
  runId: number,
  authored: readonly AuthoredJob[],
  keep: boolean,
  knownResult?: string,
): Promise<ServiceRun> {
  let result = knownResult ?? '';
  if (knownResult === undefined) {
    const res = await api(`build/builds/${runId}?api-version=7.1`);
    require2xx('get build', res, config);
    result = (res.body as { result?: string }).result ?? '';
  }

  const timelineRes = await api(`build/builds/${runId}/timeline?api-version=7.1`);
  require2xx('get timeline', timelineRes, config);
  const records = (timelineRes.body as { records?: TimelineRecord[] }).records ?? [];
  const partition = partitionServiceSteps(records, authored);

  // Logs: one blob per build, which is enough — the markers are a set, not a per-step fact.
  const logsRes = await api(`build/builds/${runId}/logs?api-version=7.1`);
  require2xx('list logs', logsRes, config);
  const logIds = ((logsRes.body as { value?: { id: number }[] }).value ?? []).map((l) => l.id);
  let log = '';
  for (const id of logIds) {
    const one = await api(`build/builds/${runId}/logs/${id}?api-version=7.1`);
    if (one.status < 200 || one.status >= 300) continue;
    // Under `Accept: application/json` this route answers `{count, value: [line, …]}`, not plain
    // text — so the raw body is JSON and splitting it on newlines yields quoted fragments rather
    // than log lines (C-E12-060). Measured from run 553.
    const asJson = (one.body as { value?: unknown })?.value;
    log += Array.isArray(asJson) ? `${asJson.join('\n')}\n` : `${one.text}\n`;
  }

  const { artifacts, route } = await downloadArtifact(api, config, runId, keep);

  // The capture is written before anything is compared, and is the reason one hosted run is
  // enough. Pinning `AGENT_INTERNAL_STEPS` needs the real record names, which are only knowable
  // *after* a run — without this file, learning them would cost a second run, and so would every
  // later change to the comparator. `--from-capture` recomputes the whole report offline.
  await mkdir(OUT_DIR, { recursive: true });
  const capture: Capture = { runId, result, records, log, artifacts, artifactRoute: route };
  await writeFile(
    path.join(OUT_DIR, 'capture.json'),
    redact(`${JSON.stringify(capture, null, 2)}\n`, config),
    'utf8',
  );
  console.log(
    `wrote ${path.join(OUT_DIR, 'capture.json')} — re-analyse with --from-capture, no agent minutes`,
  );

  return {
    facts: {
      steps: partition.steps,
      markers: markersIn(log),
      artifacts,
      skippedJobs: serviceSkippedJobs(records),
    },
    runId,
    result,
    records,
    partition,
    artifactRoute: route,
  };
}

/** Everything the hosted run produced, saved so the comparison can be redone without another. */
export interface Capture {
  readonly runId: number;
  readonly result: string;
  readonly records: readonly TimelineRecord[];
  /**
   * The raw combined log, not the extracted markers. Storing the *conclusion* would have made the
   * first fix to the marker rule cost another hosted run; storing the evidence makes it free.
   */
  readonly log: string;
  readonly artifacts: readonly ArtifactFact[];
  readonly artifactRoute: string;
}

export function serviceRunFromCapture(
  capture: Capture,
  authored: readonly AuthoredJob[],
): ServiceRun {
  const partition = partitionServiceSteps(capture.records, authored);
  return {
    facts: {
      steps: partition.steps,
      markers: markersIn(capture.log),
      artifacts: capture.artifacts,
      skippedJobs: serviceSkippedJobs(capture.records),
    },
    runId: capture.runId,
    result: capture.result,
    records: capture.records,
    partition,
    artifactRoute: capture.artifactRoute,
  };
}

/**
 * Download the published artifact and hash its contents.
 *
 * **The route was uncertain and is measured rather than assumed.** `PublishPipelineArtifact@1`
 * stores through the closed BlobStore client, and C-E06-094 flagged the file-source rule as an
 * inference awaiting an oracle run — this is that run. The build-artifacts listing is tried first
 * because it is the documented, stable route; whichever answers with a fetchable archive is
 * recorded in the transcript as the pinned one.
 */
/* istanbul ignore next -- network I/O. */
async function downloadArtifact(
  api: (route: string, init?: RequestInit) => Promise<ApiResult>,
  config: OracleConfig,
  runId: number,
  keep: boolean,
): Promise<{ artifacts: readonly ArtifactFact[]; route: string }> {
  const listed = await api(
    `build/builds/${runId}/artifacts?artifactName=${ARTIFACT_NAME}&api-version=7.1`,
  );
  require2xx('get artifact', listed, config);
  const resource = (listed.body as { resource?: { downloadUrl?: string; type?: string } }).resource;
  const downloadUrl = resource?.downloadUrl;
  if (downloadUrl === undefined) {
    throw new Error(
      `artifact ${ARTIFACT_NAME} has no downloadUrl (type ${String(resource?.type)})`,
    );
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: authorizationHeader(config.pat) },
  });
  if (!response.ok) throw new Error(`artifact download failed: HTTP ${response.status}`);
  const work = mkdtempSync(path.join(tmpdir(), 'azdo-emu-l6-art-'));
  try {
    const zip = path.join(work, 'artifact.zip');
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const unpacked = path.join(work, 'unpacked');
    execFileSync('unzip', ['-q', '-o', zip, '-d', unpacked]);
    return {
      artifacts: stripArtifactPrefix(hashTree(unpacked), ARTIFACT_NAME),
      route: `build/builds/{id}/artifacts?artifactName=${ARTIFACT_NAME} -> resource.downloadUrl (${String(resource?.type)})`,
    };
  } finally {
    if (!keep) rmSync(work, { recursive: true, force: true });
  }
}

// ---- report -------------------------------------------------------------------------------------

export function renderReport(
  service: ServiceRun,
  local: RunFacts,
  comparison: Comparison,
  forbiddenMarkers: readonly string[] = [],
): string {
  const lines = [
    '# L6 — the same fixture on the real service and locally (E11-S05-T01)',
    '',
    'Every tier below this one compares the emulator against itself. This one runs',
    '`fixtures/e2e/01-shell-artifacts/` — **the L5 fixture, read from its own path rather than',
    'copied**, so the two tiers cannot drift — on the real service and locally, and diffs three',
    'classes of fact.',
    '',
    `- Service run: id ${service.runId}, result \`${service.result}\``,
    `- Artifact route (measured, not assumed): \`${service.artifactRoute}\``,
    `- Facts compared: ${comparison.compared}`,
    `- **${comparison.parity ? 'PARITY' : `${comparison.differences.length} difference(s)`}**`,
    '',
    '## Timeline records the comparator dropped',
    '',
    'Listed by exact name and counted. A record matching neither an authored step nor this list is',
    '**an error, not a drop** — a loose filter would also swallow a real step whose name shifted,',
    'and the report would then claim a parity it had not measured.',
    '',
    ...(service.partition.dropped.length === 0
      ? ['(none)']
      : [...new Set(service.partition.dropped)].map(
          (n) => `- \`${n}\` ×${service.partition.dropped.filter((d) => d === n).length}`,
        )),
    '',
    ...(service.partition.unexpected.length === 0
      ? []
      : [
          '**Unexpected records (the run fails on these):**',
          '',
          ...service.partition.unexpected.map((n) => `- \`${n}\``),
          '',
        ]),
    '## Step results',
    '',
    '| step | service | local |',
    '|---|---|---|',
  ];

  const localByKey = new Map(local.steps.map((s) => [key(s), s]));
  for (const s of service.facts.steps) {
    const l = localByKey.get(key(s));
    lines.push(
      `| \`${key(s)}\` ${s.displayName === (l?.displayName ?? '') ? `“${s.displayName}”` : `(service “${s.displayName}”, local “${l?.displayName ?? '(absent)'}”)`} | \`${s.result}\` | \`${l?.result ?? '(absent)'}\` |`,
    );
  }

  lines.push(
    '',
    '## Markers (the fixture’s variable dump)',
    '',
    '| marker | service | local |',
    '|---|---|---|',
    ...[...new Set([...service.facts.markers, ...local.markers])]
      .sort()
      .map(
        (m) =>
          `| \`${m}\` | ${service.facts.markers.includes(m) ? 'yes' : '**no**'} | ${local.markers.includes(m) ? 'yes' : '**no**'} |`,
      ),
    '',
    '## The negative: jobs that must not run, markers that must not appear',
    '',
    'Asserted, not inferred from an empty union. A job that does not run contributes no steps to',
    'either side, so a comparison keyed on what *is* present would report parity by **mutual',
    'absence** — the same error the unexpected-record guard prevents, on the negative side.',
    '',
    `- Jobs that did not run — service: \`${service.facts.skippedJobs.join(', ') || '(none)'}\`, local: \`${local.skippedJobs.join(', ') || '(none)'}\``,
    ...forbiddenMarkers.map(
      (m) =>
        `- Forbidden marker \`${m}\` — service: ${service.facts.markers.includes(m) ? '**present**' : 'absent'}, local: ${local.markers.includes(m) ? '**present**' : 'absent'}`,
    ),
    '',
    '## Artifact contents (sha256 per path, never archive bytes)',
    '',
    '| path | service | local |',
    '|---|---|---|',
    ...[...new Set([...service.facts.artifacts, ...local.artifacts].map((a) => a.path))]
      .sort()
      .map((p) => {
        const s = service.facts.artifacts.find((a) => a.path === p)?.sha256 ?? '(absent)';
        const l = local.artifacts.find((a) => a.path === p)?.sha256 ?? '(absent)';
        return `| \`${p}\` | \`${s.slice(0, 16)}\` | \`${l.slice(0, 16)}\` |`;
      }),
    '',
  );

  if (!comparison.parity) {
    lines.push(
      '## Differences',
      '',
      '| fact | service | local |',
      '|---|---|---|',
      ...comparison.differences.map((d) => `| ${d.fact} | \`${d.service}\` | \`${d.local}\` |`),
      '',
    );
  }

  lines.push(
    '## Every timeline record',
    '',
    '| type | name | result |',
    '|---|---|---|',
    ...service.records.map((r) => `| \`${r.type}\` | \`${r.name}\` | \`${r.result ?? '-'}\` |`),
    '',
  );
  return lines.join('\n');
}

// ---- main ---------------------------------------------------------------------------------------

/* istanbul ignore next -- the CLI arm; the exported functions above are what tests drive. */
export async function main(argv: readonly string[]): Promise<number> {
  const keep = argv.includes('--keep');
  const authored = authoredJobs(readFileSync(FIXTURE, 'utf8'));

  console.log('running the fixture locally (free, repeatable — always first)…');
  const local = runLocally('.', keep);
  console.log(
    `  ${local.steps.length} steps, ${local.markers.length} markers, ${local.artifacts.length} artifact file(s)`,
  );

  if (argv.includes('--local-only')) {
    console.log('--local-only: skipping the hosted run.');
    return 0;
  }

  const reuseIndex = argv.indexOf('--reuse-run');
  const reuseRunId = reuseIndex === -1 ? undefined : Number(argv[reuseIndex + 1]);
  const service = argv.includes('--from-capture')
    ? serviceRunFromCapture(
        JSON.parse(readFileSync(path.join(OUT_DIR, 'capture.json'), 'utf8')) as Capture,
        authored,
      )
    : await runOnService(authored, keep, reuseRunId);
  // The fixture's own negative, read from the L5 manifest — one source of truth for both tiers.
  const forbidden =
    (
      JSON.parse(readFileSync(path.join('fixtures', 'e2e', 'MANIFEST.json'), 'utf8')) as {
        samples: Record<string, { absentMarkers?: string[] }>;
      }
    ).samples['01-shell-artifacts']?.absentMarkers ?? [];
  const comparison = compareFacts(service.facts, local, forbidden);

  await mkdir(OUT_DIR, { recursive: true });
  // The capture on disk is already redacted, so a `--from-capture` report needs no credentials —
  // which is what makes re-analysis possible on a machine that has none.
  const report = renderReport(service, local, comparison, forbidden);
  const redacted = argv.includes('--from-capture')
    ? report
    : redact(report, configFromEnv(await loadEnvFile('.env.oracle')));
  await writeFile(path.join(OUT_DIR, 'report.md'), redacted, 'utf8');
  console.log(`\nwrote ${path.join(OUT_DIR, 'report.md')}`);

  if (service.partition.unexpected.length > 0) {
    console.error(
      `\nFAIL: ${service.partition.unexpected.length} unrecognized timeline record(s):`,
    );
    for (const u of service.partition.unexpected) console.error(`  ${u}`);
    return 1;
  }
  if (!comparison.parity) {
    console.error(`\n${comparison.differences.length} difference(s) between service and local:`);
    for (const d of comparison.differences)
      console.error(`  ${d.fact}: service=${d.service} local=${d.local}`);
    return 1;
  }
  console.log(`\nPARITY across ${comparison.compared} facts.`);
  return 0;
}

/* istanbul ignore next -- the CLI arm. */
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
