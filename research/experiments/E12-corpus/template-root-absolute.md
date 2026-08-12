# oracle probe — template-root-absolute

Reference spelled with a leading slash (`/corpus/_probe/steps.yml`) — the documented "root-relative" form. Corpus fixtures use whichever of these two forms works, because it must mean the same path locally and server-side.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- template: /corpus/_probe/steps.yml
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
