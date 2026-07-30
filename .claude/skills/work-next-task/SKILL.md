---
name: work-next-task
description: Pick up and fully execute the next implementation task from BACKLOG.md (or a specific task ID passed as argument) — select the task, run the Grounding Protocol, implement, test, and record completion. Use when the user says "work", "continue", "next task", "pick up the backlog", or names a task ID like E02-S01-T03.
---

# Work the next backlog task

Execute exactly one backlog task end-to-end. If an argument like `E05-S01-T02` is given, work that task; otherwise select per §1.

## 1. Select

1. Read `BACKLOG.md` §5 (execution order) and `CHANGELOG-BACKLOG.md` (what's done/blocked recently).
2. Walk the §5 order entries. For each, open the epic file and find the **first `[ ]` task** (skip `[x]`, `[~]`; revisit `[!]` only if its blocker note is now resolved). Quick scan command:
   `grep -n '^\- \[ \] \*\*E' backlog/E##-*.md | head -5`
3. Confirm the epic's `Depends on:` epics are far enough along for this task (its **Do**/**Ground** will name concrete prerequisites — e.g. a runtime API or the test org). If a prerequisite is missing, mark the task `[!]` with a one-line reason, pick the next candidate, and mention the skip in your report.
4. State to the user which task you selected and why, before starting.

## 2. Ground (mandatory — never skip to implementation)

Follow the **grounding** skill for this task's **Ground** field:
- Fetch/verify each named source (WebFetch/WebSearch; GitHub raw/API via curl for code). Pin GitHub sources to commit permalinks.
- Write claim entries into `research/<epic-id>-<slug>.md` (create if absent) in the format from BACKLOG.md §3.
- If the task requires an experiment (oracle/real run) and the test org is available (`AZDO_*` env vars), run it via the **oracle-experiment** skill; store transcripts under `research/experiments/`.
- **Stop conditions:** network unavailable, a source contradicts the task's assumption, or a required experiment can't run → mark the task `[!]` with a precise blocker note, report, and end. Do not implement ungrounded.

## 3. Implement

- Do exactly the task's **Do**, in the module/path it names. If the monorepo isn't scaffolded yet (pre-E00-S01-T01), scaffold first — that *is* the first task.
- Reference claim IDs in comments only where the code encodes subtle grounded behavior.
- Respect repo conventions (CLAUDE.md): TS strict, shellcheck-clean bash, no secrets.

## 4. Verify

- Write/extend the tests the **Done** field names (vitest / bats / snapshots), run them, and run lint/typecheck/shellcheck for touched areas.
- Walk the **Done** list literally, item by item. Anything unmeetable now (e.g. needs live org): implement the rest, leave the task `[!]` with a note listing exactly which Done items remain and why — never `[x]` a partially-done task.

## 5. Record & report

1. Flip the checkbox in the epic file; add `CHANGELOG-BACKLOG.md` entry (format in CLAUDE.md).
2. Update `research/REFERENCES.md` statuses for sources you pinned.
3. `git add`/`commit` (message `E##-S##-T## <title>`; `git init` first if needed).
4. Report: task done, key findings from grounding (especially surprises vs the design docs), evidence paths, test results, and the suggested next task. If grounding contradicted `docs/` or `PLAN.md`, update the doc + decisions record per CLAUDE.md rule 5 and say so explicitly.

## Guardrails

- One task per invocation unless the user explicitly asks for a batch.
- Never reorder or reword backlog tasks to fit what you built — if a task is wrong, mark `[~]` with a note and add a corrected task at the end of its story.
- If the user interrupts with a different request mid-task, leave the checkbox untouched and note in-progress state in the changelog.
