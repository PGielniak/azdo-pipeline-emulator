# oracle probe — interrupted-else-after-true

An intervening sequence sibling is retained after a true `if`, while the later `else` remains in that selected chain and is suppressed.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 1) }}:
  - script: echo selected-if
- script: echo interruption
- ${{ else }}:
  - script: echo not-else
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
        script: echo selected-if
    - task: CmdLine@2
      inputs:
        script: echo interruption

```
