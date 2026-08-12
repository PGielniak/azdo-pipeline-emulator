# oracle probe — coalesce-all-empty

Compile-time expression: `coalesce('', variables.missing)`. Settles the no-value result.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ coalesce('', variables.missing) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: ''
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
