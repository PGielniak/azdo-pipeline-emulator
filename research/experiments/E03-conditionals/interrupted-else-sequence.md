# oracle probe — interrupted-else-sequence

An ordinary sequence sibling does not end a chain; a later `else` still belongs to the preceding false `if`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 2) }}:
  - script: echo not-if
- script: echo interruption
- ${{ else }}:
  - script: echo orphan
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
        script: echo interruption
    - task: CmdLine@2
      inputs:
        script: echo orphan

```
