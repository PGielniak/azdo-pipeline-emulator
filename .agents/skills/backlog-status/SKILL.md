---
name: backlog-status
description: Summarize implementation progress — per-epic done/todo/blocked task counts, current phase, blocked tasks with reasons, recent changelog entries, and the suggested next task. Use when the user asks for status, progress, "where are we", or what's next without wanting work done.
---

# Backlog status report

Read-only: never changes checkboxes or files.

## Gather

```bash
# Per-epic counts: done / todo / blocked / dropped
for f in backlog/E*.md; do
  printf "%s  done:%s todo:%s blocked:%s dropped:%s\n" "$(basename "$f" .md)" \
    "$(grep -c '^\- \[x\]' "$f")" "$(grep -c '^\- \[ \]' "$f")" \
    "$(grep -c '^\- \[!\]' "$f")" "$(grep -c '^\- \[~\]' "$f")"
done
# Blocked tasks with their notes
grep -n '^\- \[!\]' backlog/E*.md
# Recent activity
tail -20 CHANGELOG-BACKLOG.md 2>/dev/null || echo "no changelog yet"
```

## Determine

- **Current phase:** first phase in BACKLOG.md §5 whose listed epics still have `[ ]` tasks.
- **Suggested next task:** what the work-next-task selection (§1 of that skill) would pick — name it and its one-line **Do**.
- **Health flags:** blocked tasks older than the last 5 changelog entries; epics started out of §5 order; `VERIFY` count remaining in `research/REFERENCES.md` (`grep -c VERIFY research/REFERENCES.md`).

## Report format

Compact: a per-epic table (epic, phase, done/total, blocked), current phase, top 3 blockers with their notes verbatim, last 3 changelog lines, and the suggested next task. One screen; no prose padding. Offer to start the next task via work-next-task — don't start it unasked.
