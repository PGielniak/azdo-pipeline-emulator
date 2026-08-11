# oracle probe — template-nested-relative

A template that itself references a sibling by bare name (`nested-b.yml` from inside `/corpus/_probe/nested-a.yml`). Unlike the override, a template IS a file, so this pins that nested references resolve relative to the containing template.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- template: /corpus/_probe/nested-a.yml
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
        script: echo from-a
    - task: CmdLine@2
      inputs:
        script: echo from-b

```
