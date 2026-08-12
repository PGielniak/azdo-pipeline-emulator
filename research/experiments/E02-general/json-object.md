# oracle probe — json-object

Compile-time expression: `convertToJson(parameters.value)`. Captures exact Object/Array JSON formatting.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: value
  type: object
  default:
    alpha: one
    nested: [two, 3]
variables:
  probe: ${{ convertToJson(parameters.value) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
parameters:
- name: value
  type: object
  default:
    alpha: one
    nested:
    - two
    - 3
variables:
- name: probe
  value: >-
    {
      "alpha": "one",
      "nested": [
        "two",
        3
      ]
    }
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
