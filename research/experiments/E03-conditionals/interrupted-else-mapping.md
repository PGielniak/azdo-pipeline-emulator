# oracle probe — interrupted-else-mapping

An ordinary mapping key does not end a chain; a later `else` still belongs to the preceding false `if` and merges at its own position.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo mapping
  env:
    ${{ if eq(1, 2) }}:
      NOT_IF: no
    BETWEEN: between
    ${{ else }}:
      SELECTED_ELSE: yes
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
        BETWEEN: between
        SELECTED_ELSE: yes
        AFTER: after
      inputs:
        script: echo mapping

```
