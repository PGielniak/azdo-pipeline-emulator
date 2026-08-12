# oracle probe — each-separator-upper

Separator spelled `IN` with a lower-case `each` keyword. `case-each-upper` could not answer this — its `EACH` was already not a directive, so the whole text fell through to the expression parser and the `IN` was never reached.

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
- ${{ each item IN parameters.items }}:
  - script: echo ${{ item }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): The value 'IN' is unexpected. The expected format of an 'each' expression is: ${ each <identifier> in <value> }\n/azure-pipelines.yml (Line: 7, Col: 3): Unexpected value '${{ each item IN parameters.items }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
