# oracle probe — each-var-named-in

The loop variable itself is named `in`: `${{ each in in parameters.items }}`. Settles whether the separator is found by position (2nd word) or by searching for the token.

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
- ${{ each in in parameters.items }}:
  - script: echo ${{ in }}
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 8, Col: 13): Expected '(' to follow a function: 'in'. Located at position 1 within expression: 'in'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
