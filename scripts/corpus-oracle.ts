// E12-S01-T02 — corpus ⇄ oracle harness.
//
// For every entry under `fixtures/corpus/`: push its YAML files into the oracle repository
// (templates are read from the repo, never from the request — C-E12-011), submit the entry's
// `pipeline.yml` as `yamlOverride`, and store the service's `finalYaml` at
// `fixtures/oracle/<entry>.final.yml`.
//
// The rule the epic states — "a corpus entry without its oracle pair is invalid" — is enforced by
// two things: this script exits non-zero if any entry is rejected, and `test/corpus.test.ts`
// fails when a committed pair does not match the hash of the input it was produced from, so
// editing a fixture without re-running this is a red test rather than a silent stale golden.
//
// **Redaction is part of the comparison contract**: goldens pass through `redact()` (org name and
// PAT → placeholders, CLAUDE.md rule 4), so any future re-verification — E12-S02-T02's `--update`,
// E12-S03's nightly diff — must redact the fresh response before diffing, or every entry whose
// expansion mentions the organization will diff forever.
//
// Run: node scripts/corpus-oracle.ts             (all entries)
//      node scripts/corpus-oracle.ts 01-matrix    (one entry)
import { writeFile } from 'node:fs/promises';
import { configFromEnv, preview, redact } from '../packages/fetch/src/oracle.ts';
import { defaultRepository, syncFiles } from './azdo-repo.ts';
import { loadEnvFile } from './oracle-transcript.ts';
import {
  oraclePairPath,
  readCorpus,
  readManifest,
  sha256,
  writeManifest,
  REPO_SCOPE,
  type ManifestEntry,
} from './corpus.ts';

const only = process.argv[2];
const env = await loadEnvFile('.env.oracle');
const config = configFromEnv(env);
const repo = await defaultRepository(config);

const all = await readCorpus();
const entries = only === undefined ? all : all.filter((e) => e.name === only);
if (entries.length === 0) {
  throw new Error(`no corpus entry named ${only}; known: ${all.map((e) => e.name).join(', ')}`);
}

const manifest = { ...(await readManifest()).entries } as Record<string, ManifestEntry>;
let failures = 0;

for (const entry of entries) {
  // Mirror the entry into the repo. Scoped per entry so unrelated paths (the C-E12-011 probe
  // fixtures under /corpus/_probe) are never touched, and no-ops when nothing changed.
  const commit = await syncFiles(
    config,
    repo,
    repo.defaultBranch,
    `${REPO_SCOPE}/${entry.name}`,
    entry.files.map((f) => ({ path: f.repoPath, content: f.content })),
    `E12-S01-T02 corpus: ${entry.name}`,
  );

  const outcome = await preview(config, { yamlOverride: entry.rootYaml });
  if (outcome.kind !== 'expanded') {
    failures += 1;
    const detail =
      outcome.kind === 'rejected'
        ? redact(outcome.message, config)
        : `${outcome.kind} (HTTP ${outcome.status})`;
    console.error(`FAIL ${entry.name.padEnd(28)} ${detail}`);
    continue;
  }

  const finalYaml = redact(outcome.finalYaml, config);
  await writeFile(oraclePairPath(entry.name), finalYaml, 'utf8');

  // Re-stamp `fetchedAt` only when something actually changed. Expansions are byte-stable
  // (C-E12-022), so an unchanged entry must produce an unchanged manifest — otherwise every
  // nightly run of E12-S03 commits ten date-only rows of pure diff noise.
  const previous = manifest[entry.name];
  const finalYamlSha256 = sha256(finalYaml);
  const unchanged =
    previous?.inputSha256 === entry.inputSha256 && previous.finalYamlSha256 === finalYamlSha256;
  manifest[entry.name] = unchanged
    ? previous
    : {
        inputSha256: entry.inputSha256,
        finalYamlSha256,
        fetchedAt: new Date().toISOString().slice(0, 10),
      };
  console.log(
    `ok   ${entry.name.padEnd(28)} ${finalYaml.split('\n').length - 1} lines` +
      (commit === undefined ? '' : `  (pushed ${commit.slice(0, 8)})`),
  );
}

// Entries deleted from the corpus must not leave a manifest row behind claiming a pair exists.
for (const name of Object.keys(manifest)) {
  if (!all.some((e) => e.name === name)) delete manifest[name];
}
await writeManifest({ entries: manifest });

if (failures > 0) {
  console.error(`\n${failures} corpus entr${failures === 1 ? 'y' : 'ies'} rejected by the service`);
  process.exit(1);
}
