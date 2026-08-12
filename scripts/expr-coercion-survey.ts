// E02-S02-T02 grounding: resolve the conversion-table corners the public documentation leaves
// ambiguous. Each probe is isolated because comparison conversion failures can reject the whole
// preview document.
//
// Run: node scripts/expr-coercion-survey.ts [probe-name]
// Output: research/experiments/E02-coercion/<probe-name>.md (redacted request/response)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-coercion');

const pipeline = (expression: string): string => `parameters:
- name: objectA
  type: object
  default:
    key: value
- name: objectB
  type: object
  default:
    key: value
- name: arrayA
  type: object
  default: [one, two]
- name: arrayB
  type: object
  default: [one, two]
variables:
  probe: \${{ ${expression} }}
steps:
- script: echo done
`;

const probe = (name: string, expression: string, asserts: string): Probe => ({
  name,
  asserts: `Expression: \`${expression}\`. ${asserts}`,
  yaml: pipeline(expression),
});

const PROBES: readonly Probe[] = [
  probe(
    'empty-string-left-null',
    "eq('', parameters.objectA.missing)",
    'Null-to-String direction.',
  ),
  probe(
    'null-left-empty-string',
    "eq(parameters.objectA.missing, '')",
    'String-to-Null direction.',
  ),
  probe('object-same-reference', 'eq(parameters.objectA, parameters.objectA)', 'Object identity.'),
  probe(
    'object-distinct-equal-shape',
    'eq(parameters.objectA, parameters.objectB)',
    'Object shape vs identity.',
  ),
  probe(
    'object-same-order',
    'le(parameters.objectA, parameters.objectA)',
    'Ordered comparison with identical Object reference.',
  ),
  probe(
    'object-distinct-order',
    'lt(parameters.objectA, parameters.objectB)',
    'Ordered comparison with distinct Objects.',
  ),
  probe('array-same-reference', 'eq(parameters.arrayA, parameters.arrayA)', 'Array identity.'),
  probe(
    'array-distinct-equal-shape',
    'eq(parameters.arrayA, parameters.arrayB)',
    'Array shape vs identity.',
  ),
  probe(
    'array-same-order',
    'le(parameters.arrayA, parameters.arrayA)',
    'Ordered comparison with identical Array reference.',
  ),
  probe(
    'array-distinct-order',
    'lt(parameters.arrayA, parameters.arrayB)',
    'Ordered comparison with distinct Arrays.',
  ),
  probe('number-to-string-half', "eq('0.5', .5)", 'Number formatting in String-left comparison.'),
  probe('string-to-number-half', "eq(.5, '0.5')", 'Invariant String-to-Number partial conversion.'),
  probe('number-to-string-thousands', "eq('1000', 1000)", 'Number formatting omits grouping.'),
  probe('string-to-number-thousands', "eq(1000, '1,000')", 'Invariant String-to-Number grouping.'),
  probe('string-number-failure-eq', "eq(1, 'x')", 'eq conversion-failure result.'),
  probe('string-number-failure-ne', "ne(1, 'x')", 'ne conversion-failure result.'),
  probe(
    'string-number-failure-lt',
    "lt(1, 'x')",
    'ordered comparison conversion-failure behavior.',
  ),
  probe('number-to-version', 'eq(1.2.0, 1.2)', 'Number-to-Version partial conversion.'),
  probe(
    'number-to-version-ordered',
    'lt(1.2.0, 1.3)',
    'Successful Number-to-Version conversion produces a comparable two-component Version.',
  ),
  probe(
    'number-to-version-invalid',
    'lt(1.2.0, 2)',
    'A whole Number has no nonzero decimal component and cannot convert to Version.',
  ),
  probe('version-to-number', 'eq(1.2, 1.2.0)', 'Unsupported Version-to-Number direction.'),
  probe('string-to-version-two', "eq(1.2.0, '1.2')", 'String-to-Version accepts two components.'),
  probe(
    'string-to-version-ordered',
    "lt(1.2.0, '1.3')",
    'Successful String-to-Version conversion accepts two components.',
  ),
  probe(
    'string-to-version-three',
    "eq(1.2.0, '1.2.0')",
    'Three-component String-to-Version equality control.',
  ),
  probe('version-order', 'lt(1.2.3, 1.10.0)', 'Version component-wise ordering.'),
  probe('case-insensitive-string', "eq('AbC', 'aBc')", 'Ordinal-ignore-case string equality.'),
  probe('boolean-to-string', "eq('True', true)", 'Boolean-to-String capitalization.'),
  probe('null-to-number', 'eq(0, parameters.objectA.missing)', 'Null-to-Number conversion.'),
];

await runProbes(PROBES, OUT_DIR);
