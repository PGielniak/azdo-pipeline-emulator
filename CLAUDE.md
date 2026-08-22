# CLAUDE.md — agent instructions for azdo-pipeline-emulator

## What this project is

A converter (`azdo-emu`) that turns any Azure DevOps YAML pipeline into a **self-contained local project of plain bash scripts** (same stages/jobs/steps, same variable/condition/artifact semantics, `.env` for secrets) so pipelines can be debugged locally. Design is complete; implementation follows a grounded backlog. Check `CHANGELOG-BACKLOG.md` for how far implementation has progressed.

## Session start — read in this order

1. This file.
2. [BACKLOG.md](BACKLOG.md) — §1 pick-up protocol, §3 Grounding Protocol, §5 execution order.
3. The epic file (`backlog/E##-*.md`) for the task you'll work on, plus the design-doc sections it links.
4. [PLAN.md](PLAN.md) only when you need architecture context (decisions D1–D10, fidelity tiers).

## Default assignment

When the user says "work", "continue", "next task", or names a task ID (`E02-S01-T03`): use the **work-next-task** skill. One task per cycle: select → ground → implement → test → record. Don't cherry-pick out of order without being asked; BACKLOG.md §5 defines the order.

## Non-negotiable rules

1. **Grounding Protocol (BACKLOG.md §3) is mandatory.** Never implement Azure DevOps behavior from memory. Every behavior needs a claim entry in `research/` citing an official doc page or commit-pinned GitHub source; undocumented behavior needs an experiment (oracle preview / real run / task source reading) *before* coding. Use the **grounding** skill.
2. **Decisions already made — do not relitigate** (record in `docs/06` §5): on-prem ADO Server out of scope; Windows host deferred (seam reserved, E15); variable groups → `.env.example` names-only, never values; priority task set = the Azure/K8s deployment group (E10); every conversion emits a coverage report; converter is TypeScript/Node ≥ 22, output is dependency-free bash.
3. **Evidence before checkmarks.** A task is `[x]` only when its **Done** criteria are met, tests pass, and its claims/evidence exist. Partial work → leave `[ ]` or mark `[!]` with a note; never silently skip a Done criterion.
4. **Secret hygiene.** No tokens/secret values in code, fixtures, research notes, logs, or the lockfile. Live REST samples must be redacted before committing. `.env` values are user-owned; never fetch variable-group values.
5. **Docs are load-bearing.** If implementation reveals a design error in `PLAN.md`/`docs/`, update the doc **and** add a dated note in `docs/06` §5 decisions record — don't let code and docs drift apart silently.

## Tech conventions

- Converter: pnpm monorepo (`packages/cli|engine|fetch|emit|runtime`), TypeScript strict, vitest, eslint+prettier. **Until E00-S01-T01 has run, the monorepo does not exist — don't assume paths; scaffold first.**
- Runtime: bash ≥ 4, bats-core tests, shellcheck-clean is a hard requirement for anything under `packages/runtime` and all emitted script templates.
- Research: claims live in `research/<epic>-<slug>.md`; experiments under `research/experiments/`; canonical source index `research/REFERENCES.md` (update statuses when you pin a `VERIFY` entry).
- Git: `git init` on the first implementation session if not yet a repo; commit per completed task, message `E##-S##-T## <title>` + body summarizing evidence. Work on `main` while solo.

## Bookkeeping after every task

1. Flip the checkbox in the epic file (`[x]`, or `[!]`/`[~]` with a note).
2. Append to `CHANGELOG-BACKLOG.md`: `YYYY-MM-DD E##-S##-T## done — <summary> (evidence: <research paths / test names>)`.
3. Update `research/REFERENCES.md` statuses for any source you verified/pinned.
4. Commit. Report to the user: what was done, evidence, and the suggested next task.

## Repo map

| Path | What |
|---|---|
| `PLAN.md` | Master architecture, decisions D1–D10, fidelity tiers, roadmap |
| `docs/01`–`06` | Detailed design (schema, engine, tasks, runtime, auth, CLI/testing) |
| `BACKLOG.md` + `backlog/E00`–`E15` | Work protocol + all stories/tasks (161 tasks; every task has a **Ground** field) |
| `research/` | Grounding evidence: REFERENCES.md, claim notes, experiments |
| `CHANGELOG-BACKLOG.md` | Append-only progress log |
| `.claude/skills/` | work-next-task, grounding, oracle-experiment, backlog-status |

## Environment notes

- Web access (WebFetch/WebSearch) is required for grounding; if unavailable, do not guess — mark the task `[!]` blocked-on-network and stop.
- Oracle/live-run tasks need the test org (E00-S03 runbook) and env vars `AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, `AZDO_PAT`. Without them, do the offline part and mark the rest `[!]` with what's missing.
