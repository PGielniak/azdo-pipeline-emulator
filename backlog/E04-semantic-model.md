# E04 — Semantic model & normalization

Phase: P1–P2 · Depends on: E03 · Design: docs/01 §3–§6
Primary grounding set: yaml-schema per-keyword pages (stages/jobs/steps/pool/strategy) · …/process/phases (jobs) · …/process/stages · …/process/deployment-jobs · …/build/variables (predefined) · …/process/variables.

## E04-S01 — As an engine developer, the expanded DOM becomes a typed model with invariants, so emission works from guaranteed-clean input.
Acceptance: model types + builder with all invariants from docs/01 §6 enforced and tested.

- [ ] **E04-S01-T01 — Model types & builder**
  **Do:** `packages/engine/src/model/*`: Pipeline/Stage/Job/Step per docs/01 §6; builder from expanded DOM; single-job/single-stage shorthand normalization to full tree.
  **Ground:** yaml-schema `pipeline` page (which shorthands exist at root) — claims for each shorthand normalization.
  **Done:** builder tests: shorthand forms produce identical models to explicit forms.
- [ ] **E04-S01-T02 — Step shorthand → canonical task table**
  **Do:** implement docs/01 §3 normalization table (`script→CmdLine@2`, `bash→Bash@3`, `pwsh/powershell→PowerShell@2`, `publish/download/downloadBuild/getPackage→` tasks, checkout internal).
  **Ground:** each yaml-schema `steps-*` keyword page states the backing task and input mapping — quote per row (e.g. steps-script, steps-bash, steps-publish, steps-download pages). Any row the docs don't state → verify by inspecting a real run's log header (task name/version shown) in the test org; transcript recorded.
  **Done:** table-driven tests; each row's test names its claim ID.
- [ ] **E04-S01-T03 — Common step fields normalization**
  **Do:** `name` auto-generation rules (unnamed steps get generated identifiers — verify scheme), `displayName` defaulting, `enabled`, `timeoutInMinutes`, `retryCountOnTaskFailure`, `continueOnError`, `workingDirectory`, `failOnStderr`, `target` parse.
  **Ground:** yaml-schema `steps-task` page field list; auto-name scheme: `VERIFY` via real-run output-variable reference experiment (what name does an unnamed step get?) — experiment stored.
  **Done:** field defaulting tests incl. the verified auto-name scheme.

## E04-S02 — As a pipeline developer, variables resolve with the exact scoping/precedence rules of the service, so `$(var)` values match cloud runs.
Acceptance: scoping engine + classification, proven against docs and probes.

- [ ] **E04-S02-T01 — Scope resolution & precedence**
  **Do:** root→stage→job layering, list-order override semantics, mapping vs list forms, `readonly` flag carried to manifest/runtime.
  **Ground:** variables doc "Variable scope"/precedence sections (quote); oracle probes for list-order overrides mixing `group`/`template`/inline entries (values unknown for groups, but ordering effect on inline duplicates is testable) — transcripts.
  **Done:** precedence test matrix; claims cited.
- [ ] **E04-S02-T02 — Variable classification**
  **Do:** classify every referenced variable: inline / group-member (name-only) / predefined / `.env`-required / setvariable-produced (from prior steps, best-effort static scan for manifest hints).
  **Ground:** docs/01 §4; predefined list from …/build/variables page (vendored as data with provenance, refresh script).
  **Done:** classification snapshots on corpus; unknown-predefined warning path tested.
- [ ] **E04-S02-T03 — Predefined variable table as data**
  **Do:** `packages/engine/data/predefined-vars.json` generated from the docs page (scraper script + manual review), with local-mapping strategy per docs/01 §5.
  **Ground:** …/build/variables page (pin; note agent-version caveats on the page); every row carries the doc anchor.
  **Done:** table covers docs/01 §5 set; scraper re-run produces stable output.

## E04-S03 — As a pipeline developer, matrices, slicing and dependency graphs expand/validate exactly like the service, so job topology is identical locally.
Acceptance: matrix/parallel expansion + graph validation with service-matching defaults.

- [ ] **E04-S03-T01 — Matrix & `parallel` expansion**
  **Do:** matrix → concrete jobs (naming scheme `JobName multiplier` — verify exact display/name format), per-job injected variables; `maxParallel` recorded; `parallel` slicing with `System.JobPositionInPhase`/`System.TotalJobsInPhase`.
  **Ground:** jobs doc (…/process/phases) strategy sections — quote naming and injected-variable behavior; verify generated job names via a real matrix run in the test org (they appear in the run UI/logs) — transcript.
  **Done:** expansion tests incl. matrix-from-compile-time-expression; runtime-expression matrix → warning path per docs/01.
- [ ] **E04-S03-T02 — Dependency graphs & defaults**
  **Do:** stage graph (default: **sequential** in YAML order without `dependsOn`) and job graph (default: **parallel**), cycle/missing-target errors, empty-`dependsOn: []` semantics.
  **Ground:** stages doc + jobs doc dependency sections (quote the differing defaults — this asymmetry is a classic bug source); error phrasing via oracle probes with a missing dependency.
  **Done:** graph tests for defaults, cycles, missing refs; claims cited.
- [ ] **E04-S03-T03 — Deployment job model (runOnce)**
  **Do:** `deployment` kind, `environment` parse (name, resourceName, resourceType), runOnce hook sequence model, implicit artifact auto-download flag, output-variable naming quirks recorded on the model.
  **Ground:** deployment-jobs doc (quote hook order, auto-download statement, output-variable naming section); the naming quirk additionally verified by real-run experiment reading `stageDependencies` (E02-S04-T02 experiment can cover it).
  **Done:** model tests; quirk claims cited; rolling/canary reserved fields present but unimplemented (E10).
- [ ] **E04-S03-T04 — `manifest.json` serializer**
  **Do:** versioned schema per docs/04 §11; includes fidelity/warnings/env/tools aggregation hooks (filled by E09 handlers).
  **Ground:** docs/04 §11 shape as spec; JSON-schema for the manifest committed so external tools can validate.
  **Done:** golden manifests for corpus; schema validation in tests.
