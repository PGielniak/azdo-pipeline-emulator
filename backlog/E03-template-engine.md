# E03 — Template engine (offline fallback) & local bundler

Phase: P1 · Depends on: E01, E02 · Design: docs/02 §2–§5, §7–§8
> **Reconciled 2026-08-22 (docs/07).** This epic's local engine (S01–S05) is now substantially
> complete and is **retained as the offline fallback** — the *default* expansion path is the
> preview endpoint (E00-S04) via the **bundler** (S06–S07), which inlines local `@self` templates
> and lets the service expand them. The engine stays as the parity-verified fallback, not the
> critical path.
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/process/templates · …/process/template-parameters · …/process/runtime-parameters · **actions/runner** `src/Sdk/DTObjectTemplating` + `DTPipelines` (open fork of the object-templating/pipeline-yaml engine — corrected 2026-07-30, C-E00-012/013: these folders do not exist in `microsoft/azure-pipelines-agent`; pin actions/runner permalinks per claim) · **oracle preview API for every ambiguous rule** (outranks the fork on divergence).

## E03-S01 — As a pipeline developer, `${{ if/elseif/else }}`, `${{ each }}` and `${{ insert }}` expand exactly like the service, so template-heavy pipelines convert byte-equivalently.
Acceptance: directive semantics proven by oracle fixture pairs, not by reading alone.

> **Bookkeeping drift (noted 2026-08-21 by E06-S04-T04, not repaired here).** The checkboxes below
> understate this epic. `CHANGELOG-BACKLOG.md` records E03-S01-T02, T03, T04, T05 and E03-S02-T01 as
> done, and `packages/engine/src/template/` holds `conditionals.ts`, `each.ts`, `insert.ts`,
> `interpolate.ts`, `reference.ts` and `walk.ts` with their suites green on `main` — but only T01 and
> E03-S05-T01 were ever ticked. `main` and this branch agree on the file, so this is the E03 worker's
> outstanding bookkeeping, not a merge casualty. A cold session told to "take the next unchecked task"
> will otherwise pick E03-S01-T03, which is finished. Flip these when the E03 lane next runs.
>
> **Demotion sweep (2026-08-22, E12-S01-T02) deliberately left these checkboxes alone.** The sweep
> marks *scope*, not completed work (E12 header), and it cannot certify another lane's Done
> criteria. What the demotion changes for S01 is its **status, not its state**: the directive engine
> built here is the offline fallback (PLAN D3/D4), reached only through `--offline-expand`
> (E12-S01-T01) once E03-S04-T02 gives it a whole-document driver. Nothing in S01 is `[~]` — it is
> built, proven against oracle pairs, and retained. E03-S01-T02's `[!]` blocker note also predates
> two `done` entries for it in `CHANGELOG-BACKLOG.md`; that too is the E03 lane's to reconcile.

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
- [ ] **E03-S01-T03 — Iterative insertion (`each`)**
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

> **Demoted to fallback scope (2026-08-22, E12-S01-T02).** Same treatment as S01: T01/T02 are built
> but unchecked (T01 recorded `done`, T02 only `in-progress` — see the S01 drift note) and are
> retained as the offline fallback; T03/T04 were never built and are `[~]`. The **default** path
> reaches template files by *bundling* them for the service (E03-S06/S07), not by interpreting them
> here.

- [ ] **E03-S02-T01 — Reference resolution (`relative`, `/root`, `@alias`, `@self`)**
  **Do:** resolver with per-file base dir, repo-context switching on `@alias` (fetcher interface injected; local-FS impl now, remote in E08), cycle detection on (repo, commit, path).
  **Ground:** templates doc "Use other repositories" + resources doc `repositories`; oracle can't exercise cross-repo without setup — add a two-repo fixture in the test org and capture `finalYaml` proving path resolution + `@self` semantics.
  **Done:** unit tests for path math; oracle fixture for cross-repo include.
- [ ] **E03-S02-T02 — Typed parameter binding**
  **Do:** all documented types (`string number boolean object step stepList job jobList deployment deploymentList stage stageList`), `values:` restriction, `default`, required-missing error, extra-parameter error; runtime parameters at root bound from CLI/config.
  **Ground:** template-parameters + runtime-parameters docs (quote type list and coercion notes); oracle probes for: passing number to string, boolean literals accepted (`true`/`True`?), object deep shape — transcripts + claims.
  **Done:** binding test matrix per type × (default/provided/missing/wrong-type); errors snapshot-compared to service phrasing collected via oracle.
  *Status note (2026-08-21, recorded by E06-S04-T04): an unfinished 755-line `packages/engine/src/template/parameters.ts` from the 2026-08-20 in-progress session survives on branch `claude/e06-s04-t03`, swept in by the crash-recovery commit `f76a47b` ("auto-save checkpoint"). It is **not on `main`**, is imported by nothing, and has no tests, so it counts as ~247 wholly uncovered statements and is the sole reason `pnpm test:unit` fails its coverage thresholds on that branch (1,439/1,439 tests pass; `main` measures 93.4% statements against the same numerator). Left in place rather than deleted — finishing or discarding it is this task's call; it is recoverable from `f76a47b` either way. Thresholds were **not** lowered.*
- [~] **E03-S02-T03 — `extends` semantics** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): `extends` is compile-time semantics the **service** performs (PLAN D3). The default path is the preview expansion (E00-S04) fed by the bundler (E03-S06/S07), which inlines the `extends` **target file** rather than interpreting the keyword. Retained fallback scope: build only if the offline engine is pursued (E03-S04-T02).*
  **Do:** expansion of the target with root restrictions enforced (which root keys are legal beside `extends`); nested `extends` behavior.
  **Ground:** templates doc "Extend from a template" (+ security section); oracle probes: illegal root key beside extends → capture error; nested extends → capture result. Claims per rule.
  **Done:** fixtures matching service for legal/illegal cases.
- [~] **E03-S02-T04 — `templateContext` passthrough** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): an opaque compile-time payload the service resolves before it ever reaches us; the expanded `finalYaml` no longer contains it. Retained fallback scope only.*
  **Do:** opaque payload attached to stage/job/step items iterated in templates; reachable in expressions per doc.
  **Ground:** templates doc "templateContext" section + yaml-schema keyword page; one oracle fixture using it with a jobList.
  **Done:** golden matches oracle.
- [ ] **E03-S02-T05 — Local file lookup must be case-sensitive on a case-insensitive filesystem** *(filed 2026-08-22 by E12-S03-T01 as a defect found in CI, not fixed there — it is E03-S02-T01's lane and needs its own grounding + tests.)*
  **Do:** the local-FS loader in `packages/engine/src/template/reference.ts` resolves a template path with `readFileSync`, so on macOS (case-insensitive APFS) a path whose case does not match the repository's succeeds — the service rejects it. Verify the *real* case of each resolved segment (e.g. `readdirSync` on the parent, or `realpath` compared against the requested spelling) before returning the content, so the resolver answers the same on Linux and macOS.
  **Ground:** already grounded — **C-E03-204** (path lookup does not fold case, while alias lookup does) and the oracle transcript `research/experiments/E03-references/case-mismatch/` (HTTP 400, `PipelineValidationException`). No new probe is needed; the service's answer is on file.
  **Done:** the `case-mismatch` probe in `packages/engine/test/template/reference.test.ts` ("oracle replay — every reference probe") passes on macOS as well as Linux — it currently fails there with `expected undefined to be defined`, the only red test in CI on both `main` and PR #22; a regression test asserts the miss directly, not only through the replay.


## E03-S03 — As an engine developer, compile-time variable visibility follows empirically proven rules, so the murkiest area of the service is encoded as tested policy, not guesses.
Acceptance: policy function backed by an experiment matrix.

- [~] **E03-S03-T01 — Visibility experiment matrix** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): compile-time `${{ variables.* }}` visibility is decided by the service; only the **runtime** expression half stays local (PLAN D6). The matrix would now be documentation of the service's behavior, not a specification we implement. Retained fallback scope; the carried-in cell below (C-E12-024) stays as evidence.*
  **Do:** design & run oracle experiments: `${{ variables.x }}` read in root vs included template vs nested template; variable declared before/after use; variables from `variables:` templates; stage-level vs root-level. ≥ 12 cells; store inputs+`finalYaml`.
  **Ground:** the experiments **are** the grounding (docs are known-incomplete here — note the doc gap with links to what the templates/variables docs do say).
  **Done:** `research/E03-visibility.md` table: cell → observed behavior → claim ID.
  *Note (2026-08-11, E12-S01-T02): one cell is already answered and should be carried in, plus a thirteenth the Do list doesn't name — **job-level scoping**: `${{ variables.x }}` read inside a job that overrides `x` resolves to the **job's** value, not the pipeline-level one (C-E12-024, `fixtures/oracle/04-variable-layers.final.yml:55`). Corpus entry 04 is a ready-made input for the matrix.*
- [~] **E03-S03-T02 — `compileTimeVariableScope()` policy implementation** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): same reason as T01 — the policy exists only inside the offline fallback's walker. Retained fallback scope; it cannot start before T01 either way.*
  **Do:** single policy function consumed by the walker; every branch annotated with the claim ID from T01.
  **Ground:** exclusively the T01 experiment claims (`research/E03-visibility.md`) — no branch may exist without a cell citation; templates/variables doc statements (where they exist) linked alongside as secondary support.
  **Done:** all T01 cells reproduced by engine tests; divergence from any future oracle run fails CI (cells become permanent oracle fixtures).

## E03-S04 — As a pipeline developer, expansion enforces the same limits and produces the same final document the service would, with provenance for debugging.
Acceptance: limits enforced; `pipeline.expanded.yml` + `expansion-map.json` emitted; strict validation runs post-expansion.

> **Split by the demotion sweep (2026-08-22, E12-S01-T02).** The story's premise — *we* produce the
> final document — is the service's job now (PLAN D3). T01 is demoted; T02 stays as the offline
> fallback's entry point (its only consumer is `--offline-expand`); T03 stays and re-points at the
> service's `finalYaml`. `pipeline.expanded.yml` itself is still emitted on the default path — the
> service's expansion, frozen by the emitter (E05).

- [~] **E03-S04-T01 — Server limits** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): the service enforces its own limits and reports a breach through the preview response, which `expand()` surfaces as a `rejected` outcome (E00-S04-T01). Re-implementing the numbers locally would only be able to disagree with the authority. Retained fallback scope.*
  **Do:** named constants for max file count / nesting depth / expanded size with enforcement + our error messages referencing the doc.
  **Ground:** templates doc "Imposed limits" section — quote exact current numbers into claims (do **not** trust the numbers in design docs; they are placeholders).
  **Done:** limit tests at boundary±1; constants file cites claims.
- [ ] **E03-S04-T02 — Expanded-YAML emitter + provenance map** — *Retained 2026-08-22 (E12-S01-T02): **not** demoted, because it is the offline fallback's missing entry point. The engine's directive visitors are driven end-to-end today only by the test harness `packages/engine/test/template/fixture-harness.ts`; this task is what promotes that into `src/`. Its one consumer is the `--offline-expand` port shipped by E12-S01-T01, which refuses with a message naming this task until it lands. Off the critical path — the default expansion never calls it.*
  **Do:** stable-ordered YAML serialization of the expanded DOM; `expansion-map.json` mapping node paths → source stack (file, line, repo@sha, template-params hash) per docs/02 §7.
  **Ground:** compare serialization choices against oracle `finalYaml` formatting (key order, flow vs block) and encode the normalizer accordingly (feeds E03-S05).
  **Done:** map covers 100% of emitted nodes on corpus; spot-check tool prints provenance for a chosen line.
- [ ] **E03-S04-T03 — Strict post-expansion validation wiring** (with E01-S02-T02) — *Re-pointed 2026-08-22 (E12-S01-T02): **not** demoted — it now validates the **service's** `finalYaml` (E00-S04), not a locally-expanded DOM, which is also what unblocks E01-S02-T02. The provenance half of the Done criteria depends on E03-S04-T02 and is fallback-only.*
  **Ground:** vendored official schema + its provenance (E00-S02-T01); confirm the service also rejects the injected mutations by submitting 3 of them through the oracle preview and recording the error responses.
  **Done:** corpus expansions validate; injected mutations fail with pointers into expanded YAML + original source via provenance; 3 mutation cases matched against recorded service errors.

## E03-S05 — As the project owner, `preview-diff` proves our engine against the service continuously, so parity drift is detected within a day.
Acceptance: normalize-and-diff pipeline usable locally and in CI.

> **Story premise superseded (2026-08-22, E12-S01-T02).** There is no default-path engine to prove:
> the service *is* the expansion. T01's normalizer is built and stays useful (comparing any two
> expansions, fallback included); T02, the `preview-diff` command, is demoted — drift detection is
> now E11-S03-T01's nightly re-expansion.

- [x] **E03-S05-T01 — Normalizer** *(done 2026-08-11. `packages/engine/src/normalize/normalize.ts` — `normalizeExpandedYaml()` returning `{value, text, applied, errors}`: a path-addressable canonical structure for E03-S05-T02's semantic diff plus a stable serialization, with the exercised rule ids reported. Eight rules N1–N8, each citing its claim and its corpus sample; catalogue in `research/E03-normalizer.md`, evidence in `research/experiments/E03-normalizer/survey.md` (`pnpm normalizer-survey`). **The canonical target was established, not chosen**: re-submitting each committed `finalYaml` as `yamlOverride` returns it byte-for-byte — 10/10 fixpoint modulo the single output-only shape `trigger:/pr: {enabled: false}`, which the service emits and then **refuses to read back** (C-E03-001/002). Scope boundary held deliberately: the normalizer does **not** expand — no `stages: __default` wrapping, no shortcut→task desugaring — because doing expansion here would let a broken expander pass `preview-diff`. 49 tests; idempotence over every golden is a real gate, not a formality (it caught list-item rules re-wrapping their own output on each pass).)*
  **Do:** canonicalization for both sides: key ordering, insignificant whitespace, server-injected defaults (catalog them as discovered — each injected default gets a claim + normalizer rule).
  **Ground:** empirically from oracle outputs on the corpus; every normalizer rule cites the sample that motivated it.
  **Done:** normalizer idempotent; rule list documented in `research/E03-normalizer.md`.
- [~] **E03-S05-T02 — `preview-diff` command** — *Demoted 2026-08-22 (E12-S01-T02, docs/07 §6): the command is removed from the CLI surface (E10 epic header): with the service as *the* expansion there is nothing to diff on the default path. Service-drift detection moved to the nightly re-expansion harness (**E11-S03-T01**); parity of the offline fallback, if it is ever built, is E11-S02 conformance work rather than a shipped command. **Left for E12-S03:** `packages/cli/src/program.ts` still registers a `preview-diff` command (its `NotImplementedError` points at "E12-S03-T01 (nightly parity workflow)") and docs/06 §1 still lists it — removing the surface is E12-S02/E12-S03 scope, not this sweep's.*
  **Do:** expand locally → fetch `finalYaml` → normalize both → semantic diff (path-based, colored) → exit code; `--update-fixture` writes the pair into `fixtures/oracle/`.
  **Ground:** preview REST page (already pinned E00-S03); diff behavior spec docs/02 §8.
  **Done:** command green on corpus; used by E12-S03 nightly.

## E03-S06 — As a pipeline developer, editing a local template file is visible to the expansion, so I can debug multi-file pipelines without committing.
Acceptance: a root pipeline referencing local `@self` templates converts from an uncommitted working tree.

- [ ] **E03-S06-T01 — Detect `@self` template references**
  **Do:** `packages/engine/src/template/bundle.ts` walks the parsed raw DOM (E01) and finds `extends.template`, `stages/jobs/steps` `- template:` references, and a `@self`-style repository alias; record each with its `file:line`.
  **Ground:** templates doc (…/process/templates) for the reference syntax + `resources.repositories` doc; reference shapes are the only behavior here — no expansion.
  **Done:** unit tests list references across root/stage/job/step levels from a fixture.
- [ ] **E03-S06-T02 — Recursive local inliner**
  **Do:** resolve each `@self` reference against the local working tree (relative to the root file), inline the file's content, recurse into nested `@self` references; detect cycles and report them.
  **Ground:** oracle experiment: confirm that a `yamlOverride` whose body contains inlined template content expands identically to the committed multi-file form (one redacted probe pair under `research/experiments/E03-bundle/`); this pins *our* inlining mechanics, not server behavior.
  **Done:** a two-file pipeline with a nested template converts with no `@self` references left in the override; a cycle produces a diagnostic with file:line.
- [ ] **E03-S06-T03 — Parameter pass-through**
  **Do:** pass `templateParameters` (and `parameters:` at the `extends` boundary) through to the expansion call (E00-S04) as the `templateParameters` request field; leave parameter *binding* to the service.
  **Ground:** preview request shape already grounded (C-E00-018 includes `templateParameters`); runtime-parameters doc for the parameter syntax.
  **Done:** a pipeline with `- template: t.yml` + `parameters: {…}` converts and the expansion reflects the values (asserted against the returned `finalYaml`).
- [ ] **E03-S06-T04 — Cross-repo (`@other`) references**
  **Do:** detect template references to repos other than `@self`; for v1 emit a clear convert-time diagnostic ("cross-repo template — resolves against the committed repo; see E09"), never a silent wrong expansion.
  **Ground:** `resources.repositories` doc for the alias form; C-E03-110 (position gating measured).
  **Done:** an `@other` reference produces the diagnostic and stops (or continues with an explicit warning) — no silent fallback.

## E03-S07 — As a pipeline developer, I can see exactly what was sent to the service, so surprises are debuggable.
Acceptance: the bundled override and its provenance are written to the output.

- [ ] **E03-S07-T01 — Bundled-override provenance**
  **Do:** write the exact `yamlOverride` sent to `preview` (secrets redacted) plus a map of `local path → inlined location` and file hashes into the output (e.g. `pipeline.bundled.yml` + `bundle.json`).
  **Ground:** docs/04 §10 (provenance comments) and D7 (secret redaction) — reuse `redact()` from the fetch package.
  **Done:** output contains the redacted override and the path map; a template edit is attributable by hash.
- [ ] **E03-S07-T02 — Missing-file & cycle diagnostics**
  **Do:** missing template file and circular includes produce E01-style diagnostics (file:line, hint), never a raw exception.
  **Ground:** docs/01 §1 diagnostic contract (E01-S01-T03).
  **Done:** snapshot tests for missing-file and cycle cases.
