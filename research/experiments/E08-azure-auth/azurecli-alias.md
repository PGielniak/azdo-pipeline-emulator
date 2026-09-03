# oracle probe — azurecli-alias

Does the expansion rewrite the alias `azureSubscription` to the declared input name `connectedServiceNameARM`? Also: is the input keyed by its declared *case*?

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

```
