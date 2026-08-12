# oracle probe — template-repo-relative

Reference spelled relative to the **repository root** (`corpus/_probe/steps.yml`). If this expands, the override behaves as though it were a file at the repo root.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- template: corpus/_probe/steps.yml
```

### Response — finalYaml

```yaml
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      displayName: probe template step
      inputs:
        script: echo from-template

```
