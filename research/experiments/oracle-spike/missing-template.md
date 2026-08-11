# oracle probe — missing-template

A template that does not resolve names the repository, branch and commit it searched. This message embeds the organization URL — the reason redaction is mandatory.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
steps:
- template: does-not-exist.yml
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml: File /does-not-exist.yml not found in repository https://dev.azure.com/{org}/oracle/_git/oracle branch refs/heads/main version 0bdb4cf68d4f3a22d7000d2a46f6cb4f72fff017.",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
