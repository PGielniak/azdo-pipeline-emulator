# E06-S01-T01 — read-only variable overwrite (real run)

This probe establishes the **effective hosted-agent policy** for a variable first set with
`isReadOnly=true` and then set again in the same step. Preview cannot answer this because
only the agent executes logging commands.

- Probe pipeline: `oracle-readonly-variable-probe` → `/experiments/readonly-variable.yml`
- Run: id 539, state `completed`, result `succeeded`
- First task has `continueOnError: true`; the `always()` observation task therefore executes
  even if the overwrite is enforced as an error.

## Probe YAML

```yaml
trigger: none
pr: none
jobs:
- job: readonly
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo "##vso[task.setvariable variable=readonlyProbe;isReadOnly=true]first"
      echo "##vso[task.setvariable variable=readonlyProbe]second"
    name: write
    continueOnError: true
  - bash: |
      printf 'READONLY_PROBE=%s\n' '$(readonlyProbe)'
    name: observe
    condition: always()
```

## Task results

| task | result |
|---|---|
| `Initialize job` | `succeeded` |
| `observe` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `write` | `succeededWithIssues` |

## Relevant log lines

```text
2026-08-12T20:00:46.9737764Z ##[error]Unable to process command '##vso[task.setvariable variable=readonlyProbe]second' successfully. Please reference documentation (http://go.microsoft.com/fwlink/?LinkId=817296)
2026-08-12T20:00:46.9752402Z ##[error]Overwriting readonly variable 'readonlyProbe' is not permitted. See https://github.com/microsoft/azure-pipelines-yaml/blob/master/design/readonly-variables.md for details.
2026-08-12T20:00:47.1645780Z READONLY_PROBE=first
```

Interpretation: `READONLY_PROBE=second` proves warning-and-overwrite; `first` with a task
error (shown as `SucceededWithIssues` here only because `continueOnError` is true) proves
enforced no-overwrite; `first` with a warning would prove the former local
warn-and-ignore design.

Regenerate with `node scripts/readonly-variable-realrun.ts`; this queues a new hosted run.
