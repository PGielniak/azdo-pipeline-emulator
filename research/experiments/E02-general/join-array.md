# oracle probe — join-array

Compile-time expression: `join(';', parameters.items)`. Settles scalar conversion and complex/empty elements.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: [Alpha, '', 2]
variables:
  probe: ${{ join(';', parameters.items) }}
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
  - ''
  - 2
variables:
- name: probe
  value: Alpha;;2
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
