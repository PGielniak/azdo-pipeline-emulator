# E04-S03-T01 — matrix & parallel naming and slice variables (real run)

This probe establishes the **effective** job naming and slice variables for `strategy: matrix`
and `strategy: parallel`. Preview never expands `strategy:` (C-E12-018), so the multiplied jobs
are only observable by queueing a run and reading its timeline and logs.

- Probe pipeline: `oracle-matrix-parallel-probe` → `/experiments/matrix-parallel.yml`
- Run: id 546, state `completed`, result `succeeded`

## Probe YAML

```yaml
trigger: none
pr: none
jobs:
- job: Build
  strategy:
    matrix:
      Alpha:
        MATRIX_VAR: 'a'
      Beta:
        MATRIX_VAR: 'b'
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "SYSTEM_JOBNAME=$(System.JobName)"
      echo "SYSTEM_JOBDISPLAYNAME=$(System.JobDisplayName)"
      echo "AGENT_JOBNAME=$(Agent.JobName)"
      echo "MATRIX_VAR=$(MATRIX_VAR)"

- job: Slice
  strategy:
    parallel: 2
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "POSITION=$(System.JobPositionInPhase)"
      echo "TOTAL=$(System.TotalJobsInPhase)"
```

## Job records (timeline, type `Job`)

| name | result |
|---|---|
| `Build Beta` | `succeeded` |
| `Build Alpha` | `succeeded` |
| `Slice 2` | `succeeded` |
| `Slice 1` | `succeeded` |

## Relevant log lines

```text
          echo "SYSTEM_JOBNAME=$(System.JobName)"
          echo "SYSTEM_JOBDISPLAYNAME=$(System.JobDisplayName)"
          echo "AGENT_JOBNAME=$(Agent.JobName)"
          echo "MATRIX_VAR=$(MATRIX_VAR)"
          echo "POSITION=$(System.JobPositionInPhase)"
          echo "TOTAL=$(System.TotalJobsInPhase)"
Result: 'echo "SYSTEM_JOBNAME=$(System.JobName)"
echo "SYSTEM_JOBDISPLAYNAME=$(System.JobDisplayName)"
echo "AGENT_JOBNAME=$(Agent.JobName)"
echo "MATRIX_VAR=$(MATRIX_VAR)"
Result: 'echo "POSITION=$(System.JobPositionInPhase)"
echo "TOTAL=$(System.TotalJobsInPhase)"
2026-08-24T06:32:55.5158670Z SYSTEM_JOBNAME=Beta
2026-08-24T06:32:55.5162279Z SYSTEM_JOBDISPLAYNAME=Build Beta
2026-08-24T06:32:55.5164002Z AGENT_JOBNAME=Build Beta
2026-08-24T06:32:55.5165568Z MATRIX_VAR=b
2026-08-24T06:33:13.0929872Z POSITION=1
2026-08-24T06:33:13.0931613Z TOTAL=2
2026-08-24T06:33:26.8337298Z POSITION=2
2026-08-24T06:33:40.7453851Z SYSTEM_JOBNAME=Alpha
2026-08-24T06:33:40.7455793Z SYSTEM_JOBDISPLAYNAME=Build Alpha
2026-08-24T06:33:40.7458256Z AGENT_JOBNAME=Build Alpha
2026-08-24T06:33:40.7460099Z MATRIX_VAR=a
```

Interpretation: `Build Alpha`/`Build Beta` in the Job records proves the space-separated naming
of C-E04-110; `SYSTEM_JOBNAME` vs `SYSTEM_JOBDISPLAYNAME` per leg shows whether the identifier or
only the display name gains the key; `POSITION`/`TOTAL` show whether `System.JobPositionInPhase`
is 1-based.

Regenerate with `node scripts/matrix-parallel-realrun.ts`; this queues a new hosted run.
