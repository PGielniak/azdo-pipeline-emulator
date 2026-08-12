# oracle probe — pos-expr-in-pool-demands

A position that is neither a documented-expandable one nor one the Note names — a job `pool.demands` entry. Narrows whether the Note's list is exhaustive.

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
    - ${{ 'agent.os -equals Linux' }}
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
