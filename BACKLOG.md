# Implementation Backlog — azdo-pipeline-emulator

This is the working backlog derived from [PLAN.md](PLAN.md) and `docs/01`–`docs/06`. It is written so that **any future session can pick up work cold**: read this file, pick the next unchecked task in execution order, follow its Grounding requirement, implement, check it off.

## 1. Session pick-up protocol

1. Read `PLAN.md` §4–§6, then the epic file for the task you pick (each epic links its design doc sections).
2. Pick the **first unchecked task** in the current phase per §5 execution order, respecting the epic's `Depends on:`.
3. Execute the **Grounding Protocol** (§3) *before* writing implementation code.
4. Implement with tests per the task's **Done** criteria. Update `research/` notes.
5. Mark the task `[x]` in its epic file; add a dated one-line entry to `CHANGELOG-BACKLOG.md` (create on first use).
6. If a task turns out wrong/obsolete, don't delete it — mark `[~]` with a note and reference the replacing task.

**Statuses:** `[ ]` todo · `[x]` done · `[~]` dropped/superseded (note why) · `[!]` blocked (note on what).

## 2. ID & format conventions

`E<epic>-S<story>-T<task>`, e.g. `E02-S01-T03`. Stories are user-value slices with acceptance criteria; tasks are implementable units (≤ ~1 day each) with three fields:

- **Do** — concrete implementation instruction (module, approach, data shapes).
- **Ground** — the mandatory evidence sources for this task (see §3). *Every task has one. No exceptions.*
- **Done** — acceptance criteria: tests, artifacts, and recorded evidence.

## 3. Grounding Protocol (mandatory for every task)

Purpose: **prove the implementation is grounded in real Azure DevOps documentation or code — never in model memory.** A task is not done until its evidence exists.

1. **Collect sources first.** Before coding, open the sources named in the task's **Ground** field: official `learn.microsoft.com` pages and/or GitHub code from `microsoft/azure-pipelines-agent`, `microsoft/azure-pipelines-tasks`, `microsoft/azure-pipelines-task-lib`, `microsoft/azure-pipelines-vscode`, `actions/runner-images`, or the vendor repo named in the task. GitHub references must be **commit-pinned permalinks** (press `y` on github.com), not branch links.
2. **Record claims.** For each behavior you implement, add a claim entry to `research/<epic-id>-<slug>.md`:
   `[C-E02-014] <one-sentence behavior claim> — <source link> — "<short quoted excerpt>" — checked YYYY-MM-DD`.
   Code that encodes subtle behavior references its claim ID in a comment. Tests for that behavior reference the claim ID in the test name or a comment.
3. **Verify, don't assume.** URLs in this backlog were written from knowledge and are the *starting point* — the task includes confirming they resolve and pinning the exact current location. Anything the docs don't answer gets a `VERIFY:` marker and must be settled **by experiment** before coding: the preview API for compile-time behavior (docs/02 §8), a real run in the test org or a reading of task/agent source for runtime behavior. Store experiment transcripts under `research/experiments/`.
4. **Review gate.** PRs use the checklist in `.github/pull_request_template.md` (created in E00): sources linked, permalinks pinned, claims recorded, no behavior "from memory". Reviewer rejects unproven behavior changes.
5. `research/REFERENCES.md` is the canonical index of primary sources (seeded; every epic keeps it current).

## 4. Epic index

| Epic | Title | Phase | Depends on | Design docs |
|---|---|---|---|---|
| [E00](backlog/E00-foundations.md) | Foundations & grounding infrastructure | P0 | — | PLAN §5, docs/06 |
| [E01](backlog/E01-yaml-frontend.md) | YAML front end & schema validation | P0–P1 | E00 | docs/01 §1–§2 |
| [E02](backlog/E02-expressions.md) | Expression language (evaluator + shell compiler) | P1–P2 | E00 | docs/02 §1, §6 |
| [E03](backlog/E03-template-engine.md) | Template engine & oracle parity | P1 | E01, E02 | docs/02 §2–§5, §7–§8 |
| [E04](backlog/E04-semantic-model.md) | Semantic model & normalization | P1–P2 | E03 | docs/01 §3–§6 |
| [E05](backlog/E05-emitter.md) | Emitter: generated project & scripts | P2 | E04, E06, E09 | docs/04 §1–§2, §10–§12 |
| [E06](backlog/E06-runtime.md) | Runtime library (bash) | P2 | E00 (parallel w/ E02–E04) | docs/04 §3–§9 |
| [E07](backlog/E07-coverage.md) | Coverage report | P2 | E04, E05 | docs/04 §13, PLAN D10 |
| [E08](backlog/E08-auth-fetchers.md) | Auth, REST fetchers, cache & lockfile | P3 | E00; integrates E03/E06 | docs/05 |
| [E09](backlog/E09-task-registry-core.md) | Task handler registry & core tasks (A/B) | P2 | E04, E06 | docs/03 §1–§2, A/B, §4 |
| [E10](backlog/E10-priority-deployment-tasks.md) | Priority deployment set (group D) + strategies | P4 | E08, E09 | docs/03 D, §5; docs/01 deployment jobs |
| [E11](backlog/E11-task-breadth.md) | Task breadth (groups C/E/F/G) | P5 | E09 | docs/03 C/E/F/G |
| [E12](backlog/E12-testing-parity.md) | Testing & parity program | cross-cutting (starts P0) | E00 | docs/06 §3 |
| [E13](backlog/E13-cli-config-doctor.md) | CLI, config & doctor | P0–P4 | E00 | docs/06 §1–§2 |
| [E14](backlog/E14-fidelity-dx.md) | Fidelity & DX (real-task mode, sandbox & containers, parallel) | P6 · sandbox S04-T01/T02: P2 | E09, E06 (S04: E05+E06 only) | docs/03 §6, docs/04 §9 |
| [E15](backlog/E15-windows-readiness.md) | Windows host readiness (seam now, impl future) | seam: P2 / impl: Future | E05 | docs/04 §9, PLAN roadmap |

Docs → epic completeness map: docs/01 → E01+E04 · docs/02 → E02+E03 · docs/03 → E09+E10+E11+E14 · docs/04 → E05+E06+E07+E14+E15 · docs/05 → E08 · docs/06 → E12+E13.

## 5. Execution order

- **P0:** E00 (all) → E01-S01/S02 → E13-S01 (CLI skeleton) → E12-S01 (harness bootstrap) → E03-S05-T01 (oracle spike lives in E00-S03 — do with it).
- **P1:** E02 → E03 → E04 (E12-S02/S03 grow alongside; every E03 story lands with oracle fixtures).
- **P2:** E06 → E09 → E05 → E04-S03 (deployment runOnce) → E07 → E14-S04-T01/T02 (sandbox wrapper, D11) → E15-S01 (seam guard) → E13-S02.
- **P3:** E08 (then wire into E03 remote templates + E06 checkout/artifacts) → E13-S03.
- **P4:** E10 → E13-S04 (doctor).
- **P5:** E11.
- **P6:** E14.
- **Future:** E15-S02+.

Parallelism note for multi-session work: E06 (bash runtime) has no dependency on E02–E04 and is ideal to progress in parallel with engine work.
