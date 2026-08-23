# E04 — semantic model: claims

Claim format per BACKLOG.md §3. IDs are **never reused** and are allocated from the block table
below rather than by "next free number" — see `research/E03-template-engine.md`'s header for the
collision that made this convention mandatory.

## Claim-ID block allocation

| Block | Task | File | Status |
|---|---|---|---|
| `C-E04-001..029` | **E04-S01-T01 model types & builder** | this file | 001–005 used |
| `C-E04-030..059` | E04-S01-T02 normalization boundary | this file | free |
| `C-E04-060..079` | E04-S01-T03 common step fields | this file | free |
| `C-E04-080..109` | E04-S02 variables & scoping | this file | free |
| `C-E04-110..139` | E04-S03 dependency graph & matrix | this file | free |

Leave gaps. A branch that numbers from what it can see collides silently with every sibling.

---

## E04-S01-T01 — what shape the service's `finalYaml` actually arrives in (`C-E04-001..005`)

Evidence of two kinds, and they are labelled apart because they carry different weight. **A corpus
observation** over the 147 `final.yml` transcripts this epic inherits from E00/E02/E03
(`research/experiments/*/*/final.yml`) — strong, but it measures the probes that happened to be
written, not the whole input space. And **two probes run for this task**
(`research/experiments/E04-model/`), which close the one root shorthand the corpus never exercised.

[C-E04-001] **Every expansion the service returns is rooted at `stages:`.** All **147** captured
`final.yml` documents carry a top-level `stages` key; none is rooted at `jobs:` or `steps:`
— `research/experiments/*/*/final.yml`, counted 2026-08-23. The other top-level keys that survive
expansion are `parameters`, `variables` and `resources`; the observed key sets are exactly
`{stages}` (63), `{parameters, stages}` (62), `{parameters, stages, variables}` (13),
`{resources, stages}` (8) and `{stages, variables}` (1). Consequence for the builder: on the
**default** path there is no stage/job wrapping left to do. The wrapping it still implements is for
the `--offline-expand` fallback (PLAN D3/D4), whose local engine makes no such guarantee, and that
is why the code keeps it rather than asserting the invariant.

[C-E04-002] **A root-level `steps:` is wrapped as stage `__default` → job `Job` → `task: CmdLine@2`.**
Corpus: `__default` appears as a stage name in 78 transcripts and `Job` as a job name in the same
78 — exactly the probes whose input was rooted at bare `steps:` (141 probe inputs are
`{steps}` or `{parameters, steps}`; the difference is the ones the service rejected). This restates
C-E00-017/018's measurement, which the task's **Ground** field names, and confirms it holds across
every later probe rather than only the original spike.

[C-E04-003] **A root-level `jobs:` is wrapped in `__default` too, and keeps its own job name.**
`research/experiments/E04-model/root-jobs/` — input `jobs:\n- job: Build\n  steps: …`, HTTP 200,
expanded to `stages:\n- stage: __default\n  jobs:\n  - job: Build\n    steps:\n    - task: CmdLine@2`
— checked 2026-08-23. The corpus could not answer this: **no** inherited probe is rooted at `jobs:`
(the 147 inputs are `{steps}`, `{stages}` and their `parameters`/`variables`/`resources`
combinations), which is why this was probed rather than assumed from the `steps:` case.

[C-E04-004] **An explicitly written but unnamed job keeps the empty string as its name — it does
*not* get the synthetic `Job`.** `research/experiments/E04-model/root-jobs-unnamed/` — input
`jobs:\n- job:\n  steps: …`, HTTP 200, expanded to `- job: ''` — checked 2026-08-23. The synthetic
`Job` of C-E04-002 is what the service supplies when it invents the job, not a default it applies
to a job the author wrote. Consequence, and the reason this is a separate claim: **job identity may
be the empty string**, so the model must not treat a job name as non-empty, and anything deriving a
directory or a script filename from it (E05) needs its own fallback rather than trusting the name.

[C-E04-005] **`stages:` at the root passes through unwrapped.** 100 of the inherited probe inputs
are rooted at `stages:` and every corresponding expansion is likewise rooted at `stages:` with the
authored stage names intact (`probe`, `alpha`, `beta` in the corpus, alongside the synthetic
`__default` from the `steps:`-rooted probes) — counted 2026-08-23. Together with C-E04-002/003 this
gives the builder its input contract: one shape, always, on the default path.
