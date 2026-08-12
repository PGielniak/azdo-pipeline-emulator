# oracle probe — ctl-each-sequence

Control. Documented lower-case `each` over an object parameter expands.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: [alpha, beta]
steps:
- script: echo base
- ${{ each item in parameters.items }}:
  - script: echo ${{ item }}
```

### Response — finalYaml

```yaml
parameters:
- name: items
  type: object
  default:
  - alpha
  - beta
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo base
    - task: CmdLine@2
      inputs:
        script: echo alpha
    - task: CmdLine@2
      inputs:
        script: echo beta

```
