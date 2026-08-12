# oracle probe — elseif-spelled-else-if

Is `elseif` one token? `${{ else if … }}` is the spelling a developer reaches for first.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ if eq(1, 2) }}:
  - script: echo no
- ${{ else if eq(1, 1) }}:
  - script: echo elseif
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 5, Col: 3): Exactly 0 parameter(s) were expected following the directive 'else'. Actual parameter count: 2\n/azure-pipelines.yml (Line: 5, Col: 3): Unexpected value '${{ else if eq(1, 1) }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
