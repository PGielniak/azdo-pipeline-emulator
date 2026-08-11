# oracle probe — merge-key

QUIRK — the YAML merge key `<<: *anchor` (the most common real-world use of anchors, and a separate spec feature from plain aliasing).

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
jobs:
- job: A
  pool: &shared
    vmImage: ubuntu-latest
  steps:
  - script: echo one
- job: B
  pool:
    <<: *shared
  steps:
  - script: echo two
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
