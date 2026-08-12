# oracle probe — arity-if-zero-parameters

A bare `${{ if }}`. If this gives "Exactly 1 parameter(s) … Actual parameter count: 0" then `if` does have an arity check and the two-parameter case is the special one; if it gives an expression error, `if` never reports arity.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ if }}:
  - script: echo x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 3, Col: 3): Unrecognized value: 'if'. Located at position 1 within expression: 'if'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996\n/azure-pipelines.yml (Line: 3, Col: 3): Expected at least one key-value pair in the mapping",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
