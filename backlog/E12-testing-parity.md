# E12 — Testing & parity program

Phase: cross-cutting (starts P0) · Depends on: E00 · Design: docs/06 §3
Primary grounding set: the oracle (preview API) and real runs in the test org are themselves the grounding instruments; this epic builds and operates them. Layer numbering = docs/06 §3.

## E12-S01 — As a contributor, test infrastructure exists from day one, so every epic lands with its tests.
- [x] **E12-S01-T01 — Test layout & runners** *(done 2026-08-11. Root `vitest.config.ts`: five named projects — `cli`/`engine`/`emit`/`fetch` over the pre-existing `packages/*/test/**/*.test.ts` layout, plus `repo` for `test/test-layout.test.ts` — and v8 coverage with per-package glob thresholds seeded from measured coverage (ratchet, table in `research/E12-testing-parity.md`). bats harness: `packages/runtime/test/helpers/fixture-store.bash` (repo/runtime/fixture paths, `BATS_TEST_TMPDIR`-scoped scratch dirs, copy-on-use fixtures from `fixtures/runtime/`, runtime loader), 9 cases exercising every helper. `pnpm test` = vitest **with coverage** + bats; CI runs the same and uploads coverage alongside the junit reports; `lint:shell` extended to the helpers. **Measured, not assumed** (C-E12-005/008): a threshold glob that matches nothing passes silently with exit 0 — so the meta-test asserts every glob still matches source, and it was mutation-tested.)*
  **Do:** vitest projects per package; bats harness for `packages/runtime` with fixture-store helpers; `pnpm test` orchestrates all; coverage thresholds per package.
  **Ground:** bats-core docs (pin) for helper patterns; internal spec docs/06 §3.
  **Done:** skeleton suites run in CI (E00-S01-T02).
- [x] **E12-S01-T02 — Fixture corpus v1 (authoring)** *(done 2026-08-11. Ten entries under `fixtures/corpus/<entry>/` (`pipeline.yml` + `templates/*.yml` + a README naming what it exercises), ten `finalYaml` pairs under `fixtures/oracle/` + `MANIFEST.json` binding each pair to the input hash it was fetched for. Harness: `scripts/corpus.ts` (catalogue), `scripts/corpus-oracle.ts` (push templates → preview → store, `pnpm corpus-oracle`), `scripts/azdo-repo.ts`, `scripts/oracle-provision.ts`. The pairing rule is enforced by `test/corpus.test.ts` (36 tests), not just stated. **The layout is dictated by a measured fact** (C-E12-011): a `yamlOverride` resolves templates as though it were the definition's own file, from the **repo**, so `fixtures/corpus/` mirrors the oracle repo's `/corpus/` and references are root-absolute. Findings worth reading before E03/E09 work: matrix is **not** expanded by the service (C-E12-018), `- group:` never inlines values (C-E12-016), shortcut steps desugar to task **GUIDs** — `checkout`/`download` ones unresolvable in the task catalogue (C-E12-019/020), and expansions are byte-stable (C-E12-022).)*
  **Do:** author the first 10 corpus pipelines patterned on docs/06 §3 shapes (nested templates, extends+each, matrix, artifact hand-off, deployment runOnce, multi-checkout…); each with a README stating what it exercises.
  **Ground:** every corpus file must be **accepted by the real service** — submit via preview; store `finalYaml`; a corpus entry without its oracle pair is invalid.
  **Done:** 10 pairs committed under `fixtures/corpus/` + `fixtures/oracle/`.

## E12-S02 — As an engine developer, table-driven conformance suites encode every grounded claim, so regressions name the claim they broke.
- [ ] **E12-S02-T01 — Claim-linked test convention & tooling**
  **Do:** test-name convention embedding claim IDs (`[C-E02-014]`); script listing claims ↔ tests coverage (claims without tests reported).
  **Ground:** BACKLOG §3; the tool output itself becomes part of review.
  **Done:** report runs in CI; E02 tables adopt the convention first.
- [ ] **E12-S02-T02 — Expansion golden harness (L2)**
  **Do:** snapshot runner: corpus in → expanded out; update flow gated behind `--update` with mandatory oracle re-verification.
  **Ground:** goldens are only valid when their oracle pair exists (E12-S01-T02 rule); the `--update` path must re-fetch `finalYaml` via the preview endpoint (pinned in E00-S03) — a golden without a fresh oracle pair is rejected by the harness itself.
  **Done:** corpus goldens green; mutation test (engine bug injection) fails loudly; update-without-oracle path proven to fail.

## E12-S03 — As the project owner, nightly oracle runs detect parity drift within a day, so service changes never surprise users.
- [ ] **E12-S03-T01 — Nightly `preview-diff` workflow (L3)**
  **Do:** enable the E00 CI job: corpus × preview-diff vs test org; failure artifact = normalized diffs; alerting via CI notifications.
  **Ground:** preview endpoint page (pinned in E00-S03); org PAT rotation documented in the runbook.
  **Done:** first scheduled run green; simulated drift (hand-edited fixture) alerts correctly.
- [ ] **E12-S03-T02 — Drift triage runbook**
  **Do:** `research/drift-runbook.md`: classify (our bug vs service change), fixture-first fix rule (every drift becomes a permanent fixture), claim updates.
  **Ground:** the runbook's classification step requires re-running the oracle (preview endpoint) and citing the diff artifact; service-change verdicts must additionally link the Azure DevOps release notes page (learn.microsoft.com/azure/devops/release-notes/ — verify & pin) checked for the change.
  **Done:** runbook exercised once on a synthetic drift, producing a filed fixture + claim update.

## E12-S04 — As a pipeline developer, the generated projects are proven end-to-end in clean environments, so "works on the author's machine" can't ship.
- [ ] **E12-S04-T01 — Docker E2E images & harness (L5)**
  **Do:** minimal images approximating hosted toolsets (base + dotnet, + node, + docker-in-docker variant); harness: convert fixture app pipelines → run → assert artifacts/exit codes/log markers.
  **Ground:** actions/runner-images `images/ubuntu` manifest (pin) as the reference for what "hosted" contains — image contents chosen against it, gaps documented.
  **Done:** 3 sample-app pipelines green in CI containers.
- [ ] **E12-S04-T02 — Runtime conformance suite growth (L4 umbrella)**
  **Do:** consolidate E06 bats into a tagged conformance suite runnable standalone (`pnpm test:runtime`); macOS leg in CI.
  **Ground:** suite inherits the E06 claim links (every test carries its claim ID per E12-S02-T01); the consolidation must not orphan any claim — the claims↔tests report is the gate.
  **Done:** suite badge in README; runs < 5 min; claims↔tests report shows zero orphans.

## E12-S05 — As the project owner, selected behaviors are verified against real cloud runs, so runtime claims (not just compile-time) are proven.
- [ ] **E12-S05-T01 — Real-run harness (L6)**
  **Do:** scripts to queue a fixture pipeline in the test org, wait, download logs + artifacts (REST), and extract comparable facts (step results sequence, produced variables via a dump step, artifact hashes); comparator vs local run of the same fixture.
  **Ground:** Build/Pipelines REST pages for queue+logs (pin + live samples); this harness is the instrument behind many `VERIFY` items across epics (E02 contexts, E06 macro/env experiments) — link them.
  **Done:** one fixture compared end-to-end with report; manual-trigger CI job wired.
- [ ] **E12-S05-T02 — Release gate definition**
  **Do:** document the release checklist: L1–L4 green, L3 nightly green ≥ 3 consecutive days, L5 green, L6 spot-check on majors; encode as a checklist template.
  **Ground:** each checklist line links the CI job/artifact that proves it (oracle nightly run URL, L6 comparison report) — the gate is evidence-based by construction; template reviewed against BACKLOG §3.
  **Done:** first release candidate walks the checklist with all evidence links resolving.
