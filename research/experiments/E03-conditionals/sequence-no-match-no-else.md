# oracle probe — sequence-no-match-no-else

A sequence chain with no true condition and no `else` contributes no items; ordinary siblings remain ordered.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo before
- ${{ if eq(1, 2) }}:
  - script: echo not-if
- ${{ elseif eq(2, 3) }}:
  - script: echo not-elseif
- script: echo after
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
        script: echo before
    - task: CmdLine@2
      inputs:
        script: echo after

```
