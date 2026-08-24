# oracle probe — job-cycle

Two jobs in one stage depend on each other.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
stages:
- stage: A
  jobs:
  - job: A1
    dependsOn: A2
    steps:
    - script: echo A
  - job: A2
    dependsOn: A1
    steps:
    - script: echo B
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Stage A must contain at least one job with no dependencies.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
