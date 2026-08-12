# oracle probe — bare-nonstatus-job-condition

The same bare non-status function has the missing-parenthesis error in a job condition, whose function table is parsed by the service preview path.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
jobs:
- job: Probe
  condition: eq
  steps:
  - script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Expected '(' to follow a function: 'eq'. Located at position 1 within expression: 'eq'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
