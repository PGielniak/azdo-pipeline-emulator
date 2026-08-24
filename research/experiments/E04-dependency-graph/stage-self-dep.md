# oracle probe — stage-self-dep

A stage depends on itself — the minimal cycle.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
stages:
- stage: A
  dependsOn: A
  jobs:
  - job: a1
    steps:
    - script: echo A
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "The pipeline must contain at least one stage with no dependencies.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
