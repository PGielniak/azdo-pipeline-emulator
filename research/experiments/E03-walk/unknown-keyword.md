# oracle probe — unknown-keyword

An unrecognized directive-shaped key `${{ foreach item in parameters.items }}`. The error sentence says whether directive detection is a closed keyword set consumed *before* the expression parse, or a fallthrough into ordinary expression-key parsing.

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
- ${{ foreach item in parameters.items }}:
  - script: echo x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): Unexpected symbol: 'item'. Located at position 9 within expression: 'foreach item in parameters.items'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996\n/azure-pipelines.yml (Line: 7, Col: 3): Unexpected value '${{ foreach item in parameters.items }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
