# oracle probe — nested-mapping-chain

A selected sequence body is recursively expanded when it contains a mapping-position conditional chain.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 1) }}:
  - script: echo nested-mapping
    env:
      BEFORE: before
      ${{ if eq(1, 2) }}:
        PICKED: if
      ${{ else }}:
        PICKED: else
      AFTER: after
```

### Response — finalYaml

```yaml
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      env:
        BEFORE: before
        PICKED: else
        AFTER: after
      inputs:
        script: echo nested-mapping

```
