// E03-S01-T05 — scalar interpolation.
//
// The fixture suite uses the exact 2026-08-19 preview input/finalYaml pairs. Probes the service
// rejected have no golden, so they are asserted against their committed error transcripts instead —
// and for this task the rejections carry three of the load-bearing claims, because the lone/mixed
// boundary (C-E03-180) and the two key-position sentences (C-E03-191) are things the service tells
// us by refusing a document.
//
// One claim belongs to a layer below this one and the tests say so rather than asserting the
// visitor's behavior as if it were the whole story: `interp-lone-string-numeric` cannot go through
// `normalizeExpandedYaml`, because the *normalizer* re-types the service's `0123` into the Number
// 123 (C-E03-193, handed to E03-S05-T03). It is compared against the raw `finalYaml` text instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { conditionalVisitor } from '../../src/template/conditionals.js';
import { eachVisitor } from '../../src/template/each.js';
import { insertVisitor } from '../../src/template/insert.js';
import { interpolationVisitor } from '../../src/template/interpolate.js';
import { normalizeExpandedYaml } from '../../src/normalize/normalize.js';
import { composeVisitors } from '../../src/template/walk.js';
import {
  expandFixture,
  oracleFixtures,
  repoRoot,
  walkFixture,
  type DirectiveVisitorFactory,
} from './fixture-harness.js';

/**
 * The same composition the directive suites use. `interpolationVisitor` is supplied by the harness
 * itself now — this factory adds only the directive half — which is the point of T05 replacing the
 * stand-in: every E03-S01 suite runs one interpolation implementation, not four approximations.
 */
const directives: DirectiveVisitorFactory = (evaluate, values) =>
  composeVisitors(conditionalVisitor({ values }), insertVisitor(evaluate), eachVisitor(evaluate));

const expand = (source: string) => expandFixture(source, directives);

const probe = (name: string, file = 'probe.yml'): string =>
  readFileSync(join(repoRoot, 'research', 'experiments', 'E03-interpolation', name, file), 'utf8');

/** The message the service returned, reassembled from its committed transcript. */
const rejection = (name: string): string =>
  (JSON.parse(probe(name, 'response.json')) as { message: string }).message
    .split('\n')
    .map((line) => line.replace(/^\S+ \(Line: \d+, Col: \d+\): /, ''))
    .join('\n');

interface ProbeStep {
  readonly env?: Record<string, unknown>;
  readonly script?: string;
  readonly displayName?: string;
  readonly inputs?: { script?: string };
}

/**
 * The probe job's steps, read **without** the normalizer. Most assertions below want the normalized
 * view — it is what parity is measured through — but the two claims about a scalar's exact text
 * (C-E03-192/193) have to see the document before N7 re-types it and N8 sorts its keys.
 */
const steps = (yaml: string): readonly ProbeStep[] =>
  (parse(yaml) as { stages?: { jobs: { steps: ProbeStep[] }[] }[] }).stages?.[0]?.jobs[0]?.steps ??
  [];

/** The `env:` mapping of the single probe step, normalized — where most probes put their answer. */
function env(yaml: string): Record<string, unknown> {
  const step = ((
    normalizeExpandedYaml(yaml).value as { stages: { jobs: { steps: unknown[] }[] }[] }
  ).stages[0]?.jobs[0]?.steps ?? [])[0] as { env?: Record<string, unknown> } | undefined;
  return step?.env ?? {};
}

const diagnostics = (source: string): readonly string[] =>
  walkFixture(source, directives).diagnostics.map((diagnostic) => diagnostic.message);

/**
 * Two pairs cannot be normalized goldens, for one shared reason: `normalizeExpandedYaml` compares a
 * scalar *after* the YAML parser has typed it, so a String whose text YAML reads as something else
 * survives the round trip on the service's side and not on ours (C-E03-193, handed to E03-S05-T03).
 *
 *  - `lone-string-numeric` — the service writes the String `0123` unquoted; the normalizer reads it
 *    back as the Number 123, while our quoted `"0123"` stays four characters.
 *  - `key-boolean` — the *key* `True` is the String form and must stay text (C-E03-192 shows the
 *    service quoting that exact spelling back in an error), but read as YAML it is a Boolean, so
 *    the normalizer folds the service's side to `true` and ours to `True`.
 *
 * Values are unaffected because a lone scalar result is carried as the node a parse of its String
 * form would produce (see `structural` in `interpolate.ts`) — which is precisely what the normalizer
 * does to the service's side, so the two agree. A key has no such option: its measured spelling is
 * the evidence.
 */
const NORMALIZER_LOSSY = new Set(['interp-lone-string-numeric', 'interp-key-boolean']);

/**
 * Pairs whose `finalYaml` contains a `script:`/`- script:` shortcut the service **desugared** into
 * `task: CmdLine@2`. Desugaring is deliberately outside the E03-S05-T01 normalizer (doing it there
 * would let a broken expander pass `preview-diff`) and belongs to E04 — the same exclusion
 * E03-S01-T04 made for `insert-sequence-position-valid`. Their structural points are asserted
 * directly below.
 */
const DESUGARED_BY_THE_SERVICE = new Set([
  'interp-lone-array-sequence-item',
  'interp-lone-object-sequence-item',
]);

const fixtures = oracleFixtures('interp-');
const goldens = fixtures.filter(
  ({ name }) => !NORMALIZER_LOSSY.has(name) && !DESUGARED_BY_THE_SERVICE.has(name),
);

describe('interpolation oracle goldens', () => {
  it('commits the live input/finalYaml pairs', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(20);
    expect(fixtures.map(({ name }) => name)).toContain('interp-lone-object-value');
  });

  it.each(goldens)('$name matches the service finalYaml', ({ input, final }) => {
    expect(normalizeExpandedYaml(expand(input).yaml).value).toEqual(
      normalizeExpandedYaml(final).value,
    );
  });

  it('C-E03-185/193 — the `0123` pair, against raw text because the normalizer is lossy', () => {
    const fixture = fixtures.find(({ name }) => name === 'interp-lone-string-numeric');
    // Our side keeps the String, and so does the service's *text*. It is only the normalizer's
    // typed re-reading of that text that turns it into 123 — asserted here so the gap is a fact in
    // the suite rather than a note, and so E03-S05-T03 has a test to flip.
    expect(steps(expand(fixture?.input ?? '').yaml)[0]?.env?.PROBE).toBe('0123');
    expect(fixture?.final).toContain('PROBE: 0123');
    expect(env(fixture?.final ?? '').PROBE).toBe('123');
  });

  it('C-E03-192/193 — the `True` key pair, for the same reason on the key side', () => {
    const fixture = fixtures.find(({ name }) => name === 'interp-key-boolean');
    expect(Object.keys(steps(expand(fixture?.input ?? '').yaml)[0]?.env ?? {})).toEqual(['True']);
    expect(fixture?.final).toContain('True: value');
    expect(Object.keys(env(fixture?.final ?? ''))).toEqual(['true']);
  });
});

// -------------------------------------------------------------------------------------------
// Lone expression → structural insertion
// -------------------------------------------------------------------------------------------

describe('a lone expression inserts structurally (C-E03-177..179)', () => {
  it('C-E03-177 — an Object in mapping-value position becomes a real mapping', () => {
    expect(env(expand(probe('lone-object-value')).yaml)).toEqual({ ALPHA: 'a', BETA: 'b' });
  });

  it('C-E03-180 — quoting the host scalar does not demote it to mixed content', () => {
    expect(env(expand(probe('lone-object-value-quoted')).yaml)).toEqual({
      ALPHA: 'a',
      BETA: 'b',
    });
  });

  it('C-E03-178 — an Array in sequence position splices its items in', () => {
    const expanded = steps(expand(probe('lone-array-sequence-item')).yaml);
    // Three siblings, not a nested list and not one item holding two: the doc's flattening rule.
    // The service's own final YAML has three steps too — it just desugars each `script:` shortcut
    // into `task: CmdLine@2`, which is why this pair is not a normalized golden.
    expect(expanded.map((step) => step.script)).toEqual([
      'echo pre-one',
      'echo pre-two',
      undefined,
    ]);
    expect(expanded[2]?.inputs?.script).toBe('echo probe');
    const service = parse(
      fixtures.find(({ name }) => name === 'interp-lone-array-sequence-item')?.final ?? '',
    ) as { stages: { jobs: { steps: unknown[] }[] }[] };
    expect(service.stages[0]?.jobs[0]?.steps).toHaveLength(3);
  });

  it('C-E03-178 — an Object in sequence position is one item, not a splice', () => {
    const expanded = steps(expand(probe('lone-object-sequence-item')).yaml);
    // Two keys forming one step. Splicing them into the parent sequence — the other reading of
    // "structural insertion" — would give three items here, the middle two not steps at all.
    expect(expanded).toHaveLength(2);
    expect(expanded[0]).toEqual({ script: 'echo from-object', displayName: 'From Object' });
    const service = parse(
      fixtures.find(({ name }) => name === 'interp-lone-object-sequence-item')?.final ?? '',
    ) as { stages: { jobs: { steps: unknown[] }[] }[] };
    expect(service.stages[0]?.jobs[0]?.steps).toHaveLength(2);
  });

  it('C-E03-179 — nested mappings, empty sequences and scalars all survive whole', () => {
    const job = (
      normalizeExpandedYaml(expand(probe('lone-object-nested')).yaml).value as {
        stages: { jobs: Record<string, unknown>[] }[];
      }
    ).stages[0]?.jobs[1];
    expect(job?.workspace).toEqual({ clean: 'all' });
    expect(job?.dependsOn).toEqual([]);
    expect(job?.displayName).toBe('Nested');
  });
});

// -------------------------------------------------------------------------------------------
// Stringification — the table the task's Done field asks for
// -------------------------------------------------------------------------------------------

describe('scalar stringification (C-E03-181..184)', () => {
  // Every row is a live measurement, lone and mixed side by side. The mixed column is what pins the
  // rendering independently of any YAML-serializer choice: `v0.5` cannot be a re-typed number.
  it.each([
    ['C-E03-181', 'lone-boolean', { FROM_PARAM: 'true', LITERAL_TRUE: 'true', LITERAL_FALSE: 'false' }], // prettier-ignore
    ['C-E03-182', 'lone-number', { HALF: '0.5', ONE_POINT_ZERO: '1', MILLION: '1000000', NEGATIVE: '-1.25' }], // prettier-ignore
    ['C-E03-183', 'lone-null', { BEFORE: 'before', PROBE: '' }],
    ['C-E03-183', 'lone-empty-string', { BEFORE: 'before', PROBE: '' }],
    ['C-E03-184', 'lone-version', { PROBE: '1.2.3' }],
    ['C-E03-185', 'lone-string-yamlish-quoted', { PROBE: 'a: b' }],
    ['C-E03-186', 'mixed-boolean', { TRUE_MID: 'pre-True-post', FALSE_MID: 'pre-False-post' }],
    ['C-E03-186', 'mixed-null', { PROBE: 'pre--post' }],
    ['C-E03-182', 'mixed-number', { HALF: 'v0.5', ONE_POINT_ZERO: 'v1', MILLION: 'v1000000', NEGATIVE: 'v-1.25' }], // prettier-ignore
    ['C-E03-184', 'mixed-version', { THREE: 'v1.2.3', FOUR: 'v1.2.3.4' }],
    ['C-E03-186', 'mixed-two-expressions', { SEPARATED: 'a then b', ADJACENT: 'ab' }],
    ['C-E03-188', 'escape-literal', { PROBE: 'my${{value' }],
    ['C-E03-188', 'escape-literal-quote', { PROBE: "my${{value with a ' single quote too" }],
    ['C-E03-180', 'whitespace-around-lone-string', { PROBE: '  x  ' }],
  ])('%s — %s', (_claim, name, expected) => {
    expect(env(expand(probe(name)).yaml)).toEqual(expected);
  });

  it('C-E03-181 — the Boolean casing is `True`/`False`, checked before YAML gets a say', () => {
    // The normalized comparison above folds `True` and `true` together, so on its own it would pass
    // for an implementation that rendered `yes`/`no`. This asserts the String form directly.
    expect(env(expand(probe('mixed-boolean')).yaml).TRUE_MID).toBe('pre-True-post');
    expect(env(expand(probe('mixed-boolean')).yaml).FALSE_MID).toBe('pre-False-post');
  });

  it('C-E03-182 — `1.0` loses its trailing zero, so the value is a double not the source text', () => {
    expect(env(expand(probe('mixed-number')).yaml).ONE_POINT_ZERO).toBe('v1');
  });

  it('C-E03-186 — two adjacent expressions are mixed content, not one lone expression', () => {
    // The case a "starts with ${{ and ends with }}" test gets wrong: both hold for `${{a}}${{b}}`.
    expect(env(expand(probe('mixed-two-expressions')).yaml).ADJACENT).toBe('ab');
  });

  it('C-E03-189 — a block scalar interpolates as one scalar and keeps its lines', () => {
    const script = (
      normalizeExpandedYaml(expand(probe('block-scalar-expression')).yaml).value as {
        stages: { jobs: { steps: { inputs: { script: string } }[] }[] }[];
      }
    ).stages[0]?.jobs[0]?.steps[0]?.inputs.script;
    expect(script).toBe('echo one\necho world\necho three\n');
  });
});

// -------------------------------------------------------------------------------------------
// The lone/mixed boundary — the finding that changed T01
// -------------------------------------------------------------------------------------------

describe('the lone/mixed boundary is not whitespace-tolerant (C-E03-180)', () => {
  it('padding demotes a structural insertion to mixed content, which then cannot convert', () => {
    // The service returns two sentences here; the second, `Unexpected value ''`, is the schema
    // rejecting `env: ''` afterwards and belongs to E01-S02, so only the first is ours.
    expect(diagnostics(probe('whitespace-around-lone-object'))).toEqual([
      'Unable to convert from Object to String. Value: Object',
    ]);
    expect(rejection('whitespace-around-lone-object').split('\n')[0]).toBe(
      'Unable to convert from Object to String. Value: Object',
    );
  });

  it('the padding itself survives, so the service never trimmed and re-added it', () => {
    expect(env(expand(probe('whitespace-around-lone-string')).yaml).PROBE).toBe('  x  ');
  });

  it('the same expression without padding still inserts structurally', () => {
    expect(diagnostics(probe('lone-object-value-quoted'))).toEqual([]);
  });
});

describe('collections in a string position (C-E03-187)', () => {
  it.each([
    ['mixed-object', 'Unable to convert from Object to String. Value: Object'],
    ['mixed-array', 'Unable to convert from Array to String. Value: Array'],
  ])('%s — the sentence names the kind twice', (name, message) => {
    expect(diagnostics(probe(name))).toEqual([message]);
    expect(rejection(name)).toBe(message);
  });

  it('the sentence carries no help link and no expression position', () => {
    // Both are measured absences: every *expression* error in the E02 corpus ends with the help
    // link and carries "Located at position N within expression".
    expect(rejection('mixed-object')).not.toContain('For more help');
    expect(rejection('mixed-object')).not.toContain('Located at position');
  });

  it('the failed hole becomes the empty string and interpolation continues', () => {
    // Proven by the service itself: the padded probe's *second* sentence is `Unexpected value ''`,
    // i.e. it went on to hand `env: ''` to the schema rather than stopping at the conversion.
    expect(rejection('whitespace-around-lone-object').split('\n')[1]).toBe("Unexpected value ''");
    // `expandFixture` asserts a clean walk, so the substitution has to be read off `walkFixture`.
    const result = walkFixture(probe('mixed-object'), directives).plain as {
      stages: { jobs: { steps: ProbeStep[] }[] }[];
    };
    expect(result.stages[0]?.jobs[0]?.steps[0]?.env?.PROBE).toBe('pre-');
  });
});

// -------------------------------------------------------------------------------------------
// Keys
// -------------------------------------------------------------------------------------------

describe('expressions in keys stringify (C-E03-190..192)', () => {
  it.each([
    ['key-string', { PROBE: 'value' }],
    ['key-boolean', { True: 'value' }],
    ['key-number', { 1: 'one', 0.5: 'half' }],
    ['key-null', { BEFORE: 'before', '': 'value' }],
    ['key-mixed', { PRE_TAIL: 'value' }],
  ])('%s', (name, expected) => {
    expect(env(expand(probe(name)).yaml)).toEqual(expected);
  });

  it('C-E03-190 — a key is *always* the String form, where a value may stay structural', () => {
    // `${{ true }}` is the key `True` — the literal four characters, not a Boolean that a YAML
    // writer happens to render that way, and not `true`. C-E03-192 confirms the same spelling from
    // the service's own error text in a schema-checked mapping.
    const keys = Object.keys(
      (
        walkFixture(probe('key-boolean'), directives).plain as {
          stages: { jobs: { steps: { env: Record<string, unknown> }[] }[] }[];
        }
      ).stages[0]?.jobs[0]?.steps[0]?.env ?? {},
    );
    expect(keys).toEqual(['True']);
    expect(rejection('key-boolean-nonloose')).toBe("Unexpected value 'True'");
  });

  it('C-E03-190 — a Null key is the empty string, in place, not a dropped entry', () => {
    // Read before the normalizer, which sorts keys (N8), so the *position* is observable too.
    expect(Object.keys(steps(expand(probe('key-null')).yaml)[0]?.env ?? {})).toEqual([
      'BEFORE',
      '',
    ]);
  });

  it('C-E03-191 — a *lone* collection key is `Expected a scalar value`', () => {
    expect(diagnostics(probe('key-object'))).toEqual(['Expected a scalar value']);
    expect(rejection('key-object')).toBe('Expected a scalar value');
  });

  it('C-E03-191 — the same collection in *mixed* key content gives the conversion sentence', () => {
    // The pair is the evidence that keys run through the same lone/mixed split as values: one rule
    // cannot produce two sentences for two spellings of the same failure.
    expect(diagnostics(probe('key-mixed-object'))).toEqual([
      'Unable to convert from Object to String. Value: Object',
    ]);
    expect(rejection('key-mixed-object')).toBe(
      'Unable to convert from Object to String. Value: Object',
    );
  });

  it('C-E03-191 — the raw key is kept when it cannot be rendered', () => {
    // Substituting anything would invent a key the user never wrote, and could then collide with a
    // real one under the mapping's duplicate rule (C-E03-169).
    const result = walkFixture(probe('key-object'), directives).plain as {
      stages: { jobs: { steps: { env: Record<string, unknown> }[] }[] }[];
    };
    expect(Object.keys(result.stages[0]?.jobs[0]?.steps[0]?.env ?? {})).toEqual([
      '${{ parameters.obj }}',
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// Directive keywords in value position
// -------------------------------------------------------------------------------------------

describe('a lone directive keyword in value position is never evaluated (C-E03-194)', () => {
  const insertProbe = (name: string): string =>
    readFileSync(
      join(repoRoot, 'research', 'experiments', 'E03-insert', name, 'probe.yml'),
      'utf8',
    );

  it('C-E03-173/194 — `KEY: ${{ insert }}` survives verbatim, with no expression error', () => {
    const result = walkFixture(insertProbe('value-position'), directives);
    // The whole point: an interpolator that evaluated this would report `Unrecognized value:
    // 'insert'`, the one sentence T04's probe proves the service does not emit.
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.plain)).toContain('${{ insert }}');
  });

  it('the rule is the lone case only — the keyword set is what is exempt, not the text', () => {
    const source =
      'variables:\n  KEY: ${{ if eq(1, 1) }}\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - task: CmdLine@2\n        inputs:\n          script: echo probe\n';
    const result = walkFixture(source, directives);
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.plain)).toContain('${{ if eq(1, 1) }}');
  });
});

// -------------------------------------------------------------------------------------------
// Composition: the pass the other four now run through
// -------------------------------------------------------------------------------------------

describe('composition with the directive passes', () => {
  it('interpolation and directives compose in either order', () => {
    // `interpolationVisitor` defines only the `scalar` hook and the directive visitors define only
    // the two directive hooks, so unlike C-E03-138's chain/insert ordering constraint this one is
    // genuinely free — and a regression that gave interpolation a directive hook would show here.
    const source = probe('lone-object-value');
    const first = expandFixture(source, (evaluate, values) =>
      composeVisitors(interpolationVisitor(evaluate), conditionalVisitor({ values })),
    );
    const second = expandFixture(source, (evaluate, values) =>
      composeVisitors(conditionalVisitor({ values }), interpolationVisitor(evaluate)),
    );
    expect(first.yaml).toBe(second.yaml);
  });

  it('an `each` body interpolates with the loop binding in scope', () => {
    // The composition the `each` goldens already rely on, asserted here so a change to the scalar
    // seam that dropped the frame would fail in T05's own suite rather than only in T03's.
    const source =
      'parameters:\n- name: names\n  type: object\n  default:\n  - alpha\n  - beta\n' +
      'stages:\n- stage: probe\n  jobs:\n  - job: probe\n    steps:\n' +
      '      - ${{ each name in parameters.names }}:\n' +
      '        - task: CmdLine@2\n          displayName: run-${{ name }}\n' +
      '          inputs:\n            script: echo ${{ name }}\n';
    const steps = (
      normalizeExpandedYaml(expand(source).yaml).value as {
        stages: { jobs: { steps: { displayName: string }[] }[] }[];
      }
    ).stages[0]?.jobs[0]?.steps;
    expect(steps?.map((step) => step.displayName)).toEqual(['run-alpha', 'run-beta']);
  });
});
