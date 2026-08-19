# E06-S01-T02 — environment materialization (real run)

This hosted-agent probe measures collisions after variable-name conversion and cross-checks
explicit step `env`, secret exclusion/mapping, the space transform, and prepend-PATH order.

- Probe pipeline: `oracle-env-materialization-probe` → `/experiments/env-materialization.yml`
- Run: id 540, state `completed`, result `succeeded`

## Probe YAML

```yaml
trigger: none
pr: none
jobs:
- job: declared_dot_then_under
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: A.B
    value: dot-first
  - name: A_B
    value: under-second
  steps:
  - bash: |
      printf 'CASE declared_dot_then_under ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\n' "$A_B" '$(A.B)' '$(A_B)'

- job: declared_under_then_dot
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: A_B
    value: under-first
  - name: A.B
    value: dot-second
  steps:
  - bash: |
      printf 'CASE declared_under_then_dot ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\n' "$A_B" '$(A.B)' '$(A_B)'

- job: runtime_dot_then_under
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.setvariable variable=A.B]dot-first'
      echo '##vso[task.setvariable variable=A_B]under-second'
  - bash: |
      printf 'CASE runtime_dot_then_under ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\n' "$A_B" '$(A.B)' '$(A_B)'

- job: runtime_under_then_dot
  pool:
    vmImage: ubuntu-latest
  steps:
  - bash: |
      echo '##vso[task.setvariable variable=A_B]under-first'
      echo '##vso[task.setvariable variable=A.B]dot-second'
  - bash: |
      printf 'CASE runtime_under_then_dot ENV=%s DOT_MACRO=%s UNDER_MACRO=%s\n' "$A_B" '$(A.B)' '$(A_B)'

- job: transform_overlay_secret_path
  pool:
    vmImage: ubuntu-latest
  variables:
  - name: lower.dot
    value: dotted
  - name: Space Name
    value: spaced
  - name: OVERLAY_NAME
    value: automatic
  - name: overlay.source
    value: macro
  steps:
  - bash: |
      generated="runtime-$RANDOM-$RANDOM"
      echo "##vso[task.setvariable variable=Hidden.Value;issecret=true]$generated"
      echo '##vso[task.prependpath]/first-e06'
      echo '##vso[task.prependpath]/second-e06'
  - bash: |
      if printenv HIDDEN_VALUE >/dev/null; then auto_secret=present; else auto_secret=absent; fi
      macro_literal='$'
      macro_literal+='(Hidden.Value)'
      if [[ -n "${EXPLICIT_SECRET+x}" && "$EXPLICIT_SECRET" != "$macro_literal" ]]; then
        mapped_secret=present
      else
        mapped_secret=absent
      fi
      case "$PATH" in
        /second-e06:/first-e06:*) path_order=second-first-base ;;
        /first-e06:/second-e06:*) path_order=first-second-base ;;
        *) path_order=other ;;
      esac
      printf 'CASE transform LOWER_DOT=%s SPACE_NAME=%s\n' "$LOWER_DOT" "$SPACE_NAME"
      printf 'CASE overlay OVERLAY_NAME=%s\n' "$OVERLAY_NAME"
      printf 'CASE secret AUTO=%s EXPLICIT=%s\n' "$auto_secret" "$mapped_secret"
      printf 'CASE path ORDER=%s\n' "$path_order"
    env:
      OVERLAY_NAME: explicit-$(overlay.source)
      EXPLICIT_SECRET: $(Hidden.Value)
```

## Task results

| task | result |
|---|---|
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Bash` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Bash` | `succeeded` |
| `Bash` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Bash` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Bash` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Bash` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Bash` | `succeeded` |
| `Initialize job` | `succeeded` |
| `Bash` | `succeeded` |

## Relevant log lines

```text
2026-08-19T08:24:22.1632124Z CASE declared_under_then_dot ENV=dot-second DOT_MACRO=dot-second UNDER_MACRO=under-first
2026-08-19T08:24:42.8934641Z CASE transform LOWER_DOT=dotted SPACE_NAME=spaced
2026-08-19T08:24:42.8938276Z CASE overlay OVERLAY_NAME=automatic
2026-08-19T08:24:42.8939964Z CASE secret AUTO=absent EXPLICIT=present
2026-08-19T08:24:42.8943318Z CASE path ORDER=second-first-base
2026-08-19T08:25:00.6206667Z CASE runtime_under_then_dot ENV=dot-second DOT_MACRO=dot-second UNDER_MACRO=under-first
2026-08-19T08:25:55.5586959Z CASE declared_dot_then_under ENV=dot-first DOT_MACRO=dot-first UNDER_MACRO=under-second
2026-08-19T08:26:14.1206321Z CASE runtime_dot_then_under ENV=dot-first DOT_MACRO=dot-first UNDER_MACRO=under-second
```

## Interpretation

- `A.B` supplied `A_B` in all four collision jobs, independent of declaration/logging-command
  order in this run; the two macro values prove the names remained distinct in the store.
- The automatic public variable supplied `OVERLAY_NAME=automatic`, overwriting the explicit
  step mapping `explicit-macro`. This directly refutes E06-S01-T02's "env overlay wins"
  Done criterion and the prior docs/04 ordering.
- The secret had no automatic `HIDDEN_VALUE` entry but was present through the explicit
  `EXPLICIT_SECRET` mapping. Dots and spaces both became underscores with upper casing.
- Two prepend commands in one step produced `second:first:base`, so the newest entry is first.

The collision observation is deliberately scoped to hosted run 540: the pinned agent walks
a `ConcurrentDictionary` and does not specify a collision ordering contract.

Regenerate with `node scripts/env-materialization-realrun.ts`; this queues a fresh hosted run.
