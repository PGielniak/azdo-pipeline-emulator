# oracle probe — mapping-no-match-no-else

A mapping chain with no true condition and no `else` contributes no entries; surrounding keys remain.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo mapping
  env:
    BEFORE: before
    ${{ if eq(1, 2) }}:
      NOT_IF: no
    ${{ elseif eq(2, 3) }}:
      NOT_ELSEIF: no
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
        AFTER: after
      inputs:
        script: echo mapping

```
