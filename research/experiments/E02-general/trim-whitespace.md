# oracle probe — trim-whitespace

Compile-time expression: `trim(' \tvalue  ')`. Settles tabs and non-breaking-space trimming.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ trim(' \tvalue  ') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: '\tvalue'
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
