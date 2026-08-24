# E04-S03-T03 — runOnce output-variable naming (real run)

This hosted-agent probe establishes the **effective** output-variable key for a runOnce deployment
job read from a later stage via `stageDependencies`. The doc asserts the first segment is the
**job name** (`A1.setvarStep.myOutputVar`), not the lifecycle hook (`deploy.setvarStep.myOutputVar`);
preview cannot execute the setvariable, so the only way to observe the registered key is to queue
a run and read both spellings back.

- Probe pipeline: `oracle-deployment-output-probe` → `/experiments/deployment-output.yml`
- Run: id 548, state `completed`, result `succeeded`

## Probe YAML

```yaml
trigger: none
pr: none
stages:
- stage: StageA
  jobs:
  - deployment: A1
    pool:
      vmImage: ubuntu-latest
    environment: corpus-staging
    strategy:
      runOnce:
        deploy:
          steps:
          - bash: echo "##vso[task.setvariable variable=myOutputVar;isOutput=true]deployment-value"
            name: setvarStep
          - bash: echo "CASE SAME_JOB=$(setvarStep.myOutputVar)"
- stage: StageB
  dependsOn: StageA
  variables:
    jobNameKey: $[stageDependencies.StageA.A1.outputs['A1.setvarStep.myOutputVar']]
    hookNameKey: $[stageDependencies.StageA.A1.outputs['deploy.setvarStep.myOutputVar']]
  jobs:
  - job: B1
    pool:
      vmImage: ubuntu-latest
    steps:
    - bash: |
        echo "CASE JOBNAME_KEY=[$(jobNameKey)]"
        echo "CASE HOOKNAME_KEY=[$(hookNameKey)]"
```

## Job records (timeline, type `Job`)

| name | result |
|---|---|
| `A1` | `succeeded` |
| `B1` | `succeeded` |

## Relevant log lines

```text
2026-08-24T08:38:50.4207233Z CASE SAME_JOB=deployment-value
2026-08-24T08:39:35.3205787Z CASE JOBNAME_KEY=[deployment-value]
2026-08-24T08:39:35.3207561Z CASE HOOKNAME_KEY=[]
```

Interpretation: `SAME_JOB` shows the output variable is set and readable in the same hook;
`JOBNAME_KEY` and `HOOKNAME_KEY` show which of the two `stageDependencies` spellings resolves. A
non-empty `JOBNAME_KEY` with an empty `HOOKNAME_KEY` proves the job-name quirk; the opposite would
refute the doc.

Regenerate with `node scripts/deployment-output-realrun.ts`; this queues a hosted run.
