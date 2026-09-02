# 11-implicit-wrapping

The narrowest pipeline the service accepts — bare `steps:`, no stage, no job, no pool — and the
wrapping it comes back with.

## Exercises

- **C-E04-002**: a root-level `steps:` is expanded to `stage: __default` → `job: Job` →
  `task: CmdLine@2`. Three separate facts in one document: the synthesized stage *name*, the
  synthesized job *name*, and the desugaring of `script:` into a task reference.

That is deliberately all it exercises. The point of the entry is that when it drifts, the diff is
a handful of lines and says exactly which of the three changed.

## Why it exists

Filed by the **drift-triage exercise** in `research/drift-runbook.md` (E11-S03-T02), following that
runbook's fixture-first rule: every drift leaves behind a narrow corpus entry watching the area it
touched.

The gap it closes is real and predates the exercise. `__default` and `Job` are load-bearing for
every path the emitter writes — a scaffold directory, a `dependencies.<job>.result` lookup, a
manifest row — and the ten original entries all declare their stages and jobs explicitly, so no
committed pair asserted the implicit case. It was measured (78 transcripts behind C-E04-002) and
then watched by nothing.

## Not covered here

`C-E04-003` — the same wrapping for a root-level `jobs:`, which keeps the authored job name — is
still transcript-only (`research/experiments/E04-model/root-jobs/`). One drift produces one
fixture, so it was recorded as a gap rather than bundled in.

## Consumed by

E04 (semantic model: implicit stage/job synthesis), E05 (scaffold paths derive from these names),
E11-S03 (the nightly re-expands it and byte-compares).
