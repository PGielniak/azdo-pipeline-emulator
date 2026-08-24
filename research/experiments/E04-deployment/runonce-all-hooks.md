# oracle probe — runonce-all-hooks

A runOnce strategy with every hook survives the expansion verbatim (the corpus golden shows one instance; this is the exhaustive control the hook-sequence model keys off).

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
        preDeploy:
          steps:
          - script: echo pre
        deploy:
          steps:
          - script: echo deploy
        routeTraffic:
          steps:
          - script: echo route
        postRouteTraffic:
          steps:
          - script: echo post
        on:
          failure:
            steps:
            - script: echo fail
          success:
            steps:
            - script: echo ok
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
        preDeploy:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo pre
        deploy:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo deploy
        routeTraffic:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo route
        postRouteTraffic:
          steps:
          - task: CmdLine@2
            inputs:
              script: echo post
        on:
          failure:
            steps:
            - task: CmdLine@2
              inputs:
                script: echo fail
          success:
            steps:
            - task: CmdLine@2
              inputs:
                script: echo ok

```
