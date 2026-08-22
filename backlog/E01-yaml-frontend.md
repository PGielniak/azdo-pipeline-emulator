# E01 — YAML front end (expanded schema)

Phase: P1 · Depends on: E00 · Design: docs/01 §1–§2
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/yaml-schema/ (landing + per-keyword
pages), vendored JSON schema (E00-S02-T01), expansion client (E00-S04).

> Re-scoped by the simplification (docs/07): the front end now parses and validates the **service's
> fully-expanded YAML** (`finalYaml`), not the raw pipeline. The raw file is only lightly parsed for
> the bundler (E03); its full validation is the server's job (PLAN D3). S01 (parse) carries over
> unchanged; S02 (validate) now targets the expanded document.

## E01-S01 — As an engine developer, YAML parses into a DOM with exact source positions and server-matching strictness, so every later error message can point at file:line and we fail where the service fails.
Acceptance: parse produces DOM+positions; server-divergent YAML features rejected with the same intent as the service, each proven by oracle experiment.

- [x] **E01-S01-T01 — CST-backed parse with provenance**
  **Do:** `packages/engine/src/frontend/parse.ts` using the `yaml` package with CST; DOM nodes carry `{file, range:{line,col,endLine,endCol}}`; runtime expressions (`$[ ]`, `$( )`) remain inert strings.
  **Ground:** `yaml` package docs (eemeli.org/yaml) for CST/position APIs — pin version; docs/01 §1 for requirements.
  **Done:** unit tests assert positions for nested mappings/sequences/scalars incl. block scalars; round-trip of node → source snippet.
- [x] **E01-S01-T02 — Server-quirk conformance (anchors, dup keys, multi-doc)**
  **Do:** explicit checks producing our errors for: YAML anchors/aliases, duplicate mapping keys, multi-document files. Behavior (reject vs accept) must mirror the **current** service.
  **Ground:** oracle experiments: submit tiny pipelines via the preview API; record acceptance/error text under `research/experiments/E01-quirks/`.
  **Done:** one experiment transcript per quirk; conformance tests reference transcript claim IDs; toggles isolated in `quirks.ts`.
- [x] **E01-S01-T03 — Diagnostics reporter**
  **Do:** diagnostic type `{severity, code, message, file, range, jsonPath, hint}`; renderer for terminal (colored, code-frame excerpt) and `--json`.
  **Ground:** docs/01 §1 requirement; sample real `az pipelines` error output for message-style reference.
  **Done:** snapshot tests of rendered diagnostics; all subsequent epics use this type.
- [x] **E01-S01-T04 — Duplicate-key quirk must exempt template directive keys**
  **Do:** `collectDuplicateKeys` exempts recognized directive keys (reuse `parseDirectiveKey`/`loneExpression`) while keeping ordinary duplicate keys as errors.
  **Ground:** `research/experiments/E03-walk/dup-identical-if-keys.md` (C-E03-111) + one preview probe per uncovered cell.
  **Done:** accepted-by-service document parses without `DUPLICATE_KEY`; a genuine duplicate still reports; each new cell cites its transcript.
  *(Retained for the offline fallback path only — the bundler does not re-run directive logic.)*

## E01-S02 — As a pipeline developer, invalid *expanded* YAML is rejected with readable schema errors before emission, so I find typos instantly.
Acceptance: the expanded `finalYaml` is strictly validated with readable messages from the official schema; the raw file is the server's to validate.

- [x] **E01-S02-T01 — Validator over the vendored schema**
  **Do:** compile the vendored JSON schema with a post-processing layer that converts raw `oneOf` explosion into targeted messages (nearest-branch heuristic by discriminating keys like `task`/`script`/`bash`).
  **Ground:** vendored schema + PROVENANCE (E00-S02-T01); cross-check 5 keyword pages against schema content.
  **Done:** fixture set of 15 broken pipelines → snapshot-tested readable errors incl. file:line.
- [!] **E01-S02-T02 — Strict validation of the expanded pipeline** *(blocked on E00-S04: strict validation needs `finalYaml`, which only exists once the expansion client is wired into `convert`. Re-scoped from the original "two-pass validation" — the loose pass on the raw root is dropped, since raw-file validation is now the server's job.)*
  **Do:** wire the strict validator (T01) to the expanded `finalYaml` (E00-S04) inside `convert`; report errors against `pipeline.expanded.yml`.
  **Ground:** docs/01 §1; the expanded document's shape from a real `finalYaml` sample (E00-S04-T01).
  **Done:** a deliberately broken expansion fails with pointers into `pipeline.expanded.yml`; a known-good corpus pipeline passes.
- [x] **E01-S02-T03 — Org-schema injection point**
  **Do:** validator accepts an alternative schema document (fetched per-org in E09) so marketplace task inputs validate when authenticated; fall back to vendored schema offline.
  **Ground:** pin `GET {org}/_apis/distributedtask/yamlschema` response sample from the test org into `research/experiments/E01-orgschema/`.
  **Done:** integration test swapping schemas; behavior identical for in-box constructs.
