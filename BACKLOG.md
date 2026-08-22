# Implementation Backlog — azdo-pipeline-emulator (revised)

This is the working backlog for the **simplified** architecture (see
[docs/07-simplification-review.md](docs/07-simplification-review.md) and the revised
[PLAN.md](PLAN.md)). It replaces the original "reimplement Azure Pipelines end-to-end" backlog:
expansion is delegated to the service (`preview` endpoint), and only the **runtime** half is
reimplemented. It is written so that **any future session can pick up work cold**: read this file,
pick the next unchecked task in execution order, follow its Grounding requirement, implement, check
it off.

## 1. Session pick-up protocol

1. Read `PLAN.md` §4–§6, then the epic file for the task you pick (each epic links its design-doc
   sections).
2. Pick the **first unchecked task** in the current phase per §5 execution order, respecting the
   epic's `Depends on:`.
3. Execute the **Grounding Protocol** (§3) *before* writing implementation code. Note the re-scope:
   **expansion behavior is not grounded by us at all** — the `preview` endpoint is the source of
   truth. Grounding applies to **runtime** behavior (agent contract, `$( )`/`$[ ]`, `##vso[]`,
   task-lib `INPUT_*`).
4. Implement with tests per the task's **Done** criteria. Update `research/` notes.
5. Mark the task `[x]` in its epic file; add a dated one-line entry to `CHANGELOG-BACKLOG.md`.
6. If a task turns out wrong/obsolete, don't delete it — mark `[~]` with a note and reference the
   replacing task.

**Statuses:** `[ ]` todo · `[x]` done · `[~]` dropped/superseded (note why) · `[!]` blocked (note on what).

## 2. ID & format conventions

`E<epic>-S<story>-T<task>`, e.g. `E05-S01-T02`. Stories are user-value slices with acceptance
criteria; tasks are implementable units (≤ ~1 day each) with three fields:

- **Do** — concrete implementation instruction (module, approach, data shapes).
- **Ground** — the mandatory evidence sources for this task (see §3). *Every task has one. No exceptions.*
- **Done** — acceptance criteria: tests, artifacts, and recorded evidence.

## 3. Grounding Protocol (mandatory for every *runtime* task)

Purpose: **prove runtime implementation is grounded in real Azure DevOps documentation or code —
never in model memory.** A task is not done until its evidence exists.

1. **Collect sources first.** Before coding, open the sources named in the task's **Ground** field:
   official `learn.microsoft.com` pages and/or GitHub code from `microsoft/azure-pipelines-agent`,
   `microsoft/azure-pipelines-tasks`, `microsoft/azure-pipelines-task-lib`. GitHub references must be
   **commit-pinned permalinks** (press `y` on github.com), not branch links.
2. **Record claims.** For each behavior you implement, add a claim entry to
   `research/<epic-id>-<slug>.md` in the format `[C-E05-014] <one-sentence behavior claim> — <source
   link> — "<short quoted excerpt>" — checked YYYY-MM-DD`. Code that encodes subtle behavior
   references its claim ID in a comment; tests reference the claim ID in the name or a comment.
3. **Verify, don't assume.** URLs in this backlog were written from knowledge and are the *starting
   point*. Anything the docs don't answer gets a `VERIFY:` marker and must be settled **by experiment**
   (a real run in the test org, or a reading of task/agent source) before coding. Store experiment
   transcripts under `research/experiments/`.
4. **Expansion is the exception.** Tasks that merely *consume* the `preview` expansion do **not**
   re-ground template/`${{ }}` behavior — the service is the authority by construction (PLAN D3).
   They ground only their own mechanics (auth, caching, bundling).
5. `research/REFERENCES.md` is the canonical index of primary sources (seeded; every epic keeps it
   current).

## 4. Epic index

| Epic | Title | Phase | Depends on | Design docs |
|---|---|---|---|---|
| [E00](backlog/E00-foundations.md) | Foundations & expansion client | P1 | — | PLAN §5 D1/D3, docs/05 §2 |
| [E01](backlog/E01-yaml-frontend.md) | YAML front end (expanded schema) | P1 | E00 | docs/01 §1–§2 |
| [E02](backlog/E02-expressions.md) | Runtime expressions & conditions | P2 | E00, E06 | docs/02 §6 |
| [E03](backlog/E03-template-engine.md) | Template engine (offline fallback) + local bundler | P1 | E00, E01, E02 | docs/02 §2–§5, docs/05 §4 |
| [E04](backlog/E04-semantic-model.md) | Semantic model (expanded pipeline) | P2 | E01, E03 | docs/01 §3–§6 |
| [E05](backlog/E05-emitter.md) | Emitter: generated project & scripts | P2 | E04, E06 | docs/04 §1–§2, §10–§12 |
| [E06](backlog/E06-runtime.md) | Runtime library (bash) | P2 | E00 (parallel w/ E02–E05) | docs/04 §3–§9 |
| [E07](backlog/E07-real-task-mode.md) | Real-task execution & stubs | P3 | E05, E06 | docs/03 §6, docs/04 §9 |
| [E08](backlog/E08-deployment-tasks.md) | Priority deployment tasks | P3 | E07, E09 | docs/03 D, docs/05 |
| [E09](backlog/E09-auth-fetchers.md) | Auth, fetchers, cache & lockfile | P3 | E00; integrates E03/E07 | docs/05 |
| [E10](backlog/E10-cli-config-doctor.md) | CLI, config & doctor | P1–P3 | E00 | docs/06 §1–§2 |
| [E11](backlog/E11-testing-parity.md) | Testing & parity harness | cross-cutting (starts P1) | E00 | docs/06 §3 |
| [E12](backlog/E12-cleanup.md) | Cleanup & demotion of the v1 reimplementation | P1 | — | docs/07 |

Docs → epic completeness map: docs/01 → E01+E04 · docs/02 → E02+E03 · docs/03 → E07+E08 ·
docs/04 → E05+E06+E07 · docs/05 → E03+E09 · docs/06 → E10+E11 · docs/07 → E12.

## 5. Execution order

- **P1 (Thin expansion):** E00-S04 (expansion client — first: E12-S01-T01 gates the engine behind
  it) → E12 (cleanup/demotion) → E01 → E03 (bundler) → E10-S01 (CLI skeleton).
- **P2 (Script-native runner):** E06 → E04 → E05 → E02 (runtime expressions, lands with E06's
  fixture store) → E10-S02. E11-S01 harness bootstrap runs with E00-S04.
- **P3 (Task breadth):** E09 → E07 (real-task mode + stubs) → E08 (deployment set) → E10-S03/S04
  (`auth`, `doctor`); E11-S02/S03 (conformance + nightly) grow alongside.

Parallelism note: E06 (bash runtime) has no dependency on E02–E05 and is ideal to progress in
parallel with engine work; E02 depends on E06's variable/fixture-store APIs, mirroring the old plan's
E02↔E06 relationship.
