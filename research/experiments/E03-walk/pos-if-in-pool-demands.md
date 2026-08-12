# oracle probe — pos-if-in-pool-demands

Batch 1 found a value expression expands in `pool.demands` (outside the doc Note's list) while a *directive* in `resources.repositories` is rejected "A template expression is not allowed in this context". Asks whether that gate is specific to `resources` or applies wherever the position is not a documented-expandable one.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
jobs:
- job: A
  pool:
    vmImage: ubuntu-latest
    demands:
    - ${{ if eq(1, 1) }}:
      - agent.os -equals Linux
  steps:
  - script: echo base
```

### Response — finalYaml

```yaml
stages:
- stage: __default
  jobs:
  - job: A
    pool:
      vmImage: ubuntu-latest
      demands:
      - agent.os -equals Linux
    steps:
    - task: CmdLine@2
      inputs:
        script: echo base

```
