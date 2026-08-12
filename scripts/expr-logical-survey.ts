// E02-S03-T01 grounding: logical, comparison, and membership function edge cases.
// Run: node scripts/expr-logical-survey.ts [probe-name]
// Output: research/experiments/E02-logical/<probe-name>.md (redacted request/response)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-logical');

const pipeline = (expression: string, parameters = ''): string => `${parameters}variables:
  probe: \${{ ${expression} }}
steps:
- script: echo done
`;

const probe = (name: string, expression: string, asserts: string, parameters = ''): Probe => ({
  name,
  asserts: `Expression: \`${expression}\`. ${asserts}`,
  yaml: pipeline(expression, parameters),
});

const ARRAY_PARAMETER = `parameters:
- name: items
  type: object
  default: [Alpha, beta, 1]
`;

const OBJECT_PARAMETER = `parameters:
- name: values
  type: object
  default:
    first: Alpha
    second: beta
    numericText: '01'
`;

const PROBES: readonly Probe[] = [
  probe(
    'and-short-circuit',
    "and(false, lt(1, 'not-a-number'))",
    'A false first operand prevents evaluation of the failing second operand.',
  ),
  probe(
    'or-short-circuit',
    "or(true, lt(1, 'not-a-number'))",
    'A true first operand prevents evaluation of the failing second operand.',
  ),
  probe(
    'in-short-circuit',
    "in('Alpha', 'alpha', lt(1, 'not-a-number'))",
    'The first match prevents evaluation of later candidates.',
  ),
  probe(
    'not-in-short-circuit',
    "notIn('Alpha', 'alpha', lt(1, 'not-a-number'))",
    'The first match prevents evaluation of later candidates.',
  ),
  probe('in-one-argument', "in('Alpha')", 'Settles the documented minimum arity.'),
  probe('not-in-one-argument', "notIn('Alpha')", 'Settles the documented minimum arity.'),
  probe(
    'contains-array-hit',
    "contains(parameters.items, 'BETA')",
    'Settles whether contains accepts arrays and, if so, comparison casing.',
    ARRAY_PARAMETER,
  ),
  probe(
    'contains-array-number',
    "contains(parameters.items, '1')",
    'Settles array-element coercion direction.',
    ARRAY_PARAMETER,
  ),
  probe(
    'contains-value-object-hit',
    "containsValue(parameters.values, 'BETA')",
    'Object values participate in ordinal-ignore-case membership.',
    OBJECT_PARAMETER,
  ),
  probe(
    'contains-value-array-hit',
    "containsValue(parameters.items, 'BETA')",
    'Array items participate in ordinal-ignore-case membership.',
    ARRAY_PARAMETER,
  ),
  probe(
    'contains-value-conversion-direction',
    'containsValue(parameters.values, 1)',
    'A collection String value is converted to the right parameter Number type.',
    OBJECT_PARAMETER,
  ),
  probe(
    'contains-value-primitive-left',
    "containsValue('Alpha', 'alpha')",
    'Settles the fallback when the left parameter is neither Array nor Object.',
  ),
];

await runProbes(PROBES, OUT_DIR);
