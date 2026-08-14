// E01-S01-T04 grounding — duplicate template-expression mapping keys.
//
// C-E03-111 established that two byte-identical `${{ if }}` keys are accepted and their
// mapping bodies are merged. These two adjacent cells decide whether the parse-time exemption
// applies to every recognized directive or to every template expression used as a key.
//
// Run: node scripts/duplicate-key-survey.ts [probe-name]
// Output: research/experiments/E01-directive-duplicates/<probe-name>.md (redacted)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E01-directive-duplicates');

const PROBES: readonly Probe[] = [
  {
    name: 'dup-identical-each-keys',
    asserts:
      'Two byte-identical recognized `${{ each }}` keys in one mapping. Acceptance with both ' +
      'generated variables present establishes that duplicate-key parsing exempts `each` like `if`.',
    yaml: `parameters:
- name: items
  type: object
  default: [one]
variables:
  \${{ each item in parameters.items }}:
    EACH_A: \${{ item }}
  \${{ each item in parameters.items }}:
    EACH_B: \${{ item }}
steps:
- script: echo $(EACH_A) $(EACH_B)
`,
  },
  {
    name: 'dup-ordinary-expression-keys',
    asserts:
      'Two byte-identical ordinary expression keys `${{ pair.key }}` in one mapping. The result ' +
      'decides whether the duplicate-key exemption is directive-only or covers every expression key.',
    yaml: `parameters:
- name: pairs
  type: object
  default:
  - key: PROBE
steps:
- \${{ each pair in parameters.pairs }}:
  - script: echo probe
    env:
      \${{ pair.key }}: first
      \${{ pair.key }}: second
`,
  },
];

await runProbes(PROBES, OUT_DIR);
