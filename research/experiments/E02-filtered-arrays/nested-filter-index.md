# oracle probe — nested-filter-index

Compile-time filtered-array expression: `parameters.data.groups[*][*].id`. Checks the fully bracketed spelling of the same nested filter.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: data
  type: object
  default:
    rows:
    - id: 1
      child:
        values: [a, b]
    - name: missing-id
      child:
        values: [c]
    - id:
      child:
        values: []
    - plain
    mapping:
      first:
        id: 10
      second:
        id: 20
    groups:
    - - id: 100
      - id: 101
    - - id: 200
    explicitNull:
    scalar: text
    nested:
      left:
        children:
        - value: L1
        - value: L2
      right:
        children:
        - value: R1
variables:
  probe: ${{ convertToJson(parameters.data.groups[*][*].id) }}
steps:
- script: echo done
```

### Response — finalYaml

```yaml
parameters:
- name: data
  type: object
  default:
    rows:
    - id: 1
      child:
        values:
        - a
        - b
    - name: missing-id
      child:
        values:
        - c
    - id: ''
      child:
        values: []
    - plain
    mapping:
      first:
        id: 10
      second:
        id: 20
    groups:
    - - id: 100
      - id: 101
    - - id: 200
    explicitNull: ''
    scalar: text
    nested:
      left:
        children:
        - value: L1
        - value: L2
      right:
        children:
        - value: R1
variables:
- name: probe
  value: >-
    [
      100,
      101,
      200
    ]
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo done

```
