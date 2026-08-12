# oracle probe — starts-ends-coercion

Compile-time expression: `and(startsWith(12345, '123'), endsWith('AbCdE', 'DE'))`. Settles String conversion and ignore-case matching.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  probe: ${{ and(startsWith(12345, '123'), endsWith('AbCdE', 'DE')) }}
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
