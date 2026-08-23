// E03-S06-T03 grounding — what does the preview request's `templateParameters` field actually do?
//
// C-E00-018 records the field's *existence* from the REST reference and nothing about its behavior:
// the doc page lists it among the optional `RunPipelineParameters` members and does not say which
// parameters it binds, whether an undeclared name is an error, or what value types it accepts. All
// four are decisions this task has to encode, so all four are probed.
//
// The fifth probe is the one with consequences beyond this task: if `templateParameters` can reach a
// *template's* parameters rather than only the root pipeline's, that is option (c) of E03-S06-T05 —
// the way a parameterized template could be bundled without the binding that PLAN D3 reserves for
// the service. If it cannot, that option is closed by measurement rather than by argument.
//
// Run: pnpm template-parameters-survey [probe-name]
// Output: research/experiments/E03-parameters-request/<probe>/{probe.yml,request.json,response.json,
//         final.yml,README.md}
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  configFromEnv,
  preview,
  redact,
  type OracleConfig,
  type PreviewOutcome,
} from '../packages/fetch/src/oracle.ts';
import { describe, loadEnvFile, type Probe } from './oracle-transcript.ts';

const EXPERIMENTS = path.join('research', 'experiments', 'E03-parameters-request');

interface ParameterProbe extends Probe {
  /** The `templateParameters` object sent with this document, if any. */
  readonly templateParameters?: Record<string, unknown>;
}

/** A root pipeline that declares `greeting` and echoes it. */
const declaring = (type = 'string', dflt = 'from-default'): string =>
  `parameters:
- name: greeting
  type: ${type}
  default: ${dflt}
steps:
- script: echo [\${{ parameters.greeting }}]
`;

const PROBES: readonly ParameterProbe[] = [
  {
    name: 'declared-overridden',
    asserts:
      'The root declares `greeting` with a default and the request supplies a value. Does the ' +
      'request win over the declared default? This is the whole premise of threading the field.',
    yaml: declaring(),
    templateParameters: { greeting: 'from-request' },
  },
  {
    name: 'declared-not-supplied',
    asserts: 'Control: the same document with no `templateParameters` must show the default.',
    yaml: declaring(),
  },
  {
    name: 'undeclared-name',
    asserts:
      'The request names a parameter the pipeline does not declare. Rejected, or silently ' +
      'ignored? Decides whether we validate names before sending or let the service answer.',
    yaml: declaring(),
    templateParameters: { greeting: 'ok', nosuchparameter: 'x' },
  },
  {
    name: 'number-typed',
    asserts:
      'A `number`-typed root parameter given a **string** value — the only thing a ' +
      '`Record<string, string>` field can carry. Does the service coerce it to the declared type?',
    yaml: `parameters:
- name: count
  type: number
  default: 1
steps:
- script: echo [\${{ parameters.count }}]
`,
    templateParameters: { count: '42' },
  },
  {
    name: 'number-typed-raw',
    asserts:
      'The same parameter given a raw JSON number rather than a string. If this is accepted the ' +
      'field is not `Record<string, string>` and the client type is too narrow.',
    yaml: `parameters:
- name: count
  type: number
  default: 1
steps:
- script: echo [\${{ parameters.count }}]
`,
    templateParameters: { count: 42 },
  },
  {
    name: 'object-typed-raw',
    asserts:
      "An `object`-typed root parameter given a raw JSON object. The CLI's `--parameter " +
      'name=@file.json` produces exactly this shape (C-E13-009/010), so whether it can be sent ' +
      'unflattened decides what that flag can support.',
    yaml: `parameters:
- name: config
  type: object
  default: {}
steps:
- script: echo [\${{ convertToJson(parameters.config) }}]
`,
    templateParameters: { config: { key: 'value' } },
  },
  {
    name: 'object-typed-string',
    asserts:
      'The same `object` parameter given the JSON **as a string**. If this binds, a structured ' +
      '`--parameter name=@file.json` value can still be sent — serialized — despite the raw form ' +
      'being refused; if it does not, structured parameters cannot reach the service at all ' +
      'through this field.',
    yaml: `parameters:
- name: config
  type: object
  default: {}
steps:
- script: echo [\${{ convertToJson(parameters.config) }}]
`,
    templateParameters: { config: '{"key":"value"}' },
  },
  {
    name: 'template-scoped',
    asserts:
      'THE ONE WITH CONSEQUENCES. The root has no `parameters:`; it includes a committed template ' +
      "that declares `greeting` and echoes it. Can `templateParameters` bind a **template's** " +
      "parameter, or only the root pipeline's? If it can, E03-S06-T05 has an option (c); if it " +
      'cannot, that option is closed by measurement.',
    yaml: `steps:
- template: /e03-bundle/passed/leaf.yml
`,
    templateParameters: { greeting: 'from-request' },
  },
];

function responseJson(outcome: PreviewOutcome): string {
  return JSON.stringify(outcome, undefined, 2) + '\n';
}

const env = await loadEnvFile('.env.oracle');
const config: OracleConfig = configFromEnv(env);

const requested = process.argv[2];
const selected =
  requested === undefined ? PROBES : PROBES.filter((entry) => entry.name === requested);
if (selected.length === 0) {
  throw new Error(
    `no probe named ${requested}; known: ${PROBES.map((entry) => entry.name).join(', ')}`,
  );
}

for (const entry of selected) {
  // Sequential by construction: no parallel calls against the user's oracle organization.
  // The cast is the point of `number-typed-raw`/`object-typed-raw`: the client types the field as
  // `Record<string, string>` on the strength of the REST doc alone, and these probes ask whether
  // that narrowing is real.
  const outcome = await preview(config, {
    yamlOverride: entry.yaml,
    ...(entry.templateParameters
      ? { templateParameters: entry.templateParameters as Record<string, string> }
      : {}),
  });

  const dir = path.join(EXPERIMENTS, entry.name);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'probe.yml'), entry.yaml, 'utf8');
  await writeFile(
    path.join(dir, 'request.json'),
    JSON.stringify({ templateParameters: entry.templateParameters ?? null }, undefined, 2) + '\n',
    'utf8',
  );
  await writeFile(path.join(dir, 'response.json'), redact(responseJson(outcome), config), 'utf8');
  await writeFile(
    path.join(dir, 'README.md'),
    `# oracle probe — ${entry.name}\n\n${entry.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      `- \`templateParameters\`: \`${JSON.stringify(entry.templateParameters ?? null)}\`\n` +
      `- Outcome: **${describe(outcome)}**\n` +
      '- Not predicted by this script: every probe here is asking, not asserting.\n',
    'utf8',
  );
  if (outcome.kind === 'expanded') {
    await writeFile(path.join(dir, 'final.yml'), outcome.finalYaml, 'utf8');
  }

  const echoed =
    outcome.kind === 'expanded' ? (/echo \[(.*)\]/.exec(outcome.finalYaml)?.[1] ?? '') : '';
  console.log(`${entry.name.padEnd(22)} ${describe(outcome).padEnd(46)} ${echoed}`);
}
