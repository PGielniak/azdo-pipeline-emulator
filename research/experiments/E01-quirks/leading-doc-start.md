# oracle probe — leading-doc-start

QUIRK — a single document introduced by a leading `---` marker. Real pipelines are commonly written this way, so rejecting it would produce false rejections; docs/01 §1 is ambiguous between "separator" and "any document marker".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
---
steps:
- script: echo one
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
        script: echo one

```
