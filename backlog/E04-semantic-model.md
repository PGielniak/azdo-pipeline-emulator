# E04 — Semantic model (expanded pipeline)

Phase: P2 · Depends on: **E00-S04** (the service expansion supplies `finalYaml`), E01 · Design: docs/01 §3–§6
> *Dependency corrected 2026-08-22 (E12-S01-T02): this line still read `E01, E03` — a reference to a
> locally-computed expansion. E03 is now the offline fallback and this epic's input is the service's
> `finalYaml` (see the re-scope note below); E03 is a dependency only when `--offline-expand` is used.*

Primary grounding set: yaml-schema per-keyword pages (stages/jobs/steps/pool/strategy) · …/process/phases (jobs) · …/process/stages · …/process/deployment-jobs · …/build/variables (predefined) · …/process/variables.

> **Re-scoped by the simplification (docs/07).** The model is now built from the **service's
> normalized `finalYaml`**, not a locally-expanded DOM. The preview endpoint already desugars
> shorthand and wraps implicit structure (measured: `steps:` → `stages: __default` → `job: Job` →
> `task: CmdLine@2`), so part of the old normalization work is delegated. What remains here is the
> **runtime** model: canonical steps, variable scoping, matrix/parallel expansion, and the
> dependency graph.

## E04-S01 — As an engine developer, the expanded pipeline becomes a typed model with invariants, so emission works from guaranteed-clean input.
Acceptance: model types + builder with all invariants from docs/01 §6 enforced and tested.

- [ ] **E04-S01-T01 — Model types & builder**
  **Do:** `packages/engine/src/model/*`: Pipeline/Stage/Job/Step per docs/01 §6; builder from the service's `finalYaml`; single-job/single-stage shorthand → full tree (any case the service leaves unwrapped).
  **Ground:** yaml-schema `pipeline` page (which shorthands exist at root); C-E00-017/018 (the preview's `__default`/`Job`/`CmdLine@2` wrapping).
  **Done:** builder tests: shorthand forms produce identical models to explicit forms.
- [ ] **E04-S01-T02 — Normalization boundary: what the service already desugars**
  **Do:** probe `finalYaml` for a matrix of step shorthands (`script`, `bash`, `pwsh`, `powershell`, `publish`, `download`, `checkout`, `getPackage`) and record which become canonical tasks; implement a `normalize.ts` pass for **only** the remainder.
  **Ground:** the preview expansion is the authority — one redacted probe set under `research/experiments/E04-normalization/`; each row a claim.
  **Done:** table-driven tests; every shorthand either provably desugared by the service or normalized by us with a claim.
- [ ] **E04-S01-T03 — Common step fields normalization**
  **Do:** `name` auto-generation (verify the scheme), `displayName` defaulting, `enabled`, `timeoutInMinutes`, `retryCountOnTaskFailure`, `continueOnError`, `workingDirectory`, `failOnStderr`, `target` parse.
  **Ground:** yaml-schema `steps-task` page field list; auto-name scheme `VERIFY` via a real-run output-variable reference experiment.
  **Done:** field defaulting tests incl. the verified auto-name scheme.

## E04-S02 — As a pipeline developer, variables resolve with the exact scoping/precedence rules of the service, so `$(var)` values match cloud runs.
Acceptance: scoping engine + classification, proven against docs and probes.

- [ ] **E04-S02-T01 — Scope resolution & precedence**
  **Do:** root→stage→job layering, list-order override semantics, mapping vs list forms, `readonly` flag carried to manifest/runtime.
  **Ground:** variables doc "Variable scope"/precedence sections (quote); oracle probes for list-order overrides mixing `group`/`template`/inline entries.
  **Done:** precedence test matrix; claims cited.
- [ ] **E04-S02-T02 — Variable classification**
  **Do:** classify every referenced variable: inline / group-member (name-only) / predefined / `.env`-required / setvariable-produced (best-effort static scan).
  **Ground:** docs/01 §4; predefined list from …/build/variables page (vendored as data with provenance).
  **Done:** classification snapshots on corpus; unknown-predefined warning path tested.
- [ ] **E04-S02-T03 — Predefined variable table as data**
  **Do:** `packages/engine/data/predefined-vars.json` generated from the docs page, with local-mapping strategy per docs/01 §5.
  **Ground:** …/build/variables page (pin); every row carries the doc anchor.
  **Done:** table covers docs/01 §5 set; scraper re-run produces stable output.

## E04-S03 — As a pipeline developer, matrices, slicing and dependency graphs expand/validate exactly like the service, so job topology is identical locally.
Acceptance: matrix/parallel expansion + graph validation with service-matching defaults.

- [ ] **E04-S03-T01 — Matrix & `parallel` expansion**
  **Do:** matrix → concrete jobs (naming scheme `JobName multiplier` — verify exact format), per-job injected variables; `maxParallel` recorded; `parallel` slicing with `System.JobPositionInPhase`/`System.TotalJobsInPhase`.
  **Ground:** jobs doc (…/process/phases) strategy sections; verify generated job names via a real matrix run in the test org.
  **Done:** expansion tests incl. runtime-expression matrix → warning path per docs/01.
- [ ] **E04-S03-T02 — Dependency graphs & defaults**
  **Do:** stage graph (default **sequential** in YAML order without `dependsOn`) and job graph (default **parallel**), cycle/missing-target errors, empty-`dependsOn: []` semantics.
  **Ground:** stages + jobs doc dependency sections (quote the differing defaults); error phrasing via oracle probes with a missing dependency.
  **Done:** graph tests for defaults, cycles, missing refs; claims cited.
- [ ] **E04-S03-T03 — Deployment job model (runOnce)**
  **Do:** `deployment` kind, `environment` parse (name, resourceName, resourceType), runOnce hook sequence model, implicit artifact auto-download flag, output-variable naming quirks recorded on the model.
  **Ground:** deployment-jobs doc (quote hook order, auto-download, output-variable naming); the naming quirk verified by real-run experiment reading `stageDependencies`.
  **Done:** model tests; quirk claims cited; rolling/canary reserved but unimplemented (E08).
- [ ] **E04-S03-T04 — `manifest.json` serializer**
  **Do:** versioned schema per docs/04 §11; includes fidelity/warnings/env/tools aggregation hooks (filled by E07/E08).
  *Pointer added 2026-08-22 (E12-S01-T02): the manifest is also where the **expansion mode** is recorded — E12-S01-T01 already returns a typed `ExpansionManifestEntry` (`service` + api-version/pipelineId/hashes, or `offline` + `degraded: true`) from `resolveExpansion()` with no writer to serialize it. Serializing it is this task's, not new scope; see docs/06 §5 decision 42(b) for the one interaction to handle — an offline re-convert of a service-expanded project leaves a stale `expansion` lockfile entry under the same request hash.*
  **Ground:** docs/04 §11 shape as spec; JSON-schema for the manifest committed.
  **Done:** golden manifests for corpus; schema validation in tests.
