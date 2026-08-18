# oracle probe — condition-truthiness-primitives

Conditional clauses use expression truthiness: nonempty String/nonzero Number are true; empty String/zero/Null are false.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if 'text' }}:
  - script: echo selected-nonempty-string
- ${{ else }}:
  - script: echo not-nonempty-string
- ${{ if '' }}:
  - script: echo not-empty-string
- ${{ else }}:
  - script: echo selected-empty-string-else
- ${{ if 1 }}:
  - script: echo selected-nonzero-number
- ${{ else }}:
  - script: echo not-nonzero-number
- ${{ if 0 }}:
  - script: echo not-zero
- ${{ else }}:
  - script: echo selected-zero-else
- ${{ if variables.absent }}:
  - script: echo not-null
- ${{ else }}:
  - script: echo selected-null-else
```

### Response — finalYaml

```yaml
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo selected-nonempty-string
    - task: CmdLine@2
      inputs:
        script: echo selected-empty-string-else
    - task: CmdLine@2
      inputs:
        script: echo selected-nonzero-number
    - task: CmdLine@2
      inputs:
        script: echo selected-zero-else
    - task: CmdLine@2
      inputs:
        script: echo selected-null-else

```
