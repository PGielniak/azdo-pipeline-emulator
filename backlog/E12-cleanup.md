# E12 — Cleanup & demotion of the v1 reimplementation

Phase: P1 · Depends on: E00-S04 (S01-T01 gates the engine behind the expansion path) · Design: docs/07 (the simplification review)
Primary grounding set: docs/07 is the authority; the repo's own rule 5 (docs/06 §5 dated decisions) and rule 3 (mark `[~]`, never delete) govern the bookkeeping.

> **This epic is the deliberate counterpart of the re-orientation.** The simplification (docs/07)
> keeps the completed reimplementation as an *offline fallback* and removes a large amount of
> *planned* (not-yet-built) scope. This epic makes that demotion concrete and records the revisited
> decisions. It is scheduled **first** (P1) so the reimplementation is off the critical path before
> new work builds on the wrong foundation.
>
> **Reconciliation update (2026-08-22, after rebasing onto the parallel E03/E06 work):** the local
> template engine (E03-S01..S05) and bash runtime (E06) are now **substantially complete** — not
> merely planned — so they are retained as the *offline fallback* rather than reimplemented from
> scratch, and the `[~]` sweep below marks scope, not completed work. The old E14 fidelity epic was
> folded: real-task mode → E07, the rest (container jobs, sandbox, `--parallel`, `--shell-at`)
> deferred here.

## E12-S01 — As the project owner, the reimplementation is retained as a fallback, not deleted, and is off the critical path.
Acceptance: `convert` uses the service by default; the retained engine is reachable only behind an explicit flag.

- [ ] **E12-S01-T01 — Gate the compile-time engine behind `--offline-expand`**
  **Do:** `convert` calls the preview expansion (E00-S04) by default; add an `--offline-expand` flag that invokes the retained local expression evaluator + template engine (old E02/E03) and records the choice in the manifest; document it as a degraded fallback.
  **Ground:** PLAN D3/D4/D6; docs/07 §6.
  **Done:** default path never invokes the local engine (asserted); `--offline-expand` still produces an expanded pipeline from the existing unit tests; a warning is emitted on the fallback path.
- [ ] **E12-S01-T02 — Mark superseded tasks `[~]` (bookkeeping sweep)**
  **Do:** in the epic files, mark with `[~]` + a one-line pointer the tasks whose scope is demoted: old E02 compile-time evaluation entry points, old E03 template-engine stories (walker/conditionals/each/insert/normalizer/visibility/limits), and any E04/E05 references to a locally-computed expansion. Add the same pointers to CHANGELOG-BACKLOG.md.
  **Ground:** docs/07 §6 table (what is cut/deferred); BACKLOG rule 3 (`[~]`, never delete).
  **Done:** every demoted task carries a `[~]` note naming its replacement or the fallback; `grep -n '\[\~\]' backlog/` is reviewable in one pass.

## E12-S02 — As the project owner, the non-v1 product surface is removed from the active path.
Acceptance: no `--min-coverage`, sandbox-by-default, or per-task transpiler remains a live requirement.

- [ ] **E12-S02-T01 — Replace the coverage report with a warnings list**
  **Do:** remove the coverage emitter + `--min-coverage` gate (old D10/E07); the generated README carries the warnings/unsupported list and per-step fidelity labels (E05-S02-T02).
  **Ground:** PLAN D10; docs/07 §6.
  **Done:** no coverage files are emitted; `--min-coverage` is gone from the CLI and docs.
- [ ] **E12-S02-T02 — Demote sandbox-by-default and faithful-workspace**
  **Do:** default to host execution and a shared workspace; annotate (not delete) the D9/D11 sandbox and per-job-workspace design text as deferred; remove them from the P2 exit criteria.
  **Ground:** PLAN D8/D9; docs/07 §6.
  **Done:** `convert` emits host/shared-workspace defaults; the deferred notes are recorded in docs/06 §5.
- [ ] **E12-S02-T03 — Drop the per-task transpiler registry (old E09/E11)**
  **Do:** archive/annotate the task-registry-core and task-breadth plans; confirm real-task mode + stubs (E07) are the only task paths referenced by E05/E06.
  **Ground:** PLAN D4; docs/07 §5.
  **Done:** no epic references a per-task transpiler; `grep -rni transpil backlog/ PLAN.md` returns only historical/annotation hits.

## E12-S03 — As the project owner, the docs and decisions record reflect the re-orientation.
Acceptance: every revisited decision has a dated docs/06 §5 entry; the design docs no longer describe the v1 architecture as current.

- [ ] **E12-S03-T01 — Sync the design docs (docs/01–06)**
  **Do:** update or annotate docs/01–06 so the current architecture (server-expanded, script-native, real-task mode) is described as *the* plan, and superseded v1 sections are marked "(superseded by docs/07)".
  **Ground:** PLAN.md (revised) + docs/07; CLAUDE.md rule 5 (docs are load-bearing).
  **Done:** a reviewer reading any design doc finds no unannotated v1-only claim on the active path.
- [ ] **E12-S03-T02 — Dated decision entries for the revisits**
  **Do:** add dated entries to docs/06 §5 for each revisited decision: D3 (server-expanded), D4 (script-native + real-task mode), D6 (compile-time half delegated), D8 (shared workspace), D9 (host default), D10 (warnings list, no metric). Reference docs/07 in each.
  **Ground:** docs/07 §6; docs/06 §5's own format.
  **Done:** the decisions record lists the six revisits with dates and pointers; CLAUDE.md rule 2's "decisions already made" list is updated to the new set.
