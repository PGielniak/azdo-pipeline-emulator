# oracle probe — object-terminal-index

Compile-time filtered-array expression: `parameters.data.mapping[*]`. Checks that the bracket spelling has the same Object values.

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
  probe: ${{ convertToJson(parameters.data.mapping[*]) }}
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
      {
        "id": 10
      },
      {
        "id": 20
      }
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
