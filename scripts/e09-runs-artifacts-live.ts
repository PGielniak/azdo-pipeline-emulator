// E09-S03-T02 — the live check its blocker note asked for.
//
// The task shipped `[!]` on 2026-09-02 with one Done item unreachable: "fixture pipeline artifact
// lands in `.cache/artifacts/...`". The organization had 13 pipelines, 29 completed runs and **no
// artifacts at all**, because every oracle experiment to that date used `previewRun: true`, which
// expands a pipeline without executing it (C-E09-073). The note names the procedure exactly: "Run
// any pipeline with a `PublishPipelineArtifact` step once and this closes — re-run §4 of
// `research/experiments/E09-rest/runs-artifacts/real-run.md`."
//
// E11-S05-T01 did that as a side effect: run **553** of `oracle-l6-shell-artifacts` publishes the
// artifact `drop`. This script is that §4 re-run, made reproducible rather than ad hoc.
//
// **It reads; it never queues.** The outward-facing write the old note declined to take
// unilaterally has already happened and is not repeated here — this walks an existing run.
//
// **Secret hygiene, and it is not the usual one.** `signedContent.url` *is* the grant: it carries
// "limited-time anonymous access" (C-E09-071), so it is a bearer credential in a query string. The
// transcript therefore records the URL's **shape** — host, path segments, parameter *names*, and
// `signatureExpires` — and never its signature. `redact()` would not catch this on its own; the
// URL contains neither the org name nor the PAT.
//
// Run: pnpm e09-runs-artifacts-live
// Output: research/experiments/E09-rest/runs-artifacts/download-real-run.md (redacted)
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The **built** bundle, not the sources: `packages/fetch/src/**` uses `.js`-suffixed relative
// imports (the TS ESM convention), which Node cannot resolve when the `.ts` files are loaded
// directly. `scripts/e2e.ts` reaches for `packages/cli/dist/bin.js` for the same reason. So this
// script needs `pnpm build` first, and exercises exactly what ships.
import {
  AzureDevOpsClient,
  downloadArtifact,
  getArtifact,
  listRuns,
  verifyLockfile,
  writeLockfile,
  type Lockfile,
  type StoredAzureCredential,
} from '../packages/fetch/dist/index.js';
import { configFromEnv, redact } from '../packages/fetch/src/oracle.ts';
import { loadEnvFile } from './oracle-transcript.ts';

const OUT = path.join('research', 'experiments', 'E09-rest', 'runs-artifacts');
/** `oracle-l6-shell-artifacts`, the pipeline E11-S05-T01 created; run 553 published `drop`. */
const PIPELINE_ID = Number(process.env['E09_PIPELINE_ID'] ?? 36);
const ARTIFACT = process.env['E09_ARTIFACT'] ?? 'drop';
const ALIAS = 'l6-shell-artifacts';

/**
 * Structural literals in the signed-content path. Everything else is redacted.
 *
 * An allowlist rather than a denylist, because the two opaque segments here are an account GUID and
 * a base64 blob, and neither announces itself.
 */
const SAFE_PATH_SEGMENTS = new Set(['_apis', 'public', 'artifact', 'signedContent']);

/**
 * A signed URL reduced to its shape.
 *
 * Keeps what identifies the *route* — scheme, host, the structural path literals, which query
 * parameters exist — and redacts every value that could be replayed or that identifies the owner.
 *
 * **The path needs redacting as much as the query string, and that is not obvious.** The signature
 * lives in `urlSignature`, so a first version of this function redacted the query and printed the
 * path verbatim. One path segment is **base64**, and it decodes to
 * `pipelineartifact://<org>/projectId/<guid>/buildId/<n>/artifactName/<name>` — so the
 * organization name was sitting in the transcript, encoded. `redact()` could not catch it (it
 * matches the org as a literal string) and neither could the runbook's `grep` for the org name:
 * both return a clean result on base64. Measured 2026-09-22, C-E09-094.
 */
export function describeSignedUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '(unparseable url)';
  }
  const segments = parsed.pathname
    .split('/')
    .map((segment) =>
      segment.length === 0 || SAFE_PATH_SEGMENTS.has(segment) ? segment : '{redacted}',
    )
    .join('/');
  const params = [...parsed.searchParams.keys()].sort();
  return `${parsed.protocol}//${parsed.host}${segments} ?${params.map((p) => `${p}={redacted}`).join('&')}`;
}

/* istanbul ignore next -- the CLI arm; `describeSignedUrl` above is what tests drive. */
async function main(): Promise<void> {
  const env = await loadEnvFile('.env.oracle');
  const config = configFromEnv(env);

  const credential: StoredAzureCredential = {
    version: 1,
    orgUrl: config.orgUrl,
    mode: 'pat',
    token: config.pat,
  };

  const client = new AzureDevOpsClient({
    orgUrl: config.orgUrl,
    project: config.project,
    credential,
  });

  console.log(`pipeline ${PIPELINE_ID}, artifact ${ARTIFACT}`);
  const runs = await listRuns(client, PIPELINE_ID);
  console.log(`  ${runs.length} run(s)`);
  const completed = runs.filter((r) => r.state === 'completed');
  const target = completed[0];
  if (target === undefined) throw new Error(`pipeline ${PIPELINE_ID} has no completed run`);
  console.log(`  newest completed: run ${target.id} (${target.result ?? '-'})`);

  const meta = await getArtifact(client, PIPELINE_ID, target.id, ARTIFACT);
  console.log(
    `  artifact ${meta.name}: signedUrl ${meta.signedUrl === undefined ? 'ABSENT' : 'present'}`,
  );

  const cacheDir = mkdtempSync(path.join(tmpdir(), 'azdo-emu-e09-cache-'));
  try {
    const result = await downloadArtifact(client, {
      cacheDir,
      alias: ALIAS,
      pipelineId: PIPELINE_ID,
      runId: target.id,
      artifactName: ARTIFACT,
    });
    console.log(`  downloaded ${result.files} file(s), ${result.bytes} bytes -> ${result.dir}`);

    const relative = path.relative(cacheDir, result.dir).split(path.sep).join('/');

    // Done item 2, "pinned runId in lockfile", exercised against the real download rather than a
    // fixture. The 2026-09-02 note reassigned this clause to E09-S03-T06; the schema and the verify
    // path were in fact already here, and what was missing was the same thing as item 1 — an
    // artifact to point them at. `verifyLockfile` resolves the cache directory *from the pinned
    // runId*, so a satisfied verify is evidence the pin and the download agree on the layout.
    const lockfilePath = path.join(cacheDir, 'azdo-emu.lock.json');
    const lockfile: Lockfile = {
      version: 1,
      // Fixed rather than `new Date()`: a transcript that changes on every regeneration is a diff
      // nobody can read, and this field is not what the check is about. `signatureExpires` below
      // is the deliberate exception — that one *is* the measurement.
      convertedAt: '2026-09-22T00:00:00.000Z',
      pipelines: {
        [ALIAS]: { pipelineId: PIPELINE_ID, runId: target.id, artifacts: [ARTIFACT] },
      },
    };
    await writeLockfile(lockfilePath, lockfile);
    const missing = await verifyLockfile(lockfile, { cacheDir });
    const pinOk = missing.length === 0;
    console.log(
      `  lockfile pin runId=${target.id}: ${pinOk ? 'verified' : `MISSING ${missing.length}`}`,
    );
    const body = [
      '# E09-S03-T02 §4 re-run — the download half, now measured',
      '',
      'The 2026-09-02 transcript closed §4 with "the thing to re-run once a pipeline with a',
      '`PublishPipelineArtifact` step has executed once". E11-S05-T01 executed one: run 553 of',
      '`oracle-l6-shell-artifacts` publishes `drop`. This is that re-run.',
      '',
      '**Reads only.** The outward-facing write the old note declined to take unilaterally had',
      'already happened for another task; nothing here queues a build.',
      '',
      `- Pipeline \`${PIPELINE_ID}\`, run \`${target.id}\`, result \`${target.result ?? '-'}\``,
      `- Runs visible on this pipeline: ${runs.length}`,
      '',
      '## Artifact metadata, with `$expand=signedContent`',
      '',
      '```text',
      `GET <org>/<project>/_apis/pipelines/${PIPELINE_ID}/runs/${target.id}/artifacts`,
      `      ?artifactName=${ARTIFACT}&$expand=signedContent&api-version=7.1`,
      '  -> HTTP 200',
      `     name:             ${meta.name}`,
      `     url:              ${meta.url === undefined ? '(absent)' : '<container url, redacted>'}`,
      `     signatureExpires: ${meta.signatureExpires ?? '(absent)'}   <- the one value that changes per run`,
      `     signedContent.url shape:`,
      `       ${meta.signedUrl === undefined ? '(absent)' : describeSignedUrl(meta.signedUrl)}`,
      '```',
      '',
      "`signatureExpires` is deliberately **not** pinned the way the lockfile's `convertedAt` is: it",
      'is a measurement, and a fresh short TTL on every regeneration is exactly the evidence for',
      'C-E09-071\'s "limited-time" wording. It is the only line here that churns, and it churns on',
      'purpose.',
      '',
      '**Neither the signature nor the path is recorded, and the path is the interesting half.**',
      '`signedContent.url` grants "limited-time anonymous access" (C-E09-071) — a bearer credential in',
      'a query string. But the *path* carries a **base64** segment that decodes to',
      '`pipelineartifact://<org>/projectId/<guid>/buildId/<n>/artifactName/<name>`, so printing the',
      'path verbatim puts the organization name in the transcript in a form neither `redact()` nor the',
      "runbook's `grep` for the org name can see — both come back clean (C-E09-094). Only structural",
      'literals survive here; every other segment and every parameter value is redacted.',
      '',
      '## The download, unauthenticated by design',
      '',
      'The request carries **no** `Authorization` header — the signature is the grant (C-E09-071).',
      '',
      '```text',
      `GET <signed content url>   [no Authorization header]`,
      '  -> HTTP 200, application/zip',
      `     unpacked: ${result.files} file(s), ${result.bytes} bytes`,
      `     cache path: .cache/${relative}`,
      '```',
      '',
      `The layout is docs/05 §4's \`.cache/artifacts/<alias>/<runId>/<artifactName>/\`, with the`,
      'archive kept beside its extraction as `artifact.zip`.',
      '',
      '## The lockfile pin, against the same download',
      '',
      '```text',
      `pipelines.${ALIAS} = { pipelineId: ${PIPELINE_ID}, runId: ${target.id}, artifacts: ["${ARTIFACT}"] }`,
      `verifyLockfile -> ${pinOk ? 'satisfied (0 missing pins)' : `${missing.length} missing pin(s)`}`,
      '```',
      '',
      '`verifyLockfile` resolves the artifact directory **from the pinned `runId`**, so a satisfied',
      'verify is evidence that the pin and the downloader agree on the cache layout — not merely that',
      'the schema has a `runId` field. The 2026-09-02 note reassigned this clause to E09-S03-T06; the',
      'schema and the verify path were already here, and what it was actually missing was item 1’s',
      'artifact.',
      '',
      '## What this closes',
      '',
      'Done item 1 of E09-S03-T02 — "fixture pipeline artifact lands in `.cache/artifacts/...`" —',
      'which had been the only thing standing between this task and `[x]` since 2026-09-02.',
      '',
      'Regenerate with `pnpm e09-runs-artifacts-live` (reads an existing run; queues nothing).',
      '',
    ].join('\n');

    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, 'download-real-run.md'), redact(body, config), 'utf8');
    console.log(`\nwrote ${path.join(OUT, 'download-real-run.md')}`);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

// Guarded, because `test/e09-signed-url-redaction.test.ts` imports `describeSignedUrl` from
// this file: without it, importing the module would run a live download inside the test suite.
/* istanbul ignore next -- the CLI arm. */
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await main();
}
