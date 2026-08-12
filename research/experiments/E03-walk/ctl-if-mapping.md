# oracle probe — ctl-if-mapping

Control. Documented lower-case `if` in mapping position expands.

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
      EXTRA: '1'
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
        EXTRA: '1'
      inputs:
        script: echo base

```
