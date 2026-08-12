# oracle probe — length-values

Compile-time expression: `format('{0}|{1}', length('fabrikam'), length(parameters.items))`. Covers String and Array lengths.

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
  probe: ${{ format('{0}|{1}', length('fabrikam'), length(parameters.items)) }}
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
  value: 8|3
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
