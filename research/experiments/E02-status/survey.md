# E02-S03-T03 — job status check function survey (live service)

Each row is one live `preview` call. The **placement** column is the slot the expression was
submitted in, because the two open sources disagree about arity and only placement can
reconcile them: `ExpressionManager.cs` registers all five status functions with
`minParameters: 0, maxParameters: 0`, while the expressions doc documents `succeeded('A')`
argument forms "for a job".

Status functions are runtime-only, so **no row here shows an evaluated result** — preview never
runs them. What a row shows is whether the slot accepts the expression, and for accepted
condition rows the `condition:` values the service emitted (which also reveals the defaults it
injects). Truth tables come from the agent source and the docs, not from these rows.

Regenerate with `pnpm expr-status-survey`. Source of truth for C-E02-060..079 in
`research/E02-expressions.md`.

## Controls — is the condition body parsed?

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `ctl-step-arity` | step-condition | `eq(1)` | rejected (400) | Job Job: Step  specifies condition eq(1) which is not valid. Reason: Unexpected symbol: ')'. Located at position 5 within expression: 'eq(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the single row every arity claim below depends on: if a known-bad arity in a step condition is accepted, preview does not gate conditions and no arity row means anything |
| `ctl-job-arity` | job-condition | `eq(1)` | rejected (400) | Unexpected symbol: ')'. Located at position 5 within expression: 'eq(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same control at the job level |
| `ctl-stage-arity` | stage-condition | `eq(1)` | rejected (400) | Unexpected symbol: ')'. Located at position 5 within expression: 'eq(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same control at the stage level |
| `ctl-step-unknown-fn` | step-condition | `nosuchfunc()` | accepted | `nosuchfunc()` | whether the function *name* is resolved in a condition, not just the syntax |
| `ctl-step-syntax` | step-condition | `eq(1, 'a'` | rejected (400) | Job Job: Step  specifies condition eq(1, 'a' which is not valid. Reason: Unclosed function: 'eq'. Located at position 1 within expression: 'eq(1, 'a''. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | pure syntax error, the weakest form of gating |

## Zero-argument form per slot

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `step-always` | step-condition | `always()` | accepted | `always()` | baseline: the agent registers this one, so it must be legal here |
| `step-canceled` | step-condition | `canceled()` | accepted | `canceled()` | baseline |
| `step-failed` | step-condition | `failed()` | accepted | `failed()` | baseline |
| `step-succeeded` | step-condition | `succeeded()` | accepted | `succeeded()` | baseline |
| `step-sof` | step-condition | `succeededOrFailed()` | accepted | `succeededOrFailed()` | baseline |
| `job-succeeded` | job-condition | `succeeded()` | accepted | `succeeded()` | baseline at the job level |
| `stage-succeeded` | stage-condition | `succeeded()` | accepted | `succeeded()` | baseline at the stage level |

## Arguments — step slot

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `step-succeeded-arg` | step-condition | `succeeded('A')` | accepted | `succeeded('A')` | the headline question: ExpressionManager.cs registers succeeded with maxParameters 0, so if the service accepts this the check is agent-side only and we must reject it ourselves at the step level or accept a divergence |
| `step-failed-arg` | step-condition | `failed('A')` | accepted | `failed('A')` | same question for failed |
| `step-sof-arg` | step-condition | `succeededOrFailed('A')` | accepted | `succeededOrFailed('A')` | same question for succeededOrFailed |
| `step-always-arg` | step-condition | `always('A')` | accepted | `always('A')` | the docs describe no argument form for always at any level |
| `step-canceled-arg` | step-condition | `canceled('A')` | accepted | `canceled('A')` | the docs describe no argument form for canceled at any level |

## Arguments — job slot

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `job-succeeded-arg` | job-condition | `succeeded('A')` | accepted | `succeeded('A')` | the documented job-name form; A is a real dependency here |
| `job-succeeded-two-args` | job-condition | `succeeded('A', 'A')` | accepted | `succeeded('A', 'A')` | upper arity: the docs say "job names" plural but state no maximum |
| `job-succeeded-unknown` | job-condition | `succeeded('nosuchjob')` | accepted | `succeeded('nosuchjob')` | whether a job name argument is validated against the dependency graph at compile time — if it is, the emitter must too |
| `job-succeeded-nonstring` | job-condition | `succeeded(1)` | accepted | `succeeded(1)` | whether the argument is typed as a String at parse time |
| `job-failed-arg` | job-condition | `failed('A')` | accepted | `failed('A')` | the documented job-name form for failed |
| `job-sof-arg` | job-condition | `succeededOrFailed('A')` | accepted | `succeededOrFailed('A')` | the documented job-name form for succeededOrFailed |
| `job-always-arg` | job-condition | `always('A')` | rejected (400) | Unexpected symbol: ')'. Located at position 11 within expression: 'always('A')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | undocumented at every level — settles whether always is 0-arity everywhere |
| `job-canceled-arg` | job-condition | `canceled('A')` | rejected (400) | Unexpected symbol: ')'. Located at position 13 within expression: 'canceled('A')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | undocumented at every level — settles whether canceled is 0-arity everywhere |

## Arguments — stage slot

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `stage-succeeded-arg` | stage-condition | `succeeded('A')` | accepted | `succeeded('A')` | the docs speak of "job names"; stage conditions take stage names by the same syntax |

## Name casing

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `case-upper` | step-condition | `SUCCEEDED()` | accepted | `SUCCEEDED()` | C-E02-011 found function names case-insensitive; confirm the status family follows |
| `case-lower-sof` | step-condition | `succeededorfailed()` | accepted | `succeededorfailed()` | the camel-cased name folded flat |

## Phase gating

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `compile-always` | compile-var | `always()` | rejected (400) | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'always'. Located at position 1 within expression: 'always()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | whether the status family exists in the compile-time function table at all (E02-S04-T01 inherits the answer) |
| `compile-succeeded` | compile-var | `succeeded()` | rejected (400) | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'succeeded'. Located at position 1 within expression: 'succeeded()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same question for the function with a documented step meaning |
| `runtime-var-always` | runtime-var | `always()` | rejected (400) | An error occurred while loading the YAML build pipeline. Unrecognized value: 'always'. Located at position 1 within expression: 'always()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the doc sentence "Use the following status check functions as expressions in conditions, but not in variable definitions" — is it enforced or advisory? |
| `runtime-var-succeeded` | runtime-var | `succeeded()` | rejected (400) | An error occurred while loading the YAML build pipeline. Unrecognized value: 'succeeded'. Located at position 1 within expression: 'succeeded()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same question, the function whose value would actually vary |
| `if-succeeded` | if-directive | `succeeded()` | rejected (400) | /azure-pipelines.yml (Line: 2, Col: 3): Unrecognized value: 'succeeded'. Located at position 1 within expression: 'succeeded()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | `${{ if }}` is compile-time — a status function there can never mean anything |
| `step-condition-compile-wrapped` | step-condition | `${{ succeeded() }}` | rejected (400) | /azure-pipelines.yml (Line: 3, Col: 14): Unrecognized value: 'succeeded'. Located at position 1 within expression: 'succeeded()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | a condition body wrapped in compile-time delimiters resolves in the compile-time table |
| `step-bare-always` | step-condition | `always` | accepted | `always` | without parentheses: is the name also registered as a named value? |

## Controls II — which table validates which slot

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `ctl-job-unknown-fn` | job-condition | `nosuchfunc()` | rejected (400) | Unrecognized value: 'nosuchfunc'. Located at position 1 within expression: 'nosuchfunc()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | does the job slot resolve function names, where the step slot did not? |
| `ctl-stage-unknown-fn` | stage-condition | `nosuchfunc()` | rejected (400) | Unrecognized value: 'nosuchfunc'. Located at position 1 within expression: 'nosuchfunc()'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same question at the stage level |
| `ctl-step-unknown-fn-arity` | step-condition | `nosuchfunc(1, 2, 3)` | accepted | `nosuchfunc(1, 2, 3)` | if an unknown name takes any arity in a step condition, the step slot checks syntax only and every step-slot "accepted" row above is silent about arity |
| `ctl-step-eq-3args` | step-condition | `eq(1, 2, 3)` | rejected (400) | Job Job: Step  specifies condition eq(1, 2, 3) which is not valid. Reason: Unexpected symbol: ','. Located at position 8 within expression: 'eq(1, 2, 3)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the complement: a *known* name over-supplied in the step slot |
| `ctl-runtime-var-eq` | runtime-var | `eq(1, 1)` | accepted | $[ eq(1, 1) ] | control for the two runtime-var rejections above: proves a runtime variable body is parsed and that it was the status *name* that failed, not the slot |

## Arguments II — job and stage arity table

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `job-always-zero` | job-condition | `always()` | accepted | `always()` | zero-argument baseline for the function whose one-argument form was rejected |
| `job-canceled-zero` | job-condition | `canceled()` | accepted | `canceled()` | same baseline for canceled |
| `job-bare-always` | job-condition | `always` | rejected (400) | Expected '(' to follow a function: 'always'. Located at position 1 within expression: 'always'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the step slot accepted a bare `always`; does the slot that resolves names? |
| `job-succeeded-three-args` | job-condition | `succeeded('A', 'A', 'A')` | accepted | `succeeded('A', 'A', 'A')` | confirms the upper bound is N and not 2 |
| `job-failed-two-args` | job-condition | `failed('A', 'A')` | accepted | `failed('A', 'A')` | N-ary for failed too |
| `job-sof-two-args` | job-condition | `succeededOrFailed('A', 'A')` | accepted | `succeededOrFailed('A', 'A')` | N-ary for succeededOrFailed too |
| `job-succeeded-empty-string` | job-condition | `succeeded('')` | accepted | `succeeded('')` | is an empty job name rejected, i.e. is the argument validated as a name at all? |
| `job-succeeded-var-arg` | job-condition | `succeeded(variables['jobName'])` | accepted | `succeeded(variables['jobName'])` | must the argument be a literal, or is it a general expression? decides whether the compiler can resolve names statically |
| `stage-always-arg` | stage-condition | `always('A')` | rejected (400) | Unexpected symbol: ')'. Located at position 11 within expression: 'always('A')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the job-slot arity split, re-measured in the stage slot |
| `stage-canceled-arg` | stage-condition | `canceled('A')` | rejected (400) | Unexpected symbol: ')'. Located at position 13 within expression: 'canceled('A')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the job-slot arity split, re-measured in the stage slot |

## Neighbours — how status calls compose

| id | placement | expression | outcome | emitted / message | decides |
|---|---|---|---|---|---|
| `job-not-succeeded` | job-condition | `not(succeeded())` | accepted | `not(succeeded())` | a status call as an argument, in the slot that actually resolves names |
| `job-and-succeeded` | job-condition | `and(succeeded(), eq(variables['Build.Reason'], 'Manual'))` | accepted | `and(succeeded(), eq(variables['Build.Reason'], 'Manual'))` | the documented idiom, end to end |
| `job-not-canceled` | job-condition | `not(canceled())` | accepted | `not(canceled())` | the doc's own recommended replacement for succeededOrFailed when dependencies are skipped |
| `job-dependency-result` | job-condition | `in(dependencies.A.result, 'Succeeded', 'SucceededWithIssues', 'Skipped')` | accepted | `in(dependencies.A.result, 'Succeeded', 'SucceededWithIssues', 'Skipped')` | the explicit form the docs offer instead of the status functions — grounds the result spellings and hands E02-S04-T02 a live row |
| `step-agent-jobstatus` | step-condition | `in(variables['Agent.JobStatus'], 'Succeeded', 'SucceededWithIssues')` | accepted | `in(variables['Agent.JobStatus'], 'Succeeded', 'SucceededWithIssues')` | the expansion the docs give for step-level succeeded(); if it is legal in the same slot, the doc's "equivalent to" is literal |
