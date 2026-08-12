# oracle probe — case-elseif-else-upper

Same question for the `elseif`/`else` chain keywords.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ if eq(1, 2) }}:
  - script: echo no
- ${{ ELSEIF eq(1, 1) }}:
  - script: echo elseif
- ${{ ELSE }}:
  - script: echo else
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 5, Col: 3): Unexpected symbol: 'eq'. Located at position 8 within expression: 'ELSEIF eq(1, 1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996\n/azure-pipelines.yml (Line: 5, Col: 3): Unexpected value '${{ ELSEIF eq(1, 1) }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
