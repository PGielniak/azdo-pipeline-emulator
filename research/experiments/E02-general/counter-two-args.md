# oracle probe — counter-two-args

Runtime variable expression: `counter('prefix', 7)`. Confirms the legal runtime-variable placement and arity.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: $[ counter('prefix', 7) ]
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: $[ counter('prefix', 7) ]
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
