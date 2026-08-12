# oracle probe — contains-value-array-hit

Expression: `containsValue(parameters.items, 'BETA')`. Array items participate in ordinal-ignore-case membership.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: [Alpha, beta, 1]
variables:
  probe: ${{ containsValue(parameters.items, 'BETA') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
parameters:
- name: items
  type: object
  default:
  - Alpha
  - beta
  - 1
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
