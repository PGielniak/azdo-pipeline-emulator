# E06-S04-T03 — remaining logging commands (real run)

This hosted-agent probe distinguishes logging issue counters from task results, measures how
`task.complete` merges with process exit, and checks raw/task debug output with diagnostics off
and on. Preview cannot execute these logging-command effects.

- Probe pipeline: `oracle-logging-commands-probe` → `/experiments/logging-commands/logging-commands.yml`
- Run: id 545, state `completed`, result `failed`

## Probe YAML

```yaml
trigger: none
pr: none
jobs:
- job: issueResult
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.logissue type=warning]synthetic warning issue'
      echo '##vso[task.logissue type=error]synthetic error issue'
      echo 'CASE ISSUE_STEP_CONTINUED=yes'
    displayName: Log warning and error issues
- job: completeResults
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.complete result=SucceededWithIssues;]synthetic partial result'
      echo 'CASE AFTER_PARTIAL_COMPLETE=yes'
    displayName: Complete as succeeded with issues
  - bash: |
      echo '##vso[task.complete result=Failed;]synthetic failed result'
      echo 'CASE AFTER_FAILED_COMPLETE=yes'
    displayName: Complete as failed
  - bash: |
      echo '##vso[task.complete result=Succeeded;]synthetic success result'
      echo 'CASE BEFORE_EXIT_ONE=yes'
      exit 1
    condition: always()
    displayName: Complete success then exit one
- job: debugOff
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##[debug]FORMAT DEBUG OFF'
      echo '##vso[task.debug]VSO DEBUG OFF'
      echo '##[group]FORMAT GROUP OFF'
      echo 'FORMAT GROUP BODY OFF'
      echo '##[endgroup]'
    displayName: Debug formatting disabled
- job: debugOn
  variables:
    System.Debug: true
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##[debug]FORMAT DEBUG ON'
      echo '##vso[task.debug]VSO DEBUG ON'
      echo '##[group]FORMAT GROUP ON'
      echo 'FORMAT GROUP BODY ON'
      echo '##[endgroup]'
    displayName: Debug formatting enabled
```

## Task results and issue counters

| task | result | errors | warnings |
|---|---|---:|---:|
| `Complete as failed` | `failed` | 0 | 0 |
| `Complete success then exit one` | `failed` | 1 | 0 |
| `Debug formatting disabled` | `succeeded` | 0 | 0 |
| `Log warning and error issues` | `succeeded` | 1 | 1 |
| `Complete as succeeded with issues` | `succeededWithIssues` | 0 | 0 |
| `Debug formatting enabled` | `succeeded` | 0 | 0 |

## Relevant log lines

```text
##[debug]FORMAT DEBUG OFF
##[group]FORMAT GROUP OFF
FORMAT GROUP BODY OFF
##[debug]FORMAT DEBUG ON
##[debug]VSO DEBUG ON
##[group]FORMAT GROUP ON
FORMAT GROUP BODY ON
CASE AFTER_PARTIAL_COMPLETE=yes
CASE AFTER_FAILED_COMPLETE=yes
CASE BEFORE_EXIT_ONE=yes
CASE ISSUE_STEP_CONTINUED=yes
```

## Interpretation

- A raw error issue increments the timeline error counter but leaves an otherwise successful
  task `succeeded`; warning and error counters therefore do not determine task result.
- `task.complete` changes the result but does not stop the shell: both post-command CASE lines
  ran. `SucceededWithIssues` persisted, `Failed` persisted, and process exit 1 remained `failed`
  after an earlier `Succeeded` command.
- Raw `##[debug]` and group formatting lines are retained even with `System.Debug` unset. The
  separate `##vso[task.debug]` message is absent when diagnostics are off and present when on.

Regenerate with `node scripts/logging-commands-realrun.ts`; this queues one hosted run.
