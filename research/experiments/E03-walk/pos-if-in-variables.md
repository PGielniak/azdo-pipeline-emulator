# oracle probe — pos-if-in-variables

Control for the position question: the docs show `${{ if }}` inside `variables:`, which is not in the Note's stages/jobs/steps/containers list either. If this expands, the Note describes nothing the engine actually enforces.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
- name: base
  value: '1'
- ${{ if eq(1, 1) }}:
  - name: extra
    value: '1'
steps:
- script: echo base
```

### Response — finalYaml

```yaml
variables:
- name: base
  value: '1'
- name: extra
  value: '1'
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo base

```
