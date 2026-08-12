# oracle probe — each-var-case-fold

The loop variable is declared `ITEM` and read as `${{ item }}`. Names in the expression grammar fold case (C-E02-011/012); this asks whether a *loop variable* does too, which decides both the lookup and the collision check against context names.

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
- ${{ each ITEM in parameters.items }}:
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
