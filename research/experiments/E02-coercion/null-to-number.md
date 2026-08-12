# oracle probe — null-to-number

Expression: `eq(0, parameters.objectA.missing)`. Null-to-Number conversion.

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
  probe: ${{ eq(0, parameters.objectA.missing) }}
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
