# oracle probe — string-number-failure-eq

Expression: `eq(1, 'x')`. eq conversion-failure result.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

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
  probe: ${{ eq(1, 'x') }}
steps:
- script: echo done
```

### Response — finalYaml

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
  default:
  - one
  - two
- name: arrayB
  type: object
  default:
  - one
  - two
variables:
- name: probe
  value: False
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
