# oracle probe — dup-key-case-user-data

QUIRK — is the case-folding of `dup-key-case` a property of the YAML mapping layer or only of schema keywords? `a:` + `A:` under `variables:` are user-chosen names, not keywords: a rejection means our parse-time (schema-unaware) check must fold case too.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  a: first
  A: second
steps:
- script: echo $(a)
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 3, Col: 3): 'A' is already defined",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
