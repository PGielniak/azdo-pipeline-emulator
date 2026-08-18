# oracle probe — condition-truthiness-empty-collections

Empty Array and Object expression results remain truthy; collection truthiness does not depend on count.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: []
- name: payload
  type: object
  default: {}
steps:
- ${{ if parameters.items }}:
  - script: echo selected-empty-array
- ${{ else }}:
  - script: echo not-empty-array
- ${{ if parameters.payload }}:
  - script: echo selected-empty-object
- ${{ else }}:
  - script: echo not-empty-object
```

### Response — finalYaml

```yaml
parameters:
- name: items
  type: object
  default: []
- name: payload
  type: object
  default: {}
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo selected-empty-array
    - task: CmdLine@2
      inputs:
        script: echo selected-empty-object

```
