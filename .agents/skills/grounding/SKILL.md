---
name: grounding
description: Execute the Grounding Protocol for a backlog task or a single behavior claim — locate official Azure DevOps docs and commit-pinned GitHub sources, record claim entries in research/, resolve VERIFY markers, and design experiments where docs are silent. Use before implementing any Azure DevOps behavior, or when the user asks to verify, ground, or fact-check a behavior.
---

# Grounding Protocol (executable form of BACKLOG.md §3)

Goal: every implemented behavior traces to a real source. Output of this skill = claim entries + updated REFERENCES.md, never code.

## 1. Resolve the sources

For each source named in the task's **Ground** field (or implied by the behavior in question):

- **Official docs:** WebFetch the URL from `research/REFERENCES.md` (or the task). If 404/moved, WebSearch the topic restricted to `learn.microsoft.com` and update REFERENCES.md with the resolved URL + last-checked date, flipping its `VERIFY` status.
- **GitHub code:** find the file via the GitHub API or raw URLs:
  - `curl -s https://api.github.com/repos/<owner>/<repo>/commits/HEAD` → note the commit SHA.
  - Browse/fetch the file at that SHA: `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/<path>` and cite `https://github.com/<owner>/<repo>/blob/<sha>/<path>#L<n>-L<m>`.
  - Key repos and what to look for are indexed in `research/REFERENCES.md` (agent = runtime behavior; tasks repo = per-task `task.json` + implementation; task-lib = env/`##vso` conventions; vscode repo = schema).
- **Source hierarchy when they disagree:** experiment result > Microsoft source code > official docs > vendor docs. Record the disagreement itself as a claim.

## 2. Record claims

Append to `research/<epic-id>-<slug>.md` (create with a title line if absent):

```
[C-E06-007] Secret variables are not automatically mapped into environment variables for scripts.
  — https://learn.microsoft.com/azure/devops/pipelines/process/variables#secret-variables (checked 2026-07-30)
  — "Unlike normal variables, they are not automatically decrypted into environment variables for scripts."
```

Rules: one claim = one falsifiable behavior sentence; quote ≤ 2 sentences; claim IDs are sequential per epic file and never reused; if a claim later proves wrong, strike it (`~~`) with a pointer to the superseding claim — don't delete.

## 3. When docs are silent or ambiguous

Do **not** guess and do not encode memory. Choose the cheapest sufficient experiment:

- Compile-time behavior (templates, expressions, parameters) → **oracle-experiment** skill (preview API).
- Runtime/agent behavior → read the pinned agent/task source; if still ambiguous and the test org exists, run a probe pipeline (E12-S05 harness once built; manual queue before that) and save the log excerpt.
- Store all transcripts under `research/experiments/<area>/` (redact org names/tokens); the transcript path goes into the claim entry as its source.

## 4. Definition of done for a grounding pass

- Every behavior the task will implement has a claim with a resolving link (test: open each link).
- No `VERIFY` marker remains for sources this task consumes.
- REFERENCES.md statuses updated.
- Surprises (doc contradicts our design docs) reported to the user explicitly — these often require a docs/ update per AGENTS.md rule 5.
