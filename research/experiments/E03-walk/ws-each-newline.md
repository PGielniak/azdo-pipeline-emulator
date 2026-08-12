# oracle probe — ws-each-newline

A directive key written across lines — the delimited text carries a real newline, which C-E02-104 showed is trimmed at the ends but says nothing about the middle.

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
- ${{ each item
     in parameters.items }}:
  - script: echo ${{ item }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml: (Line: 8, Col: 28, Idx: 136) - (Line: 8, Col: 28, Idx: 136): Mapping values are not allowed in this context.\nObject reference not set to an instance of an object.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
