# oracle probe — pos-expr-in-trigger

The template-expressions doc Note says expressions are expanded only for stages/jobs/steps/containers and *not* inside `trigger`. Submits `trigger:\n- ${{ 'main' }}` — expansion to `main` refutes the Note; a literal or a rejection confirms it.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
trigger:
- ${{ 'main' }}
steps:
- script: echo base
```

### Response — finalYaml

```yaml
trigger:
  branches:
    include:
    - main
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo base

```
