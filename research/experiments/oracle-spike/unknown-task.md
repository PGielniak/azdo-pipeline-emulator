# oracle probe — unknown-task

An unresolvable task is rejected without line/col: the message identifies job and step instead, so not every rejection can be rendered as a source-positioned diagnostic.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- task: NoSuchTask@9
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "A task is missing. The pipeline references a task called 'NoSuchTask'. This usually indicates the task isn't installed, and you may be able to install it from the Marketplace: https://marketplace.visualstudio.com. (Task version 9, job 'Job', step ''.)",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
