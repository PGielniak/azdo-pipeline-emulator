// E02-S02-T03 grounding: object/array member access, missing values, safe chaining, and casing.
// Run: node scripts/expr-member-survey.ts [probe-name]
// Output: research/experiments/E02-members/<probe-name>.md (redacted request/response)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-members');

const pipeline = (expression: string): string => `parameters:
- name: obj
  type: object
  default:
    CamelKey: value
    nested:
      DeepKey: deep
    dotted.name: dotted
    '1': numeric-key
    empty: ''
    list: [zero, one]
variables:
  MyVar: variable-value
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
  probe('property-exact', 'parameters.obj.CamelKey', 'Exact-case property lookup.'),
  probe('property-lower', 'parameters.obj.camelkey', 'Property lookup case sensitivity.'),
  probe('property-upper', 'parameters.obj.CAMELKEY', 'Property lookup case sensitivity control.'),
  probe('index-exact', "parameters.obj['CamelKey']", 'Exact-case string index lookup.'),
  probe('index-lower', "parameters.obj['camelkey']", 'String index lookup case sensitivity.'),
  probe('variable-property-lower', 'variables.myvar', 'Variables-context property casing.'),
  probe('variable-index-upper', "variables['MYVAR']", 'Variables-context index casing.'),
  probe(
    'dotted-index',
    "parameters.obj['dotted.name']",
    'Index reaches keys illegal to property syntax.',
  ),
  probe('numeric-object-index', 'parameters.obj[1]', 'Object index converts primitive to String.'),
  probe(
    'missing-property',
    "coalesce(parameters.obj.missing, 'fallback')",
    'Dictionary miss is Null.',
  ),
  probe(
    'missing-index',
    "coalesce(parameters.obj['no.such'], 'fallback')",
    'Indexed dictionary miss is Null.',
  ),
  probe(
    'missing-chain-property',
    "coalesce(parameters.obj.missing.deeper, 'fallback')",
    'Property chaining through Null is safe.',
  ),
  probe(
    'missing-chain-index',
    "coalesce(parameters.obj.missing['deeper'], 'fallback')",
    'Indexing into Null is safe.',
  ),
  probe(
    'primitive-chain',
    "coalesce(parameters.obj.CamelKey.deeper, 'fallback')",
    'Indexing a non-collection yields Null.',
  ),
  probe('array-zero', 'parameters.obj.list[0]', 'Array indexing starts at zero.'),
  probe(
    'array-one-string',
    "parameters.obj.list['1']",
    'Array index converts numeric String to Number.',
  ),
  probe('array-fraction', 'parameters.obj.list[1.9]', 'Array index floors a non-negative Number.'),
  probe(
    'array-negative',
    "coalesce(parameters.obj.list[-1], 'fallback')",
    'Negative array index is a miss.',
  ),
  probe(
    'array-out-of-range',
    "coalesce(parameters.obj.list[2], 'fallback')",
    'Out-of-range array index is a miss.',
  ),
  probe(
    'array-nonnumeric',
    "coalesce(parameters.obj.list['x'], 'fallback')",
    'Non-numeric array index is a miss.',
  ),
  probe(
    'array-null-index',
    'parameters.obj.list[parameters.obj.missing]',
    'Null array index converts to zero.',
  ),
];

await runProbes(PROBES, OUT_DIR);
