// E12-S01-T02 — the corpus/oracle pairing invariants.
//
// The epic states the rule as prose ("a corpus entry without its oracle pair is invalid"); these
// tests are what makes it true. They run offline: the oracle answered once, at authoring time,
// and the manifest records *which input* it answered for — so the failure mode this guards is
// editing a fixture and leaving a golden behind that the service never saw.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  oraclePairPath,
  readCorpus,
  readManifest,
  sha256,
  ROOT_FILE,
  type CorpusEntry,
} from '../scripts/corpus.ts';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const corpus = await readCorpus(repoRoot);
const manifest = await readManifest(repoRoot);

/** Template references in a document, as authored (`- template: <ref>` / `template: <ref>`). */
function templateRefs(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*-?\s*template:\s*(\S+)/gm)].map((m) => m[1] as string);
}

const usesTemplates = (entry: CorpusEntry): boolean =>
  entry.files.some((f) => f.rel !== ROOT_FILE) || templateRefs(entry.rootYaml).length > 0;

describe('corpus v1', () => {
  it('has at least the ten entries E12-S01-T02 requires', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(10);
  });

  it('gives every entry a README that says what it exercises', () => {
    for (const entry of corpus) {
      expect(entry.readme, entry.name).toMatch(/## Exercises/);
    }
  });

  // E01-S02-T02's loose-pass tolerance list is derived from five real template-using pipelines;
  // its blocker note names this task as the supplier.
  it('contains at least five template-using pipelines (E01-S02-T02 precondition)', () => {
    expect(corpus.filter(usesTemplates).map((e) => e.name).length).toBeGreaterThanOrEqual(5);
  });
});

describe('oracle pairing', () => {
  it.each(corpus.map((e) => [e.name, e] as const))('%s has an oracle pair', (name, entry) => {
    const pair = oraclePairPath(name);
    expect(existsSync(new URL(pair, `file://${repoRoot}`)), `${pair} is missing`).toBe(true);
    expect(readFileSync(new URL(pair, `file://${repoRoot}`), 'utf8').length).toBeGreaterThan(0);
    expect(entry.inputSha256).toHaveLength(64);
  });

  // The staleness gate. Editing a fixture changes its input hash; the manifest still records the
  // hash the service actually answered for, so the pair must be refetched
  // (`node scripts/corpus-oracle.ts <entry>`) rather than assumed to still hold.
  it.each(corpus.map((e) => [e.name, e] as const))(
    '%s pair was produced from the committed input',
    (name, entry) => {
      const row = manifest.entries[name];
      expect(row, `${name} has no MANIFEST.json row`).toBeDefined();
      expect(
        row?.inputSha256,
        `${name} changed since its oracle pair was fetched — re-run scripts/corpus-oracle.ts ${name}`,
      ).toBe(entry.inputSha256);
      const golden = readFileSync(new URL(oraclePairPath(name), `file://${repoRoot}`), 'utf8');
      expect(row?.finalYamlSha256, `${name} golden was edited by hand`).toBe(sha256(golden));
    },
  );

  it('has no manifest rows for entries that no longer exist', () => {
    const names = new Set(corpus.map((e) => e.name));
    expect(Object.keys(manifest.entries).filter((n) => !names.has(n))).toEqual([]);
  });
});

describe('template references (C-E12-011/012)', () => {
  it('spells references in the root document root-absolutely', () => {
    for (const entry of corpus) {
      for (const ref of templateRefs(entry.rootYaml)) {
        // `@alias` references are resolved through a repository resource, not the file system,
        // but their path half obeys the same rule.
        expect(ref, `${entry.name}/${ROOT_FILE}: ${ref}`).toMatch(
          new RegExp(`^/corpus/${entry.name}/`),
        );
      }
    }
  });

  it('spells references inside templates relative to the containing file', () => {
    for (const entry of corpus) {
      for (const file of entry.files.filter((f) => f.rel !== ROOT_FILE)) {
        for (const ref of templateRefs(file.content)) {
          expect(ref, `${entry.name}/${file.rel}: ${ref}`).not.toMatch(/^\//);
        }
      }
    }
  });
});

describe('redaction (CLAUDE.md rule 4)', () => {
  const PAT = /[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{4}/;

  it.each(corpus.map((e) => [e.name] as const))('%s golden carries no secrets', (name) => {
    const golden = readFileSync(new URL(oraclePairPath(name), `file://${repoRoot}`), 'utf8');
    expect(PAT.test(golden), 'a PAT-shaped string is present').toBe(false);
    // Any organization URL that survived into an expansion must be the placeholder form.
    for (const match of golden.matchAll(/dev\.azure\.com\/([^/\s'"]+)/g)) {
      expect(match[1], `unredacted organization in ${name}`).toBe('{org}');
    }
  });
});
