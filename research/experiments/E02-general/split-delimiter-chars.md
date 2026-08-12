# oracle probe — split-delimiter-chars

Compile-time expression: `join('|', split('a,b;c,,', ',;'))`. Settles whether the delimiter is a string or a set of characters and preservation of empty fields.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ join('|', split('a,b;c,,', ',;')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: a,b;c,,
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
