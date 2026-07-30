# E01 — YAML front end: grounding notes

## E01-S01-T01 — CST-backed parse with provenance (2026-07-30)

[C-E01-001] The `yaml` npm package is pinned at **2.9.0** (registry `latest` on 2026-07-30);
repo tag `v2.9.0` is annotated and dereferences to commit
`ddb21b04cb889722cec8f89dc1b67f19d62d7f7d` — all doc quotes below are from `docs/` at that
commit (rendered at eemeli.org/yaml).
  — https://registry.npmjs.org/yaml/latest (checked 2026-07-30)
  — https://github.com/eemeli/yaml/tree/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs

[C-E01-002] `parseDocument(str, options)` parses exactly one document and reports a
multi-document input as an error; parse problems land in `doc.errors` as `YAMLParseError`
objects carrying `{ code, message, pos: [number, number], linePos }`, where `linePos` is the
one-indexed `{line, col}` pair (populated when `prettyErrors` is on, its default).
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/04_documents.md#L56 (checked 2026-07-30)
  — "Will include an error if `str` contains more than one document."
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/08_errors.md
  — "pos · `[number, number]` · The position in the source at which this error or warning was
    encountered." · "If that array is not empty when constructing a native representation of a
    document, the first error will be thrown."

[C-E01-003] Passing a `LineCounter` instance as the `lineCounter` option enables
offset→position mapping: `lineCounter.linePos(offset)` returns the **1-indexed** `{line, col}`
for any offset within the input.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/03_options.md#L29 (checked 2026-07-30)
  — "If set, newlines will be tracked, to allow for `lineCounter.linePos(offset)` to provide
    the `{ line, col }` positions within the input."

[C-E01-004] Every parsed content node exposes `range: [start, value-end, node-end]` character
offsets ("The `value-end` and `node-end` positions are themselves not included in their
respective ranges" — i.e. ends are exclusive); a `Pair` has **no range of its own** — it is
`{ key, value }` whose members are nodes carrying ranges.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/05_content_nodes.md#L15-L19 (checked 2026-07-30)
  — "range?: [number, number, number] // The `[start, value-end, node-end]` character offsets
    for the part of the source parsed into this node (undefined if not parsed)."

[C-E01-005] The `keepSourceTokens: true` option retains the CST on the AST: each parsed node
gets a `srcToken` value holding the CST token it was composed from (this is the "CST retained"
requirement of docs/01 §1).
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/03_options.md#L28 (checked 2026-07-30)
  — "Include a `srcToken` value on each parsed `Node`, containing the CST token that was
    composed into this node."

[C-E01-006] `Scalar.type` distinguishes the five source styles
`'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE'`, and the
package exports the type guards `isMap / isSeq / isScalar / isPair / isAlias / isNode` for
traversal.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/05_content_nodes.md (checked 2026-07-30)
  — "type?: 'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE' |
    undefined" · "import { isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar,
    isSeq } from 'yaml'"

Structural notes (not server-behavior claims): parse.ts emits its own `ALIAS_UNSUPPORTED` /
`NON_SCALAR_KEY` errors because the DOM cannot represent aliases or non-string keys (the
vendored draft-07 JSON schema world is string-keyed, C-E00-006). Whether the *service* accepts
anchors/aliases, duplicate keys, or multi-doc files is **E01-S01-T02's oracle experiment** —
that task owns the behavior toggles; T01 only passes through the yaml package's own defaults
(`uniqueKeys`, single-doc) plus the two structural errors above.
