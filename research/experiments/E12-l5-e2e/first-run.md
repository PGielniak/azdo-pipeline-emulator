# E11-S04-T01 — what the L5 tier found on its first three samples

The tier was built to answer one question no lower tier asks: **does a converted project actually
run, and does it produce what it should?** L1/L2 test modules, L4 tests the runtime's helpers
directly, and `drift.ts` Phase B converts every corpus entry and runs it but **records** exit codes
rather than pinning them (decision 75).

Three samples were written. Between them they found **five defects**, three of which are fixed in
this task. This transcript is the evidence.

## The order they surfaced in

Each failure below blocked the next, so they are numbered by discovery, not by severity.

### 1. `node: command not found` — and the design changed because of it

The first harness converted *inside* the container. The base image has no Node, and the converter is
a Node program, so this would have forced Node into the image whose entire purpose is to be minimal.

Converting on the **host** and running in the container is both more faithful — a developer converts
on their machine and runs the result wherever — and a **stronger** assertion (C-E12-030): the base
image contains no Node, no pnpm and nothing this repository built, and `run.sh` runs there anyway.
That is the "output is dependency-free bash" promise, tested rather than asserted.

### 2. `environment file is not readable: /work/out/.env`

The generated README's quick start is `cp .env.example .env` then `./run.sh`. The harness now
follows it literally, because the first thing L5 should catch is a documented first step that does
not work.

### 3. `Build.ArtifactStagingDirectory: command not found` (C-E12-031) — **fixed**

```
/work/out/.work/run-1/workspace/tmp/steps/.expanded.3XYhc1: line 12: Build.ArtifactStagingDirectory: command not found
```

The macro was never seeded, so it survived unexpanded into the step body and bash read `$(…)` as a
command substitution. `Build.StagingDirectory`, `Build.BinariesDirectory` and
`Common.TestResultsDirectory` were missing too. The layout was always intended — `run.sh` already
created `TestResults` beside `s`.

Grounded from the **already-pinned** predefined-variables include: `a`, `b`, `TestResults` under
`Agent.BuildDirectory`, with `Build.StagingDirectory` an alias because the page says the two "are
interchangeable".

### 4. `AZDO_STEP_NAME and AZDO_OUTPUT_DIR must be set for an output variable` (C-E12-032) — **fixed**

The emitted `run_step` call carried `--id`, `--file`, `--cond`, `--display`, `--wd`,
`--continue-on-error`, `--fail-on-stderr`, `--retries`, `--timeout` — and **not the step's authored
`name:`**, for which `run_step` had no flag at all.

So `azdo_var_set … output=true` refused, and **every `##vso[task.setvariable isOutput=true]` in every
generated project failed** — while the runtime implemented output variables, and their cross-job
reads, entirely correctly (C-E06-002/005). A bats test now pins the before-state as well as the fix.

### 5. Exit 4, and no summary at all (C-E12-035) — **fixed**

Sample 03's last step exits 4. The run reported:

```
E2E-EXIT 4
```

…and printed no end-of-run table. `run.sh` and `run-stage.sh` both carry `set -euo pipefail`, so a
failing stage aborted the parent **before** `azdo_run_summary` and `exit "$(azdo_run_exit_code)"` —
the two lines docs/04 §2 makes the end of a run. After `|| :` on the stage and job invocations:

```
SCOPE    STEP  NAME                  RESULT     DURATION
job-job  010   Report the toolchain  Succeeded        0s
job-job  020   Install and test      Failed           3s

Result: Failed
E2E-EXIT 1
```

Exit **1** is the verdict `azdo_run_exit_code` computes for `Failed`. Two consequences: the summary
was absent exactly when a user needs it most, and `azdo-emu run`'s exit-code contract
(E10-S02-T02) was reporting a *step's* status rather than the pipeline's. Stopping dependent work is
unaffected — that is decided by the next stage's compiled condition reading the result store.

## The two that are not fixed, and why

### Pipeline/stage/job `variables:` are not seeded (C-E12-033)

The expanded YAML keeps them:

```yaml
variables:
- name: buildConfig
  value: Release
```

The generated project contains **zero** `azdo_var_set` calls for them, the manifest records no
`pipeline.variables`, and `.env.example` asks for nothing. Confirmed against the corpus's own
`04-variable-layers` entry, which also emits zero.

So `$(anyVariable)` is unresolvable in every generated project, and a `$[ dependencies… ]` job
variable evaluates to nothing — which is why sample 01 reads its cross-job output through a **job
condition** instead. Seeding touches variable classification, precedence, secret marking and the
`.env` interaction: E05 emitter work, filed as **E11-S04-T03**.

### `publish`/`download` are not native (C-E12-034)

`disposeStep` treats only `checkout` as runtime-performed, so `PublishPipelineArtifact@1` goes to
real-task mode and fails offline with "no cached package" — although the runtime *has*
`azdo_artifact_publish`. The samples assert artifacts as files under the staging directory instead.
Filed as **E11-S04-T03**.

## The one that is open (C-E12-036)

A `condition: failed()` step ran after a `continueOnError: true` failure, when C-E06-040 says the
downgrade to `SucceededWithIssues` should make `failed()` False. The recorded step results are
right:

```
010 = Succeeded   020 = Succeeded   030 = SucceededWithIssues
040 = Succeeded   050 = Succeeded   060 = Failed
```

`azdo__job_status_from_results` downgrades only from `Succeeded`, and `azdo_status_failed` tests for
`Failed` — yet step 050, whose compiled condition is `azdo_status_failed`, executed.

**The cause is not located, so nothing is asserted about it either way.** The step was removed from
sample 03 rather than pinned: asserting it in either direction would pin behaviour nobody has
explained. Filed as **E11-S04-T03**.

## Timing

Three samples, warm image cache: **10 s** locally. **58 s** for the whole `e2e (L5, containers)` job
on `ubuntu-latest` — checkout, install, `pnpm -r build`, both image builds from scratch, and all
three samples — measured on run 33875135535. That is well inside the 5-minute budget E11-S04-T02
used for bats, and cheaper than every `test` leg on the same run (3 m 55 s to 6 m 48 s), because the
job builds once and runs three short pipelines rather than a full matrix.
