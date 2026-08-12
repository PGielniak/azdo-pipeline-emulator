# oracle probe — ctl-insert-mapping

Control. Documented lower-case `${{ insert }}` merges into a mapping.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: extra
  type: object
  default:
    EXTRA_A: '1'
steps:
- script: echo base
  env:
    BASE: '1'
    ${{ insert }}: ${{ parameters.extra }}
```

### Response — finalYaml

```yaml
parameters:
- name: extra
  type: object
  default:
    EXTRA_A: '1'
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      env:
        BASE: '1'
        EXTRA_A: 1
      inputs:
        script: echo base

```
