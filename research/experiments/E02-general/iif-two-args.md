# oracle probe — iif-two-args

Compile-time expression: `iif(true, 'yes')`. Checks two-argument arity.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ iif(true, 'yes') }}
steps:
- script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 2, Col: 10): Unexpected symbol: ')'. Located at position 16 within expression: 'iif(true, 'yes')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
