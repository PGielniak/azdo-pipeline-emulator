# E01 — YAML front end & schema validation

Phase: P0–P1 · Depends on: E00 · Design: docs/01 §1–§2
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/yaml-schema/ (landing + per-keyword pages), vendored JSON schema (E00-S02-T01), oracle (E00-S03).

## E01-S01 — As an engine developer, YAML parses into a DOM with exact source positions and server-matching strictness, so every later error message can point at file:line and we fail where the service fails.
Acceptance: parse produces DOM+positions; server-divergent YAML features rejected with the same intent as the service, each proven by oracle experiment.

- [x] **E01-S01-T01 — CST-backed parse with provenance**
  **Do:** `packages/engine/src/frontend/parse.ts` using the `yaml` package with CST; DOM nodes carry `{file, range:{line,col,endLine,endCol}}`; expressions remain inert strings.
  **Ground:** `yaml` package docs (eemeli.org/yaml) for CST/position APIs — pin version; docs/01 §1 for requirements.
  **Done:** unit tests assert positions for nested mappings/sequences/scalars incl. block scalars; round-trip of node → source snippet.
- [x] **E01-S01-T02 — Server-quirk conformance (anchors, dup keys, multi-doc)** *(done 2026-08-11, unblocked by the live test org. 13 preview-endpoint transcripts in `research/experiments/E01-quirks/` — every quirk paired with a control; toggles isolated in `packages/engine/src/frontend/quirks.ts` (`SERVER_QUIRKS` table). Service verdicts: anchors rejected **on the definition** (`&x` unused fails like `&x`+`*x`, merge key same message); duplicate keys rejected at every level, positioned at the **second** occurrence and compared **case-insensitively** (including user-chosen names like `a`/`A`); a second document rejected — but a leading `---` and trailing `...` are **accepted** (docs/01 §1 corrected, docs/06 §5 #9).)*
  **Do:** explicit checks producing our errors for: YAML anchors/aliases, duplicate mapping keys, multi-document files. Behavior (reject vs accept) must mirror the **current** service.
  **Ground:** run oracle experiments: submit tiny pipelines using each feature via preview API; record the service's acceptance/error text under `research/experiments/E01-quirks/`; implement to match. Also check the yaml-schema landing page for any documented statement on anchors.
  **Done:** one experiment transcript per quirk; conformance tests reference the transcripts' claim IDs; behavior toggles isolated in one module for easy re-verification.
- [x] **E01-S01-T03 — Diagnostics reporter**
  **Do:** diagnostic type `{severity, code, message, file, range, jsonPath, hint}`; renderer for terminal (colored, code-frame excerpt) and `--json`.
  **Ground:** docs/01 §1 requirement; sample real `az pipelines` error output for message-style reference (record one screenshot/paste in research note).
  **Done:** snapshot tests of rendered diagnostics; all subsequent epics use this type.

## E01-S02 — As a pipeline developer, invalid YAML is rejected with readable schema errors before any expansion, so I find typos instantly.
Acceptance: root-file loose validation + expanded-DOM strict validation, readable messages from the official schema.

- [x] **E01-S02-T01 — Validator over the vendored schema**
  **Do:** compile the vendored JSON schema (ajv or equivalent) with a post-processing layer that converts raw `oneOf` explosion into targeted messages (nearest-branch heuristic by discriminating keys like `task`/`script`/`bash`).
  **Ground:** vendored schema + its PROVENANCE (E00-S02-T01); cross-check 5 keyword pages (e.g. `steps-script`, `jobs-job`, `pool`) on learn.microsoft.com yaml-schema reference against schema content and record any doc/schema mismatch found.
  **Done:** fixture set of 15 broken pipelines → snapshot-tested readable errors incl. file:line.
- [!] **E01-S02-T02 — Two-pass validation wiring** *(blocked 2026-07-30: both halves need work that hasn't landed — Ground wants the loose-pass tolerance list derived from **5 real template-using pipelines in the corpus**, and Done requires strict validation of `pipeline.expanded.yml`, which only exists once expansion lands (E03-S04). **Half unblocked 2026-08-11:** corpus v1 landed (E12-S01-T02) with exactly five template-using entries — 05, 06, 07, 08, 09 — and `test/corpus.test.ts` asserts that count stays ≥5 so this task's input cannot silently disappear. Still blocked on E03-S04. T01 left `validatePipeline()` taking any parsed document, so both passes are a thin wrapper once inputs exist.)*
  **Do:** loose pass on the raw root (template holes tolerated: unknown keys under template-bearing nodes downgraded to info), strict pass on the fully expanded DOM (hooked in E03-S04).
  **Ground:** docs/01 §1; determine the loose-pass tolerance list empirically from 5 real template-using pipelines in the corpus (record which raw files legitimately fail strict validation and why).
  **Done:** corpus root files pass loose; deliberately broken expansions fail strict with pointers into `pipeline.expanded.yml`.
- [x] **E01-S02-T03 — Org-schema injection point** *(done 2026-08-11, unblocked by the live test org. Live response pinned at `research/experiments/E01-orgschema/yamlschema.json` (`pnpm org-schema`, 611 KB, HTTP 200) — **same dialect and same generator as the vendored file** (draft-07, same `$id`, all four VS Code keywords, identical 119 definitions), so injection is a wholesale swap, implemented in `packages/engine/src/frontend/org-schema.ts` (`resolvePipelineSchema`/`checkOrgSchema`/`parseOrgSchema`/`taskNames`) with vendored fallback whenever the document fails the dialect/keyword gate. The org catalogue is a strict superset (269 vs 254 tasks) including the marketplace extension `qetza.replacetokens` — swap test: all 20 fixtures produce identical diagnostics, the only difference anywhere being the unknown-task **hint wording**, which is source-dependent by design. `DOCUMENTED_CORRECTIONS` now apply to the org document too (it omits `target` exactly as the vendored file does — C-E01-037).)*
  **Do:** validator accepts an alternative schema document (fetched per-org in E08-S03-T07) so marketplace task inputs validate when authenticated; fall back to vendored schema offline.
  **Ground:** confirm the org schema endpoint's response is the same JSON-schema dialect: pin `GET {org}/_apis/distributedtask/yamlschema` response sample from the test org into `research/experiments/E01-orgschema/`.
  **Done:** integration test swapping schemas; behavior identical for in-box constructs.
