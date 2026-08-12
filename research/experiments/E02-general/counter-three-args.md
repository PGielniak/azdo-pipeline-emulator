# oracle probe — counter-three-args

Runtime variable expression: `counter('prefix', 7, 1)`. Checks the upper arity bound.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  probe: $[ counter('prefix', 7, 1) ]
steps:
- script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "An error occurred while loading the YAML build pipeline. Unexpected symbol: ','. Located at position 20 within expression: 'counter('prefix', 7, 1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
