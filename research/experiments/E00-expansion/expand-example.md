# expand() — redacted expansion pair (E00-S04-T01)

Delegates expansion to the service (PLAN D3). `expand()` wraps the `preview` client (E00-S03-T02)
and attaches provenance. The request hash below is **real** (produced by `expansionRequestHash` on
this exact `yamlOverride`); the `finalYaml` shape matches the live-grounded `steps:`-only probe —
see `research/oracle-setup.md` (completion record: `steps:` → `stages: __default` → `job: Job` →
`task: CmdLine@2`) and the byte-exact live transcript `research/experiments/oracle-spike/five-line.md`
(C-E00-017/018). Org/project/pipelineId are redacted per rule 4.

## Request — yamlOverride

```yaml
steps:
- script: echo probe
```

## Provenance

| field | value |
|---|---|
| `apiVersion` | `7.1` |
| `pipelineId` | `{pipelineId}` (integer in the live object; redacted here) |
| `requestHash` | `2a138e6ae52c00183dbbe400bc8b340ae840048919b1254425fbde990ac28981` |
| `redacted` | `true` |

## Response — finalYaml (redacted shape)

```yaml
stages:
- stage: __default
  jobs:
  - job: Job
    steps:
    - task: CmdLine@2
      inputs:
        script: echo probe
```
