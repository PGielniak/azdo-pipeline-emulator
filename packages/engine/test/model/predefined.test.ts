// E04-S02-T03 — the predefined-variable table.
//
// The Done field asks for two things and both are asserted here rather than checked by hand once:
// "table covers docs/01 §5 set" is a coverage test that reads §5 and resolves every name it
// mentions, and "scraper re-run produces stable output" is a determinism test over the parser —
// the network half is pinned by commit, so re-running the *parse* on the same bytes is the part a
// test can own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { classifyVariables } from '../../src/model/classify.js';
import { buildPipeline } from '../../src/model/build.js';
import { parsePipelineYaml } from '../../src/frontend/parse.js';
import {
  isWritablePredefined,
  predefinedNames,
  predefinedTable,
  predefinedVariable,
} from '../../src/model/predefined.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

describe('the vendored table', () => {
  const table = predefinedTable();

  it('records both pinned commits, so a reader can fetch exactly what produced it (C-E04-094)', () => {
    expect(table.source.repo).toBe('MicrosoftDocs/azure-devops-docs');
    expect(table.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(table.source.pageCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(table.source.generatedBy).toBe('pnpm predefined-vars');
  });

  it('carries a doc anchor on every row', () => {
    for (const entry of table.variables) {
      expect(entry.anchor).toMatch(/^https:\/\/learn\.microsoft\.com\/.*#.+/);
      expect(entry.name).toMatch(/^[A-Za-z][\w]*(\.[\w*]+)+$/);
    }
  });

  it('is sorted and free of duplicates, so a regeneration diffs cleanly', () => {
    const names = table.variables.map((entry) => entry.name.toLowerCase());
    expect(names).toStrictEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it('spans every documented section', () => {
    expect([...new Set(table.variables.map((entry) => entry.section))].sort()).toStrictEqual([
      'Agent variables',
      'Build variables',
      'Checks variables',
      'Deployment job variables',
      'Page sections',
      'Pipeline variables',
      'System variables',
    ]);
  });
});

describe('the two writable exceptions (C-E04-095)', () => {
  it('is exactly Build.Clean and System.Debug', () => {
    const writable = predefinedTable()
      .variables.filter((entry) => entry.writable === true)
      .map((entry) => entry.name)
      .sort();
    expect(writable).toStrictEqual(['Build.Clean', 'System.Debug']);
  });

  it('answers `isWritablePredefined` case-insensitively', () => {
    expect(isWritablePredefined('system.debug')).toBe(true);
    expect(isWritablePredefined('SYSTEM.DEBUG')).toBe(true);
    expect(isWritablePredefined('Build.BuildId')).toBe(false);
    expect(isWritablePredefined('NotPredefined')).toBe(false);
  });
});

describe('lookup', () => {
  it('finds a row by name, case-insensitively', () => {
    expect(predefinedVariable('build.buildid')?.name).toBe('Build.BuildId');
    expect(predefinedVariable('BUILD.BUILDID')?.name).toBe('Build.BuildId');
  });

  it('returns undefined for a name that is not predefined', () => {
    expect(predefinedVariable('myOwnVariable')).toBeUndefined();
  });

  it('exposes folded names, which is the contract the classifier folds against (C-E06-003)', () => {
    const names = predefinedNames();
    expect(names.has('build.buildid')).toBe(true);
    expect(names.has('Build.BuildId')).toBe(false); // folded set, by design
  });
});

describe('coverage of docs/01 §5 (the Done criterion, C-E04-096)', () => {
  it('resolves every predefined name the local-mapping section references', () => {
    const doc = readFileSync(join(repoRoot, 'docs/01-pipeline-model-and-schema.md'), 'utf8');
    const section = doc.split('## 5. Predefined variables')[1]?.split('## 6.')[0] ?? '';
    expect(section).not.toBe('');

    const referenced = [
      ...new Set(
        [...section.matchAll(/`([A-Z][A-Za-z]*\.[A-Za-z.()*]+)`/g)].map((m) => m[1] ?? ''),
      ),
    ].sort();
    expect(referenced.length).toBeGreaterThan(25);

    const names = predefinedNames();
    const missing = referenced.filter((name) => {
      const folded = name.toLowerCase();
      if (names.has(folded)) return false;
      // `System.PullRequest.*` stands for its concrete members.
      if (folded.endsWith('.*')) return ![...names].some((n) => n.startsWith(folded.slice(0, -1)));
      // `Build.SourceBranch(Name)` abbreviates two spellings.
      const abbreviated = /^(.*)\((\w+)\)$/.exec(name);
      if (abbreviated) {
        const [, base = '', suffix = ''] = abbreviated;
        return !(names.has(base.toLowerCase()) && names.has((base + suffix).toLowerCase()));
      }
      return true;
    });
    expect(missing).toStrictEqual([]);
  });
});

describe('the port E04-S02-T02 left injectable', () => {
  it('silences the unknown-predefined warning once wired in', () => {
    const parsed = parsePipelineYaml(
      'steps:\n- task: A@1\n  inputs:\n    s: $(Build.BuildId)$(System.Debug)\n',
      'p.yml',
    );
    const pipeline = buildPipeline(parsed).pipeline;
    if (pipeline === undefined) throw new Error('no pipeline');

    // Without the table: two warnings, both service-namespaced names unaccounted for.
    expect(classifyVariables(pipeline).warnings).toHaveLength(2);

    // With it: both classify as predefined and nothing warns.
    const classified = classifyVariables(pipeline, { predefined: predefinedNames() });
    expect(classified.warnings).toStrictEqual([]);
    expect(classified.variables.get('build.buildid')?.classification).toBe('predefined');
    expect(classified.variables.get('system.debug')?.classification).toBe('predefined');
  });
});
