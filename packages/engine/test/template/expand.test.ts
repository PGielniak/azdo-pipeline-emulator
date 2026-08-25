// E03-S04-T02 — the expanded-YAML emitter and its provenance map.
//
// The Done criteria are "map covers 100% of emitted nodes on corpus" and "spot-check tool prints
// provenance for a chosen line", and there is a third thing the Ground field asks for —
// "compare serialization choices against oracle `finalYaml` formatting" — which turns out to be
// the strongest test in the file:
//
//   1. **The fixpoint.** Parsing each of the ten corpus `final.yml`s and re-serializing them
//      reproduces the file **byte for byte**. That is not a golden we wrote; it is the service's
//      own output surviving a round trip through our emitter, so the formatting choices are
//      measured rather than chosen (C-E03-250/251/252).
//   2. **Coverage.** Every node of every expanded corpus document has a map entry, asserted by
//      counting the nodes independently of the map builder — a coverage check that reused the
//      builder's own walk would be checking nothing.
//   3. **The spot-check tool**, run as a subprocess against a real file, because "prints
//      provenance for a chosen line" is a claim about a program, not about a function.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { parsePipelineYaml, type PipelineNode } from '../../src/frontend/parse.js';
import {
  EXPANSION_MAP_VERSION,
  buildExpansionMap,
  expandDocument,
  parametersHash,
  provenanceAtLine,
  serializeExpandedYaml,
} from '../../src/template/expand.js';
import { stringValue } from '../../src/expr/value.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const oracleFinals = (): { name: string; text: string }[] =>
  readdirSync(join(repoRoot, 'fixtures', 'oracle'), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.final.yml'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      text: readFileSync(join(repoRoot, 'fixtures', 'oracle', e.name), 'utf8'),
    }));

const corpusAuthored = (): { name: string; text: string }[] =>
  readdirSync(join(repoRoot, 'fixtures', 'corpus'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: e.name,
      text: readFileSync(join(repoRoot, 'fixtures', 'corpus', e.name, 'pipeline.yml'), 'utf8'),
    }));

/** Count every node in a DOM — independently of the map builder's own walk. */
function countNodes(node: PipelineNode | undefined): number {
  if (node === undefined) return 0;
  switch (node.kind) {
    case 'scalar':
      return 1;
    case 'sequence':
      return 1 + node.items.reduce((sum, item) => sum + countNodes(item), 0);
    case 'mapping':
      return 1 + node.entries.reduce((sum, entry) => sum + countNodes(entry.value), 0);
  }
}

const parse = (text: string, file = 'pipeline.yml'): PipelineNode => {
  const result = parsePipelineYaml(text, file);
  expect(result.errors).toEqual([]);
  expect(result.root).toBeDefined();
  return result.root!;
};

describe('serializeExpandedYaml — the service formatting is a measured fixpoint', () => {
  it.each(oracleFinals())('$name round-trips byte for byte', ({ text }) => {
    expect(serializeExpandedYaml(parse(text))).toBe(text);
  });

  it('keeps a sequence unindented under its key, which the library default does not', () => {
    const yaml = serializeExpandedYaml(parse('stages:\n- stage: a\n'));
    expect(yaml).toBe('stages:\n- stage: a\n\n');
  });

  it('preserves the authored quoting — the one corpus entry a value-based emitter gets wrong', () => {
    // `0 3 * * Mon-Fri` is a legal *plain* scalar, so an emitter working from plain JS values
    // drops the quotes the service keeps (C-E03-252).
    const source = "schedules:\n- cron: '0 3 * * Mon-Fri'\n";
    expect(serializeExpandedYaml(parse(source))).toBe(`${source}\n`);
  });

  it('does not re-quote a scalar the reader retyped', () => {
    // `true` and `42` parse to a boolean and a number; they must come back plain, not quoted.
    expect(serializeExpandedYaml(parse('a: true\nb: 42\n'))).toBe('a: true\nb: 42\n\n');
  });

  it('emits a lone newline for an empty document', () => {
    expect(serializeExpandedYaml(undefined)).toBe('\n');
  });
});

describe('buildExpansionMap — coverage is 100% by construction', () => {
  it.each(corpusAuthored())('$name — every emitted node has an entry', ({ name, text }) => {
    const result = expandDocument(text, `${name}/pipeline.yml`);
    // Corpus entries with templates reference files this single-document expander does not read;
    // their `template:` scalars survive verbatim, which is fine — the map still covers them.
    const emitted = parse(result.yaml, 'expanded.yml');
    expect(result.map.entries).toHaveLength(countNodes(emitted));
    expect(result.map.version).toBe(EXPANSION_MAP_VERSION);
  });

  it.each(corpusAuthored())(
    '$name — every entry names a real line and a real source',
    ({ name, text }) => {
      const result = expandDocument(text, `${name}/pipeline.yml`);
      const lines = result.yaml.split('\n').length;
      for (const entry of result.map.entries) {
        expect(entry.line).toBeGreaterThanOrEqual(1);
        expect(entry.line).toBeLessThanOrEqual(lines);
        expect(entry.from.file).toBe(`${name}/pipeline.yml`);
        expect(entry.from.line).toBeGreaterThanOrEqual(1);
      }
    },
  );

  it('paths address the emitted document, mapping keys and sequence indices alike', () => {
    const { map } = expandDocument('stages:\n- stage: build\n  jobs:\n  - job: one\n', 'p.yml');
    expect(map.entries.map((e) => e.path)).toEqual([
      '',
      '/stages',
      '/stages/0',
      '/stages/0/stage',
      '/stages/0/jobs',
      '/stages/0/jobs/0',
      '/stages/0/jobs/0/job',
    ]);
  });

  it('a node synthesized by a directive carries the provenance of the site that made it', () => {
    // The `each` body is written once and emitted twice; both copies point at the authored line.
    const source =
      'parameters:\n- name: names\n  type: object\n  default: [a, b]\n' +
      'stages:\n' +
      '- ${{ each n in parameters.names }}:\n' +
      '  - stage: ${{ n }}\n';
    const result = expandDocument(source, 'p.yml');
    expect(result.diagnostics).toEqual([]);
    expect(result.directives).toContain('each');
    const stages = result.map.entries.filter((e) => /^\/stages\/\d+$/.test(e.path));
    expect(stages).toHaveLength(2);
    // Same authored line for both, different emitted lines — which is exactly the fact a
    // provenance map exists to record.
    expect(new Set(stages.map((e) => e.from.line)).size).toBe(1);
    expect(new Set(stages.map((e) => e.line)).size).toBe(2);
  });

  it('records the repository and parameter hash when the caller supplies them', () => {
    const source = 'parameters:\n- name: p\n  default: v\nstages:\n- stage: a\n';
    const result = expandDocument(source, 'p.yml', {
      repo: 'https://example/_git/r@' + 'a'.repeat(40),
    });
    const root = result.map.entries[0]!;
    expect(root.from.repo).toBe('https://example/_git/r@' + 'a'.repeat(40));
    expect(root.from.parameters).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is empty for a document that produced no node', () => {
    const map = buildExpansionMap(undefined, '\n', { file: 'p.yml' });
    expect(map.entries).toEqual([]);
  });
});

describe('parametersHash', () => {
  it('is undefined with nothing bound, and stable under key order', () => {
    expect(parametersHash({})).toBeUndefined();
    const a = parametersHash({ x: stringValue('1'), y: stringValue('2') });
    const b = parametersHash({ y: stringValue('2'), x: stringValue('1') });
    expect(a).toBe(b);
    expect(parametersHash({ x: stringValue('2') })).not.toBe(a);
  });
});

describe('provenanceAtLine', () => {
  it('returns the innermost node starting on that line', () => {
    const { map, yaml } = expandDocument('stages:\n- stage: build\n', 'p.yml');
    const line = yaml.split('\n').findIndex((text) => text.includes('- stage')) + 1;
    const entry = provenanceAtLine(map, line)!;
    // Both `/stages/0` and `/stages/0/stage` start here; the deeper one is the useful answer.
    expect(entry.path).toBe('/stages/0/stage');
  });

  it('returns undefined for a line no node starts on', () => {
    const { map } = expandDocument('stages:\n- stage: build\n', 'p.yml');
    expect(provenanceAtLine(map, 9999)).toBeUndefined();
  });
});

describe('expandDocument — the offline entry point', () => {
  it('binds root parameters, including queue-time values, and interpolates them', () => {
    const source =
      'parameters:\n- name: env\n  default: dev\nstages:\n- stage: ${{ parameters.env }}\n';
    expect(expandDocument(source, 'p.yml').yaml).toContain('- stage: dev');
    expect(expandDocument(source, 'p.yml', { parameters: { env: 'prod' } }).yaml).toContain(
      '- stage: prod',
    );
  });

  it('reads the root vocabulary by default, so a root-only type is accepted', () => {
    const source =
      'parameters:\n- name: p\n  type: environment\n  default: prod\nstages:\n- stage: a\n';
    expect(expandDocument(source, 'p.yml').diagnostics).toEqual([]);
    expect(expandDocument(source, 'p.yml', { position: 'template' }).diagnostics).toHaveLength(1);
  });

  it('accumulates diagnostics rather than throwing on the first (C-E02-110)', () => {
    const source =
      'parameters:\n- name: a\n  type: number\n- name: b\n  type: number\nstages:\n- stage: s\n';
    const result = expandDocument(source, 'p.yml');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      "A value for the 'a' parameter must be provided.",
      "A value for the 'b' parameter must be provided.",
    ]);
  });

  it('surfaces parse errors as diagnostics instead of throwing', () => {
    const result = expandDocument('a: [\n', 'p.yml');
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.file).toBe('p.yml');
  });

  it('runs the conditional and insert passes too', () => {
    const source =
      'parameters:\n- name: on\n  type: boolean\n  default: true\n' +
      '- name: extra\n  type: object\n  default: {k: v}\n' +
      'stages:\n' +
      '- stage: a\n' +
      '  ${{ if parameters.on }}:\n' +
      '    displayName: shown\n' +
      '  ${{ insert }}: ${{ parameters.extra }}\n';
    const result = expandDocument(source, 'p.yml');
    expect(result.diagnostics).toEqual([]);
    expect(result.yaml).toContain('displayName: shown');
    expect(result.yaml).toContain('k: v');
    expect(result.directives).toEqual(expect.arrayContaining(['if', 'insert']));
  });
});

describe('the spot-check tool', () => {
  const script = join(repoRoot, 'scripts', 'expansion-provenance.ts');
  const fixture = join(repoRoot, 'fixtures', 'corpus', '01-matrix-multi-config', 'pipeline.yml');

  // The tool imports the *built* engine (Node's type stripping does not remap the `.js`
  // specifiers the sources carry), so the package is built once before the three cases run.
  beforeAll(() => {
    execFileSync('pnpm', ['--filter', '@azdo-emu/engine', 'build'], { cwd: repoRoot });
  }, 120_000);

  const run = (...args: string[]): string =>
    execFileSync('node', [script, fixture, ...args], { encoding: 'utf8', cwd: repoRoot });

  it('prints the expanded document with a provenance gutter', () => {
    const output = run();
    expect(output).toContain('pipeline.yml:');
    expect(output).toContain('│');
    expect(output.split('\n').length).toBeGreaterThan(10);
  });

  it('prints one chosen line with its source stack', () => {
    const output = run('2');
    expect(output).toMatch(/^2: /);
    expect(output).toContain('from pipeline.yml:');
  });

  it('writes the map as JSON', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'azdo-expansion-map-')), 'map.json');
    const output = run('--map', out);
    expect(output).toMatch(/^wrote \d+ entries to /);
    const map = JSON.parse(readFileSync(out, 'utf8')) as { version: number; entries: unknown[] };
    expect(map.version).toBe(EXPANSION_MAP_VERSION);
    expect(map.entries.length).toBeGreaterThan(0);
  });
}, 60_000);
