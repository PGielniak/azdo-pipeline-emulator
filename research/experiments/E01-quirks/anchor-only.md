# oracle probe — anchor-only

QUIRK — an anchor that is never referenced. Discriminates "anchor definitions are rejected" from "only alias resolution is rejected"; decides whether our check fires on `&name` or only on `*name`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  a: &shared first
  b: second
steps:
- script: echo $(a) $(b)
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml: Anchors are not currently supported. Remove the anchor 'shared'\nObject reference not set to an instance of an object.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
