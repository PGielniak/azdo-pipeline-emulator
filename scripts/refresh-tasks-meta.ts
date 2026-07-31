// E00-S02-T03 — snapshot task.json metadata for the configured task list with provenance.
// Downloads Tasks/<Dir>/task.json from microsoft/azure-pipelines-tasks at the pinned
// release tag (C-E00-015) into packages/emit/vendor/tasks-meta/<Name>@<major>/, writing a
// per-task PROVENANCE.json (url, tag, commit, date, sha256). Consumed by E09-S01.
// Idempotent: a task whose pinned commit and content hash match on disk is not rewritten.
//
// Adding a task = one entry in TASKS below (the repo directory name under Tasks/).
// Bumping the snapshot = change PIN_TAG (pick from the repo's releases), rerun.
//
// Run: node scripts/refresh-tasks-meta.ts   (Node >= 22.18: type stripping, erasable syntax only)
// Optional: GITHUB_TOKEN to raise the API rate limit.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'microsoft/azure-pipelines-tasks';
// Sprint-cadence release tag (C-E00-015): latest non-prerelease at pin time.
const PIN_TAG = 'v277';
// Repo directory names under Tasks/ (C-E00-014). One entry per snapshotted task.
const TASKS = ['CmdLineV2', 'BashV3', 'PowerShellV2', 'CopyFilesV2'];
const DEST_ROOT = path.join('packages', 'emit', 'vendor', 'tasks-meta');

interface TaskJson {
  name: string;
  version: { Major: number; Minor: number; Patch: number };
}

interface Provenance {
  source: {
    repo: string;
    path: string;
    tag: string;
    commit: string;
    rawUrl: string;
    permalink: string;
  };
  task: { name: string; version: string };
  fetchedAt: string;
  sha256: string;
  bytes: number;
}

async function github(url: string): Promise<Response> {
  const headers: Record<string, string> = {
    'user-agent': 'azdo-pipeline-emulator-refresh-tasks-meta',
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res;
}

async function resolveTagCommit(tag: string): Promise<string> {
  const ref = (await (
    await github(`https://api.github.com/repos/${REPO}/git/ref/tags/${tag}`)
  ).json()) as { object: { type: string; sha: string } };
  if (ref.object.type === 'commit') return ref.object.sha;
  // annotated tag: dereference the tag object to its target commit
  const tagObj = (await (
    await github(`https://api.github.com/repos/${REPO}/git/tags/${ref.object.sha}`)
  ).json()) as { object: { sha: string } };
  return tagObj.object.sha;
}

async function snapshotTask(taskDir: string, commit: string): Promise<void> {
  const filePath = `Tasks/${taskDir}/task.json`;
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${commit}/${filePath}`;
  const body = Buffer.from(await (await github(rawUrl)).arrayBuffer());
  const parsed = JSON.parse(body.toString('utf8')) as TaskJson; // refuse non-JSON
  const { name, version } = parsed;
  if (!name || !Number.isInteger(version?.Major)) {
    throw new Error(`${filePath}: missing name/version.Major — not a task.json?`);
  }
  // C-E00-014: the directory's V<n> suffix equals version.Major; a mismatch means the
  // upstream layout assumption broke and the snapshot must not be written silently.
  const suffix = /V(\d+)$/.exec(taskDir)?.[1];
  if (suffix === undefined || Number(suffix) !== version.Major) {
    throw new Error(
      `${filePath}: dir suffix ${taskDir} vs version.Major ${version.Major} mismatch (C-E00-014)`,
    );
  }

  const destDir = path.join(DEST_ROOT, `${name}@${version.Major}`);
  const sha256 = createHash('sha256').update(body).digest('hex');
  const provenancePath = path.join(destDir, 'PROVENANCE.json');
  const existing = await readFile(provenancePath, 'utf8').then(
    (t) => JSON.parse(t) as Provenance,
    () => undefined,
  );
  if (existing && existing.sha256 === sha256 && existing.source.commit === commit) {
    console.log(`up to date: ${name}@${version.Major} (sha256 ${sha256.slice(0, 12)}…)`);
    return;
  }

  const provenance: Provenance = {
    source: {
      repo: REPO,
      path: filePath,
      tag: PIN_TAG,
      commit,
      rawUrl,
      permalink: `https://github.com/${REPO}/blob/${commit}/${filePath}`,
    },
    task: { name, version: `${version.Major}.${version.Minor}.${version.Patch}` },
    fetchedAt: new Date().toISOString(),
    sha256,
    bytes: body.byteLength,
  };

  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, 'task.json'), body);
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(
    `vendored ${name}@${version.Major} = ${provenance.task.version} @ ${PIN_TAG} (${body.byteLength} bytes) -> ${destDir}`,
  );
}

async function main(): Promise<void> {
  const commit = await resolveTagCommit(PIN_TAG);
  console.log(`pin: ${PIN_TAG} -> ${commit}`);
  for (const taskDir of TASKS) {
    await snapshotTask(taskDir, commit);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
