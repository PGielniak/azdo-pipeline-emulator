---
name: work-next-task
description: Pick up and fully execute the next implementation task from BACKLOG.md (or a specific task ID passed as argument) — select the task, run the Grounding Protocol, implement, test, and record completion. Use when the user says "work", "continue", "next task", "pick up the backlog", or names a task ID like E02-S01-T03.
---

# Work the next backlog task

Execute exactly one backlog task end-to-end. If an argument like `E05-S01-T02` is given, work that task; otherwise select per §1.

## 1. Select

1. Read `BACKLOG.md` §5 (execution order) and `CHANGELOG-BACKLOG.md` (what's done/blocked recently).
2. Walk the §5 order entries. For each, open the epic file and find the **first `[ ]` task** (skip `[x]`, `[~]`, and every `[!]` task carrying an `In progress` ownership note; revisit a blocked `[!]` only if its blocker note is now resolved). Quick scan command:
   `grep -n '^\- \[ \] \*\*E' backlog/E##-*.md | head -5`
3. Confirm the epic's `Depends on:` epics are far enough along for this task (its **Do**/**Ground** will name concrete prerequisites — e.g. a runtime API or the test org). If a prerequisite is missing, mark the task `[!]` with a one-line reason, pick the next candidate, and mention the skip in your report.
4. **Claim the task immediately, before grounding, experiments, implementation, or creating an
   isolated worktree:**
   - Change its checkbox from `[ ]` to `[!]` and add this line beneath it:
     `*In progress YYYY-MM-DD by <worker identity> on <branch/worktree>; do not pick.*`
   - Append (never rewrite) this line to `CHANGELOG-BACKLOG.md`:
     `YYYY-MM-DD E##-S##-T## in-progress — claimed by <worker identity> on <branch/worktree> (evidence: pending)`.
   - Make the claim in the shared checkout that other workers inspect. If work later moves to an
     isolated worktree, keep the shared-checkout claim visible until completion or release.
   - Re-read the task after writing the claim. If another worker already claimed it, undo only your
     attempted claim, select the next candidate, and never alter the existing owner's note.
5. State to the user which task you selected and why, including the recorded owner, before starting.

## 2. Ground (mandatory — never skip to implementation)

Follow the **grounding** skill for this task's **Ground** field:
- Fetch/verify each named source (WebFetch/WebSearch; GitHub raw/API via curl for code). Pin GitHub sources to commit permalinks.
- Write claim entries into `research/<epic-id>-<slug>.md` (create if absent) in the format from BACKLOG.md §3.
- If the task requires an experiment (oracle/real run) and the test org is available (`AZDO_*` env vars), run it via the **oracle-experiment** skill; store transcripts under `research/experiments/`.
- **Stop conditions:** network unavailable, a source contradicts the task's assumption, or a required experiment can't run → mark the task `[!]` with a precise blocker note, report, and end. Do not implement ungrounded.

## 3. Implement

- Do exactly the task's **Do**, in the module/path it names. If the monorepo isn't scaffolded yet (pre-E00-S01-T01), scaffold first — that *is* the first task.
- Reference claim IDs in comments only where the code encodes subtle grounded behavior.
- Respect repo conventions (AGENTS.md): TS strict, shellcheck-clean bash, no secrets.

## 4. Verify

- Write/extend the tests the **Done** field names (vitest / bats / snapshots), run them, and run lint/typecheck/shellcheck for touched areas.
- Walk the **Done** list literally, item by item. Anything unmeetable now (e.g. needs live org): implement the rest, leave the task `[!]` with a note listing exactly which Done items remain and why — never `[x]` a partially-done task.

## 5. Record & report

1. Replace the task's `[!]` in-progress marker with `[x]`, remove its ownership note, and add the
   normal `done` entry to `CHANGELOG-BACKLOG.md` (format in AGENTS.md). Never leave a completed task
   marked in progress. If the visible claim lives in a different shared checkout, apply the same
   completion transition there before reporting done.
2. Update `research/REFERENCES.md` statuses for sources you pinned.
3. `git add`/`commit` (message `E##-S##-T## <title>`; `git init` first if needed).
4. Report: task done, key findings from grounding (especially surprises vs the design docs), evidence paths, test results, and the suggested next task. If grounding contradicted `docs/` or `PLAN.md`, update the doc + decisions record per AGENTS.md rule 5 and say so explicitly.

## Guardrails

- One task per invocation unless the user explicitly asks for a batch.
- Treat an `[!]` task with an `In progress` note as actively owned, not blocked. Never pick it,
  modify it, or decide that it is stale merely from elapsed time. Reclaim it only when the named
  worker is confirmed stopped or the user explicitly directs reassignment.
- If grounding or verification blocks the task, replace the ownership note with a precise
  `*Blocked YYYY-MM-DD: ...*` note, keep `[!]`, and append a `blocked` changelog entry in every
  checkout where the ownership claim was mirrored.
- If ownership is deliberately released without completing or blocking the task, change `[!]`
  back to `[ ]`, remove the ownership note, and append an `in-progress released` changelog entry so
  another worker can safely claim it. Apply the release in the shared coordination checkout too.
- Never reorder or reword backlog tasks to fit what you built — if a task is wrong, mark `[~]` with a note and add a corrected task at the end of its story.
- If the user interrupts with a different request mid-task but the work remains owned, keep `[!]`
  and its ownership note; append an updated `in-progress` changelog entry describing the partial
  state. Release it explicitly if it will not be resumed.
