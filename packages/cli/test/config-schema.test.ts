// E13-S01-T02 — the committed JSON schema (`schema/azdo-emu.schema.json`, C-E13-011) is what
// editors validate against; the hand-written loader is what the CLI validates with. Two validators
// means two chances to drift, so this suite pins them together: same accepts, same rejects, and the
// same key set.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ajv, type ValidateFunction } from 'ajv';
import { afterAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { CONFIG_KEYS, DEFAULTS, loadConfigFile } from '../src/config/index.js';
import { CliError } from '../src/exit.js';

const schemaPath = path.join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'schema',
  'azdo-emu.schema.json',
);
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as Record<string, unknown>;
const validate: ValidateFunction = new Ajv({ strict: true, allErrors: true }).compile(schema);

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Run a config object through the *loader* by writing it out as YAML first. */
function loaderAccepts(config: unknown): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), 'azdo-emu-schema-'));
  roots.push(dir);
  const file = path.join(dir, 'azdo-emu.yaml');
  writeFileSync(file, stringify(config));
  try {
    loadConfigFile(file);
    return true;
  } catch (error) {
    // A rejection must be a *validation* rejection, not an unrelated crash, or this helper would
    // report agreement that isn't there.
    expect(error).toBeInstanceOf(CliError);
    return false;
  }
}

/** The docs/06 §2 example, as data. */
const DOCUMENTED_EXAMPLE = {
  organization: 'https://dev.azure.com/contoso',
  project: 'Platform',
  auth: { azdo: 'interactive', github: 'gh' },
  parameters: { deployEnv: 'dev' },
  repositories: { templates: { path: '../pipeline-templates' } },
  variableGroups: { listNames: true },
  coverage: { min: 0 },
  tasks: { unknown: 'stub', overrides: { 'SonarQubePrepare@5': 'skip' }, execute: [] },
  output: {
    targetOs: 'linux',
    checkoutMode: 'clone',
    sharedWorkspace: false,
    execution: { environment: 'auto', image: null, dockerSocket: 'auto' },
  },
};

describe('committed config schema (E13-S01-T02, C-E13-011)', () => {
  it('is draft-07 and compiles under strict ajv', () => {
    expect(schema['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(typeof validate).toBe('function');
  });

  it('accepts the docs/06 §2 example — and so does the loader', () => {
    expect(validate(DOCUMENTED_EXAMPLE)).toBe(true);
    expect(loaderAccepts(DOCUMENTED_EXAMPLE)).toBe(true);
  });

  it('accepts an empty config: every key is optional', () => {
    expect(validate({})).toBe(true);
    expect(loaderAccepts({})).toBe(true);
  });

  describe('schema and loader reject the same documents', () => {
    const REJECTED: ReadonlyArray<readonly [string, unknown]> = [
      ['unknown top-level key', { organisation: 'https://dev.azure.com/x' }],
      ['unknown nested key', { output: { targetOS: 'linux' } }],
      ['wrong scalar type', { project: 42 }],
      ['wrong mapping type', { auth: 'interactive' }],
      ['value outside an enum', { output: { checkoutMode: 'symlink' } }],
      ['coverage above 100', { coverage: { min: 120 } }],
      ['coverage below 0', { coverage: { min: -1 } }],
      ['repository override without a path', { repositories: { templates: {} } }],
      ['task override outside its enum', { tasks: { overrides: { 'X@1': 'ignore' } } }],
      ['execute holding a non-string', { tasks: { execute: [42] } }],
    ];

    for (const [reason, document] of REJECTED) {
      it(reason, () => {
        expect(validate(document), 'JSON schema should reject this').toBe(false);
        expect(loaderAccepts(document), 'loader should reject this').toBe(false);
      });
    }
  });

  it('rejects for the reason it claims, not vacuously', () => {
    // "Both returned false" is only agreement if the schema is failing at the node in question.
    expect(validate({ coverage: { min: -1 } })).toBe(false);
    expect(validate.errors?.map((error) => `${error.instancePath} ${error.keyword}`)).toContain(
      '/coverage/min minimum',
    );
    expect(validate({ output: { targetOS: 'linux' } })).toBe(false);
    expect(validate.errors?.map((error) => `${error.instancePath} ${error.keyword}`)).toContain(
      '/output additionalProperties',
    );
  });

  it('documents the same key set the loader enforces (drift guard)', () => {
    const propertiesOf = (node: unknown): string[] =>
      Object.keys((node as { properties?: Record<string, unknown> })?.properties ?? {}).sort();
    const definitions = schema['properties'] as Record<string, unknown>;

    expect(propertiesOf(schema)).toEqual([...CONFIG_KEYS.root].sort());
    expect(propertiesOf(definitions['auth'])).toEqual([...CONFIG_KEYS.auth].sort());
    expect(propertiesOf(definitions['variableGroups'])).toEqual([...CONFIG_KEYS.variableGroups].sort()); // prettier-ignore
    expect(propertiesOf(definitions['coverage'])).toEqual([...CONFIG_KEYS.coverage].sort());
    expect(propertiesOf(definitions['tasks'])).toEqual([...CONFIG_KEYS.tasks].sort());
    expect(propertiesOf(definitions['output'])).toEqual([...CONFIG_KEYS.output].sort());
    expect(
      propertiesOf((definitions['output'] as { properties: Record<string, unknown> }).properties['execution']), // prettier-ignore
    ).toEqual([...CONFIG_KEYS.execution].sort());
  });

  it('documents the same defaults the loader falls back to (drift guard)', () => {
    const at = (...keys: string[]): Record<string, unknown> =>
      keys.reduce<Record<string, unknown>>(
        (node, key) => (node['properties'] as Record<string, Record<string, unknown>>)[key]!,
        schema,
      );

    expect(at('auth', 'azdo')['default']).toBe(DEFAULTS.auth.azdo);
    expect(at('auth', 'github')['default']).toBe(DEFAULTS.auth.github);
    expect(at('variableGroups', 'listNames')['default']).toBe(DEFAULTS.variableGroups.listNames);
    expect(at('coverage', 'min')['default']).toBe(DEFAULTS.coverage.min);
    expect(at('tasks', 'unknown')['default']).toBe(DEFAULTS.tasks.unknown);
    expect(at('tasks', 'execute')['default']).toEqual(DEFAULTS.tasks.execute);
    expect(at('output', 'targetOs')['default']).toBe(DEFAULTS.output.targetOs);
    expect(at('output', 'checkoutMode')['default']).toBe(DEFAULTS.output.checkoutMode);
    expect(at('output', 'sharedWorkspace')['default']).toBe(DEFAULTS.output.sharedWorkspace);
    expect(at('output', 'execution', 'environment')['default']).toBe(
      DEFAULTS.output.execution.environment,
    );
    expect(at('output', 'execution', 'image')['default']).toBe(DEFAULTS.output.execution.image);
    expect(at('output', 'execution', 'dockerSocket')['default']).toBe(
      DEFAULTS.output.execution.dockerSocket,
    );
  });
});
