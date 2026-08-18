# oracle probe — orphan-elseif-sequence

An `elseif` with no immediately preceding `if` is rejected.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- ${{ elseif eq(1, 1) }}:
  - script: echo orphan
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 2, Col: 3): The expression directive 'elseif' is not supported in this context\n/azure-pipelines.yml (Line: 2, Col: 3): Unexpected value '${{ elseif eq(1, 1) }}'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
