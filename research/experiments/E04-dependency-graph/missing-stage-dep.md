# oracle probe — missing-stage-dep

A stage `dependsOn` a stage name that does not exist. Does preview validate the cross-reference, and with what wording?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
stages:
- stage: A
  jobs:
  - job: a1
    steps:
    - script: echo A
- stage: B
  dependsOn: NoSuchStage
  jobs:
  - job: b1
    steps:
    - script: echo B
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Stage B depends on unknown stage NoSuchStage.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
