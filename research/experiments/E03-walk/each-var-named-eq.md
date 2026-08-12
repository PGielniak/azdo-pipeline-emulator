# oracle probe — each-var-named-eq

Batch 1: a loop variable named `in` failed with "Expected '(' to follow a function: 'in'" over the expression text `'in'` — which reads as the *variable name itself* being handed to the expression parser. `eq` is a function too but is not the `in` separator, so it separates that reading from "the splitter mis-split on the second `in`".

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
- ${{ each eq in parameters.items }}:
  - script: echo ${{ eq }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 8, Col: 13): Expected '(' to follow a function: 'eq'. Located at position 1 within expression: 'eq'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
