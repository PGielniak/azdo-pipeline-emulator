// E00-S03-T02 — oracle spike: submit probe pipelines to the Pipelines preview endpoint and
// store redacted request/response transcripts under research/experiments/oracle-spike/.
//
// The saved responses ARE the grounding artifact for the oracle: they prove the route, the
// api-version, the `finalYaml` field name, and each failure mode we rely on. Re-running this
// script re-verifies all of it against the live service.
//
// Run: node scripts/oracle-probe.ts            (all probes)
//      node scripts/oracle-probe.ts five-line  (one probe by name)
//
// Requires .env.oracle at the repo root (see research/oracle-setup.md). previewRun is always
// true, so nothing is ever queued and the org needs no agents or parallelism.
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'oracle-spike');

const PROBES: readonly Probe[] = [
  {
    name: 'five-line',
    asserts:
      'Baseline success pair: a 5-line pipeline expands to the service canonical form. ' +
      'Establishes route, api-version and that the 200 body carries exactly one field, finalYaml.',
    yaml: 'trigger: none\npool:\n  vmImage: ubuntu-latest\nsteps:\n  - script: echo hello\n',
  },
  {
    name: 'malformed-yaml',
    asserts:
      'Ill-formed YAML is rejected at parse time with a positional message ' +
      '"<file> (Line: N, Col: M): <text>" — the format our diagnostics renderer mirrors.',
    yaml: 'steps:\n- script: echo one\n  - bad: indentation\n',
  },
  {
    name: 'unknown-root-key',
    asserts:
      'Well-formed YAML that violates the schema is rejected with the offending value named.',
    yaml: 'stepz:\n- script: echo hi\n',
  },
  {
    name: 'bad-expression',
    asserts:
      'Expression errors report a position *within the expression* in addition to line/col, ' +
      'and link the expressions documentation.',
    yaml: 'variables:\n  a: ${{ nosuchfunc(1) }}\nsteps:\n- script: echo hi\n',
  },
  {
    name: 'missing-template',
    asserts:
      'A template that does not resolve names the repository, branch and commit it searched. ' +
      'This message embeds the organization URL — the reason redaction is mandatory.',
    yaml: 'steps:\n- template: does-not-exist.yml\n',
  },
  {
    name: 'unknown-task',
    asserts:
      'An unresolvable task is rejected without line/col: the message identifies job and step ' +
      'instead, so not every rejection can be rendered as a source-positioned diagnostic.',
    yaml: 'steps:\n- task: NoSuchTask@9\n',
  },
];

await runProbes(PROBES, OUT_DIR);
