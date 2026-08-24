# oracle probe — missing-job-dep

A job `dependsOn` a job name that does not exist in its own stage. Same question, one level down.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
stages:
- stage: A
  jobs:
  - job: A1
    steps:
    - script: echo A
  - job: A2
    dependsOn: NoSuchJob
    steps:
    - script: echo B
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Stage A job A2 depends on unknown job NoSuchJob.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
