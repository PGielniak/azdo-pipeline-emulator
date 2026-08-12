# oracle probe — xor-values

Compile-time expression: `format('{0}|{1}|{2}|{3}', xor(true, false), xor(false, true), xor(true, true), xor(false, false))`. Covers the complete Boolean truth table.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{0}|{1}|{2}|{3}', xor(true, false), xor(false, true), xor(true, true), xor(false, false)) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: True|True|False|False
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
