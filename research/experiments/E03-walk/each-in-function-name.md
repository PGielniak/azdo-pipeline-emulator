# oracle probe — each-in-function-name

The collection expression *calls* the `in` function: `each item in split(...)` is replaced by one whose argument list contains `in('b','b')`, so the text ` in(` appears after the real separator. Guards a splitter that scans for the last occurrence.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- script: echo base
- ${{ each item in split(format('{0}', in('b', 'b')), ',') }}:
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
        script: echo True

```
