# E11 — Testing & parity harness

Phase: cross-cutting (starts P1) · Depends on: E00 · Design: docs/06 §3
Primary grounding set: the preview API and real runs in the test org are themselves the grounding instruments; this epic builds and operates them. Layer numbering = docs/06 §3.

> **Re-scoped by the simplification (docs/07).** There is no local expansion engine to diff, so the
> old "expansion golden" and "`preview-diff`" layers are replaced: the **service's `finalYaml` is the
> golden**, and the nightly job re-expands the corpus and converts + runs it as a regression check
> against service drift. Real-run verification (L6) remains, because runtime claims still need it.

## E11-S01 — As a contributor, test infrastructure exists from day one, so every epic lands with its tests.
- [x] **E11-S01-T01 — Test layout & runners**
  **Do:** vitest projects per package; bats harness for `packages/runtime` with fixture-store helpers; `pnpm test` orchestrates all; coverage thresholds per package.
  **Ground:** bats-core docs (pin) for helper patterns; internal spec docs/06 §3.
  **Done:** skeleton suites run in CI (E00-S01-T02).
- [x] **E11-S01-T02 — Fixture corpus v1 (authoring)**
  **Do:** author the first 10 corpus pipelines patterned on docs/06 §3 shapes; each with a README stating what it exercises.
  **Ground:** every corpus file must be **accepted by the real service** — submit via preview; store `finalYaml`; a corpus entry without its oracle pair is invalid.
  **Done:** 10 pairs committed under `fixtures/corpus/` + `fixtures/oracle/`.
- [ ] **E11-S01-T03 — Run the bats suite under bash ≥ 4 on macOS CI** *(filed 2026-08-22 by E03-S02-T05, which exposed it: with the macOS vitest step green for the first time, the job reached the bats step and failed there.)*
  **Do:** `.github/workflows/ci.yml` invokes `bats test` directly, so on `macos-latest` the suite runs under the system `/bin/bash` — **3.2**, from 2007. `packages/runtime/lib/core.sh` uses bash-4 syntax (`${value,,}` at line ~3057 and `${repository,,}` at ~3605), which 3.2 rejects outright: `bad substitution`, ~30 failing tests across the `.env` loader, artifacts and every `azdo_checkout` mode. Install a modern bash on the macOS runner (`brew install bash`) and put it ahead of `/bin/bash` for the bats step (or point bats at it), so the suite runs on the version the project targets. **Do not** rewrite the runtime to bash 3.2: `bash ≥ 4` is a documented convention (CLAUDE.md tech conventions, docs/04) and lowering it silently would be a decision, not a fix — if it is ever revisited it needs a docs/06 §5 entry.
  **Ground:** CLAUDE.md tech conventions + docs/04's runtime prerequisites for the `bash >= 4` floor; the GitHub-hosted macOS runner image manifest (`actions/runner-images`, commit-pinned) for which bash versions are present and at what paths; bats-core docs for how the suite selects its interpreter. Failure evidence is on file: CI run 32603458075, macOS jobs.
  **Done:** all four CI jobs green on a PR — `macos-latest` bats included; the workflow states which bash it runs and why, so the next reader does not re-derive it; no runtime source is downgraded to 3.2 syntax.

## E11-S02 — As an engine developer, table-driven conformance suites encode every grounded claim, so regressions name the claim they broke.
- [ ] **E11-S02-T01 — Claim-linked test convention & tooling**
  **Do:** test-name convention embedding claim IDs (`[C-E05-014]`); script listing claims ↔ tests coverage (claims without tests reported).
  **Ground:** BACKLOG §3; the tool output itself becomes part of review.
  **Done:** report runs in CI; E06/E02 tables adopt the convention first.
- [ ] **E11-S02-T02 — Runtime-project golden harness (L2)**
  **Do:** snapshot runner: pinned `finalYaml` in → emitted project out; assert deterministic, shellcheck-clean output; update flow gated behind `--update` with mandatory re-fetch of `finalYaml`.
  **Ground:** goldens are only valid when their oracle pair exists (E11-S01-T02 rule); the `--update` path must re-fetch `finalYaml` via the preview endpoint (E00-S04) — a golden without a fresh oracle pair is rejected by the harness.
  **Done:** corpus goldens green; mutation test (emitter bug injection) fails loudly; update-without-oracle path proven to fail.

## E11-S03 — As the project owner, nightly runs detect service drift within a day, so service changes never surprise users.
- [ ] **E11-S03-T01 — Nightly re-expansion + convert smoke (L3)**
  **Do:** enable the E00 CI job: re-expand the corpus against the test org, assert `finalYaml` byte-stability, then convert + run each fixture and compare exit codes; failure artifact = the diff + logs.
  **Ground:** preview endpoint page (pinned in E00-S03); org PAT rotation documented in the runbook.
  **Done:** first scheduled run green; simulated drift (hand-edited fixture) alerts correctly.
- [ ] **E11-S03-T02 — Drift triage runbook**
  **Do:** `research/drift-runbook.md`: classify (our bug vs service change), fixture-first fix rule (every drift becomes a permanent fixture), claim updates.
  **Ground:** the classification step requires re-running the oracle (preview endpoint); service-change verdicts must additionally link the Azure DevOps release notes page (verify & pin) checked for the change.
  **Done:** runbook exercised once on a synthetic drift, producing a filed fixture + claim update.

## E11-S04 — As a pipeline developer, the generated projects are proven end-to-end in clean environments, so "works on the author's machine" can't ship.
- [ ] **E11-S04-T01 — Docker E2E images & harness (L5)**
  **Do:** minimal images approximating hosted toolsets (base + dotnet, + node, + docker-in-docker variant); harness: convert fixture pipelines → run → assert artifacts/exit codes/log markers.
  **Ground:** actions/runner-images `images/ubuntu` manifest (pin) as the reference for what "hosted" contains; gaps documented.
  **Done:** 3 sample-app pipelines green in CI containers.
- [ ] **E11-S04-T02 — Runtime conformance suite growth (L4 umbrella)**
  **Do:** consolidate E06 bats into a tagged conformance suite runnable standalone (`pnpm test:runtime`); macOS leg in CI.
  **Ground:** suite inherits the E06 claim links (every test carries its claim ID per E11-S02-T01); the claims↔tests report is the gate.
  **Done:** suite badge in README; runs < 5 min; claims↔tests report shows zero orphans.

## E11-S05 — As the project owner, selected behaviors are verified against real cloud runs, so runtime claims (not just expansion) are proven.
- [ ] **E11-S05-T01 — Real-run harness (L6)**
  **Do:** scripts to queue a fixture pipeline in the test org, wait, download logs + artifacts (REST), and extract comparable facts (step results sequence, produced variables via a dump step, artifact hashes); comparator vs local run of the same fixture.
  **Ground:** Build/Pipelines REST pages for queue+logs (pin + live samples); this harness is the instrument behind many `VERIFY` items across epics (E02 contexts, E06 macro/env experiments).
  **Done:** one fixture compared end-to-end with report; manual-trigger CI job wired.
- [ ] **E11-S05-T02 — Release gate definition**
  **Do:** document the release checklist: L1–L4 green, L3 nightly green ≥ 3 consecutive days, L5 green, L6 spot-check on majors; encode as a checklist template.
  **Ground:** each checklist line links the CI job/artifact that proves it; the gate is evidence-based by construction.
  **Done:** first release candidate walks the checklist with all evidence links resolving.
