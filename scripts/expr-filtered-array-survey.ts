// E02-S05-T04 grounding — filtered-array traversal is documented only by `foo.*.id`.
// This matrix asks the live preview service for the missing contract: both wildcard spellings,
// Array/Object/Null/missing/scalar targets, terminal filters, property and numeric chains, and
// nested filters. The pinned actions/runner Index.cs is a hypothesis source; the oracle decides.
//
// Run: node scripts/expr-filtered-array-survey.ts [probe-name]
// Output: research/experiments/E02-filtered-arrays/<probe-name>.md (redacted)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-filtered-arrays');

const PARAMETERS = `parameters:
- name: data
  type: object
  default:
    rows:
    - id: 1
      child:
        values: [a, b]
    - name: missing-id
      child:
        values: [c]
    - id:
      child:
        values: []
    - plain
    mapping:
      first:
        id: 10
      second:
        id: 20
    groups:
    - - id: 100
      - id: 101
    - - id: 200
    yamlNull:
    scalar: text
    nested:
      left:
        children:
        - value: L1
        - value: L2
      right:
        children:
        - value: R1
`;

const compile = (name: string, expression: string, asserts: string): Probe => ({
  name,
  asserts: `Compile-time filtered-array expression: \`${expression}\`. ${asserts}`,
  yaml:
    PARAMETERS +
    `variables:\n  probe: \${{ convertToJson(${expression}) }}\nsteps:\n- script: echo done\n`,
});

const PROBES: readonly Probe[] = [
  compile(
    'array-terminal-dot',
    'parameters.data.rows.*',
    'Settles terminal wildcard over an Array and whether every element is retained.',
  ),
  compile(
    'array-terminal-index',
    'parameters.data.rows[*]',
    'Checks that the bracket spelling has the same terminal result.',
  ),
  compile(
    'array-property-dot',
    'parameters.data.rows.*.id',
    'Settles missing-property omission versus Null insertion and explicit Null preservation.',
  ),
  compile(
    'array-property-index',
    'parameters.data.rows[*].id',
    'Checks that the bracket spelling has the same mapped-property result.',
  ),
  compile(
    'object-terminal-dot',
    'parameters.data.mapping.*',
    'Settles terminal wildcard over an Object and value ordering.',
  ),
  compile(
    'object-terminal-index',
    'parameters.data.mapping[*]',
    'Checks that the bracket spelling has the same Object values.',
  ),
  compile(
    'object-property-dot',
    'parameters.data.mapping.*.id',
    'Settles mapped property access after an Object wildcard.',
  ),
  compile(
    'object-property-index',
    'parameters.data.mapping[*].id',
    'Checks that the bracket spelling has the same mapped Object result.',
  ),
  compile(
    'yaml-null-terminal-dot',
    'parameters.data.yamlNull.*',
    'Control: YAML null in a parameter is normalized to an empty string before expression evaluation.',
  ),
  compile(
    'yaml-null-terminal-index',
    'parameters.data.yamlNull[*]',
    'Checks the bracket spelling against the same YAML-null-to-empty-string control.',
  ),
  compile(
    'expression-null-terminal-dot',
    "coalesce('', variables.missing).*",
    'Settles wildcard over a genuine Null produced by expression evaluation.',
  ),
  compile(
    'expression-null-terminal-index',
    "coalesce('', variables.missing)[*]",
    'Checks that the bracket spelling has the same genuine-Null result.',
  ),
  compile(
    'missing-terminal-dot',
    'parameters.data.absent.*',
    'Settles wildcard over a missing nested member after ordinary Null propagation.',
  ),
  compile(
    'missing-terminal-index',
    'parameters.data.absent[*]',
    'Checks that the bracket spelling has the same missing-target result.',
  ),
  compile(
    'scalar-terminal-dot',
    'parameters.data.scalar.*',
    'Control for wildcard over a non-collection primitive.',
  ),
  compile(
    'scalar-terminal-index',
    'parameters.data.scalar[*]',
    'Checks that the bracket spelling has the same primitive-target result.',
  ),
  compile(
    'nested-filter-dot',
    'parameters.data.groups.*.*.id',
    'Settles flattening when a second wildcard is applied to child Arrays.',
  ),
  compile(
    'nested-filter-index',
    'parameters.data.groups[*][*].id',
    'Checks the fully bracketed spelling of the same nested filter.',
  ),
  compile(
    'object-array-nested-dot',
    'parameters.data.nested.*.children.*.value',
    'Settles Object values followed by child-Array flattening and property mapping.',
  ),
  compile(
    'object-array-nested-index',
    'parameters.data.nested[*].children[*].value',
    'Checks the bracket spelling at both filtered-array levels.',
  ),
  compile(
    'mapped-numeric-index-dot',
    'parameters.data.groups.*[0].id',
    'Settles numeric indexing mapped over each child Array.',
  ),
  compile(
    'mapped-numeric-index-bracket',
    'parameters.data.groups[*][0].id',
    'Checks the bracket wildcard spelling for mapped numeric indexing.',
  ),
  compile(
    'index-after-primitive-map',
    'parameters.data.rows.*.id[0]',
    'Determines whether indexing a filtered primitive result selects the result or maps into each primitive.',
  ),
  compile(
    'missing-after-filter',
    'parameters.data.mapping.*.absent',
    'Settles the all-miss result after filtering an Object.',
  ),
];

await runProbes(PROBES, OUT_DIR);
