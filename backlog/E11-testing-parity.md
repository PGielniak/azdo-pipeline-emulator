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
- [x] **E11-S01-T03 — Run the bats suite under bash ≥ 4 on macOS CI** *(done 2026-08-23: `brew install bash` on the macOS runner plus Homebrew's bin prepended via `$GITHUB_PATH` — that is what actually selects the interpreter, since bats' shebang is `#!/usr/bin/env bash` and resolves through PATH. CI logs the choice (`bats will run under /opt/homebrew/bin/bash — GNU bash, version 5.3.15`) and a guard step in front of bats fails with one message naming PLAN D2 if the major version is < 4, because bats itself is content on 3.2 (C-E00-005) so the symptom is otherwise ~30 `bad substitution` failures that read as runtime bugs. **This was a known requirement nobody had built:** C-E00-005 said on 2026-07-30 that "E06 tests must ensure a bash ≥ 4 interpreter on macOS CI"; the claim was right and unimplemented, and unobservable until E03-S02-T05 made the macOS vitest step green. Claims C-E00-028/029 (`macos-latest` = macOS 26 arm64, Bash 3.2.57 only, Homebrew 6.0.13, no second bash) with the image commit-pinned in REFERENCES.md; docs/06 §3 states the L4 interpreter rule. The runtime was **not** downgraded to 3.2 syntax. Done criterion — "all four CI jobs green" — verified by run **32605819867** on PR #24, which also carried E11-S01-T04; the bash fix alone took macOS from ~30 failures to 9.)*
  **Do:** `.github/workflows/ci.yml` invokes `bats test` directly, so on `macos-latest` the suite runs under the system `/bin/bash` — **3.2**, from 2007. `packages/runtime/lib/core.sh` uses bash-4 syntax (`${value,,}` at line ~3057 and `${repository,,}` at ~3605), which 3.2 rejects outright: `bad substitution`, ~30 failing tests across the `.env` loader, artifacts and every `azdo_checkout` mode. Install a modern bash on the macOS runner (`brew install bash`) and put it ahead of `/bin/bash` for the bats step (or point bats at it), so the suite runs on the version the project targets. **Do not** rewrite the runtime to bash 3.2: `bash ≥ 4` is a documented convention (CLAUDE.md tech conventions, docs/04) and lowering it silently would be a decision, not a fix — if it is ever revisited it needs a docs/06 §5 entry.
  **Ground:** CLAUDE.md tech conventions + docs/04's runtime prerequisites for the `bash >= 4` floor; the GitHub-hosted macOS runner image manifest (`actions/runner-images`, commit-pinned) for which bash versions are present and at what paths; bats-core docs for how the suite selects its interpreter. Failure evidence is on file: CI run 32603458075, macOS jobs.
  **Done:** all four CI jobs green on a PR — `macos-latest` bats included; the workflow states which bash it runs and why, so the next reader does not re-derive it; no runtime source is downgraded to 3.2 syntax.
- [x] **E11-S01-T04 — Bats scratch paths must be physical, so macOS's `/var` symlink stops failing path assertions** *(done 2026-08-23: `prepare_checkout()` normalizes its scratch root once and `azdo_emu_scratch_dir()` hands back a physical path, so a test comparing against runtime output is right by default. **No runtime source changed** — the runtime's `pwd -P` is deliberate and correct; the expectations were wrong. **Two further faults surfaced only once the suite ran that far, and neither is named by this task's Do — recorded rather than folded in silently:** (1) a regression from this task's own first commit — `fixture-store.bats` asserted `[[ "$first" == "$BATS_TEST_TMPDIR"/* ]]`, which stops matching once the helper returns the physical path, so the assertion now compares against the physical tmpdir (the helper's contract is the stronger one); (2) `core.bats:1950` compared `wc -l` output with `=`, and **BSD `wc` pads its count with leading spaces** — a portability bug unrelated to paths, fixed with numeric `-eq`, matching line 554's existing form. Done criterion verified by run **32605819867**: all four jobs green, macOS bats included; Linux unaffected (231/231 locally).)*
  **Do:** `prepare_checkout()` in `packages/runtime/test/core.bats` builds its tree from `$BATS_TEST_TMPDIR` verbatim, and on macOS that is `/var/folders/…`, where `/var` is a symlink to `/private/var`. The runtime resolves physically (`cd … && pwd -P`, `core.sh` ~3143/3326/3702 — deliberate, and correct), so every `[ "$(azdo_var 'Build.SourcesDirectory')" = "$checkout_workspace/s" ]` compares `/private/var/…` against `/var/…` and fails. **The expectation is what is wrong, not the runtime:** normalize the scratch root once (`root="$(cd "$root" && pwd -P)"`) and do the same in `azdo_emu_scratch_dir()` (`test/helpers/fixture-store.bash`) so the next test to compare a path against runtime output is right by default. A no-op on Linux.
  **Ground:** internal — no Azure DevOps behavior is involved; the sources are the runtime's own `pwd -P` calls and macOS's documented `/var` → `/private/var` symlink. Failure evidence on file: CI run 32604368463, macOS jobs, tests 80/85/95–98/100–102 (C-E06-114..121).
  **Done:** those 9 tests pass on macOS CI; no runtime source changes (the fix is in the harness); Linux stays green.

## E11-S02 — As an engine developer, table-driven conformance suites encode every grounded claim, so regressions name the claim they broke.
- [x] **E11-S02-T01 — Claim-linked test convention & tooling**
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
