# oracle probe — case-insert-upper

Same question for `insert`, the one directive the actions/runner fork also has.

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
    ${{ INSERT }}: ${{ parameters.extra }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 10, Col: 5): Unrecognized value: 'INSERT'. Located at position 1 within expression: 'INSERT'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
