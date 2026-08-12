# oracle probe — ctl-if-sequence

Control. Documented lower-case `if` in sequence position expands.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ if eq(1, 1) }}:
  - script: echo inserted
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
        script: echo base
    - task: CmdLine@2
      inputs:
        script: echo inserted

```
