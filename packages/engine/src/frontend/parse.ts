// E01-S01-T01 — CST-backed YAML parse with per-node source provenance (docs/01 §1).
// Wraps the `yaml` package (pinned 2.9.0, C-E01-001): parseDocument with a LineCounter
// for 1-indexed offset→{line,col} mapping (C-E01-003) and keepSourceTokens so the CST
// stays reachable on the underlying document (C-E01-005). Template expressions
// `${{ … }}` are never interpreted here — they stay plain scalar strings/keys.
//
// Server-quirk conformance (anchors/aliases, duplicate keys, multi-doc) is E01-S01-T02:
// this module only passes through the yaml package's own defaults (duplicate-key and
// multiple-document errors) and adds two *structural* errors (ALIAS_UNSUPPORTED,
// NON_SCALAR_KEY) for constructs the string-keyed DOM cannot represent.
import type { Document } from 'yaml';
import { isAlias, isMap, isNode, isScalar, isSeq, LineCounter, parseDocument } from 'yaml';
import type { Node as YamlNode, Pair, Range as YamlRange, Scalar } from 'yaml';

/** 1-indexed source range; `endLine`/`endCol` point at the first position past the node. */
export interface SourceRange {
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

/** Where a DOM node came from. `offset` is `[start, end)` in the source string. */
export interface Provenance {
  file: string;
  range: SourceRange;
  offset: [number, number];
}

/** YAML 1.2 core-schema scalar values (docs/01 §1: YAML 1.2). */
export type ScalarValue = string | number | boolean | null;

export type ScalarStyle = 'plain' | 'single' | 'double' | 'literal' | 'folded';

export interface ScalarNode {
  kind: 'scalar';
  value: ScalarValue;
  style: ScalarStyle;
  pos: Provenance;
}

export interface MappingEntry {
  key: ScalarNode;
  value: PipelineNode;
}

export interface MappingNode {
  kind: 'mapping';
  entries: MappingEntry[];
  pos: Provenance;
}

export interface SequenceNode {
  kind: 'sequence';
  items: PipelineNode[];
  pos: Provenance;
}

export type PipelineNode = ScalarNode | MappingNode | SequenceNode;

export interface ParseError {
  /** yaml package error codes pass through (e.g. DUPLICATE_KEY); ours are listed below. */
  code: string;
  message: string;
  pos: Provenance;
}

/** Structural errors emitted by this module (server conformance wording lands in T02). */
export const ALIAS_UNSUPPORTED = 'ALIAS_UNSUPPORTED';
export const NON_SCALAR_KEY = 'NON_SCALAR_KEY';

export interface ParseResult {
  file: string;
  source: string;
  /** Undefined for an empty document or when nothing could be composed. */
  root: PipelineNode | undefined;
  errors: ParseError[];
  /** The underlying yaml Document (CST tokens attached) for quirk checks (T02). */
  doc: Document.Parsed;
}

/** The exact source text a node was parsed from. */
export function snippetOf(source: string, node: { pos: Provenance }): string {
  const [start, end] = node.pos.offset;
  return source.slice(start, end);
}

// C-E01-006 — Scalar.type values; undefined means the node was not parsed from source.
const STYLE_BY_TYPE: Record<string, ScalarStyle> = {
  PLAIN: 'plain',
  QUOTE_SINGLE: 'single',
  QUOTE_DOUBLE: 'double',
  BLOCK_LITERAL: 'literal',
  BLOCK_FOLDED: 'folded',
};

export function parsePipelineYaml(source: string, file: string): ParseResult {
  const lineCounter = new LineCounter();
  // prettyErrors off: T03's reporter renders its own code frames; we only need offsets.
  const doc = parseDocument(source, {
    lineCounter,
    keepSourceTokens: true,
    prettyErrors: false,
  });

  const errors: ParseError[] = [];
  const ctx = { file, lineCounter, errors };

  for (const err of doc.errors) {
    errors.push({
      code: err.code,
      message: err.message,
      pos: provenanceOf(ctx, [err.pos[0], err.pos[1], err.pos[1]]),
    });
  }

  const root = doc.contents === null ? undefined : convertNode(ctx, doc.contents);
  return { file, source, root, errors, doc };
}

interface Ctx {
  file: string;
  lineCounter: LineCounter;
  errors: ParseError[];
}

// C-E01-004 — range is [start, value-end, node-end], ends exclusive; we use value-end so
// snippets exclude trailing comments/whitespace that belong to the node only syntactically.
function provenanceOf(ctx: Ctx, range: YamlRange | [number, number, number]): Provenance {
  const [start, valueEnd] = range;
  const s = ctx.lineCounter.linePos(start);
  const e = ctx.lineCounter.linePos(valueEnd);
  return {
    file: ctx.file,
    range: { line: s.line, col: s.col, endLine: e.line, endCol: e.col },
    offset: [start, valueEnd],
  };
}

/** Zero-width provenance for synthesized nodes (e.g. the null value of a bare `key:`). */
function syntheticProvenance(ctx: Ctx, offset: number): Provenance {
  const p = ctx.lineCounter.linePos(offset);
  return {
    file: ctx.file,
    range: { line: p.line, col: p.col, endLine: p.line, endCol: p.col },
    offset: [offset, offset],
  };
}

function convertNode(ctx: Ctx, node: YamlNode): PipelineNode | undefined {
  if (isScalar(node)) return convertScalar(ctx, node);
  if (isMap(node)) {
    const pos = nodeProvenance(ctx, node);
    const entries: MappingEntry[] = [];
    for (const pair of node.items) {
      const entry = convertPair(ctx, pair, pos);
      if (entry) entries.push(entry);
    }
    return { kind: 'mapping', entries, pos };
  }
  if (isSeq(node)) {
    const pos = nodeProvenance(ctx, node);
    const items: PipelineNode[] = [];
    for (const item of node.items) {
      if (!isNode(item)) continue; // yaml only puts nodes in parsed seq items
      const converted = convertNode(ctx, item);
      if (converted) items.push(converted);
    }
    return { kind: 'sequence', items, pos };
  }
  if (isAlias(node)) {
    ctx.errors.push({
      code: ALIAS_UNSUPPORTED,
      message:
        'YAML aliases are not representable in the pipeline DOM (anchors/aliases conformance: E01-S01-T02)',
      pos: nodeProvenance(ctx, node),
    });
    return undefined;
  }
  return undefined;
}

function convertScalar(ctx: Ctx, node: Scalar): ScalarNode | undefined {
  const pos = nodeProvenance(ctx, node);
  const value: unknown = node.value;
  if (
    value !== null &&
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    // Unreachable under the default core schema; guards against schema drift.
    ctx.errors.push({
      code: 'UNSUPPORTED_SCALAR',
      message: `scalar resolved to unsupported type ${typeof value}`,
      pos,
    });
    return undefined;
  }
  const style = (node.type !== undefined && STYLE_BY_TYPE[node.type]) || 'plain';
  return { kind: 'scalar', value: value as ScalarValue, style, pos };
}

function convertPair(ctx: Ctx, pair: Pair, mapPos: Provenance): MappingEntry | undefined {
  const rawKey: unknown = pair.key;
  if (!isNode(rawKey) || !isScalar(rawKey)) {
    const pos = isNode(rawKey) ? nodeProvenance(ctx, rawKey) : mapPos;
    ctx.errors.push({
      code: NON_SCALAR_KEY,
      message: 'mapping keys must be scalars (the pipeline document model is string-keyed)',
      pos,
    });
    return undefined;
  }
  const key = convertScalar(ctx, rawKey);
  if (!key) return undefined;

  const rawValue: unknown = pair.value;
  let value: PipelineNode | undefined;
  if (isNode(rawValue)) {
    value = convertNode(ctx, rawValue);
  } else {
    // Bare `key:` — no value node exists; synthesize null at the key's end.
    value = {
      kind: 'scalar',
      value: null,
      style: 'plain',
      pos: syntheticProvenance(ctx, key.pos.offset[1]),
    };
  }
  if (!value) return undefined;
  return { key, value };
}

function nodeProvenance(ctx: Ctx, node: YamlNode): Provenance {
  if (node.range) return provenanceOf(ctx, node.range);
  return syntheticProvenance(ctx, 0); // only for nodes not parsed from source
}
