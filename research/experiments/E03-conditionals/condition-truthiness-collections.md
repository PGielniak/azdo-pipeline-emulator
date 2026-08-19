# oracle probe — condition-truthiness-collections

Array and Object expression results are truthy in a conditional clause.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: payload
  type: object
  default:
    key: value
steps:
- ${{ if split('a,b', ',') }}:
  - script: echo selected-array
- ${{ else }}:
  - script: echo not-array
- ${{ if parameters.payload }}:
  - script: echo selected-object
- ${{ else }}:
  - script: echo not-object
```

### Response — finalYaml

```yaml
parameters:
- name: payload
  type: object
  default:
    key: value
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo selected-array
    - task: CmdLine@2
      inputs:
        script: echo selected-object

```
