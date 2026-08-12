# oracle probe — arity-insert-one-parameter

A parameter after `insert`, which takes none. Third data point for the arity sentence.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
parameters:
- name: extra
  type: object
  default:
    EXTRA_A: '1'
steps:
- script: echo base
  env:
    BASE: '1'
    ${{ insert extra }}: ${{ parameters.extra }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 10, Col: 5): Exactly 0 parameter(s) were expected following the directive 'insert'. Actual parameter count: 1",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
