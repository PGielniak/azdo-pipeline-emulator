# oracle probe — sequence-if-wins

Sequence chain: the first true `if` branch is spliced and later true `elseif`/`else` bodies are suppressed.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo before
- ${{ if eq(1, 1) }}:
  - script: echo selected-if
- ${{ elseif eq(2, 2) }}:
  - script: echo not-elseif
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
        script: echo selected-if
    - task: CmdLine@2
      inputs:
        script: echo after

```
