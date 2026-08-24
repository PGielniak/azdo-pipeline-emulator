# oracle probe — env-scalar

The scalar `environment: <name>` shorthand is promoted to `environment: {name}` by the service, so the model only ever sees the object form (sibling of C-E04-062 target).

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
          - task: CmdLine@2
            inputs:
              script: echo hi

```
