# E02-S04-T01 — expression context availability survey (live service)

Each row is one live `preview` call. The **placement** column is the slot the expression was
submitted in; the expression itself is held as close to constant as the slot allows (a condition
row wraps the context read in `eq(…, 'x')` so it is a predicate).

The expressions doc spends one sentence on availability — "In a compile-time expression you have
access to `parameters` and statically defined `variables`. In a runtime expression you have
access to more `variables` but no parameters." — which names two slots and three contexts. This
table measures seven contexts across six slots, because C-E02-065 already established that the
*function* table is per-slot and there is no reason to assume the named-value table is not.

**Two kinds of row are deliberately not evidence.** A `step-condition` row is accepted whatever
you put in it — that path resolves no names (C-E02-060, docs/06 §5 decision 17). And a
`runtime-var` row shows *legality only*: preview parses `$[ ]` at queue time (C-E02-015) but
never evaluates it, so the emitted value is the unevaluated expression, not a result.
`compile-var` rows do carry real values, because `${{ }}` is expanded into the returned YAML.

Regenerate with `pnpm expr-context-survey`. Source of truth for C-E02-080..089 in
`research/E02-expressions.md`.

## Controls — the unknown-context baseline

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `ctl-unknown-compile-var` | compile-var | `nosuchcontext.probe` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'nosuchcontext'. Located at position 1 within expression: 'nosuchcontext.probe'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the reference rejection every availability row below is compared against; if a wrong-slot context renders the same sentence, availability is a name set and errors.ts is untouched |
| `ctl-unknown-runtime-var` | runtime-var | `nosuchcontext.probe` | **rejected (400)** | An error occurred while loading the YAML build pipeline. Unrecognized value: 'nosuchcontext'. Located at position 1 within expression: 'nosuchcontext.probe'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same baseline for the runtime slot |
| `ctl-unknown-job-condition` | job-condition | `eq(nosuchcontext.probe, 'x')` | **rejected (400)** | Unrecognized value: 'nosuchcontext'. Located at position 4 within expression: 'eq(nosuchcontext.probe, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same baseline for the job condition slot |
| `ctl-unknown-stage-condition` | stage-condition | `eq(nosuchcontext.probe, 'x')` | **rejected (400)** | Unrecognized value: 'nosuchcontext'. Located at position 4 within expression: 'eq(nosuchcontext.probe, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same baseline for the stage condition slot |
| `ctl-unknown-if-directive` | if-directive | `eq(nosuchcontext.probe, 'x')` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 3): Unrecognized value: 'nosuchcontext'. Located at position 4 within expression: 'eq(nosuchcontext.probe, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same baseline for the compile-time `if` slot |
| `ctl-unknown-step-condition` | step-condition | `eq(nosuchcontext.probe, 'x')` | **accepted** | `eq(nosuchcontext.probe, 'x')` | NOT evidence — expected to be accepted because the step condition path resolves no names (C-E02-060, docs/06 §5 decision 17). Present so no later reader mistakes a step-slot 200 for availability |

## `parameters`

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `parameters-compile-var` | compile-var | `parameters.myParam` | **accepted** | `paramValue` | the documented compile-time availability of `parameters`, and its resolved value |
| `parameters-runtime-var` | runtime-var | `parameters.myParam` | **rejected (400)** | An error occurred while loading the YAML build pipeline. Unrecognized value: 'parameters'. Located at position 1 within expression: 'parameters.myParam'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the doc's "no parameters" claim for runtime expressions — whether it is enforced by the parser or merely advice |
| `parameters-job-condition` | job-condition | `eq(parameters.myParam, 'x')` | **rejected (400)** | Unrecognized value: 'parameters'. Located at position 4 within expression: 'eq(parameters.myParam, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | whether a bare (runtime) job condition can read `parameters` |
| `parameters-stage-condition` | stage-condition | `eq(parameters.myParam, 'x')` | **rejected (400)** | Unrecognized value: 'parameters'. Located at position 4 within expression: 'eq(parameters.myParam, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the same at stage level |
| `parameters-if-directive` | if-directive | `eq(parameters.myParam, 'x')` | **accepted** | echo done | the compile-time `if` slot, which E03 drives |

## `variables`

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `variables-compile-var` | compile-var | `variables.myVar` | **accepted** | `varValue` | compile-time availability of statically defined `variables`, and the resolved value |
| `variables-runtime-var` | runtime-var | `variables.myVar` | **accepted** | `$[ variables.myVar ]` | runtime availability of `variables` |
| `variables-job-condition` | job-condition | `eq(variables.myVar, 'x')` | **accepted** | `eq(variables.myVar, 'x')` | job condition availability of `variables` |
| `variables-stage-condition` | stage-condition | `eq(variables.myVar, 'x')` | **accepted** | `eq(variables.myVar, 'x')` | stage condition availability of `variables` |
| `variables-if-directive` | if-directive | `eq(variables.myVar, 'x')` | **accepted** | echo done | compile-time `if` availability of `variables` |

## `dependencies`

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `dependencies-compile-var` | compile-var | `dependencies.A.result` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'dependencies'. Located at position 1 within expression: 'dependencies.A.result'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | THE discriminating row: `dependencies` is a real context that cannot exist at compile time. Same sentence as ctl-unknown-compile-var ⇒ availability is a per-slot name set, nothing more |
| `dependencies-runtime-var` | runtime-var | `dependencies.A.result` | **rejected (400)** | An error occurred while loading the YAML build pipeline. Unrecognized value: 'dependencies'. Located at position 1 within expression: 'dependencies.A.result'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | whether `dependencies` is legal in a variable value at all, or only in conditions |
| `dependencies-job-condition` | job-condition | `eq(dependencies.A.result, 'x')` | **accepted** | `eq(dependencies.A.result, 'x')` | the documented job-level home of `dependencies` |
| `dependencies-stage-condition` | stage-condition | `eq(dependencies.A.result, 'x')` | **accepted** | `eq(dependencies.A.result, 'x')` | the documented stage-level home of `dependencies` (different shape, same name) |
| `dependencies-if-directive` | if-directive | `eq(dependencies.A.result, 'x')` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 3): Unrecognized value: 'dependencies'. Located at position 4 within expression: 'eq(dependencies.A.result, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | whether the compile-time `if` slot shares the compile-var name table |

## `stageDependencies`

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `stagedependencies-compile-var` | compile-var | `stageDependencies.A.A1.result` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'stageDependencies'. Located at position 1 within expression: 'stageDependencies.A.A1.result'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | compile-time rejection shape for the second graph context |
| `stagedependencies-runtime-var` | runtime-var | `stageDependencies.A.A1.result` | **rejected (400)** | An error occurred while loading the YAML build pipeline. Unrecognized value: 'stageDependencies'. Located at position 1 within expression: 'stageDependencies.A.A1.result'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | runtime variable legality |
| `stagedependencies-job-condition` | job-condition | `eq(stageDependencies.A.A1.result, 'x')` | **accepted** | `eq(stageDependencies.A.A1.result, 'x')` | the documented job-level home of `stageDependencies` |
| `stagedependencies-stage-condition` | stage-condition | `eq(stageDependencies.A.A1.result, 'x')` | **accepted** | `eq(stageDependencies.A.A1.result, 'x')` | whether the stage slot also carries `stageDependencies` — the docs only ever use `dependencies` there, so a rejection would make job and stage conditions two different tables |

## `resources` / `pipeline` / `environment`

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `resources-compile-var` | compile-var | `resources.pipeline.probe.runID` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'resources'. Located at position 1 within expression: 'resources.pipeline.probe.runID'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | compile-time availability of the pinned-run context E02-S04-T03 populates |
| `resources-runtime-var` | runtime-var | `resources.pipeline.probe.runID` | **accepted** | `$[ resources.pipeline.probe.runID ]` | runtime availability of the same |
| `resources-job-condition` | job-condition | `eq(resources.pipeline.probe.runID, 'x')` | **rejected (400)** | Unrecognized value: 'resources'. Located at position 4 within expression: 'eq(resources.pipeline.probe.runID, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | condition availability of the same |
| `pipeline-compile-var` | compile-var | `pipeline.startTime` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'pipeline'. Located at position 1 within expression: 'pipeline.startTime'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the `pipeline` context the counter/format doc examples use — the doc says `pipeline.startTime` "isn't available outside of expressions", which says nothing about which slot |
| `pipeline-runtime-var` | runtime-var | `pipeline.startTime` | **accepted** | `$[ pipeline.startTime ]` | the slot the doc example actually uses (`$[counter(format(...), 100)]`) |
| `pipeline-job-condition` | job-condition | `eq(pipeline.startTime, 'x')` | **accepted** | `eq(pipeline.startTime, 'x')` | condition availability of `pipeline` |
| `environment-compile-var` | compile-var | `environment.name` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Unrecognized value: 'environment'. Located at position 1 within expression: 'environment.name'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | compile-time availability of the deployment-only `environment` context |
| `environment-runtime-var` | runtime-var | `environment.name` | **rejected (400)** | An error occurred while loading the YAML build pipeline. Unrecognized value: 'environment'. Located at position 1 within expression: 'environment.name'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | runtime availability of `environment` in a non-deployment pipeline |
| `environment-job-condition` | job-condition | `eq(environment.name, 'x')` | **rejected (400)** | Unrecognized value: 'environment'. Located at position 4 within expression: 'eq(environment.name, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | condition availability of `environment` outside a deployment job |

## Provider semantics — what a resolved context returns

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `variables-index-dotted` | compile-var | `variables['My.Var']` | **accepted** | `dottedValue` | that `variables` is FLAT and keyed by the literal dotted name (index syntax) |
| `variables-property-dotted` | compile-var | `variables.My.Var` | **accepted** | `` | whether the property chain `variables.My.Var` nests (would return dottedValue) or null-propagates (empty) — the flatness claim from the other side |
| `variables-property-case` | compile-var | `variables.MYVAR` | **accepted** | `varValue` | the key-comparison policy of the `variables` context object (expected ignore-case) |
| `variables-missing` | compile-var | `variables.noSuchVariable` | **accepted** | `` | that a miss is Null rather than an error (the doc's "dictionary miss" sentence) |
| `variables-predefined-compile` | compile-var | `variables['Build.SourceBranch']` | **accepted** | `refs/heads/main` | the sharpest reading of "statically defined variables": is a predefined system variable in the compile-time context, and if so with what value |
| `parameters-property-case` | compile-var | `parameters.MYPARAM` | **accepted** | `paramValue` | the key-comparison policy of the `parameters` context object — C-E02-024..027 measured NESTED parameter objects as ordinal case-SENSITIVE; whether the top-level context shares that policy is a separate cell and the provider must construct it correctly |
| `parameters-index-syntax` | compile-var | `parameters['myParam']` | **accepted** | `paramValue` | that index and property syntax hit the same lookup for `parameters` |
| `parameters-missing` | compile-var | `parameters.noSuchParameter` | **rejected (400)** | /azure-pipelines.yml (Line: 6, Col: 10): Key not found 'noSuchParameter' | whether an undeclared parameter is Null or an error |
| `parameters-undeclared-block` | compile-var | `parameters.myParam` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 10): Key not found 'myParam' | whether `parameters` exists as an empty context when the pipeline declares no parameters block at all — decides whether the provider registers the name unconditionally |
| `variables-bare` | compile-var | `variables` | **rejected (400)** | /azure-pipelines.yml (Line: 4, Col: 10): A mapping was not expected ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.hosttype' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.servertype' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.culture' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.collectionId' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.collectionUri' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.teamFoundationCollectionUri' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.taskDefinitionsUri' ⏎ /azure-pipelines.yml (Line: 4, Col: 10): Cannot override system variable 'system.pipelineStartTime' | whether the bare context name is a legal expression, and how an Object stringifies into a variable value |

## Second batch — is the runtime variable table job-scoped?

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `variables-job-scoped-runtime-var` | job-scoped-runtime-var | `variables.myVar` | **accepted** | `$[ variables.myVar ]` | control: the new placement resolves contexts at all |
| `dependencies-job-scoped-runtime-var` | job-scoped-runtime-var | `dependencies.A.result` | **accepted** | `$[ dependencies.A.result ]` | whether `dependencies` is rejected in a runtime *variable* because variables never carry it, or only because the ROOT variables block has no dependency graph — the difference between one runtime table and two |
| `resources-job-scoped-runtime-var` | job-scoped-runtime-var | `resources.pipeline.probe.runID` | **accepted** | `$[ resources.pipeline.probe.runID ]` | whether `resources` survives into a job-scoped runtime variable too |

## Second batch — do job and stage conditions share one table?

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `pipeline-stage-condition` | stage-condition | `eq(pipeline.startTime, 'x')` | **accepted** | `eq(pipeline.startTime, 'x')` | `pipeline` was accepted in a job condition; if the stage slot agrees they are one table |
| `resources-stage-condition` | stage-condition | `eq(resources.pipeline.probe.runID, 'x')` | **rejected (400)** | Unrecognized value: 'resources'. Located at position 4 within expression: 'eq(resources.pipeline.probe.runID, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | `resources` was rejected in a job condition; confirms the stage slot matches |
| `stagedependencies-if-directive` | if-directive | `eq(stageDependencies.A.A1.result, 'x')` | **rejected (400)** | /azure-pipelines.yml (Line: 2, Col: 3): Unrecognized value: 'stageDependencies'. Located at position 4 within expression: 'eq(stageDependencies.A.A1.result, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | completes the compile-time row for the second graph context |

## Second batch — is `environment` deployment-job-only?

| id | placement | expression | outcome | detail | decides |
|---|---|---|---|---|---|
| `environment-deployment-condition` | deployment-job-condition | `eq(environment.name, 'x')` | **rejected (400)** | Unrecognized value: 'environment'. Located at position 4 within expression: 'eq(environment.name, 'x')'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | whether `environment` is rejected everywhere or only outside a deployment job — i.e. whether the name table also varies by JOB KIND, which would add a dimension E04/E10 must carry |
| `environment-deployment-runtime-var` | deployment-scoped-runtime-var | `environment.name` | **rejected (400)** | Job D: Environment probe-env could not be found. The environment does not exist or has not been authorized for use. | the same question in the deployment job's own runtime variable slot |
| `variables-deployment-runtime-var` | deployment-scoped-runtime-var | `variables.myVar` | **rejected (400)** | Job D: Environment probe-env could not be found. The environment does not exist or has not been authorized for use. | control: the deployment placement resolves contexts at all |
