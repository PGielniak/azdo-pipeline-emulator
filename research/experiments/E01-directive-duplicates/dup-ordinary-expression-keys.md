# oracle probe — dup-ordinary-expression-keys

Two byte-identical ordinary expression keys `${{ pair.key }}` in one mapping. The result decides whether the duplicate-key exemption is directive-only or covers every expression key.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
parameters:
- name: pairs
  type: object
  default:
  - key: PROBE
steps:
- ${{ each pair in parameters.pairs }}:
  - script: echo probe
    env:
      ${{ pair.key }}: first
      ${{ pair.key }}: second
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 7, Col: 3): 'PROBE' is already defined",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
