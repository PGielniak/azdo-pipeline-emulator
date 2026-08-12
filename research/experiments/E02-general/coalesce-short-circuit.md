# oracle probe — coalesce-short-circuit

Compile-time expression: `coalesce('hit', lt(1, 'bad'))`. Settles left-to-right short-circuiting.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ coalesce('hit', lt(1, 'bad')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: hit
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
