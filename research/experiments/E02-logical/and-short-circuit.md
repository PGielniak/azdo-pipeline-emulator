# oracle probe — and-short-circuit

Expression: `and(false, lt(1, 'not-a-number'))`. A false first operand prevents evaluation of the failing second operand.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ and(false, lt(1, 'not-a-number')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: False
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
