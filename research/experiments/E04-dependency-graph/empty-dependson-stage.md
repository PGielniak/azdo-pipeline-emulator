# oracle probe — empty-dependson-stage

Control: `dependsOn: []` on a stage survives expansion — the "runs in parallel" meaning is run-time ordering, not expansion.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
stages:
- stage: A
  jobs:
  - job: a1
    steps:
    - script: echo A
- stage: B
  dependsOn: []
  jobs:
  - job: b1
    steps:
    - script: echo B
```

### Response — finalYaml

```yaml
stages:
- stage: A
  jobs:
  - job: a1
    steps:
    - task: CmdLine@2
      inputs:
        script: echo A
- stage: B
  dependsOn: []
  jobs:
  - job: b1
    steps:
    - task: CmdLine@2
      inputs:
        script: echo B

```
