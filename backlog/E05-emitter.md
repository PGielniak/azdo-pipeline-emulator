# E05 — Emitter: generated project & scripts

Phase: P2 · Depends on: E04, E06 (runtime contract), E09 (handlers) · Design: docs/04 §1–§2, §10–§12
Primary grounding set: docs/04 as internal spec · variables doc (env-var name transform) · logging-commands doc · GNU bash manual for emitted-code semantics · fidelity claims from handler research (E09/E10).

## E05-S01 — As a pipeline developer, `convert` writes a navigable project mirroring my pipeline, so I can find any step by eye.
Acceptance: output tree per docs/04 §1 generated deterministically.

- [ ] **E05-S01-T01 — Project scaffolder**
  **Do:** `packages/emit/src/scaffold.ts`: tree creation, `NNN-` numbering with gaps, slug rules (displayName → fs-safe), collision handling, `.gitignore`, deterministic ordering (stable across runs for clean diffs).
  **Ground:** docs/04 §1 tree as spec; slug edge cases validated against real pipelines in corpus (unicode/emoji displayNames — record observed ADO UI behavior for weird names in research note).
  **Done:** golden-tree tests on corpus; re-convert produces zero diff.
- [ ] **E05-S01-T02 — Step script emission**
  **Do:** header block (displayName, provenance chain from expansion-map, condition source, fidelity, warnings), body from handler `EmittedStep.body` with macros left intact, `set -euo pipefail` policy, `source runtime.sh` preamble.
  **Ground:** docs/04 §12 sample as spec; macro-preservation requirement traced to variables doc macro section claim (created in E06-S02-T01) — reference that claim ID here.
  **Done:** emitted corpus scripts pass shellcheck; headers snapshot-tested.
- [ ] **E05-S01-T03 — `run-job.sh` / `run-stage.sh` / `run.sh` emission**
  **Do:** per-job sequencer invoking `run_step` with metadata args (docs/04 §5 signature); per-job `conditions.sh` from E02-S05 compiler; root orchestrator with topological order from E04 graphs; flags per docs/04 §2 (`--from-step --to-step --only-step --resume --no-condition --list`).
  **Ground:** docs/04 §2–§3 as spec; ordering semantics claims from E04-S03-T02 (cite IDs).
  **Done:** bats E2E on a fixture project: full run, partial run, `--only-step`, `--list` output snapshot.

## E05-S02 — As a pipeline developer, everything unresolvable lands in a documented `.env.example`, so I know exactly what to fill and why.
Acceptance: synthesis per docs/04 §10 with per-entry provenance comments.

- [ ] **E05-S02-T01 — `.env.example` synthesizer**
  **Do:** sections in docs/04 §10 order; entries fed by E04 classification + handler `envRequired`; provenance comments ("used by <stage/job/step>", "from group '<name>'"); secret flags to manifest for masking.
  **Ground:** docs/04 §10; `SYSTEM_ACCESSTOKEN` filling instructions grounded in the OAuth/PAT docs (pin the page that documents `az account get-access-token --resource 499b84ac-…`; verify GUID from official docs page — claim required).
  **Done:** corpus `.env.example` snapshots; lint: no entry without provenance comment.
- [ ] **E05-S02-T02 — Generated README + warnings report**
  **Do:** README generator: conversion summary, fidelity table per step, warnings list, `.env` how-to, run instructions, tool prereqs (from manifest), coverage summary embed (E07).
  **Ground:** docs/04 §12; content assembled only from manifest data (no free text at emit time) — guarantees claims travel from handlers.
  **Done:** README snapshot for corpus; broken-link check over generated links.

## E05-S03 — As a pipeline developer, run-number and identity variables behave like the service, so `Build.BuildNumber`-dependent logic works.
Acceptance: `name:` format evaluation + counters local semantics.

- [ ] **E05-S03-T01 — Run-number formatter**
  **Do:** `name:` format evaluation at run start (emitted into runtime init): `$(Date:yyyyMMdd)`, `$(Rev:.r)`, variable tokens, literal text; `Build.BuildId` monotonic local counter.
  **Ground:** run-number doc (learn.microsoft.com/azure/devops/pipelines/process/run-number) — quote token table incl. `Rev` reset semantics; local deviation (Rev per local state) documented as delta claim.
  **Done:** formatter tests per token; runtime integration test shows `Build.BuildNumber` set before first step.
