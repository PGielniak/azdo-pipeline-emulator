# oracle probe — nested-sequence-chain

A selected sequence body is recursively expanded, including its own nested elseif chain.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 1) }}:
  - script: echo outer-before
  - ${{ if eq(1, 2) }}:
    - script: echo nested-not-if
  - ${{ elseif eq(2, 2) }}:
    - script: echo nested-selected-elseif
  - ${{ else }}:
    - script: echo nested-not-else
  - script: echo outer-after
- ${{ else }}:
  - script: echo outer-not-else
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
        script: echo outer-before
    - task: CmdLine@2
      inputs:
        script: echo nested-selected-elseif
    - task: CmdLine@2
      inputs:
        script: echo outer-after

```
