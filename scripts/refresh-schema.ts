// E00-S02-T01 — vendor the official Azure Pipelines YAML schema with provenance.
// Downloads service-schema.json from microsoft/azure-pipelines-vscode at the current
// HEAD commit (C-E00-006: file lives at the repo root) into packages/engine/vendor/schema/,
// writing PROVENANCE.json (url, commit, date, sha256). Idempotent: when the upstream
// content hash matches the existing pin, nothing is rewritten.
//
// Run: node scripts/refresh-schema.ts   (Node >= 22.18: type stripping, erasable syntax only)
// Optional: GITHUB_TOKEN to raise the API rate limit.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPO = 'microsoft/azure-pipelines-vscode';
const FILE_PATH = 'service-schema.json';
const DEST_DIR = path.join('packages', 'engine', 'vendor', 'schema');

interface Provenance {
  source: {
    repo: string;
    path: string;
    commit: string;
    rawUrl: string;
    permalink: string;
  };
  fetchedAt: string;
  sha256: string;
  bytes: number;
}

async function github(url: string): Promise<Response> {
  const headers: Record<string, string> = { 'user-agent': 'azdo-pipeline-emulator-refresh-schema' };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status} ${res.statusText}`);
  return res;
}

async function main(): Promise<void> {
  const head = (await (
    await github(`https://api.github.com/repos/${REPO}/commits/HEAD`)
  ).json()) as { sha: string };
  const commit = head.sha;
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/${commit}/${FILE_PATH}`;

  const body = Buffer.from(await (await github(rawUrl)).arrayBuffer());
  JSON.parse(body.toString('utf8')); // refuse to vendor something that is not valid JSON
  const sha256 = createHash('sha256').update(body).digest('hex');

  const provenancePath = path.join(DEST_DIR, 'PROVENANCE.json');
  const existing = await readFile(provenancePath, 'utf8').then(
    (t) => JSON.parse(t) as Provenance,
    () => undefined,
  );
  if (existing && existing.sha256 === sha256 && existing.source.commit === commit) {
    console.log(
      `up to date: ${FILE_PATH} @ ${commit.slice(0, 12)} (sha256 ${sha256.slice(0, 12)}…)`,
    );
    return;
  }
  if (existing && existing.sha256 === sha256) {
    console.log(
      `content unchanged upstream (sha256 ${sha256.slice(0, 12)}…); keeping pin ${existing.source.commit.slice(0, 12)}`,
    );
    return;
  }

  const provenance: Provenance = {
    source: {
      repo: REPO,
      path: FILE_PATH,
      commit,
      rawUrl,
      permalink: `https://github.com/${REPO}/blob/${commit}/${FILE_PATH}`,
    },
    fetchedAt: new Date().toISOString(),
    sha256,
    bytes: body.byteLength,
  };

  await mkdir(DEST_DIR, { recursive: true });
  await writeFile(path.join(DEST_DIR, FILE_PATH), body);
  await writeFile(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(
    `vendored ${FILE_PATH} @ ${commit.slice(0, 12)} (${body.byteLength} bytes, sha256 ${sha256.slice(0, 12)}…) -> ${DEST_DIR}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
