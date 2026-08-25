// E03-S02-T02 — typed parameter binding.
//
// The Done criteria are "binding test matrix per type × (default/provided/missing/wrong-type)" and
// "errors snapshot-compared to service phrasing collected via oracle", so the suite is built in
// three layers:
//
//   1. **The matrix** — every type in both vocabularies, driven through the four cells. Table-driven
//      rather than hand-written, so a type added to `TEMPLATE_PARAMETER_TYPES` without a binding
//      rule fails here instead of silently binding as a string.
//   2. **The sentences** — every message helper is compared against the *service's own bytes*, read
//      back out of the committed `response.json` of the probe that produced it. Not a snapshot of
//      our own output: a golden that we wrote could drift from the service and stay green.
//   3. **The rules that shape the code** — source-text binding (C-E03-321/332), the position-split
//      vocabularies (C-E03-305), `legacyObject`'s leaf stringification (C-E03-325), the
//      one-expression-form `default:` (C-E03-315), and the queue-time path (C-E03-329..331).
//
// Claims: `research/E03-template-engine.md` C-E03-300..333, from the 88 probes under
// `research/experiments/E03-parameters/`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  parsePipelineYaml,
  type MappingNode,
  type PipelineNode,
} from '../../src/frontend/parse.js';
import {
  ROOT_PARAMETER_TYPES,
  TEMPLATE_PARAMETER_TYPES,
  bindParameters,
  coerceParameterValue,
  coerceScalarText,
  duplicateMessage,
  invalidShapeMessage,
  invalidValueMessage,
  notInValuesMessage,
  parameterTypesFor,
  readParameterDeclarations,
  requiredMessage,
  scalarText,
  unexpectedParameterMessage,
  unknownTypeMessage,
  EXPRESSION_NOT_ALLOWED,
  PARAMETER_DUPLICATE,
  PARAMETER_EXPRESSION,
  PARAMETER_INVALID_VALUE,
  PARAMETER_NOT_IN_VALUES,
  PARAMETER_REQUIRED,
  PARAMETER_UNEXPECTED,
  PARAMETER_UNKNOWN_TYPE,
  type ParameterPosition,
  type ParameterType,
} from '../../src/template/parameters.js';
import { type ExprValue } from '../../src/expr/value.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The message the service returned for a probe, read out of its committed transcript. */
function serviceMessage(probe: string): string {
  const body = JSON.parse(
    readFileSync(
      join(repoRoot, 'research', 'experiments', 'E03-parameters', probe, 'response.json'),
      'utf8',
    ),
  ) as { message?: string };
  return body.message ?? '';
}

/** Strip the `/file.yml (Line: n, Col: m): ` prefix the service puts on in-document rejections. */
const sentence = (message: string): string =>
  message.replace(/^[^\n]*?\(Line: \d+, Col: \d+\): /, '').split('\n')[0]!;

const FILE = 'pipeline.yml';

/** Parse `source` and hand back the root plus the source text, which scalars bind from. */
function parse(source: string): { root: PipelineNode; source: string } {
  const result = parsePipelineYaml(source, FILE);
  expect(result.errors).toEqual([]);
  expect(result.root).toBeDefined();
  return { root: result.root!, source };
}

function entry(node: PipelineNode, key: string): PipelineNode | undefined {
  if (node.kind !== 'mapping') return undefined;
  return node.entries.find((e) => String(e.key.value) === key)?.value;
}

/** Bind a document's `parameters:` against an optional `caller:` mapping in the same document. */
function bind(
  source: string,
  options: { position?: ParameterPosition; queue?: Record<string, string> } = {},
) {
  const { root } = parse(source);
  const where = { file: FILE, source };
  const args = entry(root, 'caller');
  return bindParameters(
    entry(root, 'parameters'),
    where,
    {
      node: args?.kind === 'mapping' ? (args as MappingNode) : undefined,
      from: where,
      queue: options.queue,
    },
    options.position ?? 'template',
  );
}

/** A single value node parsed from `value: <text>`, plus the source it came from. */
function valueNode(text: string): { node: PipelineNode; source: string } {
  const source = `value: ${text}\n`;
  const { root } = parse(source);
  return { node: entry(root, 'value')!, source };
}

function plain(value: ExprValue): unknown {
  switch (value.kind) {
    case 'array':
      return value.value.map((item) => plain(item));
    case 'object': {
      const keys = value.order ?? Object.keys(value.value);
      return Object.fromEntries(keys.map((key) => [key, plain(value.value[key]!)]));
    }
    case 'null':
      return null;
    case 'version':
      return value.segments;
    default:
      return value.value;
  }
}

// ── 1. the matrix ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per type: a value that must bind, a value that must not, and what the good one becomes.
 *
 * `undefined` for `bad` means the type accepts anything a document can express — `object` and the
 * five root-only "resource name" types take any YAML at all (C-E03-324), so there is no
 * wrong-type cell for them and the matrix says so rather than inventing one.
 */
const MATRIX: readonly {
  type: ParameterType;
  good: string;
  expected: unknown;
  bad?: string;
}[] = [
  { type: 'string', good: 'text', expected: 'text', bad: '{a: 1}' },
  { type: 'number', good: "'8'", expected: 8, bad: 'abc' },
  { type: 'boolean', good: 'True', expected: true, bad: 'yes' },
  { type: 'object', good: '{a: 1}', expected: { a: 1 } },
  { type: 'legacyObject', good: '{a: 1}', expected: { a: '1' } },
  { type: 'stringList', good: '[a, b]', expected: ['a', 'b'], bad: 'scalar' },
  { type: 'container', good: '{container: c1}', expected: { container: 'c1' }, bad: 'alpine' },
  { type: 'containerList', good: '[{container: c1}]', expected: [{ container: 'c1' }], bad: 'x' },
  { type: 'step', good: '{script: echo}', expected: { script: 'echo' }, bad: 'nope' },
  { type: 'stepList', good: '[{script: echo}]', expected: [{ script: 'echo' }], bad: 'nope' },
  { type: 'job', good: '{job: a}', expected: { job: 'a' }, bad: 'nope' },
  { type: 'jobList', good: '[{job: a}]', expected: [{ job: 'a' }], bad: 'nope' },
  { type: 'deployment', good: '{deployment: a}', expected: { deployment: 'a' }, bad: 'nope' },
  { type: 'deploymentList', good: '[{deployment: a}]', expected: [{ deployment: 'a' }], bad: 'x' },
  { type: 'stage', good: '{stage: a}', expected: { stage: 'a' }, bad: 'nope' },
  { type: 'stageList', good: '[{stage: a}]', expected: [{ stage: 'a' }], bad: 'nope' },
  { type: 'environment', good: 'prod', expected: 'prod' },
  { type: 'filePath', good: 'a/b.txt', expected: 'a/b.txt' },
  { type: 'pool', good: 'default', expected: 'default' },
  { type: 'secureFile', good: 'cert.pfx', expected: 'cert.pfx' },
  { type: 'serviceConnection', good: 'my-sub', expected: 'my-sub' },
];

describe('binding matrix — every type × default / provided / missing / wrong type', () => {
  it('covers every name in both vocabularies (a new type without a rule fails here)', () => {
    const covered = new Set(MATRIX.map((row) => row.type));
    const all = new Set<string>([...TEMPLATE_PARAMETER_TYPES, ...ROOT_PARAMETER_TYPES]);
    expect([...all].filter((name) => !covered.has(name as ParameterType))).toEqual([]);
  });

  it.each(MATRIX)('$type — a default binds when nothing is passed (C-E03-309)', (row) => {
    const position: ParameterPosition = ROOT_PARAMETER_TYPES.includes(
      row.type as (typeof ROOT_PARAMETER_TYPES)[number],
    )
      ? 'root'
      : 'template';
    const result = bind(
      `parameters:\n  - name: p\n    type: ${row.type}\n    default: ${row.good}\n`,
      {
        position,
      },
    );
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toEqual(row.expected);
  });

  it.each(MATRIX)('$type — a passed argument wins over the default', (row) => {
    const position: ParameterPosition = ROOT_PARAMETER_TYPES.includes(
      row.type as (typeof ROOT_PARAMETER_TYPES)[number],
    )
      ? 'root'
      : 'template';
    const result = bind(
      `parameters:\n  - name: p\n    type: ${row.type}\n    default: ${row.good}\ncaller:\n  p: ${row.good}\n`,
      { position },
    );
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toEqual(row.expected);
  });

  it.each(MATRIX)(
    '$type — missing and undefaulted is the requiredness rejection (C-E03-309)',
    (row) => {
      const position: ParameterPosition = ROOT_PARAMETER_TYPES.includes(
        row.type as (typeof ROOT_PARAMETER_TYPES)[number],
      )
        ? 'root'
        : 'template';
      const result = bind(`parameters:\n  - name: p\n    type: ${row.type}\n`, { position });
      expect(result.values.p).toBeUndefined();
      expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
        [PARAMETER_REQUIRED, "A value for the 'p' parameter must be provided."],
      ]);
    },
  );

  it.each(MATRIX.filter((row) => row.bad !== undefined))(
    '$type — a wrong-typed argument is rejected, and nothing binds',
    (row) => {
      const position: ParameterPosition = ROOT_PARAMETER_TYPES.includes(
        row.type as (typeof ROOT_PARAMETER_TYPES)[number],
      )
        ? 'root'
        : 'template';
      const result = bind(
        `parameters:\n  - name: p\n    type: ${row.type}\ncaller:\n  p: ${row.bad}\n`,
        { position },
      );
      expect(result.values.p).toBeUndefined();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]!.code).toBe(PARAMETER_INVALID_VALUE);
      expect(result.diagnostics[0]!.message).toContain('is not a valid');
    },
  );
});

// ── 2. the sentences, against the service's own bytes ─────────────────────────────────────────

describe('error phrasing matches the service, byte for byte', () => {
  it.each([
    ['decl-duplicate-name', (): string => duplicateMessage('p')],
    ['default-not-in-values', (): string => notInValuesMessage('p', 'gamma')],
    ['default-missing-string', (): string => requiredMessage('p')],
    ['default-wrong-type', (): string => invalidValueMessage('p', 'abc', 'number')],
    ['empty-string-to-number', (): string => invalidValueMessage('p', '', 'number')],
    ['pass-nonnumeric-to-number', (): string => invalidValueMessage('p', 'abc', 'number')],
    ['pass-bool-yes', (): string => invalidValueMessage('p', 'yes', 'boolean')],
    ['pass-bool-number', (): string => invalidValueMessage('p', '1', 'boolean')],
    ['pass-not-in-values', (): string => notInValuesMessage('p', 'gamma')],
    ['values-case', (): string => notInValuesMessage('p', 'ALPHA')],
    ['pass-extra-parameter', (): string => unexpectedParameterMessage('extra')],
    ['runtime-undeclared', (): string => unexpectedParameterMessage('nosuch')],
    ['pass-object-to-string', (): string => invalidShapeMessage('p', 'string')],
    ['pass-steplist-scalar', (): string => invalidShapeMessage('p', 'stepList')],
    ['pass-step-invalid-shape', (): string => invalidShapeMessage('p', 'step')],
    ['type-container-string', (): string => invalidShapeMessage('p', 'container')],
    ['pass-stringlist-scalar', (): string => invalidValueMessage('p', 'a', 'stringList')],
    ['pass-stringlist-invalid', (): string => notInValuesMessage('p', 'zzz')],
    ['type-root-unknown', (): string => unknownTypeMessage('notAType')],
    ['type-root-case', (): string => unknownTypeMessage('String')],
    ['type-root-legacyobject', (): string => unknownTypeMessage('legacyObject')],
    ['type-tmpl-pool', (): string => unknownTypeMessage('pool')],
    ['default-expression-function', (): string => EXPRESSION_NOT_ALLOWED],
    ['default-expression-mixed', (): string => EXPRESSION_NOT_ALLOWED],
    ['type-root-missing-untyped-object', (): string => invalidShapeMessage('p', 'string')],
  ] as const)('%s', (probe, produce) => {
    expect(produce()).toBe(sentence(serviceMessage(probe)));
  });

  it('the requiredness sentence carries no file position in the service response (C-E03-309)', () => {
    // Not `/pipeline.yml (Line: n, Col: m): …` — the service reports this one bare.
    expect(serviceMessage('default-missing-string')).toBe(requiredMessage('p'));
  });

  it('four undefaulted parameters produce four sentences at once (C-E03-309)', () => {
    expect(serviceMessage('default-missing-typed').split('\n')).toEqual([
      requiredMessage('n'),
      requiredMessage('b'),
      requiredMessage('o'),
      requiredMessage('l'),
    ]);
    const result = bind(
      'parameters:\n' +
        '  - name: n\n    type: number\n' +
        '  - name: b\n    type: boolean\n' +
        '  - name: o\n    type: object\n' +
        '  - name: l\n    type: stepList\n',
      { position: 'root' },
    );
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      requiredMessage('n'),
      requiredMessage('b'),
      requiredMessage('o'),
      requiredMessage('l'),
    ]);
  });
});

// ── 3. the rules that shape the code ──────────────────────────────────────────────────────────

describe('a scalar binds as its source text (C-E03-321/332)', () => {
  it.each([
    ['42', '42'],
    ['true', 'true'],
    ['True', 'True'],
    ['007', '007'],
    ['1.0', '1.0'],
  ])('%s binds to a string parameter as "%s"', (written, expected) => {
    const result = bind(`parameters:\n  - name: p\n    type: string\ncaller:\n  p: ${written}\n`);
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toBe(expected);
  });

  it('reads the text back out of the document, not off the parsed value', () => {
    const { node, source } = valueNode('True');
    expect(node.kind).toBe('scalar');
    expect(node.kind === 'scalar' && node.value).toBe(true);
    expect(node.kind === 'scalar' ? scalarText(node, source) : '').toBe('True');
  });

  it('Null becomes the empty string first, then fails the per-type parse', () => {
    const asString = bind('parameters:\n  - name: p\n    type: string\ncaller:\n  p:\n');
    expect(asString.diagnostics).toEqual([]);
    expect(plain(asString.values.p!)).toBe('');

    for (const type of ['number', 'boolean'] as const) {
      const result = bind(`parameters:\n  - name: p\n    type: ${type}\ncaller:\n  p:\n`);
      // Quoting `''`, exactly as an explicit empty string does — one rule, not a per-type case.
      expect(result.diagnostics[0]!.message).toBe(invalidValueMessage('p', '', type));
    }
  });
});

describe('scalar conversions (C-E03-322/323)', () => {
  it('number accepts any number-like text and binds a double', () => {
    expect(coerceScalarText('p', 'number', '8')).toEqual({
      ok: true,
      value: { kind: 'number', value: 8 },
    });
    expect(coerceScalarText('p', 'number', '1.0')).toEqual({
      ok: true,
      value: { kind: 'number', value: 1 },
    });
    expect(coerceScalarText('p', 'number', '0.5')).toEqual({
      ok: true,
      value: { kind: 'number', value: 0.5 },
    });
    expect(coerceScalarText('p', 'number', 'abc').ok).toBe(false);
    expect(coerceScalarText('p', 'number', '').ok).toBe(false);
    expect(coerceScalarText('p', 'number', '   ').ok).toBe(false);
  });

  it('boolean accepts exactly the two literals, case-insensitively', () => {
    for (const text of ['true', 'True', 'TRUE'])
      expect(coerceScalarText('p', 'boolean', text)).toEqual({
        ok: true,
        value: { kind: 'boolean', value: true },
      });
    expect(coerceScalarText('p', 'boolean', 'False')).toEqual({
      ok: true,
      value: { kind: 'boolean', value: false },
    });
    for (const text of ['yes', 'no', '1', '0', ''])
      expect(coerceScalarText('p', 'boolean', text).ok).toBe(false);
  });

  it('an unlisted scalar type binds the text unchanged (the root-only resource names)', () => {
    expect(coerceScalarText('p', 'pool', 'default')).toEqual({
      ok: true,
      value: { kind: 'string', value: 'default' },
    });
  });
});

describe('object vs legacyObject (C-E03-324/325)', () => {
  const DEEP =
    'parameters:\n' +
    '  - name: p\n    type: TYPE\n' +
    '    default:\n' +
    '      s: text\n      n: 3\n      f: 0.5\n      b: true\n      nil:\n' +
    '      list: [1, two]\n      nested: {deep: {k: v}}\n';

  it('object keeps every leaf type, at any depth, with a null leaf as the empty string', () => {
    const result = bind(DEEP.replace('TYPE', 'object'));
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toEqual({
      s: 'text',
      n: 3,
      f: 0.5,
      b: true,
      nil: '',
      list: [1, 'two'],
      nested: { deep: { k: 'v' } },
    });
  });

  it('legacyObject is the same value with every scalar leaf stringified', () => {
    const result = bind(DEEP.replace('TYPE', 'legacyObject'));
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toEqual({
      s: 'text',
      n: '3',
      f: '0.5',
      b: 'true',
      nil: '',
      list: ['1', 'two'],
      nested: { deep: { k: 'v' } },
    });
  });

  it('a bare scalar and a null both bind to object', () => {
    expect(
      plain(bind('parameters:\n  - name: p\n    type: object\n    default: scalar\n').values.p!),
    ).toBe('scalar');
    expect(
      plain(bind('parameters:\n  - name: p\n    type: object\n    default:\n').values.p!),
    ).toBe('');
  });
});

describe('the type vocabularies are position-dependent (C-E03-304/305/307)', () => {
  it('has 16 template names and 20 root names, and they are not nested', () => {
    expect(TEMPLATE_PARAMETER_TYPES).toHaveLength(16);
    expect(ROOT_PARAMETER_TYPES).toHaveLength(20);
    expect(parameterTypesFor('template')).toBe(TEMPLATE_PARAMETER_TYPES);
    expect(parameterTypesFor('root')).toBe(ROOT_PARAMETER_TYPES);
    expect(TEMPLATE_PARAMETER_TYPES).toContain('legacyObject');
    expect(ROOT_PARAMETER_TYPES).not.toContain('legacyObject');
  });

  it.each([
    ['legacyObject', 'template', true],
    ['legacyObject', 'root', false],
    ['environment', 'root', true],
    ['environment', 'template', false],
    ['filePath', 'template', false],
    ['pool', 'template', false],
    ['secureFile', 'template', false],
    ['serviceConnection', 'template', false],
    ['stringList', 'template', true],
    ['stringList', 'root', true],
  ] as const)('%s in %s position: accepted=%s', (type, position, accepted) => {
    const result = readParameterDeclarations(
      parse(`parameters:\n  - name: p\n    type: ${type}\n    default: x\n`).root.kind === 'mapping'
        ? entry(
            parse(`parameters:\n  - name: p\n    type: ${type}\n    default: x\n`).root,
            'parameters',
          )
        : undefined,
      { file: FILE, source: `parameters:\n  - name: p\n    type: ${type}\n    default: x\n` },
      position,
    );
    const rejected = result.diagnostics.some((d) => d.code === PARAMETER_UNKNOWN_TYPE);
    expect(!rejected).toBe(accepted);
  });

  it('an unknown type is case-sensitive and reported at the type node', () => {
    const result = bind('parameters:\n  - name: p\n    type: String\n    default: x\n');
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [PARAMETER_UNKNOWN_TYPE, "Unexpected value 'String'"],
    ]);
  });
});

describe('declarations (C-E03-308/313/316/333)', () => {
  it('type: is optional and defaults to string, not inferred from the default', () => {
    expect(plain(bind('parameters:\n  - name: p\n    default: x\n').values.p!)).toBe('x');
    const mapping = bind('parameters:\n  - name: p\n    default: {a: 1}\n');
    expect(mapping.diagnostics.map((d) => d.message)).toEqual([invalidShapeMessage('p', 'string')]);
  });

  it('a duplicate name is rejected once, at the second declaration', () => {
    const result = bind('parameters:\n  - name: p\n    default: a\n  - name: P\n    default: b\n');
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [PARAMETER_DUPLICATE, duplicateMessage('P')],
    ]);
    expect(plain(result.values.p!)).toBe('a');
  });

  it('names fold case on both sides', () => {
    const result = bind(
      'parameters:\n  - name: myParam\n    default: d\ncaller:\n  MYPARAM: passed\n',
    );
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.myParam!)).toBe('passed');
    expect(result.context.keyComparison).toBe('ordinalIgnoreCase');
  });

  it('a declaration with no name is skipped, not reported — the schema rejects it first', () => {
    const result = bind('parameters:\n  - type: string\n    default: x\n');
    expect(result.diagnostics).toEqual([]);
    expect(result.declarations).toEqual([]);
  });

  it('a declaration list that is not a sequence yields nothing', () => {
    expect(bind('parameters: nope\n').declarations).toEqual([]);
    const none = bindParameters(undefined, { file: FILE, source: '' });
    expect(none.declarations).toEqual([]);
    expect(none.diagnostics).toEqual([]);
  });
});

describe('default: admits exactly one expression form (C-E03-315)', () => {
  it('accepts a lone single-quoted string literal, on any type', () => {
    expect(plain(bind("parameters:\n  - name: p\n    default: ${{ 'x' }}\n").values.p!)).toBe('x');
    expect(
      plain(
        bind("parameters:\n  - name: p\n    type: number\n    default: ${{ '8' }}\n").values.p!,
      ),
    ).toBe(8);
  });

  it.each([
    ['a numeric literal', '${{ 42 }}'],
    ['a boolean literal', '${{ true }}'],
    ['a function call', '${{ format(1) }}'],
    ['another parameter', '${{ parameters.other }}'],
    ['a variable', '${{ variables.x }}'],
    ['mixed content', 'pre-${{ 1 }}'],
    ['an unparseable expression', '${{ ) }}'],
  ])('rejects %s with the one sentence', (_label, text) => {
    const result = bind(`parameters:\n  - name: p\n    default: ${text}\n`);
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [PARAMETER_EXPRESSION, EXPRESSION_NOT_ALLOWED],
    ]);
  });

  it('a default is type-checked and values-checked at the declaration (C-E03-311/312)', () => {
    expect(
      bind('parameters:\n  - name: p\n    type: number\n    default: abc\n').diagnostics.map(
        (d) => d.message,
      ),
    ).toEqual([invalidValueMessage('p', 'abc', 'number')]);
    expect(
      bind(
        'parameters:\n  - name: p\n    values: [alpha, beta]\n    default: gamma\n',
      ).diagnostics.map((d) => [d.code, d.message]),
    ).toEqual([[PARAMETER_NOT_IN_VALUES, notInValuesMessage('p', 'gamma')]]);
  });
});

describe('values: (C-E03-311/314/326)', () => {
  it('is case-sensitive', () => {
    const result = bind(
      'parameters:\n  - name: p\n    values: [alpha]\n    default: alpha\ncaller:\n  p: ALPHA\n',
    );
    expect(result.diagnostics.map((d) => d.message)).toEqual([notInValuesMessage('p', 'ALPHA')]);
  });

  it('runs after coercion, so a number restricted to [1, 2] accepts the string "2"', () => {
    const result = bind(
      "parameters:\n  - name: p\n    type: number\n    values: [1, 2]\n    default: 1\ncaller:\n  p: '2'\n",
    );
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toBe(2);
  });

  it('is silently ignored on a type that cannot carry one', () => {
    const result = bind(
      'parameters:\n  - name: p\n    type: object\n    values: [alpha]\n    default: {a: 1}\n',
    );
    expect(result.diagnostics).toEqual([]);
    expect(plain(result.values.p!)).toEqual({ a: 1 });
  });

  it('checks a stringList per item', () => {
    const ok = bind(
      'parameters:\n  - name: p\n    type: stringList\n    values: [a, b]\n    default: [a, b]\n',
    );
    expect(ok.diagnostics).toEqual([]);
    const bad = bind(
      'parameters:\n  - name: p\n    type: stringList\n    values: [a, b]\n    default: [a, zzz]\n',
    );
    expect(bad.diagnostics.map((d) => d.message)).toEqual([notInValuesMessage('p', 'zzz')]);
  });

  it('an empty values list restricts nothing', () => {
    const result = bind('parameters:\n  - name: p\n    values: []\n    default: anything\n');
    expect(result.diagnostics).toEqual([]);
  });

  it('a stringList of non-scalars takes the shape sentence', () => {
    const { node, source } = valueNode('[{a: 1}]');
    expect(coerceParameterValue('p', 'stringList', node, source)).toEqual({
      ok: false,
      message: invalidShapeMessage('p', 'stringList'),
    });
  });
});

describe('arguments and scope (C-E03-318/319/320)', () => {
  it('rejects an argument the callee never declared', () => {
    const result = bind('parameters:\n  - name: p\n    default: d\ncaller:\n  p: v\n  extra: x\n');
    expect(result.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [PARAMETER_UNEXPECTED, unexpectedParameterMessage('extra')],
    ]);
  });

  it('accepts any argument when the callee declares no parameters block at all', () => {
    const { root } = parse('caller:\n  anything: x\n');
    const args = entry(root, 'caller');
    const result = bindParameters(
      undefined,
      { file: FILE, source: 'caller:\n  anything: x\n' },
      {
        node: args?.kind === 'mapping' ? args : undefined,
      },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('gives each file its own frame: only the declared names are in the context', () => {
    const result = bind('parameters:\n  - name: p\n    default: ok\ncaller:\n  p: ok\n');
    expect(Object.keys(result.values)).toEqual(['p']);
    expect(result.context.missPolicy).toBe('error');
  });
});

describe('queue-time values (C-E03-329/330/331)', () => {
  it('runs the same per-type conversion a YAML value gets', () => {
    const number = bind('parameters:\n  - name: p\n    type: number\n    default: 1\n', {
      position: 'root',
      queue: { p: '8' },
    });
    expect(plain(number.values.p!)).toBe(8);

    const boolean = bind('parameters:\n  - name: p\n    type: boolean\n    default: false\n', {
      position: 'root',
      queue: { p: 'true' },
    });
    expect(plain(boolean.values.p!)).toBe(true);
  });

  it('parses a JSON string into an object parameter, and keeps a non-JSON string as text', () => {
    const parsed = bind('parameters:\n  - name: p\n    type: object\n    default: {}\n', {
      position: 'root',
      queue: { p: '{"a": 1, "b": [true, null]}' },
    });
    expect(plain(parsed.values.p!)).toEqual({ a: 1, b: [true, null] });

    const legacy = bind('parameters:\n  - name: p\n    type: legacyObject\n    default: {}\n', {
      queue: { p: '{"a": 1, "b": [true, null]}' },
    });
    expect(plain(legacy.values.p!)).toEqual({ a: '1', b: ['true', ''] });

    const text = bind('parameters:\n  - name: p\n    type: object\n    default: {}\n', {
      position: 'root',
      queue: { p: 'not json' },
    });
    expect(plain(text.values.p!)).toBe('not json');
  });

  it('satisfies requiredness and is still subject to values:', () => {
    const required = bind('parameters:\n  - name: p\n    type: string\n', {
      position: 'root',
      queue: { p: 'supplied' },
    });
    expect(required.diagnostics).toEqual([]);
    expect(plain(required.values.p!)).toBe('supplied');

    const restricted = bind('parameters:\n  - name: p\n    values: [alpha]\n    default: alpha\n', {
      position: 'root',
      queue: { p: 'gamma' },
    });
    expect(restricted.diagnostics.map((d) => d.message)).toEqual([
      notInValuesMessage('p', 'gamma'),
    ]);
  });

  it('reports an undeclared queue-time parameter, and a wrong-typed one', () => {
    const undeclared = bind('parameters:\n  - name: p\n    default: d\n', {
      position: 'root',
      queue: { nosuch: 'x' },
    });
    expect(undeclared.diagnostics.map((d) => [d.code, d.message])).toEqual([
      [PARAMETER_UNEXPECTED, unexpectedParameterMessage('nosuch')],
    ]);

    const wrong = bind('parameters:\n  - name: p\n    type: number\n    default: 1\n', {
      position: 'root',
      queue: { p: 'abc' },
    });
    expect(wrong.diagnostics.map((d) => d.message)).toEqual([
      invalidValueMessage('p', 'abc', 'number'),
    ]);
  });

  it('reports an undeclared queue-time parameter even when nothing is declared at all', () => {
    const result = bindParameters(
      undefined,
      { file: FILE, source: '' },
      { queue: { x: '1' } },
      'root',
    );
    expect(result.diagnostics.map((d) => d.message)).toEqual([unexpectedParameterMessage('x')]);
  });
});

describe('an argument wins over a queue-time value, which wins over the default', () => {
  it('applies the three sources in order', () => {
    const declaration = 'parameters:\n  - name: p\n    default: fromDefault\n';
    expect(plain(bind(declaration, { position: 'root' }).values.p!)).toBe('fromDefault');
    expect(
      plain(bind(declaration, { position: 'root', queue: { p: 'fromQueue' } }).values.p!),
    ).toBe('fromQueue');
    expect(
      plain(
        bind(`${declaration}caller:\n  p: fromArgument\n`, {
          position: 'root',
          queue: { p: 'fromQueue' },
        }).values.p!,
      ),
    ).toBe('fromArgument');
  });
});
