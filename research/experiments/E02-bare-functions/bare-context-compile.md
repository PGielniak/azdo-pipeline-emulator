# oracle probe — bare-context-compile

A bare legal context name is not mistaken for a function; preview accepts it as a complete expression in a compile-time variable.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ variables }}
steps:
- script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 2, Col: 10): A mapping was not expected\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.hosttype'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.servertype'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.culture'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.collectionId'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.collectionUri'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.teamFoundationCollectionUri'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.taskDefinitionsUri'\n/azure-pipelines.yml (Line: 2, Col: 10): Cannot override system variable 'system.pipelineStartTime'",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
