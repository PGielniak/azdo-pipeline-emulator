# oracle probe — property-exact

Expression: `parameters.obj.CamelKey`. Exact-case property lookup.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: obj
  type: object
  default:
    CamelKey: value
    nested:
      DeepKey: deep
    dotted.name: dotted
    '1': numeric-key
    empty: ''
    list: [zero, one]
variables:
  probe: ${{ parameters.obj.CamelKey }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
parameters:
- name: obj
  type: object
  default:
    CamelKey: value
    nested:
      DeepKey: deep
    dotted.name: dotted
    '1': numeric-key
    empty: ''
    list:
    - zero
    - one
variables:
- name: probe
  value: value
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
