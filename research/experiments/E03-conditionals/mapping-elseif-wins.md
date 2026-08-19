# oracle probe — mapping-elseif-wins

Mapping chain: only the winning branch entries are merged at the directive position, between ordinary siblings.

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
      PICKED: if
      IF_ONLY: no
    ${{ elseif eq(2, 2) }}:
      PICKED: elseif
      ELSEIF_ONLY: yes
    ${{ else }}:
      PICKED: else
      ELSE_ONLY: no
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
        PICKED: elseif
        ELSEIF_ONLY: yes
        AFTER: after
      inputs:
        script: echo mapping

```
