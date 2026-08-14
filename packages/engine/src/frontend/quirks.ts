// E01-S01-T02 — server-quirk conformance (docs/01 §1).
//
// Azure Pipelines does not implement all of YAML 1.2 (C-E01-021), so a spec-conformant parse is
// *not* the behaviour we want: we must fail where the service fails and accept what it accepts.
// This module is the single place where those divergences live, so re-verifying them later is a
// matter of re-running `pnpm oracle-quirks` and `pnpm duplicate-key-survey`
// (transcripts: research/experiments/E01-quirks/ and E01-directive-duplicates/;
// claims C-E01-021..028 and C-E01-038..039).
//
// Rejections mirror the service's *decision* and its message text; positions do not always
// mirror it — the service reports anchors and multi-document files against the file with no
// line/col, while we always carry a range, because docs/01 §1 requires file:line:col on every
// diagnostic (C-E01-026).
import { isMap, isScalar, visit } from 'yaml';
import type { Document, Node as YamlNode } from 'yaml';
import { parseDirectiveKey } from '../template/walk.js';
import type { ParseError, Provenance } from './parse.js';

/** An anchor (`&name`) appears anywhere in the document — C-E01-022. */
export const ANCHOR_UNSUPPORTED = 'ANCHOR_UNSUPPORTED';
/** The same key appears twice in one mapping — C-E01-023. */
export const DUPLICATE_KEY = 'DUPLICATE_KEY';
/** The file holds more than one YAML document — C-E01-024. */
export const MULTIPLE_DOCUMENTS = 'MULTIPLE_DOCUMENTS';

/** yaml-package error code for >1 document; superseded by {@link MULTIPLE_DOCUMENTS}. */
export const YAML_MULTIPLE_DOCS = 'MULTIPLE_DOCS';

export interface ServerQuirk {
  /** YAML feature under test. */
  readonly feature: string;
  /** What the live service does with it. */
  readonly accepted: boolean;
  /** Our error code when the service rejects it. */
  readonly code?: string;
  /** Claim backing the decision. */
  readonly claim: string;
  /** Transcript or experiment index proving it, relative to research/experiments/. */
  readonly transcript: string;
}

/**
 * The conformance table. Accepted quirks are listed too — they are conformance decisions as
 * much as the rejections are, and `leading document marker` in particular is the one that
 * docs/01 §1 originally got wrong (C-E01-025).
 */
export const SERVER_QUIRKS: readonly ServerQuirk[] = [
  {
    feature: 'anchor definition (&name), aliases (*name) and merge keys (<<: *name)',
    accepted: false,
    code: ANCHOR_UNSUPPORTED,
    claim: 'C-E01-022',
    transcript: 'E01-quirks/anchor-only.md',
  },
  {
    feature: 'duplicate ordinary key in one mapping, case-insensitive (any nesting level)',
    accepted: false,
    code: DUPLICATE_KEY,
    claim: 'C-E01-023',
    transcript: 'E01-quirks/dup-key-mapping.md',
  },
  {
    feature: 'byte-identical recognized template directive keys in one mapping',
    accepted: true,
    claim: 'C-E01-038',
    transcript: 'E01-directive-duplicates/README.md',
  },
  {
    feature: 'more than one YAML document in a file',
    accepted: false,
    code: MULTIPLE_DOCUMENTS,
    claim: 'C-E01-024',
    transcript: 'E01-quirks/multi-doc.md',
  },
  {
    feature: 'single document opened by --- or closed by ...',
    accepted: true,
    claim: 'C-E01-025',
    transcript: 'E01-quirks/leading-doc-start.md',
  },
];

export interface QuirkContext {
  /** The parsed document, CST tokens attached. */
  readonly doc: Document.Parsed;
  /** Source provenance for a node range — supplied by parse.ts, which owns the LineCounter. */
  posOf(range: readonly [number, number, number]): Provenance;
}

/**
 * All server-quirk violations in one document, in source order.
 *
 * Anchors are reported per occurrence rather than only for the first one: the service stops at
 * the first (C-E01-022), but every anchor has to be removed anyway, so listing them all is a
 * strict improvement that cannot change the accept/reject outcome.
 */
export function serverQuirkErrors(ctx: QuirkContext): ParseError[] {
  const errors: ParseError[] = [];
  collectAnchors(ctx, errors);
  collectDuplicateKeys(ctx, errors);
  collectMultipleDocuments(ctx, errors);
  return errors.sort((a, b) => a.pos.offset[0] - b.pos.offset[0]);
}

// C-E01-022 — the service rejects the *definition*: `&shared` that is never aliased fails
// exactly like `&shared` + `*shared`, and `<<: *shared` fails with the same anchor message
// (there is no distinct merge-key path). Message text mirrors the service, minus its trailing
// "Object reference not set to an instance of an object." null-reference artifact.
//
// Detection is on the AST (`node.anchor` names every anchor, including one on the document
// root); the position comes from the CST, because a node's own range starts *after* its anchor
// — `a: &shared first` would otherwise put the caret on `first` (C-E01-027).
function collectAnchors(ctx: QuirkContext, errors: ParseError[]): void {
  const tokens = anchorTokens(ctx.doc.contents?.srcToken);
  const claimed = new Set<number>();

  visit(ctx.doc, (_key, node) => {
    if (node === null || typeof node !== 'object') return;
    const anchor = (node as { anchor?: unknown }).anchor;
    if (typeof anchor !== 'string') return;

    const index = tokens.findIndex((t, i) => !claimed.has(i) && t.name === anchor);
    let pos: Provenance;
    if (index === -1) {
      pos = rangeOf(ctx, node as YamlNode); // e.g. an anchor on the document root
    } else {
      claimed.add(index);
      const { offset, length } = tokens[index] as AnchorToken;
      pos = ctx.posOf([offset, offset + length, offset + length]);
    }

    errors.push({
      code: ANCHOR_UNSUPPORTED,
      message: `Anchors are not currently supported. Remove the anchor '${anchor}'`,
      pos,
    });
  });
}

interface AnchorToken {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
}

/**
 * Every `&name` token in the CST, in source order. Anchors live in the documented `start`/`sep`
 * SourceToken arrays of collection items ("Content before, within, and after 'actual' values.
 * Includes item and collection indicators, anchors, tags…"), so the walk follows exactly the
 * documented token fields (C-E01-027; CST retained by `keepSourceTokens`, C-E01-005).
 */
function anchorTokens(token: unknown): AnchorToken[] {
  const found: AnchorToken[] = [];

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const t = node as { type?: string; offset?: number; source?: string } & Record<string, unknown>;
    if (t.type === 'anchor' && typeof t.offset === 'number' && typeof t.source === 'string') {
      found.push({ name: t.source.slice(1), offset: t.offset, length: t.source.length });
    }
    for (const field of ['start', 'key', 'sep', 'value', 'items', 'end'] as const) {
      if (t[field] !== undefined) walk(t[field]);
    }
  };

  walk(token);
  return found.sort((a, b) => a.offset - b.offset);
}

// C-E01-023/039 — ordinary duplicate keys are rejected at every nesting level, and the service
// points at the *second* occurrence. parse.ts turns the yaml package's own uniqueKeys check off so
// that both pairs survive to be seen here.
//
// The comparison is **case-insensitive** (C-E01-028): the service rejects `displayName` +
// `displayname`, and also `a` + `A` under `variables:` — user-chosen names, not schema keywords —
// so the folding belongs to the mapping layer and applies here, where nothing is known about the
// schema. The message quotes the second key with its own spelling, as the service does.
//
// Recognized template directive keys are the one measured exception (C-E01-038): two identical
// `if` keys and two identical `each` keys are accepted and both bodies expand. This must use the
// same classifier as the walker; spelling another directive parser here would let parse-time and
// expansion-time recognition drift apart. An ordinary expression key is *not* exempt — two
// `${{ pair.key }}` keys are rejected by the service after resolving to the same key (C-E01-039).
function collectDuplicateKeys(ctx: QuirkContext, errors: ParseError[]): void {
  visit(ctx.doc, (_key, node) => {
    if (!isMap(node)) return;
    const seen = new Set<string>();
    for (const pair of node.items) {
      const key: unknown = pair.key;
      if (!isScalar(key)) continue; // non-scalar keys are parse.ts's NON_SCALAR_KEY
      const name = String(key.value);
      if (parseDirectiveKey(name).kind === 'directive') continue;
      const folded = name.toLowerCase();
      if (seen.has(folded)) {
        errors.push({
          code: DUPLICATE_KEY,
          message: `'${name}' is already defined`,
          pos: rangeOf(ctx, key),
        });
      }
      seen.add(folded);
    }
  });
}

// C-E01-024/025 — a second document is an error; a lone `---` or trailing `...` around a single
// document is not (the yaml package agrees on both, so the only work here is to replace its
// error with our wording and code).
function collectMultipleDocuments(ctx: QuirkContext, errors: ParseError[]): void {
  for (const err of ctx.doc.errors) {
    if (err.code !== YAML_MULTIPLE_DOCS) continue;
    errors.push({
      code: MULTIPLE_DOCUMENTS,
      message:
        'a pipeline file must contain exactly one YAML document; remove the second document ' +
        "(the service reports 'Expected stream end parse event')",
      pos: ctx.posOf([err.pos[0], err.pos[1], err.pos[1]]),
    });
  }
}

function rangeOf(ctx: QuirkContext, node: YamlNode): Provenance {
  const range = node.range;
  return ctx.posOf(range ?? [0, 0, 0]);
}
