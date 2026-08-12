# oracle probe — contains-value-conversion-direction

Expression: `containsValue(parameters.values, 1)`. A collection String value is converted to the right parameter Number type.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: values
  type: object
  default:
    first: Alpha
    second: beta
    numericText: '01'
variables:
  probe: ${{ containsValue(parameters.values, 1) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
parameters:
- name: values
  type: object
  default:
    first: Alpha
    second: beta
    numericText: '01'
variables:
- name: probe
  value: True
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
