# oracle probe — contains-value-object-hit

Expression: `containsValue(parameters.values, 'BETA')`. Object values participate in ordinal-ignore-case membership.

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
  probe: ${{ containsValue(parameters.values, 'BETA') }}
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
