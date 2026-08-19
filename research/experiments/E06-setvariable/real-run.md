# E06-S04-T02 — task.setvariable timing and outputs (real run)

This hosted-agent probe measures the current-task boundary, following-task macro/environment
visibility, same-job output syntax, dependency output mapping, and secret masking. Preview
cannot execute any of those logging-command effects.

- Probe pipeline: `oracle-setvariable-probe` → `/experiments/setvariable/setvariable.yml`
- Run: id 544, state `completed`, result `succeeded`

## Probe YAML

```yaml
trigger: none
pr: none
jobs:
- job: producer
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      mask_value="synthetic-mask-$BUILD_BUILDID"
      echo "##vso[task.setvariable variable=plain]later-value"
      echo "##vso[task.setvariable variable=out;isOutput=true]output-value"
      echo "##vso[task.setvariable variable=masked;isSecret=true]$mask_value"
      printf 'CASE CURRENT_MACRO=%s\n' '$(plain)'
      printf 'CASE CURRENT_ENV=%s\n' "${PLAIN-unset}"
      printf 'CASE CURRENT_OUTPUT=%s\n' '$(setVars.out)'
      printf 'CASE CURRENT_SECRET=%s\n' "$mask_value"
    name: setVars
    displayName: Set and observe in current task
  - bash: |
      printf 'CASE LATER_MACRO=%s\n' '$(plain)'
      printf 'CASE LATER_ENV=%s\n' "${PLAIN-unset}"
      printf 'CASE LATER_OUTPUT=%s\n' '$(setVars.out)'
      printf 'CASE LATER_SECRET=%s\n' '$(masked)'
    displayName: Observe in following task
- job: consumer
  dependsOn: producer
  variables:
    imported: $[ dependencies.producer.outputs['setVars.out'] ]
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      printf 'CASE CROSS_JOB=%s\n' '$(imported)'
    displayName: Observe dependency output
```

## Task results

| task | result |
|---|---|
| `Initialize job` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Observe in following task` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Observe dependency output` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Set and observe in current task` | `succeeded` |

## Relevant log lines

```text
2026-08-19T14:25:44.9365187Z CASE CURRENT_MACRO=$(plain)
2026-08-19T14:25:44.9367288Z CASE CURRENT_ENV=unset
2026-08-19T14:25:44.9368964Z CASE CURRENT_OUTPUT=$(setVars.out)
2026-08-19T14:25:44.9371085Z CASE CURRENT_SECRET=***
2026-08-19T14:25:45.1567489Z CASE LATER_MACRO=later-value
2026-08-19T14:25:45.1572073Z CASE LATER_ENV=later-value
2026-08-19T14:25:45.1573233Z CASE LATER_OUTPUT=output-value
2026-08-19T14:25:45.1575146Z CASE LATER_SECRET=***
2026-08-19T14:26:06.4235516Z CASE CROSS_JOB=output-value
```

## Interpretation

- The current task retains literal `$(plain)`/`$(setVars.out)` text and has no `PLAIN`
  environment entry, while the following task sees the new plain value through both forms.
- The output variable is available in the following same-job task as `$(setVars.out)` and in
  the dependent job through `dependencies.producer.outputs['setVars.out']`.
- Both the output immediately after secret registration and the next task’s macro expansion
  render as `***`; the generated synthetic source value is not retained in this transcript.

Regenerate with `node scripts/setvariable-realrun.ts`; this queues one hosted run.
