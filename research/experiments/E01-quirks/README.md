# E01 server-quirk conformance — preview-endpoint transcripts (E01-S01-T02)

Live request/response pairs captured **2026-08-11** against the Azure DevOps Pipelines *preview*
endpoint, settling how the real service treats the three YAML features where Azure Pipelines is
known or suspected to diverge from YAML 1.2: anchors/aliases, duplicate mapping keys, and
multi-document files.

Regenerate with `pnpm oracle-quirks` (needs `.env.oracle`, see `research/oracle-setup.md`).
`previewRun` is always `true`, so no run is ever queued. All transcripts pass through `redact()`.

Every quirk probe has a **control** that is identical except for the quirk, so a 400 is
attributable to the quirk and not to an unrelated schema error.

## Results

| Probe | Quirk | HTTP | Positional? | Service message |
|---|---|---|---|---|
| `control-variables` | — (control) | 200 | — | expands normally |
| `anchor-alias` | `&shared` + `*shared` | 400 | no | `Anchors are not currently supported. Remove the anchor 'shared'` |
| `anchor-only` | `&shared`, never used | 400 | no | *(identical to above)* |
| `merge-key` | `<<: *shared` | 400 | no | *(identical to above)* |
| `dup-key-mapping` | `a:` twice in a mapping | 400 | **yes** (Line 3, Col 3) | `'a' is already defined` |
| `dup-key-root` | `variables:` twice at root | 400 | **yes** (Line 3, Col 1) | `'variables' is already defined` |
| `dup-key-step` | `displayName:` twice in a step | 400 | **yes** (Line 4, Col 3) | `'displayName' is already defined` |
| `dup-key-case` | `displayName:` + `displayname:` | 400 | **yes** (Line 4, Col 3) | `'displayname' is already defined` |
| `dup-key-case-user-data` | `a:` + `A:` under `variables:` | 400 | **yes** (Line 3, Col 3) | `'A' is already defined` |
| `control-single-doc` | — (control) | 200 | — | expands normally |
| `multi-doc` | `doc1 --- doc2` | 400 | no | `Expected stream end parse event` |
| `leading-doc-start` | leading `---` | **200** | — | expands normally |
| `trailing-doc-end` | trailing `...` | **200** | — | expands normally |

Claims: C-E01-021..028 in `research/E01-yaml-frontend.md`.

## What was surprising

1. **Anchors are rejected at the *definition*.** `anchor-only` proves the service does not wait
   for an alias: an anchor nobody references is enough. So our check fires on `&name`, not on
   `*name` — the opposite of the `ALIAS_UNSUPPORTED` placeholder E01-S01-T01 left behind.
   The merge key `<<: *shared` produces the same anchor message, i.e. there is no separate
   merge-key code path to model.
2. **`---` is accepted when it opens a single document.** docs/01 §1 previously said "`---`
   separators rejected"; taken literally that would reject `---`-prefixed pipeline files, which
   the service happily expands. What is rejected is a *second* document. Trailing `...` is fine
   too. docs/01 §1 corrected, decision recorded in docs/06 §5 (#9).
3. **Only duplicate keys get a source position.** Anchors and multi-doc are reported against the
   file with no `(Line: N, Col: M)`, so the service's own text cannot always be rendered as a
   positioned diagnostic. Our checks emit ranges for all three (a deliberate superset — docs/01 §1
   requires `file:line:col` on every diagnostic).
4. **Duplicate keys collide case-insensitively — including in user data.** `displayName` +
   `displayname` was the expected case (the schema matches keywords with `ignoreCase`, C-E01-015),
   but `a:` + `A:` under `variables:` collide too, so the folding is a property of the mapping
   layer, not of keyword lookup. That is what makes it implementable in the schema-unaware parse
   stage. The message quotes the second key as the author spelled it.
5. The anchor message ends with `Object reference not set to an instance of an object.` — a
   server-side null-reference artifact appended to the validation message. Do not pattern-match on
   the tail of that string in any drift harness.

## Not probed (open)

- Non-ASCII case folding (e.g. `İ`/`i`): our check uses JS `toLowerCase()`, the service uses .NET
  semantics. Irrelevant for keywords, conceivably divergent for exotic variable names.
- Anchors inside a *template* file (as opposed to the root file) — the same parser runs on both,
  but that is inference, not evidence.
