# E02-S03-T03 — job status functions over a SKIPPED dependency (real run)

The only E02 experiment that is a **run**, not a preview. Preview never evaluates status
functions and the job-level engine is server-side and closed, so the behaviour of
`succeeded()` / `succeededOrFailed()` when a dependency was *skipped* — the cell the docs only
hint at — can be measured no other way.

Every job is agentless (`pool: server`, one `Delay@1` of 0 minutes), so the run consumes no
hosted-agent parallelism. **The datum is each job’s own result**: `skipped` means its
condition evaluated False, `succeeded` means it evaluated True. No log is read.

The results below come from the timeline’s **Phase** records, not its Job records. A `Job`
record exists only for a job that actually materialized, so a job whose condition was False is
simply missing from that layer — "absent" would be indirect evidence. The `Phase` layer carries
one record per YAML job either way, with an explicit result, so each row is a direct reading of
what the condition evaluated to. The `materialized` column shows whether a `Job` record also
appeared, and agrees with the phase result on every row.

- Probe pipeline: `oracle-status-probe` → `/experiments/status-skipped.yml` (source of truth:
  `research/experiments/E02-status/status-skipped.yml`, pushed by the script)
- Run: id 527, state `completed`, result `failed`

Regenerate with `pnpm expr-status-realrun` (queues a fresh run; results are expected to be
identical run to run).

| job | condition | phase result | condition evaluated | job record? | what it settles |
|---|---|---|---|---|---|
| `dep_skipped` | `false` | skipped | **False** | no | the dependency under test — `condition: false` makes it Skipped without an agent |
| `dep_ok` | `(none — default)` | succeeded | **True** | yes | the control dependency |
| `dep_abandon` | `gt(1, 'not-a-number')` | abandoned | **True** | no | an attempt to fail a job without an agent: `gt` errors on an unconvertible operand (C-E02-022) and a condition that throws is evaluated orchestrator-side. It does **not** produce Failed — the result is `abandoned`, a sixth TaskResult the docs never list |
| `dep_fail` | `(none — default)` | failed | **True** | yes | a genuinely Failed dependency: the server task itself errors on an unparseable input |
| `nodep_succeeded` | `succeeded()` | succeeded | **True** | yes | a job with no dependencies: all-of over an empty set. The conditions doc says such a job runs by default, so this should be True |
| `nodep_succeededorfailed` | `succeededOrFailed()` | succeeded | **True** | yes | the same for `succeededOrFailed`, whose rule is any-of (C-E02-068) — any-of over an empty set would be False, which would make a dependency-free job with this condition never run |
| `nodep_failed` | `failed()` | skipped | **False** | no | any-of over an empty set for `failed` |
| `skipped_succeeded` | `succeeded()` | skipped | **False** | no | **the headline cell**: `succeeded()` over a skipped dependency |
| `skipped_succeeded_named` | `succeeded('dep_skipped')` | skipped | **False** | no | same, with the dependency named explicitly |
| `skipped_succeededorfailed` | `succeededOrFailed()` | skipped | **False** | no | `succeededOrFailed()` over a skipped dependency — the docs recommend `not(canceled())` here, implying this is False |
| `skipped_succeededorfailed_named` | `succeededOrFailed('dep_skipped')` | skipped | **False** | no | same, with the dependency named explicitly |
| `skipped_failed` | `failed()` | skipped | **False** | no | `failed()` over a skipped dependency — Skipped is not Failed, but measure it |
| `skipped_failed_named` | `failed('dep_skipped')` | skipped | **False** | no | same, with the dependency named explicitly |
| `skipped_always` | `always()` | succeeded | **True** | yes | `always()` is documented as unconditionally True; confirms the run is healthy |
| `skipped_canceled` | `canceled()` | skipped | **False** | no | `canceled()` in a run that was never canceled |
| `skipped_not_canceled` | `not(canceled())` | succeeded | **True** | yes | the replacement the docs recommend for the skipped-dependency case |
| `skipped_result_is_skipped` | `eq(dependencies.dep_skipped.result, 'Skipped')` | succeeded | **True** | yes | independent confirmation that the dependency really did record `Skipped` |
| `ok_succeeded` | `succeeded()` | succeeded | **True** | yes | control: `succeeded()` over a succeeded dependency |
| `ok_failed` | `failed()` | skipped | **False** | no | control: `failed()` over a succeeded dependency |
| `ok_succeededorfailed` | `succeededOrFailed()` | succeeded | **True** | yes | control: `succeededOrFailed()` over a succeeded dependency — the commonest real-world case, measured rather than inferred from the mixed row |
| `ok_canceled` | `canceled()` | skipped | **False** | no | control: `canceled()` over a succeeded dependency |
| `mixed_succeeded` | `succeeded()` | skipped | **False** | no | `succeeded()` over {Succeeded, Skipped} — all-of vs any-of |
| `mixed_succeededorfailed` | `succeededOrFailed()` | succeeded | **True** | yes | `succeededOrFailed()` over {Succeeded, Skipped} — the docs say "True whether **any** of those jobs succeeded or failed", which a one-dependency probe cannot test |
| `mixed_succeeded_named_ok` | `succeeded('dep_ok')` | succeeded | **True** | yes | do arguments **narrow** the set? names only the succeeded dependency while a skipped one is still in the graph |
| `mixed_succeededorfailed_named_ok` | `succeededOrFailed('dep_ok')` | succeeded | **True** | yes | same question for `succeededOrFailed` |
| `mixed_succeeded_named_both` | `succeeded('dep_ok', 'dep_skipped')` | skipped | **False** | no | names both dependencies explicitly — should match the no-argument form |
| `mixed_not_canceled` | `not(canceled())` | succeeded | **True** | yes | the recommended replacement, over a mixed graph |
| `unknown_named` | `succeeded('nosuchjob')` | skipped | **False** | no | a name that is not a dependency at all — preview accepts it, so the runtime verdict decides whether the emitter must validate names itself |
| `case_named` | `succeeded('DEP_OK')` | succeeded | **True** | yes | the dependency name argument in the wrong case — decides whether the lookup folds case, which C-E02-027 showed differs per context |
| `abandon_succeeded` | `succeeded()` | skipped | **False** | no | `succeeded()` over an abandoned dependency |
| `abandon_failed` | `failed()` | skipped | **False** | no | `failed()` over an **abandoned** dependency — False, so an errored condition is not "failed" |
| `abandon_failed_named` | `failed('dep_abandon')` | skipped | **False** | no | same, with the dependency named explicitly |
| `abandon_succeededorfailed` | `succeededOrFailed()` | skipped | **False** | no | `succeededOrFailed()` over an abandoned dependency |
| `abandon_always` | `always()` | succeeded | **True** | yes | `always()` over an abandoned dependency |
| `abandon_canceled` | `canceled()` | skipped | **False** | no | `canceled()` over an abandoned dependency, in a run that was never canceled |
| `abandon_result` | `eq(dependencies.dep_abandon.result, 'Failed')` | skipped | **False** | no | confirms `dependencies.<x>.result` is not `Failed` for an abandoned job |
| `fail_succeeded` | `succeeded()` | skipped | **False** | no | `succeeded()` over a failed dependency |
| `fail_failed` | `failed()` | succeeded | **True** | yes | `failed()` over a failed dependency |
| `fail_failed_named` | `failed('dep_fail')` | succeeded | **True** | yes | same, with the dependency named explicitly |
| `fail_succeededorfailed` | `succeededOrFailed()` | succeeded | **True** | yes | `succeededOrFailed()` over a failed dependency — the Failed half of its name |
| `fail_always` | `always()` | succeeded | **True** | yes | `always()` over a failed dependency |
| `fail_result_is_failed` | `eq(dependencies.dep_fail.result, 'Failed')` | succeeded | **True** | yes | independent confirmation that the dependency really did record `Failed` |
