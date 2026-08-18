# oracle probe — sequence-elseif-wins

Sequence chain: false `if` clauses are skipped and the first true `elseif` body is spliced.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo before
- ${{ if eq(1, 2) }}:
  - script: echo not-if
- ${{ elseif eq(2, 2) }}:
  - script: echo selected-elseif
- ${{ elseif eq(3, 3) }}:
  - script: echo not-second-elseif
- ${{ else }}:
  - script: echo not-else
- script: echo after
```

### Response — finalYaml

```yaml
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo before
    - task: CmdLine@2
      inputs:
        script: echo selected-elseif
    - task: CmdLine@2
      inputs:
        script: echo after

```
