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

- [!] **E12-S01-T01 — Gate the compile-time engine behind `--offline-expand`** *(Partial 2026-08-22: the gate is built — `resolveExpansion()` in `packages/fetch/src/expansion-source.ts` is the single seam that chooses the service (default, via `expandCached`) or the retained local engine, plus the `--offline-expand` flag on `convert`, the unconditional degraded warning, and a discriminated `ExpansionManifestEntry` for E05 to serialize. **Blocked 2026-08-22 on two Done items:** (1) "`--offline-expand` still produces an expanded pipeline" — there is no whole-document offline expander in `src/`: the engine's directive visitors are driven end-to-end only by the test harness `packages/engine/test/template/fixture-harness.ts`, and promoting it is **E03-S04-T02**'s "Expanded-YAML emitter + provenance map". The offline arm is therefore an injected port whose default binding refuses with a message naming that task. (2) "records the choice in the manifest" — no manifest writer exists anywhere (**E05**); the entry is returned typed instead of written. Also deferred: the end-to-end "default path never invokes the local engine" assertion through `convert`, whose body still throws `NotImplementedError` (**E10-S02-T01** owns convert wiring); asserted at the seam instead. Evidence: `packages/fetch/test/expansion-source.test.ts` (12), `packages/cli/test/program.test.ts` (3 + help snapshot); docs/06 §5 decision 42; docs/05 §4; docs/06 §1.)*
  **Do:** `convert` calls the preview expansion (E00-S04) by default; add an `--offline-expand` flag that invokes the retained local expression evaluator + template engine (old E02/E03) and records the choice in the manifest; document it as a degraded fallback.
  **Ground:** PLAN D3/D4/D6; docs/07 §6.
  **Done:** default path never invokes the local engine (asserted); `--offline-expand` still produces an expanded pipeline from the existing unit tests; a warning is emitted on the fallback path.
- [x] **E12-S01-T02 — Mark superseded tasks `[~]` (bookkeeping sweep)** *(done 2026-08-22: six tasks demoted `[~]` — E03-S02-T03/T04 (`extends`, `templateContext`), E03-S03-T01/T02 (compile-time variable visibility), E03-S04-T01 (server limits), E03-S05-T02 (`preview-diff`) — each with a one-line pointer to the service path or the fallback. Two E03 tasks were deliberately **not** demoted and say why: S04-T02 is the offline fallback's missing entry point (the only consumer of E12-S01-T01's `--offline-expand` port) and S04-T03 re-points at the service's `finalYaml`. Story-level notes added to E03-S01/S02/S04/S05; **no built-but-unchecked checkbox was flipped** — the sweep marks scope, not completed work, and cannot certify another lane's Done criteria. E02 yielded nothing to mark (all `[x]`); that finding is recorded in its header rather than left as a silent gap. E04's stale `Depends on: E01, E03` corrected to E00-S04/E01 (+ the BACKLOG §4 row), a manifest-expansion pointer added to E04-S03-T04, and E01-S02-T02's blocker narrowed from "E00-S04" to "E10-S02-T01 convert wiring". `grep -rn '^- \[~\]' backlog/` is 9 lines.)*
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
