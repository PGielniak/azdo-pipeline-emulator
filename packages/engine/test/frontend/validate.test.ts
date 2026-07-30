import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDiagnostics } from '../../src/frontend/diagnostics.js';
import { parsePipelineYaml } from '../../src/frontend/parse.js';
import { DOCUMENTED_CORRECTIONS, loadPipelineSchema } from '../../src/frontend/schema.js';
import {
  SCHEMA_FIRST_PROPERTY,
  SCHEMA_NO_MATCHING_FORM,
  SCHEMA_TYPE,
  SCHEMA_UNKNOWN_KEY,
  SCHEMA_UNKNOWN_TASK,
  SCHEMA_UNKNOWN_TASK_INPUT,
  SUPPORTED_KEYWORDS,
  unsupportedKeywords,
  validatePipeline,
} from '../../src/frontend/validate.js';

const fixtureRoot = path.join(import.meta.dirname, '..', '..', '..', '..', 'fixtures', 'schema');

function validateFixture(kind: 'invalid' | 'valid', name: string) {
  const file = path.join(fixtureRoot, kind, name);
  const source = readFileSync(file, 'utf8');
  const parsed = parsePipelineYaml(source, name);
  expect(parsed.errors).toEqual([]);
  return { source, diagnostics: validatePipeline(parsed) };
}

function validateYaml(source: string, file = 'azure-pipelines.yml') {
  const parsed = parsePipelineYaml(source, file);
  expect(parsed.errors).toEqual([]);
  return validatePipeline(parsed);
}

describe('schema validation (E01-S02-T01)', () => {
  describe('broken pipelines render readable diagnostics', () => {
    const names = readdirSync(path.join(fixtureRoot, 'invalid')).sort();

    it('covers the full invalid fixture set', () => {
      expect(names).toHaveLength(15);
    });

    for (const name of names) {
      it(name, () => {
        const { source, diagnostics } = validateFixture('invalid', name);
        expect(diagnostics.length).toBeGreaterThan(0);
        // Raw ajv output for these documents runs to hundreds of alternatives (C-E01-019);
        // the post-processing layer exists to keep it at a handful.
        expect(diagnostics.length).toBeLessThanOrEqual(3);
        for (const diagnostic of diagnostics) {
          expect(diagnostic.file).toBe(name);
          expect(diagnostic.range.line).toBeGreaterThan(0);
          expect(diagnostic.jsonPath).toMatch(/^\$/);
        }
        expect(renderDiagnostics(diagnostics, { source })).toMatchSnapshot();
      });
    }
  });

  describe('valid pipelines produce no errors', () => {
    const names = readdirSync(path.join(fixtureRoot, 'valid')).sort();

    for (const name of names) {
      it(name, () => {
        const { diagnostics } = validateFixture('valid', name);
        expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(diagnostics).toEqual([]);
      });
    }
  });

  describe('branch selection', () => {
    it('reports the intended step form, not every alternative (C-E01-018)', () => {
      const diagnostics = validateYaml('steps:\n- script: 1\n  workingDirectry: src\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(SCHEMA_UNKNOWN_KEY);
      expect(diagnostics[0]?.jsonPath).toBe('$.steps[0].workingDirectry');
      expect(diagnostics[0]?.hint).toBe('did you mean "workingDirectory"?');
    });

    it('lists the allowed forms when no discriminator matches', () => {
      const diagnostics = validateYaml('steps:\n- bahs: make\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(SCHEMA_NO_MATCHING_FORM);
      expect(diagnostics[0]?.message).toContain('task, script, powershell, pwsh, bash');
      expect(diagnostics[0]?.hint).toBe('did you mean "bash"?');
    });

    it('picks the per-task input branch by task name (C-E01-018)', () => {
      const diagnostics = validateYaml(
        'steps:\n- task: CmdLine@2\n  inputs:\n    script: make\n    workingDirectory: src\n',
      );
      expect(diagnostics).toEqual([]);
    });

    it('validates inputs of the selected task branch', () => {
      const diagnostics = validateYaml('steps:\n- task: CmdLine@2\n  inputs:\n    scritp: make\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(SCHEMA_UNKNOWN_TASK_INPUT);
      expect(diagnostics[0]?.severity).toBe('warning');
    });
  });

  describe('pipeline-model coercions', () => {
    it('accepts YAML booleans, numbers and empty values where a string is declared (C-E01-015)', () => {
      expect(
        validateYaml('steps:\n- script: make\n  continueOnError: true\n  timeoutInMinutes: 5\n'),
      ).toEqual([]);
      expect(validateYaml('steps:\n- script:\n')).toEqual([]);
    });

    it('exempts ${{ }}, $( ) and $[ ] values from type checks (C-E01-016)', () => {
      expect(
        validateYaml(
          'steps:\n- task: PowerShell@2\n  timeoutInMinutes: ${{ parameters.timeout }}\n',
        ),
      ).toEqual([]);
      expect(
        validateYaml('steps:\n- task: PowerShell@2\n  timeoutInMinutes: $(timeout)\n'),
      ).toEqual([]);
    });

    it('matches task names and enum values case-insensitively (C-E01-017)', () => {
      expect(validateYaml('steps:\n- task: cmdline@2\n  inputs:\n    script: make\n')).toEqual([]);
    });

    it('still rejects a wrongly typed value', () => {
      const diagnostics = validateYaml('steps:\n- script: make\n  env: not-a-mapping\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe(SCHEMA_TYPE);
      expect(diagnostics[0]?.message).toBe('incorrect type: expected a mapping, found a string');
    });
  });

  describe('severity policy', () => {
    it('warns (not errors) on unknown tasks — the vendored catalog is in-box only (C-E01-020)', () => {
      const diagnostics = validateYaml('steps:\n- task: Contoso.MyExtension.Deploy@1\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('warning');
      expect(diagnostics[0]?.code).toBe(SCHEMA_UNKNOWN_TASK);
      expect(diagnostics[0]?.hint).toContain('org schema');
    });

    it('warns when the discriminating key is not first (C-E01-012, order not yet oracle-verified)', () => {
      const diagnostics = validateYaml('steps:\n- displayName: Build\n  script: make\n');
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('warning');
      expect(diagnostics[0]?.code).toBe(SCHEMA_FIRST_PROPERTY);
    });
  });

  describe('the vendored schema itself', () => {
    it('adds the documented `target` property to task steps (C-E01-011)', () => {
      expect(DOCUMENTED_CORRECTIONS.map((correction) => correction.pointer)).toEqual([
        '#/definitions/task/properties/target',
      ]);

      const uncorrected = loadPipelineSchema({ corrections: false });
      const parsed = parsePipelineYaml('steps:\n- task: PowerShell@2\n  target: host\n', 'p.yml');
      expect(validatePipeline(parsed, { schema: uncorrected })).not.toEqual([]);
      expect(validatePipeline(parsed)).toEqual([]);
    });

    it('uses only keywords this validator implements (guards schema refreshes)', () => {
      expect(unsupportedKeywords(loadPipelineSchema())).toEqual([]);
      expect(SUPPORTED_KEYWORDS.has('firstProperty')).toBe(true);
    });

    it('accepts an alternative schema document (seam for E01-S02-T03)', () => {
      const schema = {
        type: 'object',
        properties: { steps: { type: 'array', items: { type: 'object' } } },
        additionalProperties: false,
      };
      expect(validatePipeline(parsePipelineYaml('steps: []\n', 'p.yml'), { schema })).toEqual([]);
      expect(validatePipeline(parsePipelineYaml('stages: []\n', 'p.yml'), { schema })).toHaveLength(
        1,
      );
    });
  });
});
