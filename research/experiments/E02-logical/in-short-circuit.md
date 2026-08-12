# oracle probe — in-short-circuit

Expression: `in('Alpha', 'alpha', lt(1, 'not-a-number'))`. The first match prevents evaluation of later candidates.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ in('Alpha', 'alpha', lt(1, 'not-a-number')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: True
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
