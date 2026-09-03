# oracle probe — azurecli-missing-connection

The connection input is `required: true` in task.json. Is a missing required input an expansion-time error, or does it reach the agent? Decides whether the converter must check requiredness itself.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest
steps:
  - task: AzureCLI@2
    inputs:
      scriptType: bash
      scriptLocation: inlineScript
      inlineScript: az account show
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
    - task: AzureCLI@2
      inputs:
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: az account show

```
