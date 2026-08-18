# oracle probe — condition-short-circuit-after-elseif

After a true `elseif`, later `elseif` conditions are not evaluated.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if false }}:
  - script: echo not-if
- ${{ elseif true }}:
  - script: echo selected-elseif
- ${{ elseif lt(1, 'not-a-number') }}:
  - script: echo not-later-elseif
- ${{ else }}:
  - script: echo not-else
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
        script: echo selected-elseif

```
