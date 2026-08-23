// E03-S07-T01 — the bundle's provenance record.
//
// The Done criterion has two halves and they are tested separately: the output *contains* the
// redacted override and the path map, and **a template edit is attributable by hash**. The second
// is the one worth being careful about — it only holds if the hash covers the file the user edits,
// not the post-recursion text, so there is a case that edits a leaf three levels down and asserts
// which hashes move.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { inlineTemplates, treeReader } from '../../src/template/inline.js';
import {
  BUNDLED_OVERRIDE_FILE,
  BUNDLE_MAP_FILE,
  bundleProvenance,
  writeBundleProvenance,
  type BundleProvenance,
} from '../../src/template/provenance.js';

const bundle = (source: string, files: Record<string, string>) =>
  inlineTemplates(source, { read: treeReader(files) });

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const TREE = {
  '/t/mid.yml': 'steps:\n- script: echo mid\n- template: /t/leaf.yml\n',
  '/t/leaf.yml': 'steps:\n- script: echo leaf\n',
};
const ROOT = 'steps:\n- template: /t/mid.yml\n';

describe('bundleProvenance — the record', () => {
  it('lists each inlined file with the file that referenced it and its content hash', () => {
    const { provenance } = bundleProvenance(bundle(ROOT, TREE));
    expect(provenance.inlined).toStrictEqual([
      { path: '/t/leaf.yml', from: '/t/mid.yml', sha256: sha(TREE['/t/leaf.yml']) },
      { path: '/t/mid.yml', from: '/azure-pipelines.yml', sha256: sha(TREE['/t/mid.yml']) },
    ]);
  });

  it('hashes the override it actually writes, so the two files agree', () => {
    const { override, provenance } = bundleProvenance(bundle(ROOT, TREE));
    expect(provenance.overrideSha256).toBe(sha(override));
    expect(override).toBe('steps:\n- script: echo mid\n- script: echo leaf\n');
  });

  it('records every reference that was NOT inlined, with the reason and position', () => {
    const result = bundle('steps:\n- template: common.yml@templates\n- template: /t/param.yml\n', {
      '/t/param.yml': 'steps:\n- script: echo ${{ parameters.x }}\n',
    });
    const { provenance } = bundleProvenance(result);
    expect(provenance.skipped).toStrictEqual([
      {
        reason: 'cross-repo',
        site: 'steps',
        reference: 'common.yml@templates',
        file: '/azure-pipelines.yml',
        line: 2,
        col: 13,
      },
      {
        reason: 'uses-parameters',
        site: 'steps',
        reference: '/t/param.yml',
        file: '/azure-pipelines.yml',
        line: 3,
        col: 13,
      },
    ]);
  });

  it('is empty-but-present for a pipeline with no templates at all', () => {
    const { provenance } = bundleProvenance(bundle('steps:\n- script: echo only\n', {}));
    expect(provenance.inlined).toStrictEqual([]);
    expect(provenance.skipped).toStrictEqual([]);
    expect(provenance.version).toBe(1);
    expect(provenance.root).toBe('/azure-pipelines.yml');
  });
});

describe('bundleProvenance — redaction (D7)', () => {
  const redact = (text: string): string => text.split('contoso').join('{org}');

  it('redacts the override before it is recorded or hashed', () => {
    const result = bundle('steps:\n- script: curl https://dev.azure.com/contoso/x\n', {});
    const { override, provenance } = bundleProvenance(result, { redact });
    expect(override).not.toContain('contoso');
    expect(override).toContain('{org}');
    expect(provenance.overrideSha256).toBe(sha(override));
  });

  it('redacts a skipped reference’s text, which is also user-authored', () => {
    const result = bundle('steps:\n- template: /x.yml@contoso\n', {});
    const { provenance } = bundleProvenance(result, { redact });
    expect(provenance.skipped[0]?.reference).toBe('/x.yml@{org}');
  });

  it('defaults to identity so a caller without credentials in scope still gets a record', () => {
    const { override } = bundleProvenance(bundle('steps:\n- script: echo contoso\n', {}));
    expect(override).toContain('contoso');
  });
});

describe('a template edit is attributable by hash (the Done criterion)', () => {
  it('moves only the edited file’s hash, not its parents’', () => {
    const before = bundleProvenance(bundle(ROOT, TREE)).provenance;
    const edited = { ...TREE, '/t/leaf.yml': 'steps:\n- script: echo leaf EDITED\n' };
    const after = bundleProvenance(bundle(ROOT, edited)).provenance;

    const hashOf = (record: BundleProvenance, file: string): string | undefined =>
      record.inlined.find((entry) => entry.path === file)?.sha256;

    // The edited file's hash moves...
    expect(hashOf(after, '/t/leaf.yml')).not.toBe(hashOf(before, '/t/leaf.yml'));
    // ...and its parent's does not, because the recorded hash is the working-tree content the user
    // edits, not the post-recursion text. Hashing the spliced result would move every ancestor and
    // make the record useless for attribution.
    expect(hashOf(after, '/t/mid.yml')).toBe(hashOf(before, '/t/mid.yml'));
    // The override hash moves, because the override genuinely changed.
    expect(after.overrideSha256).not.toBe(before.overrideSha256);
  });

  it('gives two files with identical content the same hash, keyed by path', () => {
    const { provenance } = bundleProvenance(
      bundle('steps:\n- template: /a.yml\n- template: /b.yml\n', {
        '/a.yml': 'steps:\n- script: echo same\n',
        '/b.yml': 'steps:\n- script: echo same\n',
      }),
    );
    expect(provenance.inlined.map((entry) => entry.path)).toStrictEqual(['/a.yml', '/b.yml']);
    expect(provenance.inlined[0]?.sha256).toBe(provenance.inlined[1]?.sha256);
  });
});

describe('writeBundleProvenance — the files on disk', () => {
  it('writes both files, creating the directory, and returns their paths', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'azdo-emu-prov-')), 'nested', 'out');
    const result = bundle(ROOT, TREE);
    const { overrideFile, mapFile } = writeBundleProvenance(dir, result);

    expect(overrideFile).toBe(join(dir, BUNDLED_OVERRIDE_FILE));
    expect(mapFile).toBe(join(dir, BUNDLE_MAP_FILE));

    const written = readFileSync(overrideFile, 'utf8');
    expect(written).toBe(result.yaml);

    const map = JSON.parse(readFileSync(mapFile, 'utf8')) as BundleProvenance;
    expect(map.overrideSha256).toBe(sha(written));
    expect(map.inlined.map((entry) => entry.path)).toStrictEqual(['/t/leaf.yml', '/t/mid.yml']);
  });

  it('writes JSON a human can read and a trailing newline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'azdo-emu-prov-'));
    const { mapFile } = writeBundleProvenance(dir, bundle(ROOT, TREE));
    const text = readFileSync(mapFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "inlined": [');
  });
});
