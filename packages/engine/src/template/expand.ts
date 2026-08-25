/**
 * E03-S04-T02 — the expanded-YAML emitter and its provenance map.
 *
 * This is the **offline fallback's entry point**. On the default path nothing here runs: the
 * service expands (PLAN D3), and `packages/fetch`'s `--offline-expand` port is the only consumer.
 * Until this module existed that port refused with a message naming this task; the engine's
 * directive visitors were driven end to end only by the test harness.
 *
 * Three things, in the order a caller needs them:
 *
 *  1. **`serializeExpandedYaml`** — the expanded DOM back to text, in the service's own formatting.
 *     Not a guess: parsing each of the ten corpus `final.yml`s and re-serializing them reproduces
 *     the file **byte for byte** (C-E03-250), which is the strongest available statement that the
 *     choices below are the service's and not ours. That fixpoint is only reachable from the DOM —
 *     flattening to plain JavaScript values first loses the authored quoting, and one corpus entry
 *     (`'0 3 * * Mon-Fri'`) proves it (C-E03-252).
 *
 *  2. **`buildExpansionMap`** — every emitted node's path to where it came from. Coverage is 100%
 *     *by construction* rather than by effort: every node in the expanded DOM carries a `pos`,
 *     including the ones the directives synthesize, because `insert`/`each`/interpolation stamp
 *     their replacements with the provenance of the site that produced them (C-E03-253).
 *
 *  3. **`expandDocument`** — parse → bind root parameters → walk → serialize + map.
 *
 * **What this does not do, and must not silently appear to do.** The offline walk performs the
 * directive passes and interpolation. It does **not** perform the two expansions the service also
 * applies while producing `finalYaml`: wrapping a `steps:`/`jobs:`-only document in
 * `stages: __default` (C-E00-022) and desugaring step shortcuts into tasks (C-E12-019). Those are
 * separate measured behaviours, deliberately kept out of the normalizer for the same reason
 * (`normalize.ts`'s header: doing them there "would let a broken expander pass the diff"). So an
 * offline expansion of an authored corpus pipeline is *not* normalizer-equal to its `final.yml`,
 * and the gap is filed as E03-S04-T04 rather than papered over here.
 */
import { createHash } from 'node:crypto';

import { Document, Pair, Scalar, YAMLMap, YAMLSeq, isDocument } from 'yaml';

import type { Diagnostic } from '../frontend/diagnostics.js';
import {
  parsePipelineYaml,
  type MappingNode,
  type PipelineNode,
  type ScalarStyle,
  type SequenceNode,
} from '../frontend/parse.js';
import type { ExprValue } from '../expr/value.js';
import { conditionalVisitor } from './conditionals.js';
import { eachVisitor, evaluateTemplateExpression } from './each.js';
import { insertVisitor } from './insert.js';
import { interpolationVisitor } from './interpolate.js';
import { bindParameters, type ParameterPosition } from './parameters.js';
import { composeVisitors, rootFrame, type TemplateFrame } from './walk.js';
import { walkTemplate } from './walk.js';
import type { ExprContextValues } from '../expr/context.js';

/** Bumped only when a consumer would misread an older document. */
export const EXPANSION_MAP_VERSION = 1;

// ── serialization ─────────────────────────────────────────────────────────────────────────────

/**
 * The `yaml` stringify options that reproduce the service's `finalYaml` formatting (C-E03-250/251).
 *
 * Each one was measured against the corpus rather than chosen:
 *   - `indentSeq: false` — the service does **not** indent a sequence under its key
 *     (`stages:` then `- stage: build` at the same column). The default indents and diverges on
 *     line 8 of every corpus entry.
 *   - `lineWidth: 0` — no folding. The service never wraps a long scalar.
 *   - `singleQuote: true` — where a quote is needed the service uses `'…'`; the default `"…"`
 *     diverges on a glob such as the corpus's quoted `sln` pattern.
 */
export const SERIALIZE_OPTIONS = { indentSeq: false, lineWidth: 0, singleQuote: true } as const;

const SCALAR_TYPE: Readonly<Record<ScalarStyle, Scalar.Type | undefined>> = {
  plain: Scalar.PLAIN,
  single: Scalar.QUOTE_SINGLE,
  double: Scalar.QUOTE_DOUBLE,
  literal: Scalar.BLOCK_LITERAL,
  folded: Scalar.BLOCK_FOLDED,
};

/**
 * Our DOM to the `yaml` library's, preserving each scalar's **authored style**.
 *
 * The style is what makes the fixpoint exact. `'0 3 * * Mon-Fri'` is a legal *plain* scalar, so a
 * serializer working from plain values emits it unquoted while the service keeps the author's
 * quotes — the one place in the corpus where the two disagree, and the reason this walks the DOM
 * (C-E03-252).
 */
function toYamlNode(node: PipelineNode): unknown {
  switch (node.kind) {
    case 'scalar': {
      const scalar = new Scalar(node.value);
      const type = SCALAR_TYPE[node.style];
      // A retyped plain scalar (`true`, `42`) must stay plain; only an authored quote is restored.
      if (type !== undefined && node.style !== 'plain') scalar.type = type;
      return scalar;
    }
    case 'sequence': {
      const seq = new YAMLSeq<unknown>();
      for (const item of node.items) seq.items.push(toYamlNode(item));
      return seq;
    }
    case 'mapping': {
      const map = new YAMLMap<unknown, unknown>();
      for (const entry of node.entries)
        map.items.push(new Pair(toYamlNode(entry.key), toYamlNode(entry.value)) as never);
      return map;
    }
  }
}

/**
 * Serialize an expanded DOM in the service's formatting.
 *
 * The trailing newline is the service's too: every `finalYaml` in the corpus ends with a blank
 * line, which `yaml` does not add (C-E03-251).
 */
export function serializeExpandedYaml(node: PipelineNode | undefined): string {
  if (node === undefined) return '\n';
  const doc = new Document();
  doc.contents = toYamlNode(node) as never;
  return `${doc.toString(SERIALIZE_OPTIONS)}\n`;
}

// ── the provenance map ────────────────────────────────────────────────────────────────────────

/** One frame in a node's source stack, outermost last. */
export interface ProvenanceFrame {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  /** Template nesting depth of the frame that emitted the node; 0 is the root document. */
  readonly depth: number;
  /**
   * Repository the file was read from, `<url>@<40-hex>` when known. Absent for a single-document
   * expansion, which is every offline expansion today: cross-repository references are the
   * bundler's (E03-S06) and reach this module already inlined, so the composition to make is
   * `expansion-map.json` → `bundle.json`, not a second repository resolver here.
   */
  readonly repo?: string;
  /** Hash of the parameter values in scope for that frame; `undefined` when none are bound. */
  readonly parameters?: string;
}

export interface ExpansionMapEntry {
  /** Slash-separated path into the emitted document, e.g. `/stages/0/jobs/0/steps/1`. */
  readonly path: string;
  /** 1-based line the node starts on **in the emitted YAML**. */
  readonly line: number;
  readonly from: ProvenanceFrame;
}

export interface ExpansionMap {
  readonly version: number;
  readonly file: string;
  /** Every emitted node, in document order. */
  readonly entries: readonly ExpansionMapEntry[];
}

/** `sha256` of the bound parameter values, so two frames with the same bindings share a key. */
export function parametersHash(values: Readonly<Record<string, ExprValue>>): string | undefined {
  const names = Object.keys(values).sort();
  if (names.length === 0) return undefined;
  const canonical = names.map((name) => `${name}=${JSON.stringify(values[name])}`).join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16);
}

interface MapContext {
  readonly file: string;
  readonly depth: number;
  readonly parameters: string | undefined;
  readonly repo: string | undefined;
}

/**
 * Walk source and emitted trees together, recording one entry per node.
 *
 * `at` overrides the lines for a mapping entry's value: a human pointing at `pool:` means the whole
 * `pool` node, not the mapping that starts on the next line, so the entry is recorded at the
 * **key's** line on both sides. Without it the gutter is full of holes exactly where the structure
 * is.
 */
function collect(
  source: PipelineNode,
  emitted: PipelineNode,
  path: string,
  context: MapContext,
  entries: ExpansionMapEntry[],
  at?: { emitted: number; source: { line: number; col: number } },
): void {
  entries.push({
    path,
    line: at?.emitted ?? emitted.pos.range.line,
    from: {
      file: context.file,
      line: at?.source.line ?? source.pos.range.line,
      col: at?.source.col ?? source.pos.range.col,
      depth: context.depth,
      ...(context.repo === undefined ? {} : { repo: context.repo }),
      ...(context.parameters === undefined ? {} : { parameters: context.parameters }),
    },
  });
  if (source.kind === 'sequence' && emitted.kind === 'sequence') {
    const pairs = Math.min(source.items.length, emitted.items.length);
    for (let i = 0; i < pairs; i += 1)
      collect(source.items[i]!, emitted.items[i]!, `${path}/${i}`, context, entries);
    return;
  }
  if (source.kind === 'mapping' && emitted.kind === 'mapping') {
    const pairs = Math.min(source.entries.length, emitted.entries.length);
    for (let i = 0; i < pairs; i += 1) {
      const key = String(emitted.entries[i]!.key.value);
      collect(
        source.entries[i]!.value,
        emitted.entries[i]!.value,
        `${path}/${key}`,
        context,
        entries,
        {
          emitted: emitted.entries[i]!.key.pos.range.line,
          source: {
            line: source.entries[i]!.key.pos.range.line,
            col: source.entries[i]!.key.pos.range.col,
          },
        },
      );
    }
  }
}

/**
 * Build the map for an expanded DOM.
 *
 * The emitted text is re-parsed rather than line-counted during serialization: the parser is the
 * thing that already knows where a node starts, and a second implementation of that would be a
 * second thing to keep correct. The two trees are structurally identical by construction — the
 * emitted text *is* this DOM — so the parallel walk pairs them exactly.
 */
export function buildExpansionMap(
  node: PipelineNode | undefined,
  yaml: string,
  options: { file: string; depth?: number; parameters?: string; repo?: string },
): ExpansionMap {
  const entries: ExpansionMapEntry[] = [];
  const reparsed = parsePipelineYaml(yaml, options.file);
  if (node !== undefined && reparsed.root !== undefined) {
    collect(
      node,
      reparsed.root,
      '',
      {
        file: options.file,
        depth: options.depth ?? 0,
        parameters: options.parameters,
        repo: options.repo,
      },
      entries,
    );
  }
  return { version: EXPANSION_MAP_VERSION, file: options.file, entries };
}

/**
 * The provenance port `validateExpandedPipeline` takes (E03-S04-T03), bound to this map.
 *
 * The validator lives a layer below this module and must not import it, so what crosses is a
 * function rather than the map — the same shape the Redactor and the OfflineExpander ports take.
 */
export function originLookup(map: ExpansionMap): (line: number) => ProvenanceFrame | undefined {
  return (line) => provenanceAtLine(map, line)?.from;
}

/**
 * The deepest entry covering `line` — what the spot-check tool prints.
 *
 * "Deepest" because entries nest: a step's line is also inside its job's and its stage's, and the
 * useful answer is the innermost node, not the document root.
 */
export function provenanceAtLine(map: ExpansionMap, line: number): ExpansionMapEntry | undefined {
  let best: ExpansionMapEntry | undefined;
  for (const entry of map.entries) {
    if (entry.line !== line) continue;
    if (best === undefined || entry.path.length > best.path.length) best = entry;
  }
  return best;
}

// ── the entry point ───────────────────────────────────────────────────────────────────────────

export interface ExpandOptions {
  /** Queue-time parameter values — `--param` / config, the preview body's `templateParameters`. */
  readonly parameters?: Readonly<Record<string, string>> | undefined;
  /** Which type vocabulary the root `parameters:` block is read against; the root's, by default. */
  readonly position?: ParameterPosition | undefined;
  /** `<url>@<40-hex>` for the document's own repository, recorded in every frame when known. */
  readonly repo?: string | undefined;
}

export interface ExpansionResult {
  readonly yaml: string;
  readonly map: ExpansionMap;
  readonly diagnostics: readonly Diagnostic[];
  /** Directive keywords seen, in document order — what the fallback reports it actually did. */
  readonly directives: readonly string[];
}

/**
 * Expand one document offline: bind its root parameters, run the directive and interpolation
 * passes, and emit the result plus its provenance map.
 *
 * Diagnostics are **accumulated, never thrown** — the service reports every bad expression in one
 * response (C-E02-110) and a fallback that stopped at the first would report a strict subset of
 * what the user would see from the real thing.
 */
export function expandDocument(
  source: string,
  file: string,
  options: ExpandOptions = {},
): ExpansionResult {
  const parsed = parsePipelineYaml(source, file);
  const diagnostics: Diagnostic[] = parsed.errors.map((error) => ({
    severity: 'error',
    code: error.code,
    message: error.message,
    file,
    range: error.pos.range,
  }));

  const declarations =
    parsed.root?.kind === 'mapping'
      ? parsed.root.entries.find((entry) => String(entry.key.value) === 'parameters')?.value
      : undefined;
  const binding = bindParameters(
    declarations,
    { file, source },
    { queue: options.parameters },
    options.position ?? 'root',
  );
  diagnostics.push(...binding.diagnostics);

  const values: ExprContextValues = { parameters: binding.context };
  const evaluate = (expression: string, frame: TemplateFrame): ExprValue =>
    evaluateTemplateExpression(expression, frame, values);
  const visitor = composeVisitors(
    conditionalVisitor({ values }),
    insertVisitor(evaluate),
    eachVisitor(evaluate),
    interpolationVisitor(evaluate),
  );

  const walked = walkTemplate(parsed.root, rootFrame(file), visitor);
  diagnostics.push(...walked.diagnostics);

  const yaml = serializeExpandedYaml(walked.node);
  const map = buildExpansionMap(walked.node, yaml, {
    file,
    ...(options.repo === undefined ? {} : { repo: options.repo }),
    ...(() => {
      const hash = parametersHash(binding.values);
      return hash === undefined ? {} : { parameters: hash };
    })(),
  });

  return {
    yaml,
    map,
    diagnostics,
    directives: walked.directives.map((site) => site.directive.keyword),
  };
}

/** Guard used by the spot-check tool; exported so a consumer can assert what it was handed. */
export const isYamlDocument = isDocument;

/** Structural helpers the map's consumers need without re-deriving them. */
export type { MappingNode, SequenceNode };
