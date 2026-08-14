# oracle probe — dup-identical-each-keys

Two byte-identical recognized `${{ each }}` keys in one mapping. Acceptance with both generated variables present establishes that duplicate-key parsing exempts `each` like `if`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Request body: `{"previewRun": true, "yamlOverride": <below>}`
- Outcome: **HTTP 200 · expanded**

### Request — yamlOverride

```yaml
parameters:
- name: items
  type: object
  default: [one]
variables:
  ${{ each item in parameters.items }}:
    EACH_A: ${{ item }}
  ${{ each item in parameters.items }}:
    EACH_B: ${{ item }}
steps:
- script: echo $(EACH_A) $(EACH_B)
```

### Response — finalYaml

```yaml
parameters:
- name: items
  type: object
  default:
  - one
variables:
- name: EACH_A
  value: one
- name: EACH_B
  value: one
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo $(EACH_A) $(EACH_B)

```
