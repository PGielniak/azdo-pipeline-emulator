# oracle probe — length-object

Compile-time expression: `length(parameters.value)`. Settles behavior for an Object value.

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
  probe: ${{ length(parameters.value) }}
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
  value: 2
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
