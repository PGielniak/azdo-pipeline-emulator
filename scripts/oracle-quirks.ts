// E01-S01-T02 — server-quirk conformance experiments: how the *live* service handles the YAML
// features where Azure Pipelines is known (or suspected) to diverge from the YAML 1.2 spec —
// anchors/aliases, duplicate mapping keys, and multi-document files.
//
// Every quirk probe is paired with a control that is identical except for the quirk, so a 400
// is attributable to the quirk itself and not to an unrelated schema error. Where the service
// *accepts* a quirk, the returned `finalYaml` is the semantics evidence (e.g. which duplicate
// key wins), which matters more than accept/reject alone.
//
// Run: node scripts/oracle-quirks.ts               (all probes)
//      node scripts/oracle-quirks.ts anchor-alias  (one probe by name)
import path from 'node:path';
import { runProbes, type Probe } from './oracle-transcript.ts';

const OUT_DIR = path.join('research', 'experiments', 'E01-quirks');

const PROBES: readonly Probe[] = [
  {
    name: 'control-variables',
    asserts:
      'CONTROL for the anchor and duplicate-key probes: the same two-variable pipeline with no ' +
      'quirk in it. A 200 here makes any 400 below attributable to the quirk alone.',
    yaml: 'variables:\n  a: first\n  b: second\nsteps:\n- script: echo $(a) $(b)\n',
  },
  {
    name: 'anchor-alias',
    asserts:
      'QUIRK — anchors + aliases. Docs say anchors are unsupported (C-E01-021); this pins what ' +
      'the service actually answers, and if it accepts, whether the alias materializes.',
    yaml: 'variables:\n  a: &shared first\n  b: *shared\nsteps:\n- script: echo $(a) $(b)\n',
  },
  {
    name: 'anchor-only',
    asserts:
      'QUIRK — an anchor that is never referenced. Discriminates "anchor definitions are ' +
      'rejected" from "only alias resolution is rejected"; decides whether our check fires on ' +
      '`&name` or only on `*name`.',
    yaml: 'variables:\n  a: &shared first\n  b: second\nsteps:\n- script: echo $(a) $(b)\n',
  },
  {
    name: 'merge-key',
    asserts:
      'QUIRK — the YAML merge key `<<: *anchor` (the most common real-world use of anchors, and ' +
      'a separate spec feature from plain aliasing).',
    yaml:
      'jobs:\n- job: A\n  pool: &shared\n    vmImage: ubuntu-latest\n  steps:\n' +
      '  - script: echo one\n- job: B\n  pool:\n    <<: *shared\n  steps:\n  - script: echo two\n',
  },
  {
    name: 'dup-key-mapping',
    asserts:
      'QUIRK — duplicate key inside a mapping, with different values so an acceptance reveals ' +
      'first-wins vs last-wins in `finalYaml`.',
    yaml: 'variables:\n  a: first\n  a: second\nsteps:\n- script: echo $(a)\n',
  },
  {
    name: 'dup-key-root',
    asserts:
      'QUIRK — duplicate key at the document root (two `variables:` blocks). Root keys are ' +
      'consumed by a different code path than nested mappings, so it gets its own probe.',
    yaml: 'variables:\n  a: first\nvariables:\n  a: second\nsteps:\n- script: echo $(a)\n',
  },
  {
    name: 'dup-key-step',
    asserts:
      'QUIRK — duplicate key inside a step mapping (`displayName` twice), the level at which ' +
      'the service applies its own step schema rather than generic mapping rules.',
    yaml: 'steps:\n- script: echo one\n  displayName: first\n  displayName: second\n',
  },
  {
    name: 'dup-key-case',
    asserts:
      'QUIRK — do duplicate keys collide case-insensitively? The schema matches keywords with ' +
      '`ignoreCase` (C-E01-015), so `displayName` + `displayname` may or may not be "already ' +
      'defined". Decides whether our duplicate check folds case.',
    yaml: 'steps:\n- script: echo one\n  displayName: first\n  displayname: second\n',
  },
  {
    name: 'dup-key-case-user-data',
    asserts:
      'QUIRK — is the case-folding of `dup-key-case` a property of the YAML mapping layer or ' +
      'only of schema keywords? `a:` + `A:` under `variables:` are user-chosen names, not ' +
      'keywords: a rejection means our parse-time (schema-unaware) check must fold case too.',
    yaml: 'variables:\n  a: first\n  A: second\nsteps:\n- script: echo $(a)\n',
  },
  {
    name: 'control-single-doc',
    asserts: 'CONTROL for the document-marker probes: one plain document, no markers at all.',
    yaml: 'steps:\n- script: echo one\n',
  },
  {
    name: 'multi-doc',
    asserts:
      'QUIRK — two documents separated by `---`. docs/01 §1 assumes the service takes only one ' +
      'document per file; this pins the actual answer and its error text.',
    yaml: 'steps:\n- script: echo one\n---\nsteps:\n- script: echo two\n',
  },
  {
    name: 'leading-doc-start',
    asserts:
      'QUIRK — a single document introduced by a leading `---` marker. Real pipelines are ' +
      'commonly written this way, so rejecting it would produce false rejections; docs/01 §1 ' +
      'is ambiguous between "separator" and "any document marker".',
    yaml: '---\nsteps:\n- script: echo one\n',
  },
  {
    name: 'trailing-doc-end',
    asserts: 'QUIRK — a single document closed by the `...` end-of-document marker.',
    yaml: 'steps:\n- script: echo one\n...\n',
  },
];

await runProbes(PROBES, OUT_DIR);
