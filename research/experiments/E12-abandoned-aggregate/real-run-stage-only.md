# E11-S04-T07 — does an abandoned node move the run result? (real run)

A stage or job whose condition *errors* completes `Abandoned` (C-E02-071). Our runtime records
that state (C-E12-051), but `azdo_run_result` folds only **step** results, so locally the run
aggregates as if the abandoned node were not there and `azdo_run_exit_code` returns 0. The
exit-code contract is ours (docs/04 §3 + docs/06 §5 decision 56) — which is a reason to decide
it deliberately, not a reason to invent it while the service can be asked.

Every job is agentless (`pool: server`, one `Delay@1` of 0 minutes), so the run consumes no
hosted-agent parallelism and finishes in seconds. **Every datum is a `result` on the timeline**;
nothing is echoed and no log is read.

**The control is in the same run.** A run result means nothing until the abandonment is shown to
have happened, so `bad_stage`’s own record is read first. If it is not `abandoned`, this probe
measured nothing — the script says so instead of reporting a tidy number.

- Probe pipeline: `oracle-abandon-stage-probe` → `/experiments/abandoned-stage-only.yml` (source of truth:
  `research/experiments/E12-abandoned-aggregate/abandoned-stage-only.yml`, pushed by the script)
- Run: id 552, state `completed`, **result `failed`**
- Control (`bad_stage` is really abandoned): **held**

Regenerate with `pnpm abandoned-aggregate-realrun` (queues a fresh run).

## Stage records

| stage | condition | result | what it settles |
|---|---|---|---|
| `ok` | `(none — default)` | `succeeded` | the control: a stage that plainly succeeds, so the run has something good in it |
| `skipped_stage` | `false` | `skipped` | the contrast the whole task is about: conditioned out, not errored |
| `bad_stage` | `gt(1, 'not-a-number')` | `abandoned` | **the control for the run datum**: is a *stage* whose own condition errors `abandoned` too? C-E02-071 measured a **job** |

## Every timeline record

Unfiltered on purpose: which layer carries the datum is discovered here rather than assumed.
The sibling harness reads `Phase` records because its probe is `jobs:`-at-root; this probe is
`stages:`, a shape that harness has never driven.

| type | identifier | state | result |
|---|---|---|---|
| `Checkpoint` | `Checkpoint` | `completed` | `succeeded` |
| `Phase` | `bad_stage.j` | `completed` | `abandoned` |
| `Phase` | `ok.j` | `completed` | `succeeded` |
| `Stage` | `ok` | `completed` | `succeeded` |
| `Job` | `ok.j.__default` | `completed` | `succeeded` |
| `Task` | `Delay` | `completed` | `succeeded` |
| `Phase` | `skipped_stage.j` | `completed` | `skipped` |
| `Stage` | `skipped_stage` | `completed` | `skipped` |
| `Stage` | `bad_stage` | `completed` | `abandoned` |
