# E07 — Coverage report

Phase: P2 · Depends on: E04 (manifest), E05 (emission) · Design: docs/04 §13, PLAN D10
Primary grounding set: docs/04 §13 (internal spec) · fidelity claims recorded by task handlers (E09/E10/E11) — coverage numbers are only as honest as those claims, so this epic's grounding requirement is **traceability into handler evidence**.

## E07-S01 — As a pipeline developer, every conversion tells me what % of my pipeline the project reproduces, so I can trust (or distrust) the local run at a glance.
Acceptance: metric per docs/04 §13 computed from manifest data only.

- [ ] **E07-S01-T01 — Metric engine**
  **Do:** `packages/emit/src/coverage.ts`: unit = unique emitted step (matrix collapse by provenance hash); weights exact/equivalent 1.0, degraded 0.5, stub/unsupported 0; structural caps (enclosing construct tier caps contained steps); denominator exclusions (triggers/schedules/approvals/lockBehavior) listed, never silently dropped.
  **Ground:** docs/04 §13 spec; **traceability rule**: the engine must read tier values only from manifest entries that carry a `fidelityClaim` reference (added to handler output in E09-S01-T01) — a step without a claim reference computes as `stub` and raises a build-time warning. This mechanically enforces "no unproven coverage".
  **Done:** unit tests: weighting, caps, matrix collapse, exclusion listing, missing-claim degradation.
- [ ] **E07-S01-T02 — `coverage.md` + `coverage.json` renderers**
  **Do:** headline % + tier histogram; per-stage/job table; ranked gap list with remediation strings sourced from handler warnings; excluded-constructs list; JSON mirror with schema.
  **Ground:** docs/04 §13 content list; remediation strings must come from handler `warnings[].remediation` (grounded at handler level) — renderer adds no free text.
  **Done:** snapshots on corpus incl. a pipeline with stubs and a 100% pipeline; JSON schema validated.
- [ ] **E07-S01-T03 — CLI integration: one-liner + `--min-coverage`**
  **Do:** convert-end summary line; threshold gate exit code 3; `coverage: {min}` config key.
  **Ground:** docs/06 §1 exit-code conventions.
  **Done:** CLI e2e: below/above threshold; `--json` includes coverage block.

## E07-S02 — As the project owner, coverage numbers stay honest over time, so the metric never rots into marketing.
Acceptance: calibration + drift guards.

- [ ] **E07-S02-T01 — Corpus calibration & snapshot**
  **Do:** compute coverage across corpus; review each score manually once against the gap lists (sanity: does 85% *feel* like 85%?); snapshot results; CI fails on unexplained deltas.
  **Ground:** review notes in `research/E07-calibration.md` linking every disputed tier back to its handler claim; disagreements fixed at the handler claim, not by tweaking weights.
  **Done:** calibration note committed; snapshot guard in CI.
- [ ] **E07-S02-T02 — Fidelity-claim audit tooling**
  **Do:** `azdo-emu coverage --audit <outdir>` (or dev script) listing every step → tier → claim ID → source link; broken/missing links fail.
  **Ground:** BACKLOG §3 protocol; link-checker over claim URLs.
  **Done:** audit clean on corpus; wired into nightly (E12-S03).
