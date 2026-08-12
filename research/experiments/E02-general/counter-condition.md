# oracle probe — counter-condition

Job condition: `counter('prefix', 7)`. Confirms counter is forbidden in conditions.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
jobs:
- job: Probe
  condition: counter('prefix', 7)
  steps:
  - script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Unrecognized value: 'counter'. Located at position 1 within expression: 'counter('prefix', 7)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
