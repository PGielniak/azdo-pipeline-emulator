// E03-S02-T02 grounding — typed parameter binding: declaration, defaults, `values:`, and what
// happens to a value on its way from a caller's `parameters:` mapping into `${{ parameters.x }}`.
//
// What the three documented sources settle, and where they disagree with each other:
//
//  - **template-parameters** and **runtime-parameters** carry the same "Parameter data types"
//    table: 13 rows (`string stringList number boolean object step stepList job jobList deployment
//    deploymentList stage stageList`), with `stringList` annotated "Not available in templates"
//    (C-E03-300). The **yaml-schema/parameters-parameter** page prints the *same* table minus
//    `stringList` — 12 rows — and calls it "the `enum` members" (C-E03-301). Two official pages,
//    two different vocabularies for one keyword.
//  - The **vendored service schema** (`azure-pipelines-vscode@2f4500cf`, E00-S02-T01) disagrees
//    with both and is the only source that distinguishes the two *positions*: `templateParameter`
//    accepts 16 type names and `pipelineTemplateParameter` 20, overlapping in 15 (C-E03-302).
//    `legacyObject` appears only in the template set, `container`/`containerList` in both, and
//    `environment`/`filePath`/`pool`/`secureFile`/`serviceConnection` only at the pipeline root.
//    None of those seven is on any documentation page.
//  - Requiredness is stated three incompatible ways: "Parameters must include a default value"
//    (yaml-schema prose), "if no default, then the parameter MUST be given by the user at runtime"
//    (the same page's `default` row), and "You can't make parameters optional... If you don't
//    assign a default value or set `default` to `false`, the first available value is used"
//    (runtime-parameters) (C-E03-303).
//
// So the vocabulary, the position split, requiredness, every coercion, and every rejection
// sentence are measured here rather than read. The instrument throughout is
// `${{ convertToJson(parameters.p) }}` (C-E02-050): it prints the bound value's JSON, which is the
// only way to see whether `42` arrived at a `string` parameter as `42` or as `"42"` — an `echo`
// renders both identically.
//
// Because the preview endpoint reads `template:` targets from the **repository**, not from the
// request body (C-E12-011), this script pushes its template tree to `/e03-params/` before probing.
// The tree is written to `fixtures/oracle/parameters/templates/` on every run and pushed from
// there, so `packages/engine/test/template/parameters.test.ts` replays the probes against the same
// bytes the service saw rather than against a second copy.
//
// Probes whose outcome is genuinely unknown are declared `expected: 'either'` on purpose:
// pre-declaring those would be model memory smuggled in as a harness assertion.
//
// Run: pnpm parameter-binding-survey [probe-name]
// Output:
//   research/experiments/E03-parameters/<probe>/{probe.yml,response.json,final.yml,README.md}
//   fixtures/oracle/parameters/param-<probe>.{input,final}.yml (expanded probes only)
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
import { defaultRepository, syncFiles, type RepoRef } from './azdo-repo.ts';

interface ParameterProbe extends Probe {
  /** `'either'` = the question this probe exists to answer; record whatever the service says. */
  readonly expected: PreviewOutcome['kind'] | 'either';
  /** Queue-time parameter values, i.e. the REST body's `templateParameters` dictionary. */
  readonly templateParameters?: Readonly<Record<string, string>>;
}

/** Repository directory the template tree is pushed to. */
const SCOPE = '/e03-params';
/** Working copy of that tree; committed so the unit tests read the same bytes. */
const TEMPLATE_DIR = path.join('fixtures', 'oracle', 'parameters', 'templates');

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------

/** A step whose `env:` carries the JSON of one bound parameter — the survey's only instrument. */
const dump = (expression = 'parameters.p'): string =>
  `steps:\n- script: echo probe\n  env:\n    OUT: \${{ convertToJson(${expression}) }}\n`;

/** One `parameters:` list item, as text. */
const decl = (name: string, type: string, rest = ''): string =>
  `- name: ${name}\n  type: ${type}\n${rest}`;

const parameters = (...items: string[]): string => `parameters:\n${items.join('')}`;

/** Root pipeline: declare parameters, dump one of them. */
const root = (decls: string, expression?: string): string => parameters(decls) + dump(expression);

/** Root pipeline that includes a template under `steps:`, passing `args`. */
const include = (file: string, args = '', decls = ''): string =>
  (decls === '' ? '' : parameters(decls)) +
  `steps:\n- template: ${SCOPE}/${file}\n` +
  (args === '' ? '' : `  parameters:\n${args}`);

/**
 * The template tree. Every file is a `steps:` template so it can be included from one place, and
 * every file's only job is to print what its parameters were bound to.
 */
const TEMPLATES: Readonly<Record<string, string>> = {
  // --- binding targets, one per type under test ------------------------------------------------
  'bind-string.yml': parameters(decl('p', 'string', '  default: dflt\n')) + dump(),
  'bind-number.yml': parameters(decl('p', 'number', '  default: 2\n')) + dump(),
  'bind-boolean.yml': parameters(decl('p', 'boolean', '  default: false\n')) + dump(),
  'bind-object.yml': parameters(decl('p', 'object', '  default: {}\n')) + dump(),
  'bind-step.yml': parameters(decl('p', 'step', '  default:\n    script: echo dflt\n')) + dump(),
  'bind-steplist.yml': parameters(decl('p', 'stepList', '  default: []\n')) + dump(),
  /** No default at all: the requiredness question (C-E03-303's three-way contradiction). */
  'bind-required.yml': parameters(decl('p', 'string')) + dump(),
  /** No default, but a `values:` list — runtime-parameters says the first value is used. */
  'bind-values-nodefault.yml':
    parameters(decl('p', 'string', '  values:\n  - alpha\n  - beta\n')) + dump(),
  'bind-values.yml':
    parameters(decl('p', 'string', '  default: alpha\n  values:\n  - alpha\n  - beta\n')) + dump(),
  /** Declares nothing: what does the service do with parameters nobody asked for? */
  'bind-none.yml': 'steps:\n- script: echo probe\n',
  /** Declares one parameter and dumps the whole `parameters` context — the visibility probe. */
  'bind-dumpall.yml': parameters(decl('p', 'string', '  default: dflt\n')) + dump('parameters'),

  // --- type vocabulary, template position ------------------------------------------------------
  'types-documented.yml':
    parameters(
      decl('t01', 'string', '  default: s\n'),
      decl('t02', 'number', '  default: 1\n'),
      decl('t03', 'boolean', '  default: true\n'),
      decl('t04', 'object', '  default: {}\n'),
      decl('t05', 'step', '  default:\n    script: echo s\n'),
      decl('t06', 'stepList', '  default: []\n'),
      decl('t07', 'job', '  default:\n    job: j\n    steps:\n    - script: echo j\n'),
      decl('t08', 'jobList', '  default: []\n'),
      decl('t09', 'deploymentList', '  default: []\n'),
      decl('t10', 'stageList', '  default: []\n'),
    ) + dump('parameters.t04'),
  'types-legacyobject.yml': parameters(decl('p', 'legacyObject', '  default: {}\n')) + dump(),
  'types-stringlist.yml':
    parameters(decl('p', 'stringList', '  default:\n  - a\n  values:\n  - a\n  - b\n')) + dump(),
  'types-container.yml':
    parameters(decl('p', 'container', '  default:\n    image: alpine\n')) + dump(),
  'types-containerlist.yml': parameters(decl('p', 'containerList', '  default: []\n')) + dump(),
  'types-pool.yml':
    parameters(decl('p', 'pool', '  default:\n    vmImage: ubuntu-latest\n')) + dump(),
  'types-filepath.yml': parameters(decl('p', 'filePath', '  default: /tmp/x\n')) + dump(),
  'types-unknown.yml': parameters(decl('p', 'notAType', '  default: x\n')) + dump(),
  'types-environment.yml': parameters(decl('p', 'environment', '  default: env\n')) + dump(),
  'types-securefile.yml': parameters(decl('p', 'secureFile', '  default: sf\n')) + dump(),
  'types-serviceconnection.yml':
    parameters(decl('p', 'serviceConnection', '  default: sc\n')) + dump(),
  /** `legacyObject` is template-only; this pairs with `bind-object.yml` to compare the two. */
  'bind-legacyobject.yml': parameters(decl('p', 'legacyObject', '  default: {}\n')) + dump(),
  'bind-stringlist.yml':
    parameters(decl('p', 'stringList', '  default:\n  - a\n  values:\n  - a\n  - b\n')) + dump(),
};

const probe = (
  name: string,
  asserts: string,
  yaml: string,
  expected: ParameterProbe['expected'],
  templateParameters?: Readonly<Record<string, string>>,
): ParameterProbe => ({ name, asserts, yaml, expected, templateParameters });

// ---------------------------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------------------------

const PROBES: readonly ParameterProbe[] = [
  // ---- A. type vocabulary: root position -------------------------------------------------
  probe(
    'type-root-documented',
    'All 12 types the yaml-schema page lists as the `enum` members, declared at the pipeline ' +
      'root in one document (C-E03-301). A single unknown name rejects the whole document, so ' +
      'one expansion accepts all twelve.',
    root(
      decl('t01', 'string', '  default: s\n') +
        decl('t02', 'number', '  default: 1\n') +
        decl('t03', 'boolean', '  default: true\n') +
        decl('t04', 'object', '  default: {}\n') +
        decl('t05', 'step', '  default:\n    script: echo s\n') +
        decl('t06', 'stepList', '  default: []\n') +
        decl('t07', 'job', '  default:\n    job: j\n    steps:\n    - script: echo j\n') +
        decl('t08', 'jobList', '  default: []\n') +
        decl('t09', 'deployment', '  default:\n    deployment: d\n') +
        decl('t10', 'deploymentList', '  default: []\n') +
        decl('t11', 'stage', '  default:\n    stage: s\n    jobs: []\n') +
        decl('t12', 'stageList', '  default: []\n'),
      'parameters.t04',
    ),
    'either',
  ),
  probe(
    'type-root-stringlist',
    '`stringList` is on the two process pages and absent from the yaml-schema page; the vendored ' +
      'schema has it in both positions (C-E03-300/302). Root position.',
    root(decl('p', 'stringList', '  default:\n  - a\n  values:\n  - a\n  - b\n')),
    'either',
  ),
  probe(
    'type-root-schema-only',
    'The five type names the vendored schema allows **only** at the pipeline root — ' +
      '`environment`, `filePath`, `pool`, `secureFile`, `serviceConnection` — none of which ' +
      'appears on any documentation page (C-E03-302).',
    root(
      decl('t01', 'environment', '  default: env\n') +
        decl('t02', 'filePath', '  default: /tmp/x\n') +
        decl('t03', 'pool', '  default:\n    vmImage: ubuntu-latest\n') +
        decl('t04', 'secureFile', '  default: sf\n') +
        decl('t05', 'serviceConnection', '  default: sc\n'),
      'parameters.t02',
    ),
    'either',
  ),
  probe(
    'type-root-container',
    '`container`/`containerList`: in both schema sets, on no documentation page.',
    root(
      decl('t01', 'container', '  default:\n    image: alpine\n') +
        decl('t02', 'containerList', '  default: []\n'),
      'parameters.t02',
    ),
    'either',
  ),
  probe(
    'type-root-legacyobject',
    'The vendored schema allows `legacyObject` in a **template** and not at the root — the one ' +
      'name that is supposed to distinguish the two positions (C-E03-302). Root position.',
    root(decl('p', 'legacyObject', '  default: {}\n')),
    'either',
  ),
  probe(
    'type-root-unknown',
    'An unknown type name at the root. The rejection sentence is the best available statement of ' +
      'the *real* vocabulary — if it enumerates, it settles the question the three sources ' +
      'disagree about.',
    root(decl('p', 'notAType', '  default: x\n')),
    'either',
  ),
  probe(
    'type-root-case',
    'Type names are matched how? `String` vs `string` — the expression language folds case ' +
      'everywhere but directive keywords (C-E03-100), and the schema patterns are anchored lower ' +
      'case.',
    root(decl('p', 'String', '  default: s\n')),
    'either',
  ),
  probe(
    'type-root-missing',
    'Both process pages say "Parameters must contain a name and data type". Omit `type:`.',
    root('- name: p\n  default: s\n'),
    'either',
  ),
  probe(
    'type-root-missing-untyped-object',
    'Omit `type:` **and** give a mapping default — if the type is inferred rather than required, ' +
      'this is where it shows.',
    root('- name: p\n  default:\n    a: 1\n'),
    'either',
  ),

  // ---- B. type vocabulary: template position ---------------------------------------------
  probe(
    'type-tmpl-documented',
    'The documented types inside a template (`deployment`/`stage` singletons omitted — a ' +
      '`steps:` template cannot carry their bodies).',
    include('types-documented.yml'),
    'either',
  ),
  probe(
    'type-tmpl-stringlist',
    'Both process pages state flatly: "The `stringList` data type isn\'t available in templates. ' +
      'Use the `object` data type in templates instead." The vendored schema disagrees ' +
      '(C-E03-300/302). This probe is the arbiter.',
    include('types-stringlist.yml'),
    'either',
  ),
  probe(
    'type-tmpl-legacyobject',
    '`legacyObject` in a template — allowed by the schema here and nowhere else.',
    include('types-legacyobject.yml'),
    'either',
  ),
  probe(
    'type-tmpl-container',
    '`container` in a template.',
    include('types-container.yml'),
    'either',
  ),
  probe(
    'type-tmpl-containerlist',
    '`containerList` in a template.',
    include('types-containerlist.yml'),
    'either',
  ),
  probe(
    'type-tmpl-pool',
    "`pool` in a template — root-only per the vendored schema, so this is the position split's " +
      'second test.',
    include('types-pool.yml'),
    'either',
  ),
  probe(
    'type-tmpl-filepath',
    '`filePath` in a template — root-only per the vendored schema.',
    include('types-filepath.yml'),
    'either',
  ),
  probe(
    'type-tmpl-unknown',
    'An unknown type name inside a template: same sentence as at the root, or a different ' +
      'vocabulary?',
    include('types-unknown.yml'),
    'either',
  ),

  // ---- C. defaults and requiredness -------------------------------------------------------
  probe(
    'default-used',
    'Control: an unpassed parameter with a default binds the default, and `convertToJson` shows ' +
      'its type.',
    include('bind-string.yml'),
    'expanded',
  ),
  probe(
    'default-missing-string',
    'A `string` parameter with no default, not passed. yaml-schema prose says parameters "must ' +
      'include a default value"; its own `default` row says the value must then be given at ' +
      'runtime; runtime-parameters says "the first available value is used" (C-E03-303).',
    include('bind-required.yml'),
    'either',
  ),
  probe(
    'default-missing-values',
    'No default, but `values: [alpha, beta]` — the exact case runtime-parameters describes as ' +
      '"the first available value is used".',
    include('bind-values-nodefault.yml'),
    'either',
  ),
  probe(
    'default-missing-typed',
    'No default on `number`, `boolean`, `object`, `stepList` at the **root**: does an unpassed ' +
      'parameter of each type get a typed empty value, or nothing?',
    root(
      decl('n', 'number') + decl('b', 'boolean') + decl('o', 'object') + decl('l', 'stepList'),
      'parameters',
    ),
    'either',
  ),
  probe(
    'default-not-in-values',
    'A default that is not a member of its own `values:` list.',
    root(decl('p', 'string', '  default: gamma\n  values:\n  - alpha\n  - beta\n')),
    'either',
  ),
  probe(
    'default-expression',
    'template-parameters: "You can only use literals for parameter default values." What happens ' +
      'when the default is a template expression?',
    root(decl('p', 'string', "  default: \${{ 'x' }}\n")),
    'either',
  ),
  probe(
    'default-wrong-type',
    'A non-numeric default on a `number` parameter — the type check on the *declaration* rather ' +
      'than on a passed value.',
    root(decl('p', 'number', '  default: abc\n')),
    'either',
  ),
  probe(
    'default-number-like-string',
    'The docs\' one coercion note: `number` "may be restricted to `values:`, otherwise any ' +
      "number-like string is accepted\". A quoted `'8'` as the default — does it arrive as 8 or " +
      'as "8"?',
    root(decl('p', 'number', "  default: '8'\n")),
    'either',
  ),
  probe(
    'default-boolean-quoted',
    "A quoted `'true'` default on a `boolean` parameter.",
    root(decl('p', 'boolean', "  default: 'true'\n")),
    'either',
  ),
  probe(
    'default-null',
    'An empty `default:` — YAML null — on a `string` parameter.',
    root(decl('p', 'string', '  default:\n')),
    'either',
  ),
  probe(
    'decl-duplicate-name',
    'Two parameters with the same name; E01-S01-T04 established that the *parser* rejects ' +
      'duplicate mapping keys, but these are sequence items.',
    root(decl('p', 'string', '  default: one\n') + decl('p', 'string', '  default: two\n')),
    'either',
  ),
  probe(
    'decl-name-case',
    "Declared `myParam`, read as `${{ parameters.MYPARAM }}` — the expression language's " +
      'ordinal-ignore-case object lookup (C-E02-045) should apply, but parameters are a ' +
      'service-built context.',
    root(decl('myParam', 'string', '  default: s\n'), 'parameters.MYPARAM'),
    'either',
  ),
  probe(
    'decl-unknown-name',
    'Reading a parameter that was never declared.',
    root(decl('p', 'string', '  default: s\n'), 'parameters.nope'),
    'either',
  ),

  // ---- D. passing values into a template --------------------------------------------------
  probe(
    'pass-number-to-string',
    "The task's first named coercion: pass the number `42` to a `string` parameter. " +
      '`convertToJson` shows whether it arrived as `42` or `"42"`.',
    include('bind-string.yml', '    p: 42\n'),
    'either',
  ),
  probe(
    'pass-boolean-to-string',
    'Pass `true` to a `string` parameter — if numbers convert, do booleans, and with which ' +
      'casing (the expression language stringifies Boolean as `True`, C-E03-175)?',
    include('bind-string.yml', '    p: true\n'),
    'either',
  ),
  probe(
    'pass-object-to-string',
    'Pass a mapping to a `string` parameter.',
    include('bind-string.yml', '    p:\n      a: 1\n'),
    'either',
  ),
  probe(
    'pass-string-to-number',
    "Pass the quoted string `'8'` to a `number` parameter — the documented \"any number-like " +
      'string is accepted".',
    include('bind-number.yml', "    p: '8'\n"),
    'either',
  ),
  probe(
    'pass-nonnumeric-to-number',
    'Pass `abc` to a `number` parameter: the rejection sentence for a failed coercion.',
    include('bind-number.yml', '    p: abc\n'),
    'either',
  ),
  probe(
    'pass-bool-quoted-true',
    "Boolean literals, spelling 1 of 4: the quoted string `'true'`.",
    include('bind-boolean.yml', "    p: 'true'\n"),
    'either',
  ),
  probe(
    'pass-bool-titlecase',
    'Boolean literals, spelling 2 of 4: `True` — YAML 1.1 reads it as a boolean, YAML 1.2 as a ' +
      "string, and the task's Ground field asks which the service takes.",
    include('bind-boolean.yml', '    p: True\n'),
    'either',
  ),
  probe(
    'pass-bool-yes',
    'Boolean literals, spelling 3 of 4: `yes`.',
    include('bind-boolean.yml', '    p: yes\n'),
    'either',
  ),
  probe(
    'pass-bool-number',
    'Boolean literals, spelling 4 of 4: `1`.',
    include('bind-boolean.yml', '    p: 1\n'),
    'either',
  ),
  probe(
    'pass-object-deep',
    "The task's third named probe: a deep object — nested mappings, a sequence, and mixed scalar " +
      'types — passed to an `object` parameter. Does every leaf keep its YAML type?',
    include(
      'bind-object.yml',
      '    p:\n      s: text\n      n: 3\n      f: 0.5\n      b: true\n      nil:\n' +
        '      list:\n      - 1\n      - two\n      nested:\n        deep:\n          k: v\n',
    ),
    'either',
  ),
  probe(
    'pass-string-to-object',
    'Pass a scalar to an `object` parameter — "any YAML structure" includes scalars?',
    include('bind-object.yml', '    p: scalar\n'),
    'either',
  ),
  probe(
    'pass-steplist-valid',
    'A real two-step list passed to `stepList`: the shape the value has once bound.',
    include(
      'bind-steplist.yml',
      '    p:\n    - script: echo one\n    - bash: echo two\n      displayName: Two\n',
    ),
    'either',
  ),
  probe(
    'pass-steplist-scalar',
    'A scalar passed to `stepList`.',
    include('bind-steplist.yml', '    p: nope\n'),
    'either',
  ),
  probe(
    'pass-step-invalid-shape',
    'A mapping with no known step keyword passed to `step` — is the *schema* of a step checked ' +
      'at binding time, or only when the value lands in `steps:`?',
    include('bind-step.yml', '    p:\n      notAStep: 1\n'),
    'either',
  ),
  probe(
    'pass-extra-parameter',
    'Pass a parameter the template never declared — one of the two errors the task names.',
    include('bind-string.yml', '    p: ok\n    extra: surprise\n'),
    'either',
  ),
  probe(
    'pass-extra-to-none',
    'Pass a parameter to a template with no `parameters:` block at all.',
    include('bind-none.yml', '    extra: surprise\n'),
    'either',
  ),
  probe(
    'pass-missing-required',
    'The other error the task names: a template parameter with no default, not passed by the ' +
      'caller — while the caller passes *something*, so the `parameters:` mapping exists.',
    include('bind-required.yml', ''),
    'either',
  ),
  probe(
    'pass-not-in-values',
    'Pass a value outside the declared `values:` list.',
    include('bind-values.yml', '    p: gamma\n'),
    'either',
  ),
  probe(
    'pass-name-case',
    'Pass `P:` to a parameter declared `p` — is the *binding* key case-insensitive too?',
    include('bind-string.yml', '    P: cased\n'),
    'either',
  ),
  probe(
    'pass-null',
    'Pass an empty value (`p:`) to a `string` parameter.',
    include('bind-string.yml', '    p:\n'),
    'either',
  ),
  probe(
    'pass-expression',
    "Pass an expression that reads the caller's own parameter — the ordinary way a value crosses " +
      "two files, and a check that the caller's frame is used, not the callee's.",
    include(
      'bind-string.yml',
      '    p: ${{ parameters.outer }}\n',
      decl('outer', 'string', '  default: from-caller\n'),
    ),
    'either',
  ),
  probe(
    'pass-callee-scope',
    "Is the caller's parameter visible inside the callee? The template dumps `parameters` " +
      'wholesale, so the answer is the key set of the printed object: `p` alone means each file ' +
      'gets its own parameters frame, `p` + `outer` means the contexts merge.',
    include('bind-dumpall.yml', '    p: ok\n', decl('outer', 'string', '  default: from-caller\n')),
    'either',
  ),

  // ---- E. queue-time values (`templateParameters` in the REST body) -----------------------
  probe(
    'runtime-override-string',
    'Runtime parameters "at root bound from CLI/config" are, on the service, the preview body\'s ' +
      '`templateParameters` dictionary — string-valued by REST contract. Override a `string`.',
    root(decl('p', 'string', '  default: dflt\n')),
    'either',
    { p: 'from-queue' },
  ),
  probe(
    'runtime-override-number',
    'Override a `number` parameter with the string `"8"`: does the queue-time value get the same ' +
      'coercion a YAML-passed value gets?',
    root(decl('p', 'number', '  default: 2\n')),
    'either',
    { p: '8' },
  ),
  probe(
    'runtime-override-boolean',
    'Override a `boolean` parameter with the string `"true"`.',
    root(decl('p', 'boolean', '  default: false\n')),
    'either',
    { p: 'true' },
  ),
  probe(
    'runtime-override-object',
    'Override an `object` parameter with a JSON string — is it parsed, or does it stay a string?',
    root(decl('p', 'object', '  default: {}\n')),
    'either',
    { p: '{"a": 1}' },
  ),
  probe(
    'runtime-required',
    'A root parameter with no default, supplied only at queue time.',
    root(decl('p', 'string')),
    'either',
    { p: 'supplied' },
  ),
  probe(
    'runtime-not-in-values',
    'A queue-time value outside the declared `values:` list.',
    root(decl('p', 'string', '  default: alpha\n  values:\n  - alpha\n  - beta\n')),
    'either',
    { p: 'gamma' },
  ),
  probe(
    'runtime-undeclared',
    'A queue-time value for a parameter the pipeline never declared.',
    root(decl('p', 'string', '  default: alpha\n')),
    'either',
    { nosuch: 'value' },
  ),

  // ---- F. second batch: questions the first batch opened ----------------------------------
  //
  // `type-root-container` and `type-tmpl-container` both came back
  // `The '…' parameter is not a valid Container.` — a *value* rejection, not the
  // `Unexpected value '<type>'` a bad type name produces. So `container` is a real type name in
  // both positions and only its default was malformed; these probes pin the distinction down and
  // finish the position table.
  probe(
    'type-container-string',
    'A `container` parameter whose default is a bare string — if the Container type is the ' +
      'resource *alias* rather than an inline definition, this is what it accepts.',
    root(decl('p', 'container', '  default: alpine\n')),
    'either',
  ),
  probe(
    'type-container-resource',
    'A `container` parameter whose default is spelled like a `resources.containers` entry.',
    root(decl('p', 'container', '  default:\n    container: c1\n    image: alpine\n')),
    'either',
  ),
  probe(
    'type-tmpl-environment',
    '`environment` in a template — root-only per the vendored schema, third confirmation.',
    include('types-environment.yml'),
    'either',
  ),
  probe(
    'type-tmpl-securefile',
    '`secureFile` in a template — root-only per the vendored schema.',
    include('types-securefile.yml'),
    'either',
  ),
  probe(
    'type-tmpl-serviceconnection',
    '`serviceConnection` in a template — root-only per the vendored schema.',
    include('types-serviceconnection.yml'),
    'either',
  ),
  probe(
    'legacyobject-deep',
    'What `legacyObject` does that `object` does not: the same deep value bound to each, compared ' +
      'leaf by leaf.',
    include(
      'bind-legacyobject.yml',
      '    p:\n      n: 3\n      b: true\n      nil:\n      list:\n      - 1\n      - two\n',
    ),
    'either',
  ),
  probe(
    'pass-stringlist-values',
    '`stringList` binding: a two-item list, both members of `values:`.',
    include('bind-stringlist.yml', '    p:\n    - a\n    - b\n'),
    'either',
  ),
  probe(
    'pass-stringlist-invalid',
    '`stringList` binding: a member outside `values:`.',
    include('bind-stringlist.yml', '    p:\n    - a\n    - zzz\n'),
    'either',
  ),
  probe(
    'pass-stringlist-scalar',
    '`stringList` binding: a bare scalar where a list is declared.',
    include('bind-stringlist.yml', '    p: a\n'),
    'either',
  ),
  probe(
    'values-case',
    'Is the `values:` membership test case-sensitive? Declared `alpha`, passed `ALPHA`.',
    include('bind-values.yml', '    p: ALPHA\n'),
    'either',
  ),
  probe(
    'values-number-coerced',
    'A `number` restricted to `values:` receiving the *string* spelling of a member — does ' +
      'coercion run before the membership test?',
    root(decl('p', 'number', "  default: '2'\n  values:\n  - 1\n  - 2\n")),
    'either',
  ),
  probe(
    'values-on-object',
    '`values:` on an `object` parameter — the schema types it `sequenceOfNonEmptyString` with no ' +
      'restriction on which parameter types may carry it ("for some data types").',
    root(decl('p', 'object', '  default: {}\n  values:\n  - a\n')),
    'either',
  ),
  probe(
    'default-expression-parameter',
    '`default-expression` proved a default is *evaluated*, contradicting "You can only use ' +
      'literals for parameter default values". So: can one default read another parameter?',
    root(
      decl('a', 'string', '  default: first\n') +
        decl('b', 'string', '  default: ${{ parameters.a }}\n'),
      'parameters.b',
    ),
    'either',
  ),
  probe(
    'number-float-binding',
    'Number formatting through binding: `1.0` and `0.5` to `number`, and `1.0` to `string` — ' +
      'C-E03-182 measured shortest-round-trip rendering for *interpolation*; binding is a ' +
      'different conversion (C-E03-321 already shows Boolean→String differs).',
    root(
      decl('a', 'number', '  default: 1.0\n') +
        decl('b', 'number', '  default: 0.5\n') +
        decl('c', 'string', '  default: 1.0\n'),
      'parameters',
    ),
    'either',
  ),
  probe(
    'empty-string-to-number',
    'An empty string bound to a `number` parameter.',
    include('bind-number.yml', "    p: ''\n"),
    'either',
  ),
  //
  // `default-expression` expanded (`${{ 'x' }}` → `x`) while `default-expression-parameter`
  // rejected with `A template expression is not allowed in this context`. So a default *is* an
  // expression slot; these two isolate what the slot may name.
  probe(
    'default-expression-function',
    'A pure-function expression in a default — no named context at all.',
    root(decl('p', 'string', "  default: \${{ format('{0}-{1}', 'a', 'b') }}\n")),
    'either',
  ),
  probe(
    'default-expression-variables',
    'A default that names the `variables` context: is the rejection about `parameters` ' +
      'specifically, or about every named context in this slot?',
    'variables:\n  foo: bar\n' + root(decl('p', 'string', '  default: ${{ variables.foo }}\n')),
    'either',
  ),
  //
  // …and the answer inverts the reading `default-expression` alone suggested: `${{ 'x' }}` is
  // accepted while `${{ format(…) }}` is not, so the slot admits **literals only** — which is the
  // template-parameters sentence "You can only use literals for parameter default values",
  // enforced far more narrowly than "no expressions".
  probe(
    'default-expression-literal-number',
    'A numeric literal expression as a `number` default.',
    root(decl('p', 'number', '  default: ${{ 42 }}\n')),
    'either',
  ),
  probe(
    'default-expression-literal-boolean',
    'A boolean literal expression as a `boolean` default.',
    root(decl('p', 'boolean', '  default: ${{ true }}\n')),
    'either',
  ),
  probe(
    'default-expression-literal-number-on-string',
    'Isolates the two variables the previous pair confounded: `${{ 42 }}` is the same *lone ' +
      "literal expression* shape as the accepted `${{ 'x' }}`, now on a `string` parameter, so " +
      'if this rejects the deciding factor is the parameter type and not the literal kind.',
    root(decl('p', 'string', '  default: ${{ 42 }}\n')),
    'either',
  ),
  probe(
    'default-expression-literal-string-on-number',
    'The other half: a lone string-literal expression on a `number` parameter.',
    root(decl('p', 'number', "  default: \${{ '42' }}\n")),
    'either',
  ),
  probe(
    'default-expression-mixed',
    'A literal expression embedded in surrounding text — mixed content is a `format()` call ' +
      '(C-E02-109), so if the rule really is "literals only" this must reject.',
    root(decl('p', 'string', "  default: pre-\${{ 'x' }}-post\n")),
    'either',
  ),
  //
  // `number-float-binding` showed `default: 1.0` on a `string` parameter arriving as `"1.0"`,
  // which `String(1)` cannot produce — so the conversion looks like it reads the scalar's *source
  // text*. These two decide it, and with it whether the binder needs the source string at all.
  probe(
    'pass-null-to-number',
    'An empty value bound to `number` — `pass-null` showed Null becoming `""` for a `string`, and ' +
      '`empty-string-to-number` showed `""` rejected by `number`, so this is where the two meet.',
    include('bind-number.yml', '    p:\n'),
    'either',
  ),
  probe(
    'pass-null-to-boolean',
    'An empty value bound to `boolean`.',
    include('bind-boolean.yml', '    p:\n'),
    'either',
  ),
  probe(
    'pass-null-to-object',
    'An empty value bound to `object` — a whole null, not the null *leaf* `pass-object-deep` ' +
      'already measured.',
    include('bind-object.yml', '    p:\n'),
    'either',
  ),
  probe(
    'decl-missing-name',
    'A declaration with no `name:` — the schema calls `name` "Required as first property".',
    root('- type: string\n  default: s\n', "'x'"),
    'either',
  ),
  probe(
    'pass-boolean-titlecase-to-string',
    'YAML `True` bound to a `string` parameter. Source text predicts `"True"`; a value-based ' +
      'conversion predicts `"true"` (C-E03-321 measured `true` → `"true"`).',
    include('bind-string.yml', '    p: True\n'),
    'either',
  ),
  probe(
    'pass-leading-zero-to-string',
    'YAML `007` bound to a `string` parameter — the other place source text and value diverge.',
    include('bind-string.yml', '    p: 007\n'),
    'either',
  ),
  probe(
    'pass-expression-callee-param',
    'The mirror of `default-expression-parameter` on the *caller* side: the argument mapping is ' +
      'an ordinary template-expression slot, so `${{ parameters.outer }}` there is fine ' +
      '(`pass-expression`). Does the same hold when the expression names the *callee* parameter?',
    include('bind-string.yml', '    p: ${{ parameters.p }}\n'),
    'either',
  ),
];

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

function responseJson(outcome: PreviewOutcome): string {
  switch (outcome.kind) {
    case 'expanded':
      return JSON.stringify({ finalYaml: outcome.finalYaml }, null, 2) + '\n';
    case 'rejected':
      return JSON.stringify(outcome.body, null, 2) + '\n';
    case 'transport':
    case 'unauthenticated':
      return JSON.stringify(outcome, null, 2) + '\n';
  }
}

const env = await loadEnvFile('.env.oracle');
const config: OracleConfig = configFromEnv(env);

await mkdir(TEMPLATE_DIR, { recursive: true });
for (const [name, content] of Object.entries(TEMPLATES)) {
  await writeFile(path.join(TEMPLATE_DIR, name), content, 'utf8');
}

const repo: RepoRef = await defaultRepository(config);
const commit = await syncFiles(
  config,
  repo,
  repo.defaultBranch,
  SCOPE,
  Object.entries(TEMPLATES).map(([name, content]) => ({ path: `${SCOPE}/${name}`, content })),
  'azdo-emu: E03-S02-T02 parameter-binding fixtures',
);
console.log(
  `${repo.name.padEnd(20)} ${SCOPE.padEnd(12)} ${commit === undefined ? 'unchanged' : `pushed ${commit.slice(0, 8)}`}`,
);

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
  const outcome = await preview(config, {
    yamlOverride: entry.yaml,
    ...(entry.templateParameters ? { templateParameters: entry.templateParameters } : {}),
  });
  if (entry.expected !== 'either' && outcome.kind !== entry.expected) {
    throw new Error(`${entry.name}: expected ${entry.expected}, observed ${describe(outcome)}`);
  }

  const experimentDir = path.join('research', 'experiments', 'E03-parameters', entry.name);
  await mkdir(experimentDir, { recursive: true });
  await writeFile(path.join(experimentDir, 'probe.yml'), entry.yaml, 'utf8');
  await writeFile(
    path.join(experimentDir, 'response.json'),
    redact(responseJson(outcome), config),
    'utf8',
  );
  await writeFile(
    path.join(experimentDir, 'README.md'),
    `# oracle probe — ${entry.name}\n\n${entry.asserts}\n\n` +
      `- Endpoint: \`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=${config.apiVersion}\`\n` +
      (entry.templateParameters
        ? `- Queue-time \`templateParameters\`: \`${JSON.stringify(entry.templateParameters)}\`\n`
        : '') +
      `- Outcome: **${describe(outcome)}**\n` +
      (entry.expected === 'either' ? '- Outcome was **not** predicted by this script.\n' : ''),
    'utf8',
  );

  if (outcome.kind === 'expanded') {
    await writeFile(path.join(experimentDir, 'final.yml'), outcome.finalYaml, 'utf8');
    const fixtureDir = path.join('fixtures', 'oracle', 'parameters');
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(path.join(fixtureDir, `param-${entry.name}.input.yml`), entry.yaml, 'utf8');
    await writeFile(
      path.join(fixtureDir, `param-${entry.name}.final.yml`),
      outcome.finalYaml,
      'utf8',
    );
  }

  console.log(`${entry.name.padEnd(28)} ${describe(outcome)}`);
}
