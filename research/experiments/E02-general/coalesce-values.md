# oracle probe — coalesce-values

Compile-time expression: `format('{0}|{1}|{2}', coalesce('', 'x'), coalesce(false, 'x'), coalesce(0, 'x'))`. Settles empty-only skipping versus other falsey values.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{0}|{1}|{2}', coalesce('', 'x'), coalesce(false, 'x'), coalesce(0, 'x')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: x|False|0
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
