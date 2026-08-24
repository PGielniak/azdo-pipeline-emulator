// E04-S03-T02 grounding — how does the service phrase missing-dependency and cycle errors?
//
// The task's Do names three behaviors: the differing defaults (stages sequential, jobs parallel),
// cycle/missing-target errors, and empty-`dependsOn: []` semantics. The defaults are documented
// (quoted in the claim file); what the docs do not say is what a *broken* graph looks like at
// validation time, which is what these probes measure. The model must reject a missing dependency
// target "same as server" (docs/01 §6), so the server's exact phrasing is the parity target — but
// only if the server rejects at preview time at all; if it does not, cycle/missing-target checking
// is ours alone and the probes establish that negative fact rather than a wording.
import { runProbes, type Probe } from './oracle-transcript.ts';

const probe = (name: string, asserts: string, yaml: string): Probe => ({ name, asserts, yaml });

const PROBES: readonly Probe[] = [
  probe(
    'missing-stage-dep',
    'A stage `dependsOn` a stage name that does not exist. Does preview validate the cross-reference, and with what wording?',
    `stages:
- stage: A
  jobs:
  - job: a1
    steps:
    - script: echo A
- stage: B
  dependsOn: NoSuchStage
  jobs:
  - job: b1
    steps:
    - script: echo B
`,
  ),
  probe(
    'missing-job-dep',
    'A job `dependsOn` a job name that does not exist in its own stage. Same question, one level down.',
    `stages:
- stage: A
  jobs:
  - job: A1
    steps:
    - script: echo A
  - job: A2
    dependsOn: NoSuchJob
    steps:
    - script: echo B
`,
  ),
  probe(
    'stage-cycle',
    'Two stages depend on each other. Does preview reject a cycle, or is cycle detection run-time only?',
    `stages:
- stage: A
  dependsOn: B
  jobs:
  - job: a1
    steps:
    - script: echo A
- stage: B
  dependsOn: A
  jobs:
  - job: b1
    steps:
    - script: echo B
`,
  ),
  probe(
    'job-cycle',
    'Two jobs in one stage depend on each other.',
    `stages:
- stage: A
  jobs:
  - job: A1
    dependsOn: A2
    steps:
    - script: echo A
  - job: A2
    dependsOn: A1
    steps:
    - script: echo B
`,
  ),
  probe(
    'stage-self-dep',
    'A stage depends on itself — the minimal cycle.',
    `stages:
- stage: A
  dependsOn: A
  jobs:
  - job: a1
    steps:
    - script: echo A
`,
  ),
  probe(
    'empty-dependson-stage',
    'Control: `dependsOn: []` on a stage survives expansion — the "runs in parallel" meaning is run-time ordering, not expansion.',
    `stages:
- stage: A
  jobs:
  - job: a1
    steps:
    - script: echo A
- stage: B
  dependsOn: []
  jobs:
  - job: b1
    steps:
    - script: echo B
`,
  ),
];

await runProbes(PROBES, 'research/experiments/E04-dependency-graph');
