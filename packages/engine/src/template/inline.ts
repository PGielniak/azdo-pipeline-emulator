// E03-S06-T02 — inline local `@self` template files into the root override.
//
// The bundler exists because the preview endpoint reads `template:` targets from the **repository**,
// not from the request body (C-E12-011), so a user's uncommitted edit to a template file is
// invisible to the expansion unless its bytes travel inside the one document the request can carry.
//
// **What the oracle measured, and what it changed about this task.** Twelve live probes
// (`research/experiments/E03-bundle/`, C-E03-408..413) established that a mechanical splice is
// *not* universally equivalent to the committed multi-file form, and that the boundary is not where
// docs/02 §5.1 implies:
//
//   - parameterless include              → normalized-identical      (C-E03-408)
//   - nested parameterless includes      → normalized-identical      (C-E03-409)
//   - declares `parameters:`, never reads → normalized-identical     (C-E03-410)
//   - reads `${{ parameters.* }}`, parent lacks the name → HTTP 400 `Key not found` (C-E03-411)
//   - reads `${{ parameters.* }}`, parent *has* the name → 200, **wrong value** (C-E03-412)
//
// The last one is why the guard lives here rather than being left to the service: splicing a
// template that reads its own parameters is *silently* wrong whenever the parent happens to declare
// the same name. So the rule this module implements is C-E03-413 — **inline iff the file reads no
// `${{ parameters.* }}`** — and anything else keeps its reference and is reported, never guessed at.
//
// The splice is textual, over the byte offsets E01's parser records, rather than a re-serialization
// of the DOM. "Mechanical inliner, not an expander" is only true if the user's bytes survive
// unchanged everywhere except at the reference itself; round-tripping through a YAML emitter would
// restyle the whole document and make every later diff unreadable.
import type { Diagnostic } from '../frontend/diagnostics.js';
import type { MappingNode, PipelineNode, SourceRange } from '../frontend/parse.js';
import { parsePipelineYaml } from '../frontend/parse.js';
import type { ReferenceSite, TemplateReference } from './bundle.js';
import { findTemplateReferences } from './bundle.js';
import { directoryOf, joinReference, normalizeRepositoryPath } from './reference.js';

export const INLINE_MISSING_FILE = 'bundle-template-not-found';
export const INLINE_CYCLE = 'bundle-template-cycle';
export const INLINE_USES_PARAMETERS = 'bundle-template-uses-parameters';
export const INLINE_UNSUPPORTED_SITE = 'bundle-template-site-unsupported';

/** Reads a file out of the user's local working tree, by repository-absolute path. */
export type LocalTreeReader = (repositoryPath: string) => string | undefined;

export interface InlineOptions {
  readonly read: LocalTreeReader;
  /**
   * The repository path the override document stands at. `/azure-pipelines.yml` by default,
   * because that is where a `yamlOverride` resolves as though it lived (C-E12-011).
   */
  readonly rootPath?: string;
}

/** Why a reference was left in the override instead of being inlined. */
export type SkipReason =
  /** Not `@self` — resolves against another repository. E03-S06-T04 owns the user-facing wording. */
  | 'cross-repo'
  /** The file reads `${{ parameters.* }}`; splicing it is unsound (C-E03-411/412). */
  | 'uses-parameters'
  /** `extends:` and references inside a `parameters:` value — see `INLINE_UNSUPPORTED_SITE`. */
  | 'unsupported-site'
  /** The file is not in the local working tree. */
  | 'not-found'
  /** The reference closes a cycle. */
  | 'cycle';

export interface SkippedReference {
  readonly reason: SkipReason;
  readonly site: ReferenceSite;
  readonly text: string;
  readonly file: string;
  readonly range: SourceRange;
}

export interface InlinedFile {
  /** Repository-absolute path of the file whose bytes were spliced in. */
  readonly path: string;
  /** The file that referenced it. */
  readonly from: string;
}

export interface BundleResult {
  /** The override to send to `preview`. Byte-identical to the input outside the splices. */
  readonly yaml: string;
  readonly inlined: readonly InlinedFile[];
  readonly skipped: readonly SkippedReference[];
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Inline every inlinable local template reference in `source`, recursing into the files it pulls in.
 *
 * `source` is the root document's text — the user's working-tree bytes, not the committed ones.
 */
export function inlineTemplates(source: string, options: InlineOptions): BundleResult {
  const rootPath = options.rootPath ?? '/azure-pipelines.yml';
  const state: State = { read: options.read, inlined: [], skipped: [], diagnostics: [] };
  const yaml = inlineDocument(source, rootPath, [rootPath], state);
  return { yaml, inlined: state.inlined, skipped: state.skipped, diagnostics: state.diagnostics };
}

interface State {
  readonly read: LocalTreeReader;
  readonly inlined: InlinedFile[];
  readonly skipped: SkippedReference[];
  readonly diagnostics: Diagnostic[];
}

/**
 * `${{ parameters.… }}` anywhere in the text — the measured guard (C-E03-410/413).
 *
 * Deliberately a text scan and not an expression parse. The question is "could this file read a
 * parameter", and the conservative answer to a spelling we fail to parse must be *yes*; a parser
 * that returned "no references" on malformed input would turn a parse bug into a silent
 * mis-inline. The `[` form is included because `parameters['name']` is the documented index
 * spelling of the same context.
 */
const READS_PARAMETERS = /\$\{\{[^}]*\bparameters\s*[.[]/i;

function usesParameters(text: string): boolean {
  return READS_PARAMETERS.test(text);
}

function inlineDocument(
  source: string,
  file: string,
  stack: readonly string[],
  state: State,
): string {
  const parsed = parsePipelineYaml(source, file);
  const references = findTemplateReferences(parsed);
  if (references.length === 0) return source;

  // Splices are applied back-to-front so an earlier edit never shifts a later offset.
  const edits: { start: number; end: number; text: string }[] = [];

  for (const reference of references) {
    const skip = (reason: SkipReason): void => {
      state.skipped.push({
        reason,
        site: reference.site,
        text: reference.text,
        file,
        range: reference.range,
      });
    };

    if (!reference.self) {
      // E03-S06-T04 turns this into the user-facing diagnostic; recording it is this task's part.
      skip('cross-repo');
      continue;
    }

    // `extends:` replaces the whole document shape rather than a list slice, and a reference inside
    // a `parameters:` value is only reached once the receiving template inserts the list — neither
    // is a sequence-item splice. Reported rather than attempted, because an `extends` target is
    // parameterized by construction and would hit C-E03-412 anyway.
    if (reference.site === 'extends' || reference.site === 'parameters') {
      skip('unsupported-site');
      state.diagnostics.push({
        severity: 'warning',
        code: INLINE_UNSUPPORTED_SITE,
        message: `\`${reference.text}\` is referenced from \`${reference.site}\`, which the bundler does not inline; the service will read the committed file.`,
        file,
        range: reference.range,
        hint: 'Local edits to this template are not visible to the expansion. Commit them, or see E03-S06-T05.',
      });
      continue;
    }

    const target = resolveLocal(reference.path, file);
    if (target === undefined) {
      skip('not-found');
      state.diagnostics.push({
        severity: 'error',
        code: INLINE_MISSING_FILE,
        message: `Template path \`${reference.text}\` escapes the repository root.`,
        file,
        range: reference.range,
      });
      continue;
    }

    if (stack.includes(target)) {
      skip('cycle');
      state.diagnostics.push({
        severity: 'error',
        code: INLINE_CYCLE,
        message: `Template cycle: \`${target}\` is already being inlined (${[...stack, target].join(' → ')}).`,
        file,
        range: reference.range,
      });
      continue;
    }

    const content = state.read(target);
    if (content === undefined) {
      skip('not-found');
      state.diagnostics.push({
        severity: 'error',
        code: INLINE_MISSING_FILE,
        message: `Template file \`${target}\` not found in the local working tree.`,
        file,
        range: reference.range,
        hint: 'Paths are repository-absolute; a bare path is relative to the file that references it.',
      });
      continue;
    }

    if (usesParameters(content)) {
      // C-E03-411/412: the splice would drop the template's own `parameters:` scope. Loud when the
      // parent lacks the name, *silent and wrong* when it has it — so we refuse rather than let the
      // service decide.
      skip('uses-parameters');
      state.diagnostics.push({
        severity: 'warning',
        code: INLINE_USES_PARAMETERS,
        message: `\`${target}\` reads \`\${{ parameters.* }}\`, so it cannot be inlined without binding; the service will read the committed file.`,
        file,
        range: reference.range,
        hint: 'Local edits to this template are not visible to the expansion (C-E03-412). Commit them, or see E03-S06-T05.',
      });
      continue;
    }

    // Recurse first, so the text spliced in is already fully bundled.
    const bundled = inlineDocument(content, target, [...stack, target], state);
    const items = containerItemsText(bundled, target, reference.site);
    if (items === undefined) {
      skip('not-found');
      state.diagnostics.push({
        severity: 'error',
        code: INLINE_MISSING_FILE,
        message: `\`${target}\` has no \`${reference.site}:\` sequence to inline into this reference.`,
        file,
        range: reference.range,
      });
      continue;
    }

    const span = itemSpan(source, reference);
    if (span === undefined) {
      skip('not-found');
      continue;
    }
    edits.push({ start: span.start, end: span.end, text: reindent(items, span.indent) });
    state.inlined.push({ path: target, from: file });
  }

  let out = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return out;
}

/** Repository-absolute, normalized target of a reference written in `from` (C-E03-195, C-E12-012). */
function resolveLocal(referencePath: string, from: string): string | undefined {
  const joined = referencePath.startsWith('/')
    ? referencePath
    : joinReference(directoryOf(from), referencePath);
  return normalizeRepositoryPath(joined);
}

/**
 * The text of `<container>:`'s sequence items in `source`, with its own base indentation intact.
 *
 * Whole lines, because the splice is line-based: a sequence item's own node offset starts after the
 * `- `, which is exactly the part that has to be reproduced at the destination's indentation.
 */
function containerItemsText(
  source: string,
  file: string,
  container: ReferenceSite,
): string | undefined {
  const parsed = parsePipelineYaml(source, file);
  const root = parsed.root;
  if (root === undefined || root.kind !== 'mapping') return undefined;
  const entry = root.entries.find((candidate) => candidate.key.value === container);
  if (entry === undefined || entry.value.kind !== 'sequence' || entry.value.items.length === 0) {
    return undefined;
  }
  const [start, end] = lineSpan(source, entry.value.pos.offset);
  return source.slice(start, end);
}

/**
 * The whole-line span of the sequence item a reference belongs to, plus the indentation its `-`
 * sits at.
 *
 * Found from the reference scalar's offset by walking back to the `-` that opens its item, rather
 * than from a DOM node, because the DOM does not record the dash — and the dash column is what the
 * inlined text has to line up with.
 */
function itemSpan(
  source: string,
  reference: TemplateReference,
): { start: number; end: number; indent: string } | undefined {
  const dash = source.lastIndexOf('-', keyOffset(source, reference));
  if (dash < 0) return undefined;
  const lineStart = source.lastIndexOf('\n', dash) + 1;
  const indent = source.slice(lineStart, dash);
  if (indent.trim() !== '') return undefined;

  // The item runs to the start of the next line at or below its own indentation.
  const lines = source.slice(lineStart).split('\n');
  let consumed = lines[0]?.length ?? 0;
  for (const line of lines.slice(1)) {
    if (line.trim() !== '' && leadingSpaces(line) <= indent.length) break;
    consumed += 1 + line.length;
  }
  // Take the item's own line terminator with it: the replacement block already ends in one
  // (`lineSpan` extends to whole lines), and leaving both behind inserts a blank line.
  const end = lineStart + consumed;
  return { start: lineStart, end: source[end] === '\n' ? end + 1 : end, indent };
}

/** Offset of the `template` key that produced `reference`, located from its value's line/col. */
function keyOffset(source: string, reference: TemplateReference): number {
  let offset = 0;
  for (let line = 1; line < reference.range.line; line += 1) {
    const next = source.indexOf('\n', offset);
    if (next < 0) return offset;
    offset = next + 1;
  }
  return offset + Math.max(0, reference.range.col - 1);
}

/** Extend `[start, end)` to whole lines. */
function lineSpan(source: string, [start, end]: readonly [number, number]): [number, number] {
  const lineStart = source.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = source.indexOf('\n', end);
  lineEnd = lineEnd < 0 ? source.length : lineEnd + 1;
  return [lineStart, lineEnd];
}

function leadingSpaces(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * Re-indent a block of sequence items from its own base indentation to `indent`.
 *
 * The block always ends with a newline (`lineSpan` extends to whole lines), which is what makes the
 * result droppable straight into the hole `itemSpan` cut.
 */
function reindent(block: string, indent: string): string {
  const lines = block.split('\n');
  const base = lines.find((line) => line.trim() !== '');
  const from = base === undefined ? 0 : leadingSpaces(base);
  return lines.map((line) => (line.trim() === '' ? line : indent + line.slice(from))).join('\n');
}

/** Convenience for callers that only want the override text. */
export function bundleOverride(source: string, options: InlineOptions): string {
  return inlineTemplates(source, options).yaml;
}

/** A `LocalTreeReader` over an in-memory tree, keyed by repository-absolute path. */
export function treeReader(files: Readonly<Record<string, string>>): LocalTreeReader {
  return (repositoryPath) => files[repositoryPath];
}

/** Re-exported so callers can name the node type without reaching into the frontend. */
export type { MappingNode, PipelineNode };
