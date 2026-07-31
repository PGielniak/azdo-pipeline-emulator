import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Ajv } from 'ajv';
import { describe, expect, it } from 'vitest';

const vendorDir = path.join(import.meta.dirname, '..', 'vendor', 'schema');

interface Provenance {
  source: { repo: string; path: string; commit: string; permalink: string };
  sha256: string;
  bytes: number;
}

describe('vendored service-schema.json (E00-S02-T01)', () => {
  it('matches its PROVENANCE pin (integrity)', async () => {
    const raw = await readFile(path.join(vendorDir, 'service-schema.json'));
    const provenance = JSON.parse(
      await readFile(path.join(vendorDir, 'PROVENANCE.json'), 'utf8'),
    ) as Provenance;

    expect(provenance.source.repo).toBe('microsoft/azure-pipelines-vscode');
    expect(provenance.source.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(raw.byteLength).toBe(provenance.bytes);
    expect(createHash('sha256').update(raw).digest('hex')).toBe(provenance.sha256);
  });

  it('is draft-07 and compiles with ajv (strict off for the five custom keywords, C-E00-007/008)', async () => {
    const schema = JSON.parse(
      await readFile(path.join(vendorDir, 'service-schema.json'), 'utf8'),
    ) as Record<string, unknown>;

    expect(schema['$schema']).toBe('http://json-schema.org/draft-07/schema#');

    // strict:false tolerates ignoreCase/aliases/doNotSuggest/firstProperty/deprecationMessage
    // (C-E00-008); honoring their semantics is E01's job, not the validator's.
    // unicodeRegExp:false — the schema's patterns use escapes invalid under /u (C-E00-010).
    const ajv = new Ajv({ strict: false, allowUnionTypes: true, unicodeRegExp: false });
    const validate = ajv.compile(schema);
    expect(typeof validate).toBe('function');

    // smoke: a minimal steps-pipeline is accepted, and clearly-wrong shapes are not
    expect(validate({ steps: [{ script: 'echo hi' }] })).toBe(true);
    expect(validate({ steps: 'not-a-list' })).toBe(false);
  });
});
