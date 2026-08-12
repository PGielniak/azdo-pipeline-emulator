# oracle probe — unknown-keyword-mapping

The same unrecognized key in mapping position, where an ordinary expression key is legal (`${{ pair.key }}: …`) — so this one separates "not a directive" from "not a valid key".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: [alpha, beta]
steps:
- script: echo base
  env:
    BASE: '1'
    ${{ foreach item in parameters.items }}: x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 9, Col: 5): Unexpected symbol: 'item'. Located at position 9 within expression: 'foreach item in parameters.items'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
