# oracle probe — azurecli-unknown-input

Is an input the task does not declare rejected at expansion time, or passed through? Decides whether the emitter can ever see an undeclared input at all.

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
      azureSubscription: my-azure-sub
      scriptType: bash
      scriptLocation: inlineScript
      inlineScript: az account show
      noSuchInput: whatever
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
        azureSubscription: my-azure-sub
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: az account show
        noSuchInput: whatever

```
