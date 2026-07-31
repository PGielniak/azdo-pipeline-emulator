<!-- Title: E##-S##-T## <task title> (or a clear description for non-backlog changes) -->

## What

<!-- One paragraph: which backlog task(s), what changed, where. -->

## Grounding checklist (BACKLOG.md §3 — reviewer rejects unproven behavior changes)

- [ ] Every implemented Azure DevOps behavior cites a source: official `learn.microsoft.com` page and/or GitHub source from the canonical repos (`research/REFERENCES.md`)
- [ ] GitHub references are **commit-pinned permalinks** (`/blob/<sha>/…`), not branch links
- [ ] Claim entries added/updated in `research/<epic-id>-<slug>.md` (`[C-E##-###]` format per `research/README.md`); subtle behavior in code/tests references its claim ID
- [ ] No behavior implemented from model/author memory
- [ ] `VERIFY` items this change consumes are resolved (experiment transcript under `research/experiments/` or pinned source); none left in code paths (`scripts/check-verify-markers.sh` is green)
- [ ] `research/REFERENCES.md` statuses updated for sources verified/pinned here

## Quality gates

- [ ] Tests per the task's **Done** criteria (vitest / bats / snapshots) added and green
- [ ] `pnpm lint` green (eslint + prettier + shellcheck; shellcheck-clean is mandatory for `packages/runtime` and emitted script templates)
- [ ] No secrets/tokens in code, fixtures, research notes, logs, or the lockfile (live REST samples redacted)
- [ ] Backlog bookkeeping: epic checkbox flipped truthfully (`[x]` only with Done met; else `[!]`/`[ ]` + note), `CHANGELOG-BACKLOG.md` entry appended
