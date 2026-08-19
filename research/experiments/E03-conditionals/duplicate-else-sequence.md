# oracle probe — duplicate-else-sequence

Only one `else` may terminate a chain; a second adjacent `else` is rejected as orphaned.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 2) }}:
  - script: echo not-if
- ${{ else }}:
  - script: echo selected-else
- ${{ else }}:
  - script: echo duplicate
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 6, Col: 3): The expression directive 'else' is not supported in this context\n/azure-pipelines.yml (Line: 6, Col: 3): Unexpected value '${{ else }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
