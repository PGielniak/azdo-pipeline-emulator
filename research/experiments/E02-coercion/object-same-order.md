# oracle probe — object-same-order

Expression: `le(parameters.objectA, parameters.objectA)`. Ordered comparison with identical Object reference.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**

### Request — yamlOverride

```yaml
parameters:
- name: objectA
  type: object
  default:
    key: value
- name: objectB
  type: object
  default:
    key: value
- name: arrayA
  type: object
  default: [one, two]
- name: arrayB
  type: object
  default: [one, two]
variables:
  probe: ${{ le(parameters.objectA, parameters.objectA) }}
steps:
- script: echo done
```

### Response — error body

```json
{
  "$id": "1",
  "innerException": null,
  "message": "/azure-pipelines.yml (Line: 17, Col: 10): Unable to convert from Object to Number. Value: Object",
  "typeName": "Microsoft.Azure.Pipelines.WebApi.PipelineValidationException, Microsoft.Azure.Pipelines.WebApi",
  "typeKey": "PipelineValidationException",
  "errorCode": 0,
  "eventId": 3000
}
```
