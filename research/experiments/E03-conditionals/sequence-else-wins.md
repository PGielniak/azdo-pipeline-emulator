# oracle probe — sequence-else-wins

Sequence chain: `else` is selected only when every preceding condition is false.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 2) }}:
  - script: echo not-if
- ${{ elseif eq(2, 3) }}:
  - script: echo not-elseif
- ${{ else }}:
  - script: echo selected-else
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
        script: echo selected-else

```
