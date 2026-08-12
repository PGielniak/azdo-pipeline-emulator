# research/ — grounding evidence

Every implemented Azure DevOps behavior traces to a recorded claim here. **Never implement from
memory** (BACKLOG.md §3; enforced by the PR template checklist).

## Layout

- `REFERENCES.md` — canonical index of primary sources with per-link status (`VERIFY` = written
  from knowledge, must be confirmed + pinned before first use; otherwise `verified <date>`).
- `<epic-id>-<slug>.md` (e.g. `E06-runtime.md`) — claim entries for that epic.
- `experiments/<area>/` — transcripts of oracle/preview probes and real runs (redact org names,
  tokens, GUIDs). The transcript path is the claim's source.

## Claim entry format

```
[C-E06-007] Secret variables are not automatically mapped into environment variables for scripts.
  — https://learn.microsoft.com/azure/devops/pipelines/process/variables#secret-variables (checked 2026-07-30)
  — "Unlike normal variables, they are not automatically decrypted into environment variables for scripts."
```

Rules (BACKLOG.md §3 + grounding skill):

- One claim = **one falsifiable behavior sentence**; quote ≤ 2 sentences from the source.
- IDs are sequential per epic file (`C-E06-001`, `C-E06-002`, …) and **never reused**.
- **Allocating IDs across parallel branches.** "Next free number" is only safe when one branch is in
  flight. When several tasks of an epic run concurrently (separate branches or worktrees), each task
  takes a **reserved block** recorded in a table at the top of the epic's claim file — a branch that
  numbers from the file it can see will collide with every sibling branch, silently, and the
  collision only surfaces at merge, by which time claim IDs in code comments and test names point at
  the wrong claims. Blocks are cheap; leave gaps. On a collision that reached a merge, the task whose
  claims are **least referenced elsewhere** renumbers into a fresh block and the renumber is recorded
  in the epic file's block table (see `E02-expressions.md` for a worked example).
- GitHub sources must be commit-pinned permalinks (`…/blob/<sha>/<path>#L10-L20`).
- A claim later proven wrong is struck (`~~…~~`) with a pointer to the superseding claim — never
  deleted.
- Code encoding subtle grounded behavior references the claim ID in a comment; the covering test
  references it in its name or a comment.
- Source hierarchy on disagreement: experiment result > Microsoft source code > official docs >
  vendor docs. Record the disagreement itself as a claim.
- Docs silent/ambiguous → settle **by experiment before coding** (preview API for compile-time,
  agent/task source or probe run for runtime), transcript under `experiments/`.

`VERIFY:` markers are legitimate *here*, in `docs/`, and in `backlog/` (they mark pending pins).
They must never survive in code paths — `scripts/check-verify-markers.sh` (pre-commit hook +
CI) fails on any `VERIFY:` under `packages/`, `scripts/`, or `fixtures/`.
