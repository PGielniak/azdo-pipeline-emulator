# oracle probe — arity-each-four-parameters

Four parameters after `each`. Pins `each`'s expected count (`<var> in <collection>` = 3).

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
- ${{ each a in parameters.items extra }}:
  - script: echo x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): Exactly 3 parameter(s) were expected following the directive 'each'. Actual parameter count: 4\n/azure-pipelines.yml (Line: 7, Col: 3): Unexpected value '${{ each a in parameters.items extra }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
