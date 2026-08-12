# oracle probe — format-brace-escape

Compile-time expression: `format('{{{0}}} {{ and }}', 'x')`. Settles doubled-brace escaping around a placeholder.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{{{0}}} {{ and }}', 'x') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: '{x} { and }'
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
