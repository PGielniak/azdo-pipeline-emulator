# oracle probe — format-basic-reuse

Compile-time expression: `format('{1}-{0}-{1}', 'A', 'B')`. Settles index reuse and out-of-order placeholders.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{1}-{0}-{1}', 'A', 'B') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: B-A-B
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
