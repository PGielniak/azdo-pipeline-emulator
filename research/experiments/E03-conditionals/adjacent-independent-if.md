# oracle probe — adjacent-independent-if

An `if` begins a new chain even when adjacent to a previous unmatched if-only chain; its `else` belongs to the new chain.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
steps:
- ${{ if eq(1, 2) }}:
  - script: echo first-not-selected
- ${{ if eq(2, 2) }}:
  - script: echo second-selected
- ${{ else }}:
  - script: echo second-not-else
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
        script: echo second-selected

```
