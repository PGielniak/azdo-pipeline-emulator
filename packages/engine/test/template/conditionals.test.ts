// E03-S01-T02 — `${{ if/elseif/else }}` insertion.
//
// The manifest binds every golden to its live oracle hashes and claim IDs. The parity test expands
// the authored input locally, projects its steps, and compares that projection with Azure's final
// YAML. Azure rewrites `script:` sugar to `CmdLine@2`, so the projection deliberately compares the
// semantic script/env payload instead of treating that unrelated normalization as this task's job.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  arrayValue,
  booleanValue,
  NULL,
  numberValue,
  objectValue,
  parametersContext,
  stringValue,
  versionValue,
} from '../../src/index.js';
import {
  conditionTruth,
  expandConditionals,
  type ConditionalExpansionContext,
} from '../../src/template/conditionals.js';
import {
  parsePipelineYaml,
  type MappingNode,
  type PipelineNode,
  type ScalarValue,
  type SequenceNode,
} from '../../src/frontend/parse.js';
import { rootFrame } from '../../src/template/walk.js';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/oracle/directives/', import.meta.url));
const FILE = 'azure-pipelines.yml';

interface ManifestRow {
  readonly taskId: string;
  readonly claimIds: readonly string[];
  readonly inputSha256: string;
  readonly finalYamlSha256: string;
  readonly fetchedAt: string;
}

const manifest = JSON.parse(readFileSync(`${FIXTURES}MANIFEST.json`, 'utf8')) as {
  readonly fixtures: Record<string, ManifestRow>;
};
const rows = Object.entries(manifest.fixtures).filter(([, row]) => row.taskId === 'E03-S01-T02');

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const parse = (source: string): PipelineNode => {
  const parsed = parsePipelineYaml(source, FILE);
  expect(parsed.errors).toEqual([]);
  expect(parsed.root).toBeDefined();
  return parsed.root as PipelineNode;
};

function entry(mapping: MappingNode, key: string): PipelineNode | undefined {
  return mapping.entries.find((candidate) => candidate.key.value === key)?.value;
}

function sequenceAt(mapping: MappingNode, key: string): SequenceNode {
  const value = entry(mapping, key);
  expect(value?.kind).toBe('sequence');
  return value as SequenceNode;
}

/** Root `steps:` before preview; default stage/job `steps:` after preview. */
function stepsOf(root: PipelineNode): SequenceNode {
  expect(root.kind).toBe('mapping');
  const mapping = root as MappingNode;
  const direct = entry(mapping, 'steps');
  if (direct?.kind === 'sequence') return direct;

  const stage = sequenceAt(mapping, 'stages').items[0];
  expect(stage?.kind).toBe('mapping');
  const job = sequenceAt(stage as MappingNode, 'jobs').items[0];
  expect(job?.kind).toBe('mapping');
  return sequenceAt(job as MappingNode, 'steps');
}

type Plain = ScalarValue | readonly Plain[] | readonly (readonly [ScalarValue, Plain])[];

function plain(node: PipelineNode): Plain {
  switch (node.kind) {
    case 'scalar':
      return node.value;
    case 'sequence':
      return node.items.map(plain);
    case 'mapping':
      // Entry arrays preserve insertion order and duplicate keys, both relevant to a structural
      // splice and both lost by an ordinary JavaScript object.
      return node.entries.map((item) => [item.key.value, plain(item.value)] as const);
  }
}

interface StepObservation {
  readonly script: ScalarValue;
  readonly env?: Plain;
}

function observeSteps(root: PipelineNode): readonly StepObservation[] {
  return stepsOf(root).items.map((item) => {
    expect(item.kind).toBe('mapping');
    const mapping = item as MappingNode;
    const direct = entry(mapping, 'script');
    const inputs = entry(mapping, 'inputs');
    const normalized = inputs?.kind === 'mapping' ? entry(inputs, 'script') : undefined;
    const script = direct ?? normalized;
    expect(script?.kind).toBe('scalar');
    const env = entry(mapping, 'env');
    return {
      script: script?.kind === 'scalar' ? script.value : null,
      ...(env === undefined ? {} : { env: plain(env) }),
    };
  });
}

function fixtureContext(name: string): ConditionalExpansionContext {
  if (name === 'condition-truthiness-collections') {
    return {
      values: {
        parameters: parametersContext({
          payload: objectValue({ key: stringValue('value') }),
        }),
      },
    };
  }
  if (name === 'condition-truthiness-empty-collections') {
    return {
      values: {
        parameters: parametersContext({
          items: arrayValue([]),
          payload: objectValue({}),
        }),
      },
    };
  }
  return { values: {} };
}

describe('conditional oracle goldens — C-E03-120..125', () => {
  it('has substantially more than the task minimum and every pair names its claims', () => {
    expect(rows.length).toBe(19);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    for (const [, row] of rows) {
      expect(row.claimIds.length).toBeGreaterThan(0);
      expect(row.claimIds.every((claim) => /^C-E03-12[0-5]$/.test(claim))).toBe(true);
      expect(row.fetchedAt).toBe('2026-08-18');
    }
  });

  it.each(rows)('%s equals Azure finalYaml', (name, row) => {
    const input = readFileSync(`${FIXTURES}${name}.input.yml`, 'utf8');
    const finalYaml = readFileSync(`${FIXTURES}${name}.final.yml`, 'utf8');
    expect(sha256(input)).toBe(row.inputSha256);
    expect(sha256(finalYaml)).toBe(row.finalYamlSha256);

    const expanded = expandConditionals(parse(input), rootFrame(FILE), fixtureContext(name));
    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.node).toBeDefined();
    expect(observeSteps(expanded.node as PipelineNode)).toEqual(observeSteps(parse(finalYaml)));
  });
});

describe('conditional rejection controls — C-E03-126/127', () => {
  it.each([
    ['else', '${{ else }}'],
    ['elseif', '${{ elseif true }}'],
  ])('rejects orphan %s with both sequence-position service messages', (keyword, directive) => {
    const result = expandConditionals(
      parse(`steps:\n- ${directive}:\n  - script: echo orphan\n`),
      rootFrame(FILE),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      `The expression directive '${keyword}' is not supported in this context`,
      `Unexpected value '${directive}'`,
    ]);
  });

  it('rejects a second else after the first one terminated the chain', () => {
    const result = expandConditionals(
      parse(
        [
          'steps:',
          '- ${{ if false }}:',
          '  - script: not-if',
          '- ${{ else }}:',
          '  - script: selected',
          '- ${{ else }}:',
          '  - script: duplicate',
          '',
        ].join('\n'),
      ),
      rootFrame(FILE),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "The expression directive 'else' is not supported in this context",
      "Unexpected value '${{ else }}'",
    ]);
  });

  it('requires a mapping body in mapping position', () => {
    const result = expandConditionals(
      parse(
        [
          'steps:',
          '- script: echo wrong-shape',
          '  env:',
          '    ${{ if true }}:',
          '    - A',
          '',
        ].join('\n'),
      ),
      rootFrame(FILE),
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Expected a mapping',
    ]);
  });
});

describe('conditional evaluation edges', () => {
  it.each([
    [NULL, false],
    [booleanValue(false), false],
    [booleanValue(true), true],
    [numberValue(0), false],
    [numberValue(1), true],
    [stringValue(''), false],
    [stringValue('x'), true],
    [versionValue([1, 2, 3]), true],
    [arrayValue([]), true],
    [objectValue({}), true],
  ] as const)('C-E03-125 — truthiness of $kind is %s', (value, expected) => {
    expect(conditionTruth(value)).toBe(expected);
  });

  it('turns a condition parse error into an accumulated diagnostic', () => {
    const result = expandConditionals(
      parse('steps:\n- ${{ if nosuch(1) }}:\n  - script: no\n'),
      rootFrame(FILE),
    );
    expect(result.diagnostics[0]).toMatchObject({
      code: 'EXPRESSION_UNRECOGNIZED_VALUE',
      message: expect.stringContaining("Unrecognized value: 'nosuch'"),
    });
  });

  it('turns a condition evaluation error into an accumulated diagnostic', () => {
    const result = expandConditionals(
      parse("steps:\n- ${{ if lt(1, 'not-a-number') }}:\n  - script: no\n"),
      rootFrame(FILE),
    );
    expect(result.diagnostics[0]).toMatchObject({
      code: 'template-condition-evaluation',
      message: 'Unable to convert from String to Number.',
    });
  });

  it('leaves future each/insert subtrees intact and handles an empty document', () => {
    const source = [
      'steps:',
      '- ${{ each item in parameters.items }}:',
      '  - ${{ if eq(item, 1) }}:',
      '    - script: future',
      '',
    ].join('\n');
    expect(expandConditionals(parse(source), rootFrame(FILE)).node).toEqual(parse(source));
    expect(expandConditionals(undefined, rootFrame(FILE))).toEqual({
      node: undefined,
      diagnostics: [],
    });
  });
});
