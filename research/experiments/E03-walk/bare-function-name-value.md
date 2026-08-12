# oracle probe — bare-function-name-value

A bare known-function name in an ordinary value position: `${{ eq }}`. The `each eq in …` probe was rejected "Expected '(' to follow a function: 'eq'", an error kind E02 does not implement (`ExprErrorCode` has no such member). This asks whether that kind belongs to the general expression grammar — an E02 gap — or only to the `each` variable slot.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ eq }}
steps:
- script: echo base
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 2, Col: 10): Expected '(' to follow a function: 'eq'. Located at position 1 within expression: 'eq'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
