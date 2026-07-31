import { describe, expect, it } from 'vitest';
import {
  ALIAS_UNSUPPORTED,
  NON_SCALAR_KEY,
  parsePipelineYaml,
  snippetOf,
} from '../../src/index.js';
import type { MappingNode, PipelineNode, ScalarNode } from '../../src/index.js';

const FILE = 'azure-pipelines.yml';

const src =
  [
    'trigger: none',
    'variables:',
    '  configuration: Release',
    '  ${{ if eq(parameters.deep, true) }}:',
    '    nested: value',
    'stages:',
    '- stage: Build',
    '  jobs:',
    '  - job: build_job',
    '    steps:',
    '    - script: |',
    '        echo one',
    '        echo two',
    "      displayName: 'Run build'",
    '    - bash: >',
    '        echo folded',
    '        line',
  ].join('\n') + '\n';

function asMap(n: PipelineNode | undefined): MappingNode {
  if (n?.kind !== 'mapping') throw new Error(`expected mapping, got ${n?.kind}`);
  return n;
}

function asScalar(n: PipelineNode | undefined): ScalarNode {
  if (n?.kind !== 'scalar') throw new Error(`expected scalar, got ${n?.kind}`);
  return n;
}

function entry(map: MappingNode, key: string): { key: ScalarNode; value: PipelineNode } {
  const e = map.entries.find((en) => en.key.value === key);
  if (!e) throw new Error(`no entry ${key}`);
  return e;
}

describe('parsePipelineYaml (E01-S01-T01)', () => {
  const result = parsePipelineYaml(src, FILE);
  const root = asMap(result.root);

  it('parses cleanly and every node carries the file name', () => {
    expect(result.errors).toEqual([]);
    expect(root.pos.file).toBe(FILE);
    expect(entry(root, 'trigger').key.pos.file).toBe(FILE);
  });

  it('positions top-level mapping keys (1-indexed line/col, C-E01-003)', () => {
    const trigger = entry(root, 'trigger').key;
    expect(trigger.pos.range).toEqual({ line: 1, col: 1, endLine: 1, endCol: 8 });
    expect(snippetOf(src, trigger)).toBe('trigger');
  });

  it('positions nested mapping scalars', () => {
    const variables = asMap(entry(root, 'variables').value);
    const configuration = entry(variables, 'configuration');
    expect(configuration.key.pos.range.line).toBe(3);
    expect(configuration.key.pos.range.col).toBe(3);
    const release = asScalar(configuration.value);
    expect(release.value).toBe('Release');
    expect(release.pos.range).toEqual({ line: 3, col: 18, endLine: 3, endCol: 25 });
    expect(snippetOf(src, release)).toBe('Release');
  });

  it('keeps template expressions inert — as plain scalar strings/keys (docs/01 §1)', () => {
    const variables = asMap(entry(root, 'variables').value);
    const exprEntry = variables.entries.find((e) => String(e.key.value).startsWith('${{'));
    expect(exprEntry).toBeDefined();
    expect(exprEntry?.key.value).toBe('${{ if eq(parameters.deep, true) }}');
    expect(exprEntry?.key.style).toBe('plain');
    expect(exprEntry?.key.pos.range.line).toBe(4);
    expect(exprEntry?.key.pos.range.col).toBe(3);
    const nested = asMap(exprEntry?.value);
    expect(entry(nested, 'nested').value).toMatchObject({ kind: 'scalar', value: 'value' });
  });

  it('positions sequences and their items', () => {
    const stages = entry(root, 'stages').value;
    expect(stages.kind).toBe('sequence');
    if (stages.kind !== 'sequence') return;
    expect(stages.pos.range.line).toBe(7);
    expect(stages.pos.range.col).toBe(1);
    const stage = asMap(stages.items[0]);
    expect(stage.pos.range.line).toBe(7);
    expect(stage.pos.range.col).toBe(3);
    expect(asScalar(entry(stage, 'stage').value).value).toBe('Build');
  });

  it('positions deep nodes (jobs/steps)', () => {
    const stage = asMap(asSeq(entry(root, 'stages').value)[0]);
    const job = asMap(asSeq(entry(stage, 'jobs').value)[0]);
    const jobKey = entry(job, 'job');
    expect(jobKey.key.pos.range).toEqual({ line: 9, col: 5, endLine: 9, endCol: 8 });
    expect(asScalar(jobKey.value).value).toBe('build_job');
  });

  it('block literal scalar: value, style, range spanning header→content, snippet round-trip', () => {
    const step = asMap(stepAt(root, 0));
    const script = asScalar(entry(step, 'script').value);
    expect(script.style).toBe('literal');
    expect(script.value).toBe('echo one\necho two\n');
    // starts at the `|` header on line 11; ends exclusive at start of the next node's line
    expect(script.pos.range.line).toBe(11);
    expect(script.pos.range.col).toBe(15);
    expect(script.pos.range.endLine).toBe(14);
    expect(script.pos.range.endCol).toBe(1);
    expect(snippetOf(src, script)).toBe('|\n        echo one\n        echo two\n');
  });

  it('block folded scalar', () => {
    const step = asMap(stepAt(root, 1));
    const bash = asScalar(entry(step, 'bash').value);
    expect(bash.style).toBe('folded');
    expect(bash.value).toBe('echo folded line\n');
    expect(snippetOf(src, bash)).toBe('>\n        echo folded\n        line\n');
  });

  it('quoted scalar: snippet includes the quotes, value does not', () => {
    const step = asMap(stepAt(root, 0));
    const displayName = asScalar(entry(step, 'displayName').value);
    expect(displayName.style).toBe('single');
    expect(displayName.value).toBe('Run build');
    expect(displayName.pos.range).toEqual({ line: 14, col: 20, endLine: 14, endCol: 31 });
    expect(snippetOf(src, displayName)).toBe("'Run build'");
  });

  function asSeq(n: PipelineNode): PipelineNode[] {
    if (n.kind !== 'sequence') throw new Error(`expected sequence, got ${n.kind}`);
    return n.items;
  }

  function stepAt(rootMap: MappingNode, i: number): PipelineNode | undefined {
    const stage = asMap(asSeq(entry(rootMap, 'stages').value)[0]);
    const job = asMap(asSeq(entry(stage, 'jobs').value)[0]);
    return asSeq(entry(job, 'steps').value)[i];
  }
});

describe('parse edge cases (E01-S01-T01)', () => {
  it('bare `key:` yields a zero-width null value after the colon', () => {
    // Observed yaml@2.9.0 behavior: the missing value is a real Scalar(null) node with a
    // zero-width range following ':' (our syntheticProvenance branch is defense-in-depth).
    const r = parsePipelineYaml('pool:\n', FILE);
    const pool = entry(asMap(r.root), 'pool');
    const v = asScalar(pool.value);
    expect(v.value).toBeNull();
    expect(v.pos.range).toEqual({ line: 1, col: 6, endLine: 1, endCol: 6 });
    expect(v.pos.offset[0]).toBe(v.pos.offset[1]);
  });

  it('empty input → no root, no errors (schema validation is E01-S02, not parse)', () => {
    const r = parsePipelineYaml('', FILE);
    expect(r.root).toBeUndefined();
    expect(r.errors).toEqual([]);
  });

  it('YAML syntax errors surface with a 1-indexed position', () => {
    const r = parsePipelineYaml('a: [1, 2\n', FILE);
    const err = r.errors[0];
    if (!err) throw new Error('expected at least one parse error');
    expect(err.code).toBeTruthy();
    expect(err.pos.file).toBe(FILE);
    expect(err.pos.range.line).toBeGreaterThanOrEqual(1);
    expect(err.pos.range.col).toBeGreaterThanOrEqual(1);
  });

  it('aliases produce the structural ALIAS_UNSUPPORTED error (semantics: T02)', () => {
    const r = parsePipelineYaml('a: &x 1\nb: *x\n', FILE);
    const alias = r.errors.find((e) => e.code === ALIAS_UNSUPPORTED);
    expect(alias).toBeDefined();
    expect(alias?.pos.range).toMatchObject({ line: 2, col: 4 });
    // the representable part of the DOM is still built
    expect(asScalar(entry(asMap(r.root), 'a').value).value).toBe(1);
  });

  it('non-scalar mapping keys are rejected structurally', () => {
    const r = parsePipelineYaml('? [1]\n: v\n', FILE);
    expect(r.errors.some((e) => e.code === NON_SCALAR_KEY)).toBe(true);
  });

  it('duplicate keys and multi-doc pass through as yaml-package errors (C-E01-002; server conformance: T02)', () => {
    expect(
      parsePipelineYaml('a: 1\na: 2\n', FILE).errors.some((e) => e.code === 'DUPLICATE_KEY'),
    ).toBe(true);
    expect(
      parsePipelineYaml('a: 1\n---\nb: 2\n', FILE).errors.some((e) => e.code === 'MULTIPLE_DOCS'),
    ).toBe(true);
  });

  function asMap(n: PipelineNode | undefined): MappingNode {
    if (n?.kind !== 'mapping') throw new Error(`expected mapping, got ${n?.kind}`);
    return n;
  }
  function asScalar(n: PipelineNode | undefined): ScalarNode {
    if (n?.kind !== 'scalar') throw new Error(`expected scalar, got ${n?.kind}`);
    return n;
  }
  function entry(map: MappingNode, key: string): { key: ScalarNode; value: PipelineNode } {
    const e = map.entries.find((en) => en.key.value === key);
    if (!e) throw new Error(`no entry ${key}`);
    return e;
  }
});
