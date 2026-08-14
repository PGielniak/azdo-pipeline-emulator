import {
  NULL,
  arrayValue,
  booleanValue,
  numberValue,
  objectValue,
  stringValue,
  versionValue,
  type ComparisonOperator,
  type ExprValue,
} from '../../src/index.js';

export interface CoercionRow {
  readonly id: string;
  readonly claim: `C-E02-${number}`;
  readonly operator: ComparisonOperator;
  readonly left: ExprValue;
  readonly right: ExprValue;
  readonly expected: boolean | 'throws';
  /**
   * Source spelling of the same comparison, for the dual-backend harness (E02-S05-T02).
   *
   * Absent where the scenario has no source spelling at all: Null is an unresolvable *name* rather
   * than a literal (C-E02-003), Object/Array identity cannot be written down, and a two-part
   * Version needs 3..4 parts as a literal (C-E02-022). Those rows stay evaluator-only.
   */
  readonly source?: string;
}

type Relation = -1 | 0 | 1 | 'error';
interface Scenario {
  readonly id: string;
  readonly claim: CoercionRow['claim'];
  readonly left: ExprValue;
  readonly right: ExprValue;
  readonly relation: Relation;
  readonly orderedError?: boolean;
  /** Literal spellings of `left`/`right`; both present or both absent. */
  readonly leftSource?: string;
  readonly rightSource?: string;
}

const sharedObject = { key: stringValue('value') };
const sharedArray = [stringValue('one')];

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'boolean-order',
    leftSource: 'false',
    rightSource: 'true',
    claim: 'C-E02-020',
    left: booleanValue(false),
    right: booleanValue(true),
    relation: -1,
  },
  { id: 'null-empty', claim: 'C-E02-021', left: NULL, right: stringValue(''), relation: 0 },
  {
    id: 'decimal-string',
    leftSource: '0.5',
    rightSource: "'0.5'",
    claim: 'C-E02-021',
    left: numberValue(0.5),
    right: stringValue('0.5'),
    relation: 0,
  },
  {
    id: 'thousands-string',
    leftSource: '1000',
    rightSource: "'1,000'",
    claim: 'C-E02-021',
    left: numberValue(1000),
    right: stringValue('1,000'),
    relation: 0,
  },
  {
    id: 'string-case',
    leftSource: "'AbC'",
    rightSource: "'aBc'",
    claim: 'C-E02-020',
    left: stringValue('AbC'),
    right: stringValue('aBc'),
    relation: 0,
  },
  {
    id: 'number-order',
    leftSource: '-1',
    rightSource: '2',
    claim: 'C-E02-020',
    left: numberValue(-1),
    right: numberValue(2),
    relation: -1,
  },
  {
    id: 'version-order',
    leftSource: '1.2.3',
    rightSource: '1.10.0',
    claim: 'C-E02-022',
    left: versionValue([1, 2, 3]),
    right: versionValue([1, 10, 0]),
    relation: -1,
  },
  {
    id: 'version-missing-build',
    claim: 'C-E02-022',
    left: versionValue([1, 2]),
    right: versionValue([1, 2, 0]),
    relation: -1,
  },
  {
    id: 'number-to-version',
    leftSource: '1.2.0',
    rightSource: '1.3',
    claim: 'C-E02-022',
    left: versionValue([1, 2, 0]),
    right: numberValue(1.3),
    relation: -1,
  },
  {
    id: 'string-to-version',
    leftSource: '1.2.0',
    rightSource: "'1.3'",
    claim: 'C-E02-022',
    left: versionValue([1, 2, 0]),
    right: stringValue('1.3'),
    relation: -1,
  },
  {
    id: 'failed-number',
    leftSource: '1',
    rightSource: "'x'",
    claim: 'C-E02-021',
    left: numberValue(1),
    right: stringValue('x'),
    relation: 'error',
  },
  {
    id: 'object-identity',
    claim: 'C-E02-023',
    left: objectValue(sharedObject),
    right: objectValue(sharedObject),
    relation: 0,
    orderedError: true,
  },
  {
    id: 'object-distinct',
    claim: 'C-E02-023',
    left: objectValue({ key: stringValue('value') }),
    right: objectValue({ key: stringValue('value') }),
    relation: 'error',
  },
  {
    id: 'array-identity',
    claim: 'C-E02-023',
    left: arrayValue(sharedArray),
    right: arrayValue(sharedArray),
    relation: 0,
    orderedError: true,
  },
  {
    id: 'array-distinct',
    claim: 'C-E02-023',
    left: arrayValue([stringValue('one')]),
    right: arrayValue([stringValue('one')]),
    relation: 'error',
  },
  { id: 'null-to-number', claim: 'C-E02-020', left: numberValue(0), right: NULL, relation: 0 },
  {
    id: 'boolean-to-string',
    leftSource: "'True'",
    rightSource: 'true',
    claim: 'C-E02-020',
    left: stringValue('True'),
    right: booleanValue(true),
    relation: 0,
  },
  {
    id: 'boolean-to-number',
    leftSource: '1',
    rightSource: 'true',
    claim: 'C-E02-020',
    left: numberValue(1),
    right: booleanValue(true),
    relation: 0,
  },
  {
    id: 'string-order',
    leftSource: "'alpha'",
    rightSource: "'BETA'",
    claim: 'C-E02-020',
    left: stringValue('alpha'),
    right: stringValue('BETA'),
    relation: -1,
  },
  {
    id: 'null-nonempty',
    claim: 'C-E02-020',
    left: NULL,
    right: stringValue('x'),
    relation: 'error',
  },
];

const OPERATORS: readonly ComparisonOperator[] = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'];

function expectation(
  operator: ComparisonOperator,
  relation: Relation,
  orderedError = false,
): boolean | 'throws' {
  if (orderedError && operator !== 'eq' && operator !== 'ne') return 'throws';
  if (relation === 'error') return operator === 'eq' ? false : operator === 'ne' ? true : 'throws';
  switch (operator) {
    case 'eq':
      return relation === 0;
    case 'ne':
      return relation !== 0;
    case 'lt':
      return relation < 0;
    case 'le':
      return relation <= 0;
    case 'gt':
      return relation > 0;
    case 'ge':
      return relation >= 0;
  }
}

/** 20 grounded scenarios × 6 operators = 120 literal conformance rows. */
export const COERCION_ROWS: readonly CoercionRow[] = SCENARIOS.flatMap((scenario) =>
  OPERATORS.map((operator) => ({
    id: `${scenario.id}-${operator}`,
    claim: scenario.claim,
    operator,
    left: scenario.left,
    right: scenario.right,
    expected: expectation(operator, scenario.relation, scenario.orderedError),
    ...(scenario.leftSource !== undefined && scenario.rightSource !== undefined
      ? { source: `${operator}(${scenario.leftSource}, ${scenario.rightSource})` }
      : {}),
  })),
);
