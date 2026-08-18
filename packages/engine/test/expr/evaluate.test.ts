import { describe, expect, it, vi } from 'vitest';
import {
  ExprConversionError,
  ExprKeyNotFoundError,
  arrayValue,
  booleanValue,
  evaluateExpression,
  filteredArrayValue,
  numberValue,
  objectValue,
  parametersContext,
  parseExpression,
  registryForSlot,
  stringValue,
  variablesContext,
  type ExprEvaluationContext,
  type ExprNode,
  type ExprSlot,
  type ExprValue,
} from '../../src/index.js';

const parse = (source: string, slot: ExprSlot): ExprNode => {
  const result = parseExpression(source, { registry: registryForSlot(slot) });
  if (!result.ok) throw new Error(result.error.message);
  return result.node;
};

const context = (
  slot: ExprSlot,
  overrides: Partial<ExprEvaluationContext> = {},
): ExprEvaluationContext => ({ slot, values: {}, ...overrides });

const evaluate = (
  source: string,
  evaluationContext: ExprEvaluationContext = context('template-expression'),
) => evaluateExpression(parse(source, evaluationContext.slot), evaluationContext);

const filterRows = [
  objectValue({
    id: numberValue(1),
    child: objectValue({ values: arrayValue([stringValue('a'), stringValue('b')]) }),
  }),
  objectValue({
    name: stringValue('missing-id'),
    child: objectValue({ values: arrayValue([stringValue('c')]) }),
  }),
  objectValue({
    id: stringValue(''),
    child: objectValue({ values: arrayValue([]) }),
  }),
  stringValue('plain'),
] as const;

const filterMapping = {
  first: objectValue({ id: numberValue(10) }),
  second: objectValue({ id: numberValue(20) }),
} as const;

const filterGroups = [
  arrayValue([objectValue({ id: numberValue(100) }), objectValue({ id: numberValue(101) })]),
  arrayValue([objectValue({ id: numberValue(200) })]),
] as const;

const filterData = objectValue({
  rows: arrayValue(filterRows),
  mapping: objectValue(filterMapping),
  groups: arrayValue(filterGroups),
  yamlNull: stringValue(''),
  scalar: stringValue('text'),
  nested: objectValue({
    left: objectValue({
      children: arrayValue([
        objectValue({ value: stringValue('L1') }),
        objectValue({ value: stringValue('L2') }),
      ]),
    }),
    right: objectValue({
      children: arrayValue([objectValue({ value: stringValue('R1') })]),
    }),
  }),
});

const filterEvaluationContext = context('template-expression', {
  values: {
    parameters: parametersContext({ data: filterData }),
    variables: variablesContext({}),
  },
});

interface FilterMatrixRow {
  readonly id: string;
  readonly claim: string;
  readonly source: string;
  readonly expected: readonly ExprValue[];
}

/** The 24 live cells in research/experiments/E02-filtered-arrays/README.md. */
const FILTER_MATRIX: readonly FilterMatrixRow[] = [
  {
    id: 'array-terminal-dot',
    claim: 'C-E02-160',
    source: 'parameters.data.rows.*',
    expected: filterRows,
  },
  {
    id: 'array-terminal-index',
    claim: 'C-E02-160',
    source: 'parameters.data.rows[*]',
    expected: filterRows,
  },
  {
    id: 'array-property-dot',
    claim: 'C-E02-161',
    source: 'parameters.data.rows.*.id',
    expected: [numberValue(1), stringValue('')],
  },
  {
    id: 'array-property-index',
    claim: 'C-E02-161',
    source: 'parameters.data.rows[*].id',
    expected: [numberValue(1), stringValue('')],
  },
  {
    id: 'object-terminal-dot',
    claim: 'C-E02-160',
    source: 'parameters.data.mapping.*',
    expected: Object.values(filterMapping),
  },
  {
    id: 'object-terminal-index',
    claim: 'C-E02-160',
    source: 'parameters.data.mapping[*]',
    expected: Object.values(filterMapping),
  },
  {
    id: 'object-property-dot',
    claim: 'C-E02-161',
    source: 'parameters.data.mapping.*.id',
    expected: [numberValue(10), numberValue(20)],
  },
  {
    id: 'object-property-index',
    claim: 'C-E02-161',
    source: 'parameters.data.mapping[*].id',
    expected: [numberValue(10), numberValue(20)],
  },
  {
    id: 'yaml-null-terminal-dot',
    claim: 'C-E02-162',
    source: 'parameters.data.yamlNull.*',
    expected: [],
  },
  {
    id: 'yaml-null-terminal-index',
    claim: 'C-E02-162',
    source: 'parameters.data.yamlNull[*]',
    expected: [],
  },
  {
    id: 'expression-null-terminal-dot',
    claim: 'C-E02-162',
    source: "coalesce('', variables.missing).*",
    expected: [],
  },
  {
    id: 'expression-null-terminal-index',
    claim: 'C-E02-162',
    source: "coalesce('', variables.missing)[*]",
    expected: [],
  },
  {
    id: 'missing-terminal-dot',
    claim: 'C-E02-162',
    source: 'parameters.data.absent.*',
    expected: [],
  },
  {
    id: 'missing-terminal-index',
    claim: 'C-E02-162',
    source: 'parameters.data.absent[*]',
    expected: [],
  },
  {
    id: 'scalar-terminal-dot',
    claim: 'C-E02-162',
    source: 'parameters.data.scalar.*',
    expected: [],
  },
  {
    id: 'scalar-terminal-index',
    claim: 'C-E02-162',
    source: 'parameters.data.scalar[*]',
    expected: [],
  },
  {
    id: 'nested-filter-dot',
    claim: 'C-E02-163',
    source: 'parameters.data.groups.*.*.id',
    expected: [numberValue(100), numberValue(101), numberValue(200)],
  },
  {
    id: 'nested-filter-index',
    claim: 'C-E02-163',
    source: 'parameters.data.groups[*][*].id',
    expected: [numberValue(100), numberValue(101), numberValue(200)],
  },
  {
    id: 'object-array-nested-dot',
    claim: 'C-E02-163',
    source: 'parameters.data.nested.*.children.*.value',
    expected: [stringValue('L1'), stringValue('L2'), stringValue('R1')],
  },
  {
    id: 'object-array-nested-index',
    claim: 'C-E02-163',
    source: 'parameters.data.nested[*].children[*].value',
    expected: [stringValue('L1'), stringValue('L2'), stringValue('R1')],
  },
  {
    id: 'mapped-numeric-index-dot',
    claim: 'C-E02-164',
    source: 'parameters.data.groups.*[0].id',
    expected: [numberValue(100), numberValue(200)],
  },
  {
    id: 'mapped-numeric-index-bracket',
    claim: 'C-E02-164',
    source: 'parameters.data.groups[*][0].id',
    expected: [numberValue(100), numberValue(200)],
  },
  {
    id: 'index-after-primitive-map',
    claim: 'C-E02-164',
    source: 'parameters.data.rows.*.id[0]',
    expected: [],
  },
  {
    id: 'missing-after-filter',
    claim: 'C-E02-161',
    source: 'parameters.data.mapping.*.absent',
    expected: [],
  },
];

describe('AST evaluator composition', () => {
  it('recurses through literals and all three function families', () => {
    expect(evaluate("eq(lower('AB'), 'ab')", context('job-condition'))).toEqual(booleanValue(true));
    expect(
      evaluate(
        "succeeded('BUILD')",
        context('job-condition', {
          status: { dependencies: { Build: 'Succeeded' } },
        }),
      ),
    ).toEqual(booleanValue(true));
  });

  it('resolves contexts and applies property/index access with each object comparer', () => {
    const parameters = parametersContext({
      Config: objectValue({ CamelKey: stringValue('value') }),
      List: arrayValue([stringValue('zero'), stringValue('one')]),
    });
    const evaluationContext = context('template-expression', { values: { parameters } });

    expect(evaluate('PARAMETERS.config.CamelKey', evaluationContext)).toEqual(stringValue('value'));
    expect(evaluate("parameters.List['1']", evaluationContext)).toEqual(stringValue('one'));
    // Nested parameter objects stay ordinal even though the top-level context folds case.
    expect(evaluate('parameters.Config.camelkey', evaluationContext)).toMatchObject({
      kind: 'null',
    });
  });

  it('preserves Null propagation and the parameters key-miss evaluation error', () => {
    expect(
      evaluate(
        'variables.Absent.deeper',
        context('template-expression', {
          values: { variables: variablesContext({ Present: 'yes' }) },
        }),
      ),
    ).toMatchObject({ kind: 'null' });

    expect(() =>
      evaluate(
        'parameters.Absent',
        context('template-expression', { values: { parameters: parametersContext({}) } }),
      ),
    ).toThrow(ExprKeyNotFoundError);
  });

  it('evaluates a dynamic index rather than requiring a static context path', () => {
    expect(
      evaluate(
        'parameters.Items[parameters.Index]',
        context('template-expression', {
          values: {
            parameters: parametersContext({
              Items: arrayValue([stringValue('zero'), stringValue('one')]),
              Index: numberValue(1),
            }),
          },
        }),
      ),
    ).toEqual(stringValue('one'));
  });
});

describe('AST evaluator laziness (C-E02-028/030/048/049)', () => {
  const job = context('job-condition');

  it.each([
    ["and(false, lt(1, 'x'))", false],
    ["or(true, lt(1, 'x'))", true],
    ["in('b', 'B', lt(1, 'x'))", true],
    ["notIn('b', 'B', lt(1, 'x'))", false],
  ] as const)('%s short-circuits before the failing branch', (source, expected) => {
    expect(evaluate(source, job)).toEqual(booleanValue(expected));
  });

  it('coalesce stops after the first nonempty value', () => {
    expect(evaluate("coalesce('hit', lt(1, 'x'))", job)).toEqual(stringValue('hit'));
  });

  it('iif remains eager and evaluates the unselected branch', () => {
    expect(() => evaluate("iif(true, 'hit', lt(1, 'x'))", job)).toThrow(ExprConversionError);
  });
});

describe('AST evaluator injected state', () => {
  it('passes counter state through the general-function context', () => {
    const next = vi.fn(() => 7);
    expect(
      evaluate("counter('prefix', 3)", context('runtime-variable', { counters: { next } })),
    ).toEqual(numberValue(7));
    expect(next).toHaveBeenCalledWith('prefix', 3);
  });

  it('derives status scope from the slot and defaults absent state to the empty graph', () => {
    expect(evaluate('succeeded()', context('job-condition'))).toEqual(booleanValue(true));
    expect(
      evaluate(
        'failed()',
        context('stage-condition', { status: { dependencies: { Build: 'Failed' } } }),
      ),
    ).toEqual(booleanValue(true));
  });
});

describe('filtered-array evaluation (C-E02-160..164)', () => {
  it.each(FILTER_MATRIX)('$claim $id', ({ source, expected }) => {
    expect(evaluate(source, filterEvaluationContext)).toEqual(filteredArrayValue(expected));
  });
});
