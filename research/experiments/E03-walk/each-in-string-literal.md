# oracle probe — each-in-string-literal

The collection expression contains ` in ` **inside a string literal**: `each item in split('a in b', ' in ')`. Iterating ['a','b'] proves the split took the first separator; anything else proves it did not.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ each item in split('a in b', ' in ') }}:
  - script: echo ${{ item }}
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
        script: echo base
    - task: CmdLine@2
      inputs:
        script: echo a
    - task: CmdLine@2
      inputs:
        script: echo b

```
