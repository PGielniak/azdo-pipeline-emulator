import { describe, expect, it, vi } from 'vitest';
import {
  ExprConversionError,
  ExprUnsupportedError,
  ExprKeyNotFoundError,
  arrayValue,
  booleanValue,
  evaluateExpression,
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

describe('AST evaluator injected state and unsupported boundaries', () => {
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

  it('reports wildcard filtering as an evaluation-time unsupported node', () => {
    expect(() =>
      evaluate(
        'parameters.Items[*]',
        context('template-expression', {
          values: { parameters: parametersContext({ Items: arrayValue([]) }) },
        }),
      ),
    ).toThrow(ExprUnsupportedError);
  });
});
