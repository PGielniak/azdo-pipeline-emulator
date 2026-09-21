# E11-S04-T03 — why a `condition: failed()` step ran (C-E12-036 → C-E12-038)

**Date:** 2026-09-21. **Host:** this machine, no container — the defect is in emitted bash and
reproduces wherever bash runs.

E11-S04-T01 filed C-E12-036 as an open finding: after a `continueOnError: true` failure, a step
whose compiled condition is `azdo_status_failed` executed. It recorded that the step *results* were
right and that the runtime's status helpers looked correct, and declined to guess further.

Reading further would not have found it. The cause is in the emitter, and the symptom it produces is
much larger than the one that was observed.

## The probe

A five-step pipeline, converted with `--offline-expand` and run on the host:

```yaml
steps:
- checkout: none                       # compiles to a constant-False condition (C-E03-260)
- script: echo "MARK 1 ok"
- script: |                            # tolerated failure
    echo "MARK 2 tolerated failure"
    exit 1
  continueOnError: true
- script: echo "MARK 3 after tolerated failure"
- script: echo "MARK 4 FAILED-COND RAN"
  condition: failed()
```

## Before

```
MARK 1 ok
MARK 2 tolerated failure
MARK 3 after tolerated failure
MARK 4 FAILED-COND RAN
job-job  010   6d15af64-…              Succeeded
job-job  030   Fail but continue       SucceededWithIssues
job-job  050   Should not run          Succeeded
```

Two steps ran that must not have: the `failed()` step **and** the `checkout: none` step, whose
compiled condition is the constant `False`. The second symptom is the one that gives the cause away
— no story about job status can make `False` true.

`conditions.sh` was correct (`cond_step_050() { azdo_status_failed }`), and so was every runtime
helper. `run-job.sh` was not:

```bash
from_step="" to_step="" only_step="" no_condition=false
...
    ${no_condition:+--no-condition}
```

`${name:+word}` substitutes `word` when `name` is set and **non-empty**. `no_condition` holds the
four-character string `false`, which is non-empty, so the flag was passed on every step of every
generated project ever produced. Demonstrated in isolation:

```console
$ bash -c 'no_condition=false; printf "[%s]\n" ${no_condition:+--no-condition}'
[--no-condition]
```

`run_step --no-condition` is the documented local force-run (docs/04 §2), so the runtime dutifully
skipped condition evaluation and ran everything.

## After

The flag moved into its own variable:

```bash
condition_flag=""
[[ "$no_condition" != true ]] || condition_flag=--no-condition
...
    ${condition_flag:+--no-condition}
```

Same probe, same command:

```
Skipping step due to condition evaluation.
MARK 1 ok
MARK 2 tolerated failure
MARK 3 after tolerated failure
Skipping step due to condition evaluation.
job-job  010   6d15af64-…              Skipped
job-job  030   Fail but continue       SucceededWithIssues
job-job  050   Should not run          Skipped
Result: SucceededWithIssues
```

Both directions hold: `failed()` is False after a *tolerated* failure while the tolerated failure's
`succeeded()` successor still runs (C-E06-036/040), and the constant-`False` checkout records
`Skipped` (C-E03-260).

## What it means for what was already measured

Every tier below L5 tests the emitter's *text* or the runtime's helpers directly, and both were
correct in isolation — which is exactly why 2,900 passing tests never saw this. The one assertion
that could have caught it is "run a generated project and check a step that must not run", and L5 is
the first tier that makes it. Sample 03 now carries a `failed()` step on **both** sides of the real
failure: absent-marker after the tolerated one, present-marker after the real one. A fix that made
conditions uniformly False would pass a one-sided assertion.

