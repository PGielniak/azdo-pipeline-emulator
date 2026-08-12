# oracle probe — iif-values

Compile-time expression: `format('{0}|{1}', iif(true, 'yes', 'no'), iif(false, 'yes', 'no'))`. Covers both branches.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ format('{0}|{1}', iif(true, 'yes', 'no'), iif(false, 'yes', 'no')) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
variables:
- name: probe
  value: yes|no
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
