# oracle probe — control-variables

CONTROL for the anchor and duplicate-key probes: the same two-variable pipeline with no quirk in it. A 200 here makes any 400 below attributable to the quirk alone.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
variables:
  a: first
  b: second
steps:
- script: echo $(a) $(b)
```

### Response — finalYaml

```yaml
variables:
- name: a
  value: first
- name: b
  value: second
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo $(a) $(b)

```
