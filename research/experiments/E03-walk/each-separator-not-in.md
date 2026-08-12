# oracle probe — each-separator-not-in

The separator word replaced: `${{ each item on parameters.items }}`. Says whether the middle parameter is checked against the literal `in` and with what message.

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
- ${{ each item on parameters.items }}:
  - script: echo x
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): The value 'on' is unexpected. The expected format of an 'each' expression is: ${ each <identifier> in <value> }\n/azure-pipelines.yml (Line: 7, Col: 3): Unexpected value '${{ each item on parameters.items }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
