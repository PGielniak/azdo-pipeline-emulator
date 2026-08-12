# oracle probe — json-primitive

Compile-time expression: `convertToJson('text')`. Settles whether conversion accepts primitive values.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ convertToJson('text') }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: '"text"'
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
