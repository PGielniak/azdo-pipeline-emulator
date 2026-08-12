# oracle probe — case-each-upper

Same question for `each`, which also has to fold its `in` separator if it folds at all.

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
- ${{ EACH item IN parameters.items }}:
  - script: echo ${{ item }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): Unexpected symbol: 'item'. Located at position 6 within expression: 'EACH item IN parameters.items'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996\n/azure-pipelines.yml (Line: 7, Col: 3): Unexpected value '${{ EACH item IN parameters.items }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
