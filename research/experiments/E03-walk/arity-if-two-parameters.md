# oracle probe — arity-if-two-parameters

Two expressions after `if`. Expect "Exactly 1 parameter(s) … Actual parameter count: 2", which simultaneously pins `if`'s count and proves a parenthesised call is ONE parameter.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ if eq(1, 1) eq(2, 2) }}:
  - script: echo x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 3, Col: 3): Unexpected symbol: 'eq'. Located at position 4 within expression: 'if eq(1, 1) eq(2, 2)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996\n/azure-pipelines.yml (Line: 3, Col: 3): Unexpected value '${{ if eq(1, 1) eq(2, 2) }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
