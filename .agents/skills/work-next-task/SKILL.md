---
name: work-next-task
description: Pick up and fully execute the next implementation task from BACKLOG.md (or a specific task ID passed as argument) — select the task, run the Grounding Protocol, implement, test, and record completion. Use when the user says "work", "continue", "next task", "pick up the backlog", or names a task ID like E05-S01-T02.
---

# Work the next backlog task

Execute exactly one backlog task end-to-end. If an argument like `E05-S01-T02` is given, work that
task; otherwise select per §1. The backlog reflects the **simplified "script-native, server-expanded"
architecture** — see `PLAN.md` (revised) and `docs/07-simplification-review.md`.

## 1. Select

1. Read `BACKLOG.md` §5 (execution order) and `CHANGELOG-BACKLOG.md` (what's done/blocked recently).
2. Walk the §5 order entries. For each, open the epic file and find the **first `[ ]` task** (skip
   `[x]`, `[~]`, and every `[!]` task carrying an `In progress` ownership note; revisit a blocked
   `[!]` only if its blocker note is now resolved). Quick scan command:
   `grep -n '^\- \[ \] \*\*E' backlog/E##-*.md | head -5`
3. Confirm the epic's `Depends on:` epics are far enough along for this task (its **Do**/**Ground**
   will name concrete prerequisites — e.g. the E00-S04 expansion client, or the E06 variable-store
   APIs). If a prerequisite is missing, mark the task `[!]` with a one-line reason, pick the next
   candidate, and mention the skip in your report.
4. State to the user which task you selected and why, before starting.

## 2. Ground (mandatory for runtime tasks — never skip to implementation)

Follow the **grounding** skill for this task's **Ground** field, with the re-scope from BACKLOG.md §3:

- **Expansion is delegated, not reimplemented.** Tasks that merely consume the `preview` expansion
  (E00-S04, the bundler E03) do **not** re-ground template/`${{ }}` behavior — the service is the
  authority by construction (PLAN D3). Ground only their own mechanics (auth, caching, bundling).
- For **runtime** behavior (`$( )`, `$[ ]`, `##vso[]`, task-lib `INPUT_*`, variable/artifact
  semantics): fetch/verify each named source, pin GitHub sources to commit permalinks, and write
  claim entries into `research/<epic-id>-<slug>.md` in the BACKLOG.md §3 format.
- If the task requires an experiment (oracle / real run) and the test org is available (`AZDO_*` env
  vars in `.env.oracle`), run it via the **oracle-experiment** skill; store transcripts under
  `research/experiments/`.
- **Stop conditions:** network unavailable, a source contradicts the task's assumption, or a
  required experiment can't run → mark the task `[!]` with a precise blocker note, report, and end.
  Do not implement ungrounded runtime behavior.

## 3. Implement

- Do exactly the task's **Do**, in the module/path it names.
- Reference claim IDs in comments only where the code encodes subtle grounded runtime behavior.
- Respect repo conventions: TS strict, shellcheck-clean bash, no secrets.

## 4. Verify

- Write/extend the tests the **Done** field names (vitest / bats / snapshots), run them, and run
  lint/typecheck/shellcheck for touched areas.
- Walk the **Done** list literally, item by item. Anything unmeetable now (e.g. needs the live org):
  implement the rest, leave the task `[!]` with a note listing exactly which Done items remain and
  why — never `[x]` a partially-done task.

## 5. Record & report

1. Replace the task's `[!]` in-progress marker with `[x]`, remove its ownership note, and add the
   normal `done` entry to `CHANGELOG-BACKLOG.md` (format in the repo instruction file). Never leave
   a completed task marked in progress.
2. Update `research/REFERENCES.md` statuses for sources you pinned.
3. `git add`/`commit` (message `E##-S##-T## <title>`).
4. Report: task done, key findings from grounding (especially surprises vs the design docs),
   evidence paths, test results, and the suggested next task. If grounding contradicted `docs/` or
   `PLAN.md`, update the doc + decisions record per the repo's rule 5 and say so explicitly.

## 6. Ship — push, PR, merge (do this automatically; don't ask)

The task is not delivered until it is merged. Run this whole section without pausing for approval.

1. **Branch.** If you are on `main`, create `<task-id-lowercase>` (e.g. `e05-s01-t02-…`) *before*
   committing. Otherwise stay on the current branch: sessions run in parallel and share one, and
   switching would strand a sibling's uncommitted work.
2. **Push.** `git push -u origin <branch>`. If rejected as non-fast-forward, `git fetch` and rebase
   or merge — **never force-push a shared branch**; if history has genuinely diverged, stop and ask.
3. **PR.** `gh pr list --head <branch> --state open` first — a sibling session may already have one
   open for this branch, in which case **update it** rather than opening a second. Otherwise
   `gh pr create --base main`. Fill in `.github/pull_request_template.md` honestly — every checkbox
   is a claim about *this* diff. Title: the task ID + title, or a summary naming each task when the
   branch carries several.
4. **Wait for CI, then merge.** `gh pr checks <n> --watch`. Green → `gh pr merge <n> --squash`. Red
   → fix and push again; never merge red.
5. **Realign the branch after a squash merge.** Verify content is identical
   (`git fetch origin && git diff HEAD origin/main --quiet`), then `git reset --soft origin/main` —
   soft, so a sibling's uncommitted work in the tree is untouched.

**When the branch carries sibling commits** (the normal case here): they ride along in your PR. Say
so explicitly in the PR body and report, listing them by SHA and task ID. Do **not** flip a
sibling's checkbox, edit their changelog entry, or judge their Done criteria — you are shipping their
commit, not certifying it.

## Guardrails

- One task per invocation unless the user explicitly asks for a batch.
- Never reorder or reword backlog tasks to fit what you built — if a task is wrong, mark `[~]` with a
  note and add a corrected task at the end of its story.
- Treat an `[!]` task with an `In progress` note as actively owned, not blocked. Never pick it,
  modify it, or decide it is stale merely from elapsed time.
- If grounding or verification blocks the task, replace the ownership note with a precise
  `*Blocked YYYY-MM-DD: ...*` note, keep `[!]`, and append a `blocked` changelog entry.
- If the user interrupts with a different request mid-task but the work remains owned, keep `[!]`
  and its ownership note; append an updated `in-progress` changelog entry describing the partial
  state. Release it explicitly if it will not be resumed.
- Ship §6 automatically, but its two stop-and-ask cases stand: genuinely diverged history, and a red
  CI run you cannot fix within the task.
