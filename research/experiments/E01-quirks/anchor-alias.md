# oracle probe — anchor-alias

QUIRK — anchors + aliases. Docs say anchors are unsupported (C-E01-021); this pins what the service actually answers, and if it accepts, whether the alias materializes.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  a: &shared first
  b: *shared
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
