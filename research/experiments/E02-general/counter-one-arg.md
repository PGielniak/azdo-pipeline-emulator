# oracle probe — counter-one-arg

Runtime variable expression: `counter('prefix')`. Checks the lower arity bound.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: $[ counter('prefix') ]
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: $[ counter('prefix') ]
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
