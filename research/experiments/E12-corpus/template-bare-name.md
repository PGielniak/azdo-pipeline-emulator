# oracle probe — template-bare-name

Reference to a bare file name that exists only inside `/corpus/_probe/`. Expected to FAIL: it discriminates "resolved from the repo root" from "resolved from wherever the referenced files happen to live".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- template: steps.yml
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml: File /steps.yml not found in repository https://dev.azure.com/{org}/oracle/_git/oracle branch refs/heads/main version 1d17140cc77d78d66e049efed6e0f7925f03f480.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
