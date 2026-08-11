# oracle probe — bad-expression

Expression errors report a position *within the expression* in addition to line/col, and link the expressions documentation.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  a: ${{ nosuchfunc(1) }}
steps:
- script: echo hi
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 2, Col: 6): Unrecognized value: 'nosuchfunc'. Located at position 1 within expression: 'nosuchfunc(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
