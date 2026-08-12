# oracle probe — case-conversion

Compile-time expression: `format('{0}|{1}', lower('ÄBC'), upper('äbc'))`. Confirms case conversion on non-ASCII text.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{0}|{1}', lower('ÄBC'), upper('äbc')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: äbc|ÄBC
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
