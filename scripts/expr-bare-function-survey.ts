// E02-S01-T03 grounding — a bare known function is not a named value. The existing E03 datum
// proves `${{ eq }}` in one value slot; these deliberately vary the slot and the name family before
// the parser grows the corresponding error kind.
//
// Run: node scripts/expr-bare-function-survey.ts
// Output: research/experiments/E02-bare-functions/*.md (redacted)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E02-bare-functions');

const PROBES: readonly Probe[] = [
  {
    name: 'bare-nonstatus-compile',
    asserts:
      'A bare non-status function in a compile-time variable reports the missing-parenthesis ' +
      'error, not an unrecognized named value.',
    yaml: `variables:
  probe: \${{ eq }}
steps:
- script: echo done
`,
  },
  {
    name: 'bare-nonstatus-job-condition',
    asserts:
      'The same bare non-status function has the missing-parenthesis error in a job condition, ' +
      'whose function table is parsed by the service preview path.',
    yaml: `jobs:
- job: Probe
  condition: eq
  steps:
  - script: echo done
`,
  },
  {
    name: 'bare-context-compile',
    asserts:
      'A bare legal context name is not mistaken for a function; preview evaluates it as a ' +
      'mapping, then schema validation rejects that mapping as a variable value.',
    yaml: `variables:
  probe: \${{ variables }}
steps:
- script: echo done
`,
  },
  {
    name: 'bare-status-outside-slot',
    asserts:
      'A status-function spelling in a compile-time variable is unavailable in that slot and ' +
      'therefore reports an unrecognized value rather than the missing-parenthesis error.',
    yaml: `variables:
  probe: \${{ always }}
steps:
- script: echo done
`,
  },
];

await runProbes(PROBES, OUT_DIR);
