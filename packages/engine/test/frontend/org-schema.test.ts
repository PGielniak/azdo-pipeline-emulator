// E01-S02-T03 — the per-org schema injection point, verified against the *pinned live response*
// (research/experiments/E01-orgschema/yamlschema.json, `node scripts/org-schema.ts`). The sample is
// committed so this suite runs offline; CI has no PAT.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_GENERATOR_ID,
  SUPPORTED_DIALECT,
  checkOrgSchema,
  parseOrgSchema,
  resolvePipelineSchema,
  taskNames,
} from '../../src/frontend/org-schema.js';
import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { loadPipelineSchema, type JsonSchema } from '../../src/frontend/schema.js';
import {
  SCHEMA_UNKNOWN_TASK,
  SCHEMA_UNKNOWN_TASK_INPUT,
  unsupportedKeywords,
  validatePipeline,
} from '../../src/frontend/validate.js';

const repoRoot = path.join(import.meta.dirname, '..', '..', '..', '..');
const fixtureRoot = path.join(repoRoot, 'fixtures', 'schema');
const orgSchemaPath = path.join(
  repoRoot,
  'research',
  'experiments',
  'E01-orgschema',
  'yamlschema.json',
);

/** The pinned response, parsed fresh per use — `resolvePipelineSchema` must not mutate its input. */
function pinnedOrgSchema(): unknown {
  return JSON.parse(readFileSync(orgSchemaPath, 'utf8'));
}

function diagnosticsFor(
  source: string,
  file: string,
  options: Parameters<typeof validatePipeline>[1],
) {
  const parsed = parsePipelineYaml(source, file);
  expect(parsed.errors).toEqual([]);
  return validatePipeline(parsed, options);
}

describe('org schema injection (E01-S02-T03)', () => {
  describe('the pinned live response is the dialect this validator implements (C-E01-030)', () => {
    it('is draft-07 from the same generator as the vendored snapshot', () => {
      const org = pinnedOrgSchema() as JsonSchema;
      const vendored = loadPipelineSchema();
      expect(org['$schema']).toBe(SUPPORTED_DIALECT);
      expect(org['$schema']).toBe(vendored['$schema']);
      expect(org['$id']).toBe(SCHEMA_GENERATOR_ID);
      expect(org['$id']).toBe(vendored['$id']);
    });

    it('uses no schema keyword the walk does not implement — so a swap is safe, not a merge', () => {
      expect(unsupportedKeywords(pinnedOrgSchema())).toEqual([]);
      expect(checkOrgSchema(pinnedOrgSchema())).toEqual([]);
    });

    it('carries the four VS Code-extension keywords, so firstProperty/ignoreCase survive the swap', () => {
      const text = readFileSync(orgSchemaPath, 'utf8');
      for (const keyword of ['firstProperty', 'ignoreCase', 'aliases', 'doNotSuggest']) {
        expect(text).toContain(`"${keyword}"`);
      }
    });

    it('its one non-task divergence from the vendored file is inert (C-E01-032)', () => {
      // `repositoryResource.endpoint` points at `string_allowExpressions` in the org response and
      // at `nonEmptyString` in the vendored file — but both definitions *are* `{type: string}` in
      // both documents, which is why the corpus swap below can assert exact equality.
      const targets = (schema: JsonSchema) => {
        const definitions = schema['definitions'] as Record<string, JsonSchema>;
        return [definitions['nonEmptyString'], definitions['string_allowExpressions']];
      };
      for (const schema of [pinnedOrgSchema() as JsonSchema, loadPipelineSchema()]) {
        expect(targets(schema)).toEqual([{ type: 'string' }, { type: 'string' }]);
      }
    });

    it('has the same definitions as the vendored snapshot (C-E01-030)', () => {
      const org = pinnedOrgSchema() as JsonSchema;
      const orgDefs = Object.keys(org['definitions'] as Record<string, unknown>).sort();
      const vendoredDefs = Object.keys(
        loadPipelineSchema()['definitions'] as Record<string, unknown>,
      ).sort();
      expect(orgDefs).toEqual(vendoredDefs);
    });
  });

  describe('what the org document adds (C-E01-031)', () => {
    it('is a strict superset of the vendored task catalogue', () => {
      const org = new Set(taskNames(pinnedOrgSchema() as JsonSchema));
      const vendored = new Set(taskNames(loadPipelineSchema()));
      expect([...vendored].filter((name) => !org.has(name))).toEqual([]);
      expect(org.size).toBeGreaterThan(vendored.size);
    });

    it('includes the marketplace task installed in the test org, which the vendored file lacks', () => {
      const org = new Set(taskNames(pinnedOrgSchema() as JsonSchema));
      const vendored = new Set(taskNames(loadPipelineSchema()));
      expect(org.has('replacetokens@7')).toBe(true);
      expect(vendored.has('replacetokens@7')).toBe(false);
    });
  });

  describe('resolvePipelineSchema', () => {
    it('falls back to the vendored schema when no org document is supplied (offline)', () => {
      const resolution = resolvePipelineSchema();
      expect(resolution.schemaSource).toBe('vendored');
      expect(resolution.problems).toEqual([]);
      expect(resolution.schema).toBe(loadPipelineSchema());
    });

    it('accepts the pinned org document', () => {
      const resolution = resolvePipelineSchema({ orgSchema: pinnedOrgSchema() });
      expect(resolution.schemaSource).toBe('org');
      expect(resolution.problems).toEqual([]);
      expect(taskNames(resolution.schema)).toContain('replacetokens@7');
    });

    it('applies DOCUMENTED_CORRECTIONS to the org document too (C-E01-037)', () => {
      const raw = pinnedOrgSchema() as JsonSchema;
      const rawTaskProperties = (raw['definitions'] as Record<string, JsonSchema>)['task']![
        'properties'
      ] as JsonSchema;
      // The live response omits `target` exactly as the vendored file does …
      expect(Object.keys(rawTaskProperties)).not.toContain('target');

      const { schema } = resolvePipelineSchema({ orgSchema: raw });
      const corrected = (schema['definitions'] as Record<string, JsonSchema>)['task']![
        'properties'
      ] as JsonSchema;
      // … so without the correction, `target:` would be rejected whenever a user authenticates.
      expect(Object.keys(corrected)).toContain('target');
    });

    it('does not mutate the caller’s document', () => {
      const raw = pinnedOrgSchema() as JsonSchema;
      const before = JSON.stringify(raw);
      resolvePipelineSchema({ orgSchema: raw });
      expect(JSON.stringify(raw)).toBe(before);
    });

    for (const [reason, document] of [
      ['not an object', 'a string'],
      ['null', null],
      ['no definitions', { $schema: SUPPORTED_DIALECT, oneOf: [] }],
      [
        'wrong dialect',
        {
          ...(pinnedOrgSchema() as JsonSchema),
          $schema: 'https://json-schema.org/draft/2020-12/schema',
        },
      ],
    ] as const) {
      it(`falls back to the vendored schema when the org document is unusable: ${reason}`, () => {
        const resolution = resolvePipelineSchema({ orgSchema: document });
        expect(resolution.schemaSource).toBe('vendored');
        expect(resolution.schema).toBe(loadPipelineSchema());
        expect(resolution.problems.length).toBeGreaterThan(0);
      });
    }

    it('refuses a document using keywords the walk would silently ignore', () => {
      const org = pinnedOrgSchema() as JsonSchema;
      (org['definitions'] as Record<string, JsonSchema>)['task']!['allOf'] = [];
      const resolution = resolvePipelineSchema({ orgSchema: org });
      expect(resolution.schemaSource).toBe('vendored');
      expect(resolution.problems.join(' ')).toContain('allOf');
    });

    it('parseOrgSchema reports invalid JSON instead of throwing', () => {
      expect(parseOrgSchema('{not json').problems[0]).toMatch(/not valid JSON/);
      expect(parseOrgSchema(readFileSync(orgSchemaPath, 'utf8')).problems).toEqual([]);
    });
  });

  describe('behaviour is identical for in-box constructs (swap test)', () => {
    const org = resolvePipelineSchema({ orgSchema: pinnedOrgSchema() });
    const fixtures = (['valid', 'invalid'] as const).flatMap((kind) =>
      readdirSync(path.join(fixtureRoot, kind))
        .sort()
        .map((name) => [kind, name] as const),
    );

    it('covers the whole fixture corpus', () => {
      expect(fixtures).toHaveLength(20);
    });

    for (const [kind, name] of fixtures) {
      it(`${kind}/${name} — same severity, code, message and range under both schemas`, () => {
        const source = readFileSync(path.join(fixtureRoot, kind, name), 'utf8');
        const vendored = diagnosticsFor(source, name, {});
        const injected = diagnosticsFor(source, name, org);
        // `hint` is the one field that is *meant* to depend on which catalogue is in use; the
        // assertion below pins that it is the only thing that ever differs.
        const withoutHint = (diagnostics: ReturnType<typeof diagnosticsFor>) =>
          diagnostics.map((diagnostic) => ({ ...diagnostic, hint: undefined }));
        expect(withoutHint(injected)).toEqual(withoutHint(vendored));
      });
    }

    it('only the unknown-task hint differs across the whole corpus, and only in wording', () => {
      const differing = fixtures.flatMap(([kind, name]) => {
        const source = readFileSync(path.join(fixtureRoot, kind, name), 'utf8');
        const vendored = diagnosticsFor(source, name, {});
        const injected = diagnosticsFor(source, name, org);
        // Pairing below is positional, so unequal counts would compare unrelated diagnostics.
        expect(injected).toHaveLength(vendored.length);
        return injected
          .map((diagnostic, index) => ({ diagnostic, vendored: vendored[index]! }))
          .filter(({ diagnostic, vendored: other }) => diagnostic.hint !== other.hint)
          .map(({ diagnostic }) => `${kind}/${name}:${diagnostic.code}`);
      });
      expect(differing).toEqual(['invalid/07-unknown-task.yml:SCHEMA_UNKNOWN_TASK']);
    });
  });

  describe('marketplace task inputs validate only under the org schema (C-E01-031)', () => {
    const pipeline = [
      'steps:',
      '- task: replacetokens@7',
      '  inputs:',
      '    sources: |',
      '      **/*.config',
      '    tokenPattern: azpipelines',
      '',
    ].join('\n');

    it('vendored: the task itself is unknown, so its inputs are never checked', () => {
      const diagnostics = diagnosticsFor(pipeline, 'marketplace.yml', {});
      expect(diagnostics.map((d) => d.code)).toEqual([SCHEMA_UNKNOWN_TASK]);
      expect(diagnostics[0]!.hint).toContain('vendored in-box task catalog');
    });

    it('org: the task and its inputs are recognized — no diagnostics at all', () => {
      const org = resolvePipelineSchema({ orgSchema: pinnedOrgSchema() });
      expect(diagnosticsFor(pipeline, 'marketplace.yml', org)).toEqual([]);
    });

    it('org: a misspelled marketplace input is caught, with a suggestion', () => {
      const org = resolvePipelineSchema({ orgSchema: pinnedOrgSchema() });
      const broken = pipeline.replace('tokenPattern:', 'tokenPatern:');
      const diagnostics = diagnosticsFor(broken, 'marketplace.yml', org);
      expect(diagnostics.map((d) => d.code)).toEqual([SCHEMA_UNKNOWN_TASK_INPUT]);
      expect(diagnostics[0]!.hint).toContain('tokenPattern');
    });

    it('org: an unknown task means "not installed in this organization" (C-E01-033)', () => {
      const org = resolvePipelineSchema({ orgSchema: pinnedOrgSchema() });
      const diagnostics = diagnosticsFor(
        'steps:\n- task: TotallyMadeUpTask@3\n',
        'unknown.yml',
        org,
      );
      expect(diagnostics.map((d) => d.code)).toEqual([SCHEMA_UNKNOWN_TASK]);
      expect(diagnostics[0]!.hint).toContain('not installed in this organization');
    });
  });
});
