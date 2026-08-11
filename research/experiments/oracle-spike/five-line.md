# oracle probe — five-line

Baseline success pair: a 5-line pipeline expands to the service canonical form. Establishes route, api-version and that the 200 body carries exactly one field, finalYaml.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest
steps:
  - script: echo hello
```

### Response — finalYaml

```yaml
trigger:
  enabled: false
stages:
- stage: __default
  jobs:
  - job: Job
    pool:
      vmImage: ubuntu-latest
    steps:
    - task: CmdLine@2
      inputs:
        script: echo hello

```
