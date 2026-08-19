# E06-S02-T01 — macro expansion (real run)

This hosted-agent probe measures task-time scanning after a logging command creates a value
that itself looks like a macro. Preview cannot execute either phase.

- Probe pipeline: `oracle-macro-expansion-probe` → `/experiments/macro-expansion/macro-expansion.yml`
- Run: id 541, state `completed`, result `succeeded`

## Probe YAML

```yaml
trigger: none
pr: none
variables:
  b: inner
  ainner: outer
  short: short-value
  shorter: longer-name-value
steps:
- bash: |
    macro='$'
    macro+='(b)'
    printf '##vso[task.setvariable variable=a]%s\n' "$macro"
  displayName: Set a to literal macro text
- bash: |
    printf 'CASE CHAIN=%s\n' '$(a)'
    printf 'CASE NESTED=%s\n' '$(a$(b))'
    printf 'CASE UNMATCHED=%s\n' '$(missing)'
    printf 'CASE EXACT=%s|%s\n' '$(short)' '$(shorter)'
  displayName: Observe macro scan
```

## Task results

| task | result |
|---|---|
| `Initialize job` | `succeeded` |
| `Finalize Job` | `succeeded` |
| `Set a to literal macro text` | `succeeded` |
| `Observe macro scan` | `succeeded` |
| `Post-job: Checkout oracle@main to s` | `succeeded` |
| `Checkout oracle@main to s` | `succeeded` |

## Relevant log lines

```text
2026-08-19T11:02:21.4029619Z CASE CHAIN=inner
2026-08-19T11:02:21.4030570Z CASE NESTED=$(ainner)
2026-08-19T11:02:21.4034525Z CASE UNMATCHED=$(missing)
2026-08-19T11:02:21.4042287Z CASE EXACT=short-value|longer-name-value
```

## Interpretation

- `CHAIN=inner` refutes the backlog task's required end-to-end non-recursion: the value set to
  literal `$(b)` in task one resolves to `inner` in task two.
- `NESTED=$(ainner)` proves the first outer candidate is unmatched, then the inner `$(b)`
  expands; the newly formed outer macro is not revisited even though `ainner` exists.
- `UNMATCHED=$(missing)` directly confirms literal preservation for a missing name.
- The two `EXACT` values confirm that prefix-related names are looked up as exact candidates.

Regenerate with `node scripts/macro-expansion-realrun.ts`; this queues one hosted run.
