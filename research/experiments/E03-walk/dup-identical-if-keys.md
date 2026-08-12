# oracle probe — dup-identical-if-keys

Two **byte-identical** `${{ if }}` keys in one mapping. C-E01-023 has the service rejecting duplicate keys case-insensitively at every nesting level; if that check runs before expansion it fires here, and E01 quirks would reject documents the service accepts.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo base
  env:
    BASE: '1'
    ${{ if eq(1, 1) }}:
      A: '1'
    ${{ if eq(1, 1) }}:
      B: '1'
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
        BASE: '1'
        A: '1'
        B: '1'
      inputs:
        script: echo base

```
