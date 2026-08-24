# oracle probe — download-none

How a `- download: none` step inside the deploy hook is rendered after expansion — the auto-download flag is derived from its presence, so the model needs its exact surviving form.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
trigger: none
pool:
  vmImage: ubuntu-latest
stages:
- stage: A
  jobs:
  - deployment: D
    environment: corpus-staging
    strategy:
      runOnce:
        deploy:
          steps:
          - download: none
          - script: echo hi
```

### Response — finalYaml

```yaml
trigger:
  enabled: false
pool:
  vmImage: ubuntu-latest
stages:
- stage: A
  jobs:
  - deployment: D
    environment:
      name: corpus-staging
    strategy:
      runOnce:
        deploy:
          steps:
          - task: 30f35852-3f7e-4c0c-9a88-e127b4f97211@1
            condition: false
            inputs:
              alias: none
          - task: CmdLine@2
            inputs:
              script: echo hi

```
