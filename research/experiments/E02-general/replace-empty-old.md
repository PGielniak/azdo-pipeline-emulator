# oracle probe — replace-empty-old

Compile-time expression: `replace('abc', '', 'x')`. Settles empty search-text behavior.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ replace('abc', '', 'x') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: abc
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
