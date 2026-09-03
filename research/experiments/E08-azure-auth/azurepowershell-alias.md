# oracle probe — azurepowershell-alias

`AzurePowerShell@5` declares the same input in PascalCase (`ConnectedServiceNameARM`) with the same alias, plus `azurePowerShellVersion` → `TargetAzurePs`. Two aliases, one step.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest
steps:
  - task: AzurePowerShell@5
    inputs:
      azureSubscription: my-azure-sub
      azurePowerShellVersion: LatestVersion
      ScriptType: InlineScript
      Inline: Get-AzContext
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
    - task: AzurePowerShell@5
      inputs:
        azureSubscription: my-azure-sub
        azurePowerShellVersion: LatestVersion
        ScriptType: InlineScript
        Inline: Get-AzContext

```
