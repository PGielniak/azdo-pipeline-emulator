# oracle probe — if-alongside-ordinary-keys

Control for the mapping walk: a directive key as a *sibling* of ordinary keys, which the corpus already exercises (06-extends-each-joblist) but never in isolation.

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
    TAIL: '1'
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
        TAIL: '1'
      inputs:
        script: echo base

```
