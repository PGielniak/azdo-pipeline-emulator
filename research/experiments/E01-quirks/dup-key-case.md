# oracle probe — dup-key-case

QUIRK — do duplicate keys collide case-insensitively? The schema matches keywords with `ignoreCase` (C-E01-015), so `displayName` + `displayname` may or may not be "already defined". Decides whether our duplicate check folds case.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- script: echo one
  displayName: first
  displayname: second
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 4, Col: 3): 'displayname' is already defined",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
