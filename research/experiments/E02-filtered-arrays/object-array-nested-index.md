# oracle probe — object-array-nested-index

Compile-time filtered-array expression: `parameters.data.nested[*].children[*].value`. Checks the bracket spelling at both filtered-array levels.

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
  probe: ${{ convertToJson(parameters.data.nested[*].children[*].value) }}
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
      "L1",
      "L2",
      "R1"
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
