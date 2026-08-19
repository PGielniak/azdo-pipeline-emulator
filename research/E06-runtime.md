# E06 — Runtime library claims

[C-E06-001] A `task.setvariable` command makes its value available to following tasks, and secret values are saved as secrets and excluded from automatic task environments — https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands (checked 2026-08-12) — "The first task can set a variable, and following tasks are able to use the variable." / "Secret variables aren't passed into tasks as environment variables".

[C-E06-002] Cross-job variable transfer requires an output variable and a dependency expression; same-job task output variables use `TASK.VARIABLE` — https://learn.microsoft.com/azure/devops/pipelines/process/variables (checked 2026-08-12) — "To reference a variable from a different job, use `dependencies.JOB.outputs['TASK.VARIABLE']`."

[C-E06-003] The agent keeps variables in case-insensitive concurrent dictionaries and persists each value with secret/read-only metadata — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Variables.cs#L44-L103 (checked 2026-08-12) — "ConcurrentDictionary<string, Variable>(StringComparer.OrdinalIgnoreCase)".

[C-E06-004] The agent warns and still sets a read-only variable when `agent.readOnlyVariables` is disabled, but throws before setting it when the flag is enabled — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/TaskCommandExtension.cs#L629-L662 and https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Misc/layoutbin/en-US/strings.json (checked 2026-08-12) — "Overwriting readonly variable '{0}'. This behavior will be disabled in the future.".

[C-E06-005] An agent output variable is persisted on the task record and made available within its job as `<referenceName>.<name>` with read-only status — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/ExecutionContext.cs#L395-L413 (checked 2026-08-12) — "Variables.Set($\"{_record.RefName}.{name}\", value, secret: isSecret, readOnly: (isOutput || isReadOnly)".

[C-E06-006] The effective hosted-agent policy rejects a read-only overwrite and preserves the initial value for downstream macro expansion — research/experiments/E06-readonly-variables/real-run.md (run 539, checked 2026-08-12) — "Overwriting readonly variable 'readonlyProbe' is not permitted" / "READONLY_PROBE=first".

[C-E06-007] System and user variables other than secrets are injected into a task's process environment with names upper-cased and periods changed to underscores — https://learn.microsoft.com/azure/devops/pipelines/process/variables (checked 2026-08-19) — "The name is upper-cased, and the `.` is replaced with the `_`." / "This is automatically inserted into the process environment."

[C-E06-008] The agent's environment-name conversion additionally replaces spaces with underscores, while preserving every other character — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Microsoft.VisualStudio.Services.Agent/Util/VarUtil.cs#L70-L81 (checked 2026-08-19) — "value?.Replace('.', '_').Replace(' ', '_')" / "envVar.ToUpperInvariant()".

[C-E06-009] Secret variables are absent from the automatic process environment and enter a script environment only through an explicit task `env:` mapping; hosted run 540 confirms both halves — https://learn.microsoft.com/azure/devops/pipelines/process/variables (checked 2026-08-19) and research/experiments/E06-env-materialization/real-run.md (run 540, checked 2026-08-19) — "Secret variables aren't automatically exported as environment variables." / "You need to explicitly map secret variables."

[C-E06-010] A Bash task's explicit environment values are macro-expanded first, but the handler subsequently adds public variables into the same environment dictionary; therefore an automatic variable whose transformed name collides with a step `env:` key overwrites the explicit mapping — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/TaskRunner.cs#L277-L293 and https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Handlers/Handler.cs#L181-L240 (checked 2026-08-19), corroborated by research/experiments/E06-env-materialization/real-run.md (run 540, checked 2026-08-19) — "runtimeVariables.ExpandValues(target: environment)" / "Environment[key] = value ?? string.Empty".

[C-E06-011] When distinct variable names collapse to one environment name, the agent source specifies only last dictionary assignment, not a stable collision precedence; hosted run 540 observed `A.B` winning over `A_B` in all four declaration/runtime-write order cases — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Variables.cs#L44-L77 and https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Handlers/Handler.cs#L188-L240 (checked 2026-08-19), research/experiments/E06-env-materialization/real-run.md (run 540, checked 2026-08-19) — "return _expanded.Values" / "Environment[key] = value".

[C-E06-012] Each `task.prependpath` moves its path to the newest position, and the handler reverses the recorded list before prefixing PATH; two commands therefore materialize as `second:first:base` in the next task — https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#prependpath-prepend-a-path-to-the-path-environment-variable and https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/TaskCommandExtension.cs#L845-L866 plus https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Handlers/Handler.cs#L269-L302 (checked 2026-08-19), corroborated by research/experiments/E06-env-materialization/real-run.md (run 540) — "The updated environment variable will be reflected in subsequent tasks." / "ExecutionContext.PrependPath.Reverse<string>()".

## E06-S01-T05 grounding composition

Re-checked 2026-08-19 before implementation: C-E06-007/008 define public-variable
selection and name conversion; C-E06-009 defines secret exclusion and explicit mapping;
C-E06-010 defines public-over-explicit precedence; C-E06-012 defines newest-first PATH.
C-E06-011 is intentionally a non-contract: the implementation may not claim a universal
winner for two public names that collapse to the same transformed environment key.

[C-E06-013] The generated runner loads its default `.env` first and its optional `--env-file` second, so the optional file supplies the final value for repeated keys; the manifest's `env[].secret` flag controls registration in the variable store. — docs/04-generated-project-and-runtime.md §10 (checked 2026-08-19) — "`run.sh` sources `.env` ... then `--env-file` overlays. Values marked secret in the manifest are masked in logs."

[C-E06-014] A Bash variable assignment has the form `name=[value]`, accepts the empty string, restricts names to letters/numbers/underscores beginning with a letter or underscore, and expands the value using tilde, parameter, command, arithmetic, and quote removal. — https://www.gnu.org/software/bash/manual/html_node/Shell-Parameters.html and https://www.gnu.org/software/bash/manual/html_node/Definitions.html (checked 2026-08-19) — "A variable is assigned to using a statement of the form name=[value]" / "All values undergo tilde expansion, parameter and variable expansion, command substitution, arithmetic expansion, and quote removal."

[C-E06-015] Bash single quotes preserve every enclosed character literally, including embedded newlines, but cannot contain a single quote even when it is preceded by a backslash. — https://www.gnu.org/software/bash/manual/html_node/Single-Quotes.html (checked 2026-08-19) — "Enclosing characters in single quotes ... preserves the literal value of each character within the quotes. A single quote may not occur between single quotes."

[C-E06-016] In Bash double quotes, `$`, backquote, and backslash retain special behavior; a backslash outside quotes preserves the next character, while an unquoted backslash-newline pair is removed as a line continuation. — https://www.gnu.org/software/bash/manual/html_node/Double-Quotes.html and https://www.gnu.org/software/bash/manual/html_node/Escape-Character.html (checked 2026-08-19) — "Enclosing characters in double quotes ... preserves the literal value of all characters ... with the exception of `$`, backquote, `\\`" / "a `\\newline` pair ... is treated as a line continuation."

[C-E06-017] In the non-interactive Bash process used by the loader, `#` starts a comment only at the beginning of a word (start of line, after unquoted whitespace, or after an operator); the rest of that physical line is ignored. — https://www.gnu.org/software/bash/manual/html_node/Comments.html (checked 2026-08-19) — "a word beginning with `#` introduces a comment" / "The comment causes that word and all remaining characters on that line to be ignored."

## E06-S01-T03 grounding composition

C-E06-013 defines base/overlay precedence and secret classification. C-E06-014..017 define the
documented `KEY=value` syntax delegated to non-interactive Bash: identifier rules, empty values,
expansions, single/double/backslash quoting, multiline quotes and continuations, and comments.

[C-E06-018] Macro syntax is evaluated at runtime before each task, and a macro with no matching variable remains literal rather than becoming empty. — https://learn.microsoft.com/azure/devops/pipelines/process/variables (checked 2026-08-19) — "Macro syntax variables (`$(var)`) get processed during runtime before a task runs." / "If there's no variable by that name, the macro expression doesn't change."

[C-E06-019] One agent `ExpandValues` pass scans from the first `$(` to the next `)`, performs an exact case-insensitive dictionary lookup, skips over inserted bytes to prevent recursive replacement within that pass, and advances one character after an unmatched opener so a nested inner opener can still be found. — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Microsoft.VisualStudio.Services.Agent/Util/VarUtil.cs#L147-L205 (checked 2026-08-19) — "This algorithm does not perform recursive replacement." / "Bump the start index to prevent recursive replacement."

[C-E06-020] End-to-end hosted behavior nevertheless resolves a runtime-created variable chain across tasks: after task one stored `a` as literal `$(b)`, task two rendered `$(a)` as `inner`; the task's required observable "no recursion into substituted values" is therefore false. — research/experiments/E06-macro-expansion/real-run.md (run 541, checked 2026-08-19) — "CASE CHAIN=inner".

[C-E06-021] For nested-looking `$(a$(b))`, hosted run 541 left the unmatched outer candidate, expanded the inner `$(b)`, and did not revisit the newly formed `$(ainner)` even though `ainner=outer`; missing and prefix-related exact-name controls also matched the one-pass scanner. — research/experiments/E06-macro-expansion/real-run.md (run 541, checked 2026-08-19) — "CASE NESTED=$(ainner)" / "CASE UNMATCHED=$(missing)".

[C-E06-022] A logging-command variable write is stored as-is in both the agent's expanded and non-expanded dictionaries, but immediately before every following step `StepsRunner` invokes `RecalculateExpanded`; this phase boundary explains why a runtime-created `a=$(b)` becomes `a=inner` for the next task. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L587-L662, https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L395-L414, https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L416-L452, and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L118-L123 (checked 2026-08-19) — "Store the value as-is to the expanded dictionary and the non-expanded dictionary." / "Variable expansion."

[C-E06-023] The agent's pre-step variable recalculation recursively follows exact, case-insensitive macro references through the non-expanded dictionary, propagates secret status from referenced variables, caps the stack at 50 levels, detects cycles, and leaves the original top-level value unchanged when either guard fires. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L481-L630 (checked 2026-08-19) — "This algorithm handles recursive replacement using a stack." / "No replacement is performed if something went wrong."

[C-E06-024] After pre-step recalculation, `TaskRunner` expands task inputs and environment values from the expanded variable dictionary by calling the separate non-recursive `VarUtil.ExpandValues` scanner; it uses the first `)` after each `$(`, performs an exact case-insensitive candidate lookup, skips inserted bytes, and advances one character after a miss. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L287-L314, https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskRunner.cs#L222-L297, and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Microsoft.VisualStudio.Services.Agent/Util/VarUtil.cs#L147-L205 (checked 2026-08-19) — "This algorithm does not perform recursive replacement." / "Bump the start index to prevent recursive replacement."

## E06-S02-T01 completed source trace

C-E06-018 establishes before-each-task timing and literal preservation for a missing name.
C-E06-019 and C-E06-024 establish the individual target scanner. C-E06-022/023 supply the missing
phase boundary: `task.setvariable` stores raw text, then the next step recursively recalculates the
variable dictionary before `TaskRunner` scans the step's values. C-E06-020/021 are the hosted
cross-check. Thus run 541's `CHAIN=inner` is recursive *variable-dictionary recalculation* followed
by a one-pass target scan, while `NESTED=$(ainner)` is the target scanner advancing after the
unmatched outer candidate, expanding the inner `$(b)`, and not revisiting the newly formed outer
macro. GitHub code search is not part of this evidence path: the trace used the repository tree API
and commit-pinned raw files at `4571a73531e1ea6342ed46723dd39a115b92843b`.

[C-E06-025] The four inline shell shortcut schemas (`bash`, `script`, `powershell`, and `pwsh`) expose `workingDirectory` and `timeoutInMinutes`; a job-level timeout terminates a running step even when its own timeout is longer. — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-bash, https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-script, https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-powershell, and https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-pwsh (checked 2026-08-19) — "Start the script with this working directory." / "the running job (including your step) is terminated".

[C-E06-026] The Bash@3, CmdLine@2, and PowerShell@2 reference pages say an omitted working directory uses `Build.SourcesDirectory`, but that sentence is incomplete when `workspaceRepo` retargets the job default directory. — https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/bash-v3, https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/cmd-line-v2, and https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/powershell-v2 (checked 2026-08-19), contradicted by research/experiments/E06-run-step/real-run.md (run 542) — "If you leave it empty, the working directory is $(Build.SourcesDirectory)."

[C-E06-027] With `Build.SourcesDirectory` held at `<workspace>/s` and `System.DefaultWorkingDirectory` retargeted to `<workspace>/repo/workspace`, hosted run 542 started `bash`, `script`, and `pwsh` shortcuts in the latter directory; the effective default is therefore `System.DefaultWorkingDirectory`. — research/experiments/E06-run-step/real-run.md (run 542, checked 2026-08-19) — "CASE bash PWD=/home/vsts/work/1/repo/workspace BUILD=/home/vsts/work/1/s SYSTEM=/home/vsts/work/1/repo/workspace".

[C-E06-028] The agent's sequential step lifecycle starts the step context, recalculates variables, evaluates the condition, invokes the step only when the condition succeeds, merges its result into the job, and completes the step context. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L84-L123, https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L211-L310, and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L349-L485 (checked 2026-08-19) — "beginning sequential step processing" / "Run the step with worker timeout integration." / "Complete the step context."

[C-E06-029] Current Bash@3 and CmdLine@2 implementations write inline text to a unique script beneath `Agent.TempDirectory`, invoke Bash with the selected working directory, and direct both output streams into the live task output to preserve ordering. — https://github.com/microsoft/azure-pipelines-tasks/blob/6485321954dafb296697763c54c30a70840154f8/Tasks/BashV3/bash.ts#L158-L184 and https://github.com/microsoft/azure-pipelines-tasks/blob/6485321954dafb296697763c54c30a70840154f8/Tasks/CmdLineV2/cmdline.ts#L21-L48 (checked 2026-08-19) — "let tempDirectory = tl.getVariable('agent.tempDirectory')" / "Direct all output to STDOUT".

[C-E06-030] Immediately before execution, `StepsRunner` applies the step timeout to its execution-context cancellation source while also passing the job cancellation token into step execution, so either the individual limit or the enclosing job deadline can stop the step. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L314-L380 and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L417-L423 (checked 2026-08-19) — "SetTimeout(timeout: step.Timeout)" / "_cancellationTokenSource.CancelAfter(timeout.Value)".

## E06-S03-T01 grounding composition

C-E06-025/030 define the effective timeout cap: the caller passes the job-deadline-adjusted
remaining seconds as `--timeout`, and `run_step` enforces that limit around the process. C-E06-027
settles the shell default working directory with a live control that makes the two candidate
variables unequal; C-E06-026 records why the task-reference prose alone is insufficient.
C-E06-028 supplies the lifecycle seam, while C-E06-029 grounds private temporary script execution
and combined live output. Condition/result policy remains intentionally deferred to E06-S03-T02/T03.

[C-E06-031] The common task/step schema exposes `continueOnError` and `retryCountOnTaskFailure`, while Bash and PowerShell shortcut schemas additionally expose `failOnStderr`; retries default to zero and are capped at ten. — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-task, https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-bash, https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-powershell, and https://learn.microsoft.com/azure/devops/pipelines/process/tasks (checked 2026-08-19) — "Continue running even on failure?" / "The maximum number of retries allowed is 10."

[C-E06-032] Bash@3 begins with a `Succeeded` result and changes it to `Failed` when the shell exits nonzero, including its separately messaged exit-137 case. — https://github.com/microsoft/azure-pipelines-tasks/blob/6485321954dafb296697763c54c30a70840154f8/Tasks/BashV3/bash.ts#L203-L228 (checked 2026-08-19) — "let result = tl.TaskResult.Succeeded" / "if (exitCode !== 0) ... result = tl.TaskResult.Failed".

[C-E06-033] With `failOnStderr` enabled, Bash@3 and PowerShell@2 set a failure flag on every emitted stderr `Buffer`, keep both streams directed to the live task output, and mark the task failed after process exit when that flag was set; the trigger is therefore any stderr bytes, not a newline or a nonempty stream checked only at exit. — https://github.com/microsoft/azure-pipelines-tasks/blob/6485321954dafb296697763c54c30a70840154f8/Tasks/BashV3/bash.ts#L179-L225 and https://github.com/microsoft/azure-pipelines-tasks/blob/6485321954dafb296697763c54c30a70840154f8/Tasks/PowerShellV2/powershell.ts#L154-L184 (checked 2026-08-19) — "bash.on('stderr', (data: Buffer) => { stderrFailure = true" / "Direct all output to STDOUT".

[C-E06-034] Task retries are capped at ten and wait `(retry index + 1)^2` seconds before re-execution, yielding the documented 1-second first retry, 4-second second retry, and 100-second tenth retry. — https://learn.microsoft.com/azure/devops/pipelines/process/tasks and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskRunner.cs#L458-L478 plus https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/RetryHelper.cs#L9-L18 (checked 2026-08-19) — "The first retry happens after 1 second, the second retry after 4 seconds, and the tenth retry after 100 seconds." / "Math.Pow(retryNumber + 1, 2) * 1000".

[C-E06-035] The agent retries only while the attempt result is exactly `Failed`, clears that failure before the next attempt, emits a warning, and stops immediately after a non-failed attempt or after exhausting the configured retry count. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/RetryHelper.cs#L71-L125 (checked 2026-08-19) — "ExecutionContext.Result != TaskResult.Failed || ExhaustedRetryCount" / "Task result ... will retry".

[C-E06-036] After task execution and retries finish, `continueOnError` converts only a final `Failed` step to `SucceededWithIssues`; a canceled step is not downgraded. — https://learn.microsoft.com/azure/devops/pipelines/process/tasks and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L464-L485 (checked 2026-08-19) — "ignore a `failed` status and continue running" / "Result: Failed -> SucceededWithIssues".

[C-E06-037] The agent result state machine records a false condition as `Skipped`, a step-local timeout or exception as `Failed`, job-driven cancellation as `Canceled`, and merges only `Failed` or `SucceededWithIssues` into ordinary job failure state. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L211-L288 and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L349-L485 (checked 2026-08-19) — "Complete(TaskResult.Skipped" / "Result = TaskResult.Canceled".

## E06-S03-T02 grounding composition

C-E06-031 defines the supported YAML controls and retry bound. C-E06-032 maps shell exit status
to the initial attempt result; C-E06-033 adds the task-level stderr failure signal without delaying
live output. C-E06-034/035 define retry count, eligibility, warning, and square-second backoff.
C-E06-036 places `continueOnError` after retries and limits its downgrade to `Failed`.
C-E06-037 defines the five persisted result spellings and distinguishes step timeout failure from
job-driven cancellation. The task and agent sources answer every runtime ambiguity, so no hosted
experiment is required for this task.

[C-E06-038] A step with no authored condition uses `succeeded()`: it runs only while nothing in its job has failed, and `succeeded()` is true when there is no previous step. — https://learn.microsoft.com/azure/devops/pipelines/process/conditions (checked 2026-08-19) — "By default, a step runs if nothing in its job failed yet" / "This function also returns `true` if there is no previous step."

[C-E06-039] At step scope, `succeeded()` reads `Agent.JobStatus`, defaults an unset status to `Succeeded`, and accepts both `Succeeded` and `SucceededWithIssues`; `always()` is unconditionally true. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExpressionManager.cs#L24-L45 and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExpressionManager.cs#L99-L150 (checked 2026-08-19) — "parser.CreateTree(condition ... ) ?? new SucceededNode()" / "jobStatus == TaskResult.SucceededWithIssues".

[C-E06-040] A final failed task with `continueOnError: true` becomes `SucceededWithIssues` before its result is merged into `Agent.JobStatus`, so downstream default and explicit `succeeded()` conditions both run. — https://learn.microsoft.com/azure/devops/pipelines/process/tasks#continue-on-error and https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L281-L293 plus https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L464-L485 (checked 2026-08-19), corroborated by research/experiments/E06-condition-flow/real-run.md (run 543) — "Downstream steps and jobs treat the task result as `success`" / "Result: Failed -> SucceededWithIssues".

[C-E06-041] When a step condition is false, the hosted agent does not invoke the step, records `Skipped`, and writes the plain raw line `Skipping step due to condition evaluation.`; hosted run 543 confirms that exact log text and timeline result after a hard failure. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L211-L253 (checked 2026-08-19), corroborated by research/experiments/E06-condition-flow/real-run.md (run 543) — "Skipping step due to condition evaluation." / "Complete(TaskResult.Skipped".

[C-E06-042] A condition evaluation error fails the step rather than treating the error status as Boolean false; ordinary false is the separate `Skipped` path. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L211-L267 (checked 2026-08-19) — "fail the step since there is an evaluate error" / "Complete(TaskResult.Failed)".

[C-E06-043] After each ordinary step, the agent merges only `SucceededWithIssues` or `Failed` into the accumulated job status; `Succeeded` and `Skipped` leave that status unchanged for later step conditions. — https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L281-L301 (checked 2026-08-19) — "Update the job result" / "Job result unchanged".

## E06-S03-T03 grounding composition

C-E06-038/039 define the implicit condition and the step-scoped status predicates. C-E06-040/043
define how persisted step outcomes form the `Agent.JobStatus` seen by the next condition.
C-E06-041 supplies the false-condition result and exact hosted raw log line. C-E06-042 keeps the
shell backend's status `2` evaluation errors distinct from status `1` Boolean false; the runtime
condition boundary must preserve helper errors even when shell `||` or command substitution would
otherwise discard their status. Run 543 resolves the only log-format ambiguity and corroborates
the documented `SucceededWithIssues` control flow.
