# oracle probe — env-dotted

Whether the dotted `environment: env.resource` shorthand is split by the service into {name, resourceName}, or survives as a scalar/string the model must split itself.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest
stages:
- stage: A
  jobs:
  - deployment: D
    environment: corpus-staging.someResource
    strategy:
      runOnce:
        deploy:
          steps:
          - script: echo hi
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "Job D: Resource someResource does not exist in environment corpus-staging.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
