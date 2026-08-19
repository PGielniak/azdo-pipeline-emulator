# E06-S03-T03 — condition evaluation and skip flow (real run)

This hosted Ubuntu probe distinguishes a hard failure from a continued failure, then observes
the implicit step condition, `always()`, explicit `succeeded()`, task timeline results, and the
raw log text emitted when the implicit condition is false.

- Probe pipeline: `oracle-e06-condition-flow` → `/experiments/e06-condition/condition-flow.yml`
- Run: id 543, state `completed`, result `failed`

## Probe YAML

See `condition-flow.yml` beside this transcript.

## Task timeline

| Task | Result |
|---|---|
| hard failure | failed |
| default after failure | skipped |
| explicit succeeded after issues | succeeded |
| always after failure | succeeded |
| default after issues | succeeded |
| continued failure | succeededWithIssues |

## Relevant raw log lines

```text
Skipping step due to condition evaluation.
ALWAYS_RAN
DEFAULT_AFTER_ISSUES
EXPLICIT_SUCCEEDED_AFTER_ISSUES
```

Checked 2026-08-19 with credentials loaded from the ignored `.env.oracle`; no token,
organization, project, requester, or repository identity is stored here.
