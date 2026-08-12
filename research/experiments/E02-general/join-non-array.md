# oracle probe — join-non-array

Compile-time expression: `join('-', 12)`. Settles the documented non-array fallback.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ join('-', 12) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: 12
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
