# E03 — Template engine & oracle parity

Phase: P1 · Depends on: E01, E02 · Design: docs/02 §2–§5, §7–§8
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/process/templates · …/process/template-parameters · …/process/runtime-parameters · **actions/runner** `src/Sdk/DTObjectTemplating` + `DTPipelines` (open fork of the object-templating/pipeline-yaml engine — corrected 2026-07-30, C-E00-012/013: these folders do not exist in `microsoft/azure-pipelines-agent`; pin actions/runner permalinks per claim) · **oracle preview API for every ambiguous rule** (outranks the fork on divergence).

## E03-S01 — As a pipeline developer, `${{ if/elseif/else }}`, `${{ each }}` and `${{ insert }}` expand exactly like the service, so template-heavy pipelines convert byte-equivalently.
Acceptance: directive semantics proven by oracle fixture pairs, not by reading alone.

- [x] **E03-S01-T01 — DOM walker with context stack**
  **Do:** `packages/engine/src/template/walk.ts`: depth-first mapping/sequence walk, per-file context frames (parameters, file variables), directive-key detection.
  **Ground:** templates doc structure sections; agent object-templating walker (pin permalink to its evaluation loop) as design reference.
  **Done:** walker unit tests on synthetic DOMs incl. directive keys in both mappings and sequences.
  *Done 2026-08-12:* `packages/engine/src/template/walk.ts` — `parseDirectiveKey`/`loneExpression`/
  `expressionUnits` (recognition), `TemplateFrame`/`bindLoopVariable`/`childFrame` (context stack),
  `walkTemplate` with a per-directive visitor seam; 54 tests. **Both Ground sources turned out
  insufficient in opposite directions**, which is why this task ran 33 live probes
  (`pnpm template-walk-survey`, `research/experiments/E03-walk/`, C-E03-100..115): the docs state
  none of the recognition rules and their one structural claim about *where* expressions expand is
  false (C-E03-109), while the `actions/runner` walker knows exactly one directive, `insert`, and
  none of the others (C-E03-115) — usable for the loop shape and nothing else. Headline findings:
  directive keywords are **case-sensitive** in an otherwise case-folding language (C-E03-100), and
  directive parameters are **expression tokens, not whitespace-split words**, so the `each`
  separator must be found by tokenizing rather than `indexOf(' in ')` (C-E03-101/104). Semantics
  stay with T02–T05 per their fixture obligations; two gaps were filed rather than fixed
  (E01-S01-T04, E02-S01-T03). `loneExpression` finds its closing `}}` with a quote-aware scan: the
  documented escape for a literal `${{` is to wrap it in an expression string (C-E03-117), which
  E03-S01-T05 depends on.
- [!] **E03-S01-T02 — Conditional insertion chains**
  *Blocked 2026-08-18: the required six-case preview-oracle matrix cannot run because `AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, and `AZDO_PAT` are all unset and `.env.oracle` is absent; official docs leave chain grouping, nesting, and orphan/missing-chain behavior unspecified. Configure `research/oracle-setup.md`, then resume from C-E03-120/121.*
  **Do:** `if/elseif/else` chain grouping in document order; winning branch spliced into parent; nested chains.
  **Ground:** templates doc "Conditional insertion"; **oracle fixtures**: ≥ 6 cases (mapping vs sequence, nested, else-only-missing) — commit input+`finalYaml` pairs under `fixtures/oracle/directives/` with claim IDs.
  **Done:** goldens equal oracle output for all pairs.
- [x] **E03-S01-T03 — Iterative insertion (`each`)**
  *Done 2026-08-18:* 12 live preview probes recorded C-E03-140..151 and produced 11
  input/`finalYaml` fixture pairs. `eachVisitor` expands sequences and mappings in authored order,
  including integer-like keys, recursively supports nested loops and full `stepList`/`jobList`
  structures, splices mapping/sequence bodies, and creates no implicit index. Oracle golden tests
  cover every successful pair; the rejected bare-index case is retained as an error transcript.
  **Do:** sequence iteration, mapping iteration (`pair.key`/`pair.value` semantics), iteration over `object`/`*List` parameters, nested `each`, index availability check.
  **Ground:** templates doc "Iterative insertion"; oracle fixtures ≥ 8 incl. each-over-mapping key order (record observed ordering as a claim) and each wrapping full jobs.
  **Done:** goldens vs oracle; ordering claim documented.
- [ ] **E03-S01-T04 — `${{ insert }}` merge**
  **Do:** mapping-merge semantics incl. collision behavior (verify: error vs overwrite).
  **Ground:** templates doc "Insertion"; oracle probe for key-collision behavior; claim recorded.
  **Done:** goldens incl. collision case matching service.
- [ ] **E03-S01-T05 — Scalar interpolation rules**
  **Do:** lone-expression structural insertion vs mixed-content stringification; Null→``, Boolean→`True/False`, Number invariant; expression-in-key stringification.
  **Ground:** docs/02 §3 spec + oracle probes for each stringification rule (esp. Boolean casing, float rendering `0.5`/`1.0`); claims per rule.
  **Done:** table-driven goldens vs oracle.
  *Note (E02-S01-T02, C-E02-109):* the service compiles a mixed-content scalar into a synthetic
  `format('<literal with {0} holes>', <expr>, …)` call and parses **that** — a parse error inside
  one is reported as `position 29 within expression: 'format('prefix {0} suffix', null)'`, and a
  block scalar becomes one `format` whose literal carries real newlines. So "stringify and
  concatenate" is `format`'s stringification (E02-S03-T02), not a separate rule, and the
  lone-expression/mixed-content split is visible in the service's own error text. Transcripts:
  `research/experiments/E02-errors/` rows `embed-mid-scalar`/`embed-second-expr`/`block-scalar`.

## E03-S02 — As a pipeline developer, includes/`extends` with typed parameters resolve like the service, so multi-file pipelines just work.
Acceptance: reference forms, parameter typing, and `extends` restrictions all enforced with service-matching errors.

- [ ] **E03-S02-T01 — Reference resolution (`relative`, `/root`, `@alias`, `@self`)**
  **Do:** resolver with per-file base dir, repo-context switching on `@alias` (fetcher interface injected; local-FS impl now, remote in E08), cycle detection on (repo, commit, path).
  **Ground:** templates doc "Use other repositories" + resources doc `repositories`; oracle can't exercise cross-repo without setup — add a two-repo fixture in the test org and capture `finalYaml` proving path resolution + `@self` semantics.
  **Done:** unit tests for path math; oracle fixture for cross-repo include.
- [ ] **E03-S02-T02 — Typed parameter binding**
  **Do:** all documented types (`string number boolean object step stepList job jobList deployment deploymentList stage stageList`), `values:` restriction, `default`, required-missing error, extra-parameter error; runtime parameters at root bound from CLI/config.
  **Ground:** template-parameters + runtime-parameters docs (quote type list and coercion notes); oracle probes for: passing number to string, boolean literals accepted (`true`/`True`?), object deep shape — transcripts + claims.
  **Done:** binding test matrix per type × (default/provided/missing/wrong-type); errors snapshot-compared to service phrasing collected via oracle.
- [ ] **E03-S02-T03 — `extends` semantics**
  **Do:** expansion of the target with root restrictions enforced (which root keys are legal beside `extends`); nested `extends` behavior.
  **Ground:** templates doc "Extend from a template" (+ security section); oracle probes: illegal root key beside extends → capture error; nested extends → capture result. Claims per rule.
  **Done:** fixtures matching service for legal/illegal cases.
- [ ] **E03-S02-T04 — `templateContext` passthrough**
  **Do:** opaque payload attached to stage/job/step items iterated in templates; reachable in expressions per doc.
  **Ground:** templates doc "templateContext" section + yaml-schema keyword page; one oracle fixture using it with a jobList.
  **Done:** golden matches oracle.

## E03-S03 — As an engine developer, compile-time variable visibility follows empirically proven rules, so the murkiest area of the service is encoded as tested policy, not guesses.
Acceptance: policy function backed by an experiment matrix.

- [ ] **E03-S03-T01 — Visibility experiment matrix**
  **Do:** design & run oracle experiments: `${{ variables.x }}` read in root vs included template vs nested template; variable declared before/after use; variables from `variables:` templates; stage-level vs root-level. ≥ 12 cells; store inputs+`finalYaml`.
  **Ground:** the experiments **are** the grounding (docs are known-incomplete here — note the doc gap with links to what the templates/variables docs do say).
  **Done:** `research/E03-visibility.md` table: cell → observed behavior → claim ID.
  *Note (2026-08-11, E12-S01-T02): one cell is already answered and should be carried in, plus a thirteenth the Do list doesn't name — **job-level scoping**: `${{ variables.x }}` read inside a job that overrides `x` resolves to the **job's** value, not the pipeline-level one (C-E12-024, `fixtures/oracle/04-variable-layers.final.yml:55`). Corpus entry 04 is a ready-made input for the matrix.*
- [ ] **E03-S03-T02 — `compileTimeVariableScope()` policy implementation**
  **Do:** single policy function consumed by the walker; every branch annotated with the claim ID from T01.
  **Ground:** exclusively the T01 experiment claims (`research/E03-visibility.md`) — no branch may exist without a cell citation; templates/variables doc statements (where they exist) linked alongside as secondary support.
  **Done:** all T01 cells reproduced by engine tests; divergence from any future oracle run fails CI (cells become permanent oracle fixtures).

## E03-S04 — As a pipeline developer, expansion enforces the same limits and produces the same final document the service would, with provenance for debugging.
Acceptance: limits enforced; `pipeline.expanded.yml` + `expansion-map.json` emitted; strict validation runs post-expansion.

- [ ] **E03-S04-T01 — Server limits**
  **Do:** named constants for max file count / nesting depth / expanded size with enforcement + our error messages referencing the doc.
  **Ground:** templates doc "Imposed limits" section — quote exact current numbers into claims (do **not** trust the numbers in design docs; they are placeholders).
  **Done:** limit tests at boundary±1; constants file cites claims.
- [ ] **E03-S04-T02 — Expanded-YAML emitter + provenance map**
  **Do:** stable-ordered YAML serialization of the expanded DOM; `expansion-map.json` mapping node paths → source stack (file, line, repo@sha, template-params hash) per docs/02 §7.
  **Ground:** compare serialization choices against oracle `finalYaml` formatting (key order, flow vs block) and encode the normalizer accordingly (feeds E03-S05).
  **Done:** map covers 100% of emitted nodes on corpus; spot-check tool prints provenance for a chosen line.
- [ ] **E03-S04-T03 — Strict post-expansion validation wiring** (with E01-S02-T02)
  **Ground:** vendored official schema + its provenance (E00-S02-T01); confirm the service also rejects the injected mutations by submitting 3 of them through the oracle preview and recording the error responses.
  **Done:** corpus expansions validate; injected mutations fail with pointers into expanded YAML + original source via provenance; 3 mutation cases matched against recorded service errors.

## E03-S05 — As the project owner, `preview-diff` proves our engine against the service continuously, so parity drift is detected within a day.
Acceptance: normalize-and-diff pipeline usable locally and in CI.

- [x] **E03-S05-T01 — Normalizer** *(done 2026-08-11. `packages/engine/src/normalize/normalize.ts` — `normalizeExpandedYaml()` returning `{value, text, applied, errors}`: a path-addressable canonical structure for E03-S05-T02's semantic diff plus a stable serialization, with the exercised rule ids reported. Eight rules N1–N8, each citing its claim and its corpus sample; catalogue in `research/E03-normalizer.md`, evidence in `research/experiments/E03-normalizer/survey.md` (`pnpm normalizer-survey`). **The canonical target was established, not chosen**: re-submitting each committed `finalYaml` as `yamlOverride` returns it byte-for-byte — 10/10 fixpoint modulo the single output-only shape `trigger:/pr: {enabled: false}`, which the service emits and then **refuses to read back** (C-E03-001/002). Scope boundary held deliberately: the normalizer does **not** expand — no `stages: __default` wrapping, no shortcut→task desugaring — because doing expansion here would let a broken expander pass `preview-diff`. 49 tests; idempotence over every golden is a real gate, not a formality (it caught list-item rules re-wrapping their own output on each pass).)*
  **Do:** canonicalization for both sides: key ordering, insignificant whitespace, server-injected defaults (catalog them as discovered — each injected default gets a claim + normalizer rule).
  **Ground:** empirically from oracle outputs on the corpus; every normalizer rule cites the sample that motivated it.
  **Done:** normalizer idempotent; rule list documented in `research/E03-normalizer.md`.
- [ ] **E03-S05-T02 — `preview-diff` command**
  **Do:** expand locally → fetch `finalYaml` → normalize both → semantic diff (path-based, colored) → exit code; `--update-fixture` writes the pair into `fixtures/oracle/`.
  **Ground:** preview REST page (already pinned E00-S03); diff behavior spec docs/02 §8.
  **Done:** command green on corpus; used by E12-S03 nightly.
