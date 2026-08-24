// E04-S03-T03 grounding — what shape a deployment job's `environment:` and `strategy:` arrive in
// after the preview expansion, and which forms the service accepts. The model is built from
// `finalYaml`, so every spelling it must parse has to be measured here or recorded as doc-grounded.
//
// The corpus golden 08-deployment-runonce already shows two facts (environment scalar → `{name}`
// and `strategy:` surviving verbatim); this survey closes the gaps the model's parser still needs:
// the dotted `environment: 'env.resource'` shorthand, the full `{name, resourceName, resourceType}`
// syntax, and how `download: none` inside a hook is rendered for the auto-download flag.
//
// Run: node scripts/deployment-survey.ts
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E04-deployment');

const PROBES: readonly Probe[] = [
  {
    name: 'env-scalar',
    asserts:
      'The scalar `environment: <name>` shorthand is promoted to `environment: {name}` by the ' +
      'service, so the model only ever sees the object form (sibling of C-E04-062 target).',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nstages:\n- stage: A\n  jobs:\n  - deployment: D\n    environment: corpus-staging\n    strategy:\n      runOnce:\n        deploy:\n          steps:\n          - script: echo hi\n',
  },
  {
    name: 'env-dotted',
    asserts:
      'Whether the dotted `environment: env.resource` shorthand is split by the service into ' +
      '{name, resourceName}, or survives as a scalar/string the model must split itself.',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nstages:\n- stage: A\n  jobs:\n  - deployment: D\n    environment: corpus-staging.someResource\n    strategy:\n      runOnce:\n        deploy:\n          steps:\n          - script: echo hi\n',
  },
  {
    name: 'env-full',
    asserts:
      'Whether the full `environment: {name, resourceName, resourceType}` syntax survives verbatim ' +
      'or is rejected when the named resource does not exist in the test org.',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nstages:\n- stage: A\n  jobs:\n  - deployment: D\n    environment:\n      name: corpus-staging\n      resourceName: someResource\n      resourceType: virtualMachine\n    strategy:\n      runOnce:\n        deploy:\n          steps:\n          - script: echo hi\n',
  },
  {
    name: 'runonce-all-hooks',
    asserts:
      'A runOnce strategy with every hook survives the expansion verbatim (the corpus golden shows ' +
      'one instance; this is the exhaustive control the hook-sequence model keys off).',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nstages:\n- stage: A\n  jobs:\n  - deployment: D\n    environment: corpus-staging\n    strategy:\n      runOnce:\n        preDeploy:\n          steps:\n          - script: echo pre\n        deploy:\n          steps:\n          - script: echo deploy\n        routeTraffic:\n          steps:\n          - script: echo route\n        postRouteTraffic:\n          steps:\n          - script: echo post\n        on:\n          failure:\n            steps:\n            - script: echo fail\n          success:\n            steps:\n            - script: echo ok\n',
  },
  {
    name: 'download-none',
    asserts:
      'How a `- download: none` step inside the deploy hook is rendered after expansion — the ' +
      'auto-download flag is derived from its presence, so the model needs its exact surviving form.',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nstages:\n- stage: A\n  jobs:\n  - deployment: D\n    environment: corpus-staging\n    strategy:\n      runOnce:\n        deploy:\n          steps:\n          - download: none\n          - script: echo hi\n',
  },
];

await runProbes(PROBES, OUT_DIR);
