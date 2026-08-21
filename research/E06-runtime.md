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

[C-E06-044] The agent scans each physical UTF-8 stdout line as it arrives, recognizes the
`##vso[area.action property=value;...]message` form, and does not recognize a command containing
an unescaped literal newline as one command. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands (checked 2026-08-19)
— "scanning standard output (stdout) ... in real time" / "Each logging command must be on a
single line."

[C-E06-045] The Node task library emits property values by escaping percent, carriage return,
newline, close bracket, and semicolon, while message data escapes only percent, carriage return,
and newline; `%AZP25`, `%0D`, `%0A`, `%5D`, and `%3B` are the corresponding wire tokens. —
https://github.com/microsoft/azure-pipelines-task-lib/blob/c377a1115fdc0e5aea896df36219b59c181d9bc4/node/taskcommand.ts#L26-L48 and
https://github.com/microsoft/azure-pipelines-task-lib/blob/c377a1115fdc0e5aea896df36219b59c181d9bc4/node/taskcommand.ts#L93-L118
(checked 2026-08-19) — "replace(/%/g, '%AZP25')" / "replace(/;/g, '%3B')".

[C-E06-046] The agent finds the first `##vso[` anywhere in a line and the first following `]`,
requires an area/event pair, splits properties on semicolons and each accepted pair at its first
equals sign, stores property names case-insensitively, and treats the suffix after `]` as data. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Microsoft.VisualStudio.Services.Agent/Command.cs#L11-L103
(checked 2026-08-19) — "message.IndexOf(LoggingCommandPrefix)" / "StringComparer.OrdinalIgnoreCase".

[C-E06-047] Agent unescaping replaces `%3B`, `%0D`, `%0A`, and `%5D` before optionally replacing
`%AZP25`, whose current default is enabled; this order prevents a double-encoded token such as
`%AZP253B` from being decoded twice. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Sdk/CommandStringConvertor.cs#L32-L60 and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Sdk/Knob/AgentKnobs.cs#L482-L487
(checked 2026-08-19) — "unescaped.Replace(mapping.Replacement, mapping.Token)" /
"new BuiltInDefaultKnobSource(\"true\")".

[C-E06-048] The hosted agent warns for malformed text containing `##vso` and for an unknown
command area; a successfully parsed unknown-area command is considered processed and is not
written again as ordinary output. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/WorkerCommandManager.cs#L69-L148 and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Handlers/ProcessHandler/ProcessHandler.cs#L326-L373
(checked 2026-08-19) — "print warning with DOC link" / "Cannot find command extension".

[C-E06-049] The emulator deliberately keeps an unknown or malformed logging-command line visible
after its warning so local debugging never silently discards output; this is the backlog's
`warning passthrough` policy and a documented delta from C-E06-048. — backlog/E06-runtime.md
E06-S04-T01 and docs/04-generated-project-and-runtime.md §6 (checked 2026-08-19) — "unknown
command → warning passthrough."

## E06-S04-T01 grounding composition

C-E06-044 defines the streaming, physical-line boundary and public wire format. C-E06-045 defines
the task-lib producer contract the parser must invert. C-E06-046 defines command discovery,
property splitting, and case-insensitive lookup. C-E06-047 fixes the one-pass decode order,
including percent escaping. C-E06-048 records hosted malformed/unknown behavior; C-E06-049 makes
the task's explicit warning-and-passthrough policy visible as a deliberate local-debug delta.

[C-E06-050] A variable created by `task.setvariable` is unavailable to the task that emits the
command: macro substitution has already happened and the running process environment is unchanged;
hosted run 544 retained literal `$(plain)` and reported no `PLAIN` entry in that task. —
https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts and
research/experiments/E06-setvariable/real-run.md (run 544, checked 2026-08-19) — "Newly set
variables aren't available in the same task."

[C-E06-051] A non-output variable created by `task.setvariable` is available to following tasks in
the same job through both `$(name)` macro syntax and its automatic environment mapping; hosted run
544 rendered `later-value` through both forms. —
https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts and
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands plus
research/experiments/E06-setvariable/real-run.md (run 544, checked 2026-08-19) — "following tasks
can use the variable using macro syntax" / "exposed to the following tasks as an environment
variable."

[C-E06-052] An `isOutput=true` write is available in the following same-job task as
`$(stepName.variable)` and in a dependent job through
`dependencies.JOB.outputs['stepName.variable']`; hosted run 544 rendered `output-value` through
both paths. — https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L395-L414 plus
research/experiments/E06-setvariable/real-run.md (run 544, checked 2026-08-19) — "include the task
name" / "reference them with `dependencies`."

[C-E06-053] `isSecret=true` registers the nonempty value with the agent masker before later output
is processed: hosted run 544 masked both a line later in the emitting task and a macro-expanded
line in the following task. —
https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L39-L53,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L643-L661, and
research/experiments/E06-setvariable/real-run.md (run 544, checked 2026-08-19) — "saved as secret
and masked out from logs" / "SecretMasker.AddValue".

[C-E06-054] The agent requires a nonempty `variable` property and parses `isSecret`, `isOutput`,
and `isReadOnly` with Boolean `TryParse`, leaving each flag false when absent or unparseable. —
https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L582-L620
(checked 2026-08-19) — "`variable` = variable name (Required)" / "Boolean.TryParse".

[C-E06-055] A secret logging-command value containing a newline is rejected by default; the agent
permits it only through the explicitly unsafe `SYSTEM_UNSAFEALLOWMULTILINESECRET` knob, whose
built-in default is false. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L643-L655 and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Sdk/Knob/AgentKnobs.cs#L406-L412
(checked 2026-08-19) — "Secrets cannot contain multiple lines" / "We recommend leaving this
option off."

[C-E06-056] Once a variable is secret, later writes preserve its secret status even when the new
command omits `isSecret`; the agent also registers the replacement value with its masker. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L416-L451
(checked 2026-08-19) — "secret = secret || ... _expanded[name].Secret" / "Register the secret."

## E06-S04-T02 grounding composition

C-E06-050/051 define the current-task boundary and following-task visibility, with run 544 serving
as the required hosted counterpart to the Bats lifecycle test. C-E06-052 defines both output
storage/reference paths; C-E06-053 defines immediate secret registration and masking; C-E06-054
defines handler property validation and defaults. C-E06-055/056 prevent multiline and downgrade
leaks. Existing C-E06-005/006 supply output-alias read-only storage and strict `isReadOnly`
overwrite enforcement. No source contradicts docs/04.

## E06-S04-T03 grounding composition

[C-E06-057] `task.prependpath` requires a nonempty value, moves a repeated entry to the newest
position, and its PATH change is scoped to later tasks rather than the emitting one. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#prependpath-prepend-a-path-to-the-path-environment-variable and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L845-L868
(checked 2026-08-21) — "Update the PATH environment variable by prepending to the PATH. The
updated environment variable will be reflected in subsequent tasks." / "ArgUtil.NotNullOrEmpty(data,
this.Name); context.PrependPath.RemoveAll(...); context.PrependPath.Add(data);". Ordering of the
resulting PATH is the already-established C-E06-012.

[C-E06-058] `task.setsecret` registers its message with the job masker for the remainder of the
job and masks only output produced after the registration; the handler delegates to the same
`TaskCommandHelper.AddSecret` used by `task.setvariable`, which ignores an empty value. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#setsecret-register-a-value-as-a-secret and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L567-L580
(checked 2026-08-21) — "The value is registered as a secret for the duration of the job. The value
will be masked out from the logs from this point forward." / "Note: Previous occurrences of the
secret value won't be masked." / "TaskCommandHelper.AddSecret(context, command.Data,
WellKnownSecretAliases.TaskSetSecretCommand)".

[C-E06-059] `task.complete` merges a parsed `result` into the task result; the agent source
**requires** a present, nonempty, parseable `result` and throws `InvalidCommandResult` otherwise,
contradicting the doc sentence that a missing result means succeeded. The optional `done=true`
property additionally forces task completion. — Doc:
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#complete-finish-timeline
(checked 2026-08-21) — "Finish the timeline record for the current task, set task result and
current operation. When result not provided, set result to succeeded." / "`Succeeded` … 
`SucceededWithIssues` The task ran into problems. … `Failed` The build will be completed as
failed." — Source:
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L503-L535
(checked 2026-08-21) — "if (!eventProperties.TryGetValue(TaskCompleteEventProperties.Result, out
resultText) || String.IsNullOrEmpty(resultText) || !Enum.TryParse<TaskResult>(resultText, out
result)) { throw new ArgumentException(StringUtil.Loc(\"InvalidCommandResult\")); }" /
"context.Result = TaskResultUtil.MergeTaskResults(context.Result, result);" /
"context.ForceTaskComplete();". **The source wins**: the emulator requires `result` and treats a
missing/unparseable value as a failed command (C-E06-064), because the doc sentence describes
neither the throw nor the merge that the same handler performs.

[C-E06-060] Task results merge worst-wins over the order
`Succeeded → SucceededWithIssues → Failed → Canceled/Skipped/Abandoned`, and a current result
worse than `Failed` is sticky. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Microsoft.VisualStudio.Services.Agent/Util/TaskResultUtil.cs#L36-L63
(checked 2026-08-21) — "Merge 2 TaskResults get the worst result. Succeeded ->
SucceededWithIssues -> Failed/Canceled/Skipped/Abandoned" / "if (currentResult > TaskResult.Failed)
{ return currentResult.Value; } if (comingResult >= currentResult) { return comingResult; }".

[C-E06-061] The per-step result precedence is: `task.complete` merges into the result; a thrown
step failure (nonzero exit, timeout, cancellation) then **assigns** `Failed`/`Canceled` directly
and therefore overrides an earlier `task.complete result=Succeeded`; accumulated command failures
merge next; `continueOnError` downgrades a final `Failed`; an unset result completes as
`Succeeded`. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/StepsRunner.cs#L369-L476 and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L329-L392
(checked 2026-08-21) — "step.ExecutionContext.Result = TaskResult.Failed;" (catch block, plain
assignment) / "step.ExecutionContext.Result = TaskResultUtil.MergeTaskResults(step.ExecutionContext.Result, step.ExecutionContext.CommandResult.Value);" /
"// Fixup the step result if ContinueOnError." / "_record.Result = _record.Result ?? TaskResult.Succeeded;".

[C-E06-062] `task.logissue` requires a `type` property; a missing type produces the warning
"Can't create TaskIssue from logging event." and no issue, while a value other than
case-insensitive `error`/`warning` throws. `sourcepath`, `linenumber`, `columnnumber`, and `code`
are the documented optional properties. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#logissue-log-an-error-or-warning and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L361-L430
(checked 2026-08-21) — "`type` = `error` or `warning` (Required)" / "`sourcepath` = source file
location" / "context.Warning(\"Can't create TaskIssue from logging event.\");" / "throw new
ArgumentException($\"issue type {issueType} is not an expected issue type.\")".

[C-E06-063] Recording an issue masks the message, writes it to the log tagged `##[error]` or
`##[warning]`, increments the record's `ErrorCount`/`WarningCount`, keeps only the first
`_maxIssueCount` = 10 issues of each kind on the record, and **does not change the task result** —
the doc's tip that `exit 1` is a separate, optional step confirms that reading. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L106-L107,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L439-L479, and
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#logissue-log-an-error-or-warning
(checked 2026-08-21) — "issue.Message = HostContext.SecretMasker.MaskSecrets(issue.Message);" /
"long logLineNumber = Write(WellKnownTags.Error, issue.Message);" / "if (_record.ErrorCount <
_maxIssueCount) { _record.Issues.Add(issue); } _record.ErrorCount++;" / "`exit 1` is optional, but
is often a command you'll issue soon after an error is logged."

[C-E06-064] A logging command that throws is reported as an error and sets `CommandResult` to
`Failed` — which later merges into the step result (C-E06-061) — while output processing
continues with the next line. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/WorkerCommandManager.cs#L96-L135
(checked 2026-08-21) — "catch (Exception ex) { context.Error(StringUtil.Loc(\"CommandProcessFailed\",
input)); context.Error(ex); context.CommandResult = TaskResult.Failed; }".

[C-E06-065] Debug output is gated on `System.Debug`: `WriteDebug` is initialized from that
variable, `context.Debug` writes only when it is true, and `##vso[task.debug]` is the command that
routes a task message through it. Every other successfully processed logging command also emits a
gated `Processed: <unescaped command>` debug line; `task.debug` itself is excluded from that note.
The formatter tags the agent itself writes are `##[section]`, `##[command]`, `##[error]`,
`##[warning]`, and `##[debug]`. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L747,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L1341-L1365,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L666-L681, and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/WorkerCommandManager.cs#L125-L134
(checked 2026-08-21) — "WriteDebug = Variables.System_Debug ?? false;" / "Verbose output is enabled
by setting System.Debug" / "if (context.WriteDebug) { context.Write(WellKnownTags.Debug, message); }"
/ "public string Name => \"debug\"; … context.Debug(data);" / "trace the ##vso command as long as
the command is not a ##vso[task.debug] command" / "public static readonly string Section =
\"##[section]\";".

[C-E06-066] The formatting commands are a distinct, message-only syntax (`##[group]`,
`##[endgroup]`, `##[section]`, `##[command]`, `##[warning]`, `##[error]`, `##[debug]`) addressed to
the log formatter rather than to the agent's command handlers; a group is collapsible in the
rendered log. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#formatting-commands
(checked 2026-08-21) — "There are also a few formatting commands with a slightly different syntax:
`##[command]message`" / "These commands are messages to the log formatter in Azure Pipelines. They
mark specific log lines as errors, warnings, collapsible sections, and so on." / "That block of
commands can also be collapsed".

[C-E06-067] `task.setprogress` sets percent-complete and current operation on the timeline record,
clamping `value` to 0..100 and defaulting to 0 when the property is missing or unparseable; it has
no effect reproducible in a local, timeline-free run. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#setprogress-show-percentage-completed and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L538-L565
(checked 2026-08-21) — "Set progress and current operation for the current task." / "`value` =
percentage of completion" / "percentComplete = (Int32)Math.Min(Math.Max(progress, 0), 100);".

[C-E06-068] `task.issue` is a registered **alias** of `task.logissue`, not a distinct command: the
handler declares one alias, and the command manager stores the alias in the same dispatch map
pointing at the same executor, so both spellings run identical code (a duplicate alias is a hard
error, confirming one-executor-per-name). The doc page documents only the `task.logissue`
spelling. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L363-L364
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/WorkerCommandManager.cs#L188-L199
(checked 2026-08-21) — "public string Name => \"logissue\";" / "public List<string> Aliases =>
new List<string>() { \"issue\" };" / "_commands[commandExecutor.Name] = commandExecutor; var
aliasList = commandExecutor.Aliases; if (aliasList != null) { foreach (var alias in
commandExecutor.Aliases) { ... _commands[alias] = commandExecutor; } }". The emulator dispatches
`task.logissue | task.issue` to one handler for the same reason.


### Composition and the two docs/04 §6 corrections

C-E06-057/058 fix `task.prependpath` and `task.setsecret` scope; both reuse existing runtime seams
(`path.d` from C-E06-012, `azdo_mask_register` from C-E06-053). C-E06-059..061 define the result
machine that `task.complete` feeds, including the discriminating detail that a nonzero exit
*overrides* rather than merges. C-E06-062..064 define issue handling and the actual path from a
logging command to a failed step.

Two statements in docs/04 §6 did not survive grounding and are corrected in this task:

1. "error issues count toward `SucceededWithIssues`/`Failed`" — `AddIssue` only increments counters
   and writes a tagged line (C-E06-063); the result changes only through a *failing command*
   (C-E06-064) or the step's own exit status (C-E06-061). Counters are still recorded and surfaced,
   which is what the backlog's "issue counters feed result machine" bullet is satisfied by, with
   the correction stated rather than silently implemented.
2. "`##[debug]` shown only when `System.Debug=true`" — the agent gates its *debug channel*
   (`context.Debug`, `##vso[task.debug]`, the per-command `Processed:` note) on `System.Debug`
   (C-E06-065), but a raw `##[debug]` line echoed by a script is ordinary task output that reaches
   the log verbatim; it is a formatter tag (C-E06-066), not a handled command. What the ADO web log
   viewer does with such a line when `System.Debug` is false is **not** established by any source
   available here (no oracle credentials in this environment), so no claim asserts it. The emulator
   therefore makes a *local* decision, recorded in docs/06 §5: the console renderer hides `##[debug]`
   lines unless `System.Debug` is true, while `logs/<step>.log` keeps every line verbatim.

ANSI colors themselves are a local rendering choice: the hosted agent emits the tags and the web UI
colors them (C-E06-066), so no source prescribes specific escape sequences. The renderer is a
separate stream filter placed after the log `tee`, which keeps emitted logs byte-faithful.

## E06-S04-T04 — artifact, attachment and build commands

Sources for this block: the logging-commands doc page (checked 2026-08-21, `ms.date` 2026-03-05,
docs commit `1481c0d18812667ac57f38b2b70c34d924608ccc`) and the agent pinned at
`4571a73531e1ea6342ed46723dd39a115b92843b`, the same commit E06-S02..S04 already trace.

[C-E06-069] `artifact.upload` requires a nonempty `artifactname` property; the `containerfolder`
property is optional and **defaults to the artifact name** when absent or empty. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#upload-upload-an-artifact
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/ArtifactCommandExtension.cs#L149-L161
(checked 2026-08-21) — "`containerfolder` = folder that the file will upload to, folder will be
created if needed." / "`artifactname` = artifact name. (Required)" / "if
(!eventProperties.TryGetValue(ArtifactUploadEventProperties.ArtifactName, out artifactName) ||
string.IsNullOrEmpty(artifactName)) { throw new Exception(StringUtil.Loc(\"ArtifactNameRequired\"));
}" / "containerFolder = artifactName;". `ArtifactNameRequired` is "Artifact Name is required."
(`src/Misc/layoutbin/en-US/strings.json`).

[C-E06-070] `artifact.upload`'s message is a local path that may be **either a file or a
directory**; a path that is neither fails the command with `PathDoesNotExist`, and a directory
that contains no files at any depth produces the **warning** `DirectoryIsEmptyForArtifact` and
returns **successfully** without uploading anything. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/ArtifactCommandExtension.cs#L178-L189
(checked 2026-08-21) — "string fullPath = Path.GetFullPath(localPath); if (!File.Exists(fullPath)
&& !Directory.Exists(fullPath)) { throw new FileNotFoundException(StringUtil.Loc(\"PathDoesNotExist\",
localPath)); } else if (Directory.Exists(fullPath) && Directory.EnumerateFiles(fullPath, \"*\",
SearchOption.AllDirectories).FirstOrDefault() == null) { context.Warning(StringUtil.Loc(
\"DirectoryIsEmptyForArtifact\", fullPath, artifactName)); return; }". Strings: "Path does not
exist: {0}" / "Directory '{0}' is empty. Nothing will be added to build artifact '{1}'.". The
warning travels `context.Warning` → `AddIssue(IssueType.Warning)`, so it is a **counted** warning
issue exactly like `task.logissue type=warning`
(https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/ExecutionContext.cs#L1314-L1318,
C-E06-063). This is the discriminating case for the emulator: the natural implementation makes an
empty directory a command *failure*, and the agent makes it a successful warning.

[C-E06-071] The uploaded container item path is `<containerfolder>/<path relative to the source's
parent directory>`: for a **file** source the parent is its containing directory, so the item is
`<containerfolder>/<basename>`; for a **directory** source the parent is the directory itself, so
its own name does **not** appear and the items are `<containerfolder>/<relative path inside it>`,
recursively. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/FileContainerServer.cs#L83-L93
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/FileContainerServer.cs#L238
(checked 2026-08-21) — "if (File.Exists(source)) { files = new List<String>() { source };
_sourceParentDirectory = Path.GetDirectoryName(source); } else { files =
Directory.EnumerateFiles(source, \"*\", SearchOption.AllDirectories).ToList();
_sourceParentDirectory = source.TrimEnd(Path.DirectorySeparatorChar,
Path.AltDirectorySeparatorChar); }" / "string itemPath = (_containerPath.TrimEnd('/') + \"/\" +
fileToUpload.Remove(0, _sourceParentDirectory.Length + 1)).Replace('\\\\', '/');". Two consequences the emulator encodes: the directory branch **trims trailing separators** off the
source before taking it as the parent, so an `artifact.upload` written as
`$(Build.ArtifactStagingDirectory)/` behaves identically to the unslashed spelling (without the trim
the prefix strip misses and the whole absolute path is nested inside the artifact); and
`Directory.EnumerateFiles` returns symbolic links as files, where the local `find … -type f` does
not — a recorded divergence, not reproduced, because a symlinked payload has no meaning in a
`.artifacts/` tree a later local download copies from.

[C-E06-072] The uploaded files land in the file container at `#/<containerId>/<containerfolder>`,
and that container path is then associated with the **build artifact named `artifactname`** as a
`Container`-type resource. The artifact name and the container folder are therefore two distinct
levels: the name keys the artifact a later download asks for, the folder keys the bytes inside the
container. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/ArtifactCommandExtension.cs#L243-L253
(checked 2026-08-21) — "var fileContainerFullPath = StringUtil.Format($\"#/{containerId}/{containerPath}\");
context.Output(StringUtil.Loc(\"UploadToFileContainer\", source, fileContainerFullPath)); ... var
artifact = await buildHelper.AssociateArtifactAsync(buildId, projectId, name, jobId,
ArtifactResourceTypes.Container, fileContainerFullPath, propertiesDictionary, cancellationToken);".

[C-E06-073] `artifact.associate` creates a link to an **already existing** artifact rather than
uploading anything: its message is a server-side location (file-container path, UNC share, TFVC
path, git ref), and it requires nonempty `artifactname`, `type` and location. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#associate-initialize-an-artifact
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/ArtifactCommandExtension.cs#L29-L86
(checked 2026-08-21) — "Create a link to an existing Artifact. Artifact location must be a file
container path, VC path or UNC share path." / "`artifactname` = artifact name (Required)" /
"`type` = artifact type (Required) `container` | `filepath` | `versioncontrol` | `gitref` |
`tfvclabel`" / "throw new Exception(StringUtil.Loc(\"ArtifactTypeRequired\"));" / "throw new
Exception(StringUtil.Loc(\"ArtifactLocationRequired\"));". Strings: "Artifact Type is required." /
"Artifact location is required." There is nothing local to copy, so the emulator accepts, validates
and records the association without materializing bytes — the `task.setprogress` pattern (C-E06-067).

[C-E06-074] `task.uploadfile`, `task.uploadsummary` and `task.addattachment` are **one
implementation**: both upload commands build a two-entry property dictionary and call
`TaskAddAttachmentCommand.AddAttachment` directly. `uploadfile` supplies type
`CoreAttachmentType.FileAttachment`, `uploadsummary` supplies `CoreAttachmentType.Summary`, and
**both derive the attachment name as `Path.GetFileName(data)`** — the doc's shorthand example,
which shows `uploadsummary` expanding to a custom `name=testsummaryname`, does not match the
source. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L249-L302
(checked 2026-08-21) — "uploadSummaryProperties.Add(TaskAddAttachmentEventProperties.Type,
CoreAttachmentType.Summary); var fileName = Path.GetFileName(data);
uploadSummaryProperties.Add(TaskAddAttachmentEventProperties.Name, fileName);
TaskAddAttachmentCommand.AddAttachment(context, uploadSummaryProperties, data);" and the identical
shape with `CoreAttachmentType.FileAttachment` in `TaskUploadFileCommand`. An empty message is
rejected before the helper runs, with a command-specific message: `CannotUploadFile` = "Cannot
upload file because file location is not specified." / `CannotUploadSummary` = "Cannot upload
summary file, summary file location is not specified."

[C-E06-075] `task.addattachment` requires nonempty `type` **and** `name` properties and a message
naming a file that **exists on disk**; unlike `artifact.upload`, a directory is not accepted. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#addattachment-attach-a-file-to-the-build
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L317-L357
(checked 2026-08-21) — "`type` = attachment type (Required)" / "`name` = attachment name
(Required)" / "if (!String.IsNullOrEmpty(filePath) && File.Exists(filePath)) { context.QueueAttachFile(
type, name, filePath); } else { throw new ArgumentNullException(StringUtil.Loc(
\"MissingAttachmentFile\")); }". Strings: "Can't add task attachment, attachment type is not
provided." / "Can't add task attachment, attachment name is not provided." / "Cannot upload task
attachment file, attachment file location is not specified or attachment file does not exist on
disk."

[C-E06-076] Both `type` and `name` are additionally rejected when they contain any character in
.NET's `Path.GetInvalidFileNameChars()`, with a message that is **not** localized and enumerates
the set. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L333-L343
(checked 2026-08-21) — "char[] s_invalidFileChars = Path.GetInvalidFileNameChars(); if
(type.IndexOfAny(s_invalidFileChars) != -1) { throw new ArgumentException($\"Type contains invalid
characters. ({String.Join(\",\", s_invalidFileChars)})\"); }". The set itself is
platform-dependent in .NET (on Unix it is effectively `\0` and `/`), so the emulator does **not**
reproduce the Windows set; it reuses the existing, strictly narrower `azdo__valid_store_segment`
guard (rejects empty, `.`, `..`, `/`, newline, carriage return), which is sound because both values
become local path segments. Recorded as a deliberate divergence rather than an imported constant.

[C-E06-077] `build.uploadlog` requires a message naming an **existing** file and attaches it as a
`Log`-type attachment under the fixed name `CustomToolLog`; a missing or absent path fails the
command. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#uploadlog-upload-a-log
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/BuildCommandExtension.cs#L30-L51
(checked 2026-08-21) — "Upload user interested log to build's container \"`logs\\tool`\" folder." /
"if (!string.IsNullOrEmpty(data) && File.Exists(data)) { context.QueueAttachFile(
CoreAttachmentType.Log, \"CustomToolLog\", data); } else { throw new Exception(StringUtil.Loc(
\"CustomLogDoesNotExist\", data ?? string.Empty)); }". String: "Log file path is not provided or
file doesn't exist: '{0}'". docs/04 §6 previously said this command was "ignored with debug note";
it is a real attachment command and the row is corrected.

[C-E06-078] `build.uploadsummary` still exists on the agent as a **deprecated** back-compat command
distinct from `task.uploadsummary`: it attaches a `Summary`-type file under the derived name
`CustomMarkDownSummary-<filename>`. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/BuildCommandExtension.cs#L53-L77
(checked 2026-08-21) — "// ##VSO[build.uploadsummary] command has been deprecated / // Leave the
implementation on agent for back compat" / "var fileName = Path.GetFileName(data);
context.QueueAttachFile(CoreAttachmentType.Summary, StringUtil.Format(
$\"CustomMarkDownSummary-{fileName}\"), data);". The doc page does not list it. String
`CustomMarkDownSummaryDoesNotExist` = "Markdown summary file path is not provided or file doesn't
exist: '{0}'".

[C-E06-079] The wire values of the `CoreAttachmentType` constants live in the closed
`Microsoft.TeamFoundation.DistributedTask.WebApi` assembly, not in any pinned repository — the same
situation as the expression engine (C-E00-012). Only `Summary` has a documented value: the doc page
states `task.uploadsummary` is shorthand for `##vso[task.addattachment
type=Distributedtask.Core.Summary;name=…]`. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#uploadsummary-add-some-markdown-content-to-the-build-summary
(checked 2026-08-21) — "It's a short hand form for the command
`##vso[task.addattachment type=Distributedtask.Core.Summary;name=testsummaryname;]c:\\testsummary.md`".
The emulator therefore uses `Distributedtask.Core.Summary` verbatim for the two summary commands —
which makes the documented shorthand identity locally observable — and uses the **C# member names**
`FileAttachment` and `Log` as local directory segments for the two whose values it cannot cite,
rather than inventing wire spellings. Recorded as a local naming decision, not a parity claim.

[C-E06-080] `build.updatebuildnumber` requires a nonempty message and sets `Build.BuildNumber` in
the job's variable set **synchronously and locally** before queueing the server update, so the new
value is visible to subsequent steps. —
https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands#updatebuildnumber-override-the-automatically-generated-build-number
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/BuildCommandExtension.cs#L99-L120
(checked 2026-08-21) — "if (!String.IsNullOrEmpty(data)) { // update build number within Context.
context.Variables.Set(BuildVariables.BuildNumber, data); ... } else { throw new Exception(
StringUtil.Loc(\"BuildNumberRequired\")); }". String: "Build number is required." The message is
**not** trimmed.

[C-E06-081] That write **bypasses the read-only rule that would otherwise reject it.**
`build.buildNumber` is a member of `Constants.Variables.ReadOnlyVariables`, and `Variables.IsReadOnly`
consults that list — but the read-only *check* lives in `TaskSetVariableCommand`, not in
`Variables.Set`, which only propagates an existing read-only flag onto the replacement. The source
comment names this command as the reason. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Microsoft.VisualStudio.Services.Agent/Constants.cs#L623
,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L442-L444
,
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Variables.cs#L650-L658
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/TaskCommandExtension.cs#L629
(checked 2026-08-21) — "Build.Number," in the `ReadOnlyVariables` list, where
`Number = \"build.buildNumber\"` / "// Also keep any variables that are already read only as read
only. // This only really matters for server side system variables that get updated by something
other than setVariable (e.g. updateBuildNumber). readOnly = readOnly || (_expanded.ContainsKey(name)
&& _expanded[name].ReadOnly);" / "return Constants.Variables.ReadOnlyVariables.Contains(
variable.Name, StringComparer.OrdinalIgnoreCase);" / "if (context.Variables.IsReadOnly(name))".
The emulator enforces read-only in `azdo__write_var` (C-E06-004/006), so this command needs an
explicit unchecked write that still **preserves** the read-only flag.

[C-E06-082] `build.addbuildtag` **trims** its message before the emptiness check — unlike
`build.updatebuildnumber`, which does not — and rejects an empty or whitespace-only tag. —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/BuildCommandExtension.cs#L150-L175
(checked 2026-08-21) — "string data = command.Data?.Trim();" / "if (!string.IsNullOrEmpty(data)) {
... } else { throw new Exception(StringUtil.Loc(\"BuildTagRequired\")); }". String: "Build tag is
required." Tags are a **set** server-side: the async completion re-reads the build's tags and fails
only if the requested tag is absent from the returned list under `OrdinalIgnoreCase`
(`BuildTagAddFailed`), which is why the emulator de-duplicates `state/tags` case-insensitively
rather than appending blindly. The doc's "You can't use a colon with AddBuildTag" is a
**server-side** restriction the agent source does not implement; it is recorded here and
deliberately **not** reproduced as a local rejection.

[C-E06-083] Four preconditions of these commands have no local counterpart and are deliberately not
reproduced: `artifact.upload`/`artifact.associate` throw
`UploadArtifactCommandNotSupported`/`AssociateArtifactCommandNotSupported` ("Uploading server
artifact is not supported in {0}.") outside a `Build` host type; all four artifact/build commands
assert `System.TeamProjectId`, `Build.BuildId` and (for upload) `Build.ContainerId` through
`ArgUtil`; the actual transfer runs on the **async command queue** after the handler returns, so a
transfer failure surfaces at job end rather than at the command; and file paths are first mapped
through `context.TranslateToHostPath(data)`, which only matters for container jobs (E14). —
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/ArtifactCommandExtension.cs#L139-L177
and
https://github.com/microsoft/azure-pipelines-agent/blob/4571a73531e1ea6342ed46723dd39a115b92843b/src/Agent.Worker/Build/BuildCommandExtension.cs#L86-L98
(checked 2026-08-21) — "long? containerId = context.Variables.Build_ContainerId; ArgUtil.NotNull(
containerId, nameof(containerId));" / "if (!ArtifactCommandExtensionUtil.IsUncSharePath(context,
localPath) && (context.Variables.System_HostType != HostTypes.Build)) { throw new Exception(
StringUtil.Loc(\"UploadArtifactCommandNotSupported\", context.Variables.System_HostType)); }" /
"context.AsyncCommands.Add(commandContext);". The local runtime copies synchronously into
`.artifacts/`, so a copy failure *is* a command failure — a divergence in timing, not in outcome.

## E06-S05-T01 — pipeline artifact publish and download

Sources pinned for this pass: the *Publish and download pipeline artifacts* doc page
(`git_commit_id` `1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`, `updated_at` 2026-05-07), the
`steps.download` schema page (`git_commit_id` `d089fd2dbb54483ec611eeb478e3eff14be74393`,
`ms.date` 2026-07-29), `microsoft/azure-pipelines-tasks` @ `299572e25b6cf14b21c7b60e5228603cbb5ffb42`
(`PublishPipelineArtifactV1`/`DownloadPipelineArtifactV2` `task.json`) and
`microsoft/azure-pipelines-agent` @ `42bde98bea7bb3b9e186d693e3b1554249e93a38`. Both tasks are
`AgentPlugin` tasks — `"AgentPlugin": { "target": "Agent.Plugins.PipelineArtifact.PublishPipelineArtifactTaskV1, Agent.Plugins" }`
and `"…DownloadPipelineArtifactTaskV2_0_0, Agent.Plugins"` — so the implementation to read is
`src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV1.cs` and `…/PipelineArtifactPluginV2.cs`,
**not** `PipelineArtifactPlugin.cs`, which holds the older V0 classes of the same shape.

[C-E06-084] The `download` keyword puts artifacts of the **current** pipeline in
`$(Pipeline.Workspace)/<artifact name>` and artifacts of an associated pipeline resource in
`$(Pipeline.Workspace)/<pipeline resource identifier>/<artifact name>`. —
https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-download (checked 2026-08-21)
— "Artifacts from the current pipeline are downloaded to `$(Pipeline.Workspace)/<artifact name>`.
Artifacts from the associated pipeline resource are downloaded to
`$(Pipeline.Workspace)/<pipeline resource identifier>/<artifact name>`." The keyword is a
server-side shorthand for the task (same page: "Depending on the type of referenced artifact (or
artifacts), `download` calls Download Pipeline Artifacts …"), so this layout is what the *emitter*
must pass as `--path`; it is **not** the task's own default, which is C-E06-085.

[C-E06-085] `DownloadPipelineArtifact@2` input defaults are `source`/`buildType` = `current`,
`artifact`/`artifactName` = empty, `patterns`/`itemPattern` = `**`, and `path` (aliases
`targetPath`, `downloadPath`, required) = `$(Pipeline.Workspace)`; the task creates the target
directory when it does not exist. —
https://github.com/microsoft/azure-pipelines-tasks/blob/299572e25b6cf14b21c7b60e5228603cbb5ffb42/Tasks/DownloadPipelineArtifactV2/task.json
and
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV2.cs#L310-L317
(checked 2026-08-21) — "{ \"name\": \"path\", \"aliases\": [ \"targetPath\", \"downloadPath\" ],
\"defaultValue\": \"$(Pipeline.Workspace)\", \"required\": true }" / "string fullPath =
Path.GetFullPath(targetPath); bool dirExists = Directory.Exists(fullPath); if (!dirExists) {
Directory.CreateDirectory(fullPath); }".

[C-E06-086] With an artifact **name** supplied, only that artifact is downloaded, the step fails if
the artifact does not exist, the file-matching patterns are evaluated relative to the artifact root,
and the files land directly in `path` with no per-artifact subdirectory. —
https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts (checked 2026-08-21)
— "Only files for that specific artifact are downloaded. If the artifact doesn't exist, the task
will fail. File matching patterns are evaluated relative to the root of the artifact." and "By
default, files are downloaded to **$(Pipeline.Workspace)**. If an artifact name wasn't specified, a
subdirectory will be created for each downloaded artifact." The no-subdirectory half is the
contrapositive of that second sentence; it is corroborated by
`ArtifactDownloadParameters.AppendArtifactNameToTargetPath` being consulted **only** on the
multi-download branch —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/Artifact/FileContainerProvider.cs#L84-L86
— "var dirPath = downloadParameters.AppendArtifactNameToTargetPath ?
Path.Combine(downloadParameters.TargetDirectory, buildArtifact.Name) :
downloadParameters.TargetDirectory;". That file is the **container** provider (build artifacts);
for pipeline artifacts the same composition happens inside the closed BlobStore
`DownloadDedupManifestArtifactOptions.CreateWithMultiManifestIds(…, minimatchFilterWithArtifactName:
…)`, so it is cited as corroboration of the rule, not as the pipeline-artifact code path.

[C-E06-087] With **no** artifact name, every artifact of the run is downloaded, the step does not
fail when no files match, a subdirectory is created per artifact, and the first segment of each
pattern is matched against the artifact name. —
https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts (checked 2026-08-21)
— "Multiple artifacts can be downloaded and the task does not fail if no files are found. A
subdirectory is created for each artifact. File matching patterns should assume the first segment of
the pattern is (or matches) an artifact name." The agent expresses the same rule as
`MinimatchFilterWithArtifactName = true` on the download parameters, and its filter helper documents
the candidate shape it implies —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/Artifact/ArtifactItemFilters.cs#L33-L40
— "<param name=\"paths\">List of relative paths for items detected in artifact. The relative paths
start from name of artifact.</param>".

[C-E06-088] An empty `patterns` input is read as `**`, and the value is split into patterns on
**newline only** (empty entries removed) — not on `;`. —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV2.cs#L111-L117
(checked 2026-08-21) — "// Empty input field \"Matching pattern\" must be recognised as default
value '**' itemPattern = string.IsNullOrEmpty(itemPattern) ? \"**\" : itemPattern; string[]
minimatchPatterns = itemPattern.Split(new[] { \"\\n\" }, StringSplitOptions.RemoveEmptyEntries);".
The `;`-delimited multi-pattern spelling in docs/03 §29 belongs to the `azdo_match` task-input
surface (E09-S01-T03) and is deliberately **not** accepted here.

[C-E06-089] **Doc/source conflict, source wins.** A relative `path` is resolved against
`System.DefaultWorkingDirectory`, not against the pipeline workspace, in both the publish and the
download plugin; the `task.json` help text for the same input says the opposite. —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV2.cs#L93-L95
and
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV1.cs#L86-L97
and
https://github.com/microsoft/azure-pipelines-tasks/blob/299572e25b6cf14b21c7b60e5228603cbb5ffb42/Tasks/DownloadPipelineArtifactV2/task.json
(checked 2026-08-21) — "string defaultWorkingDirectory =
context.Variables.GetValueOrDefault(\"system.defaultworkingdirectory\").Value; targetPath =
Path.IsPathFullyQualified(targetPath) ? targetPath : Path.GetFullPath(Path.Combine(
defaultWorkingDirectory, targetPath));" versus "Directory to download the artifact files to. Can be
relative to the pipeline workspace directory or absolute." Per BACKLOG §3's source hierarchy
(Microsoft source code > official docs) the emulator implements the code behavior and records the
docs as wrong.

[C-E06-090] Pattern list semantics: each pattern is trimmed and skipped when empty; a pattern
starting with `#` is a comment and skipped; leading `!` characters are counted and stripped, and the
pattern is an **include** iff that count is even; patterns are then applied **in order** to an
accumulating map, an include adding its matches and an exclude removing them. —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/Artifact/ArtifactItemFilters.cs#L45-L100
and
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/Artifact/ArtifactItemFilters.cs#L161-L175
(checked 2026-08-21) — "if (!matchOptions.NoComment && currentPattern.StartsWith('#')) { …
continue; } … while (negateCount < currentPattern.Length && currentPattern[negateCount] == '!') {
negateCount++; } … bool isIncludePattern = negateCount == 0 || (negateCount % 2 == 0 &&
!matchOptions.FlipNegate) || …" / "<param name=\"map\">… Item with path from the hashtable is
considered as required to be in list after filtering.</param>". The order-sensitivity is
load-bearing: `!*.md` followed by `**` yields **everything**, because the later include re-adds what
the exclude removed.

[C-E06-091] `PublishPipelineArtifact@1` takes `path`/`targetPath` (required, default
`$(Pipeline.Workspace)`), `artifactName`/`artifact` (optional, default empty) and
`artifactType`/`publishLocation` (default `pipeline`); an empty artifact name falls back to
`System.JobIdentifier` normalized by deleting every character outside `[a-zA-Z0-9 - .]` and then
deleting the literal `.default`. —
https://github.com/microsoft/azure-pipelines-tasks/blob/299572e25b6cf14b21c7b60e5228603cbb5ffb42/Tasks/PublishPipelineArtifactV1/task.json
and
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV1.cs#L122-L127
and
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV1.cs#L193-L196
(checked 2026-08-21) — "if (String.IsNullOrWhiteSpace(artifactName)) { string jobIdentifier =
context.Variables.GetValueOrDefault(WellKnownDistributedTaskVariables.JobIdentifier).Value; var
normalizedJobIdentifier = NormalizeJobIdentifier(jobIdentifier); artifactName =
normalizedJobIdentifier; }" / "jobIdentifier = jobIdentifierRgx.Replace(jobIdentifier,
string.Empty).Replace(\".default\", string.Empty);" with "new Regex(\"[^a-zA-Z0-9 - .]\", …)". The
doc page states the same fallback in prose: "**artifact**: (Optional) Name of the artifact to
publish. If not set, defaults to a unique ID scoped to the job."

[C-E06-092] Publish fails when the resolved target path is neither an existing file nor an existing
directory. —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginV1.cs#L134-L141
(checked 2026-08-21) — "bool isFile = File.Exists(fullPath); bool isDir =
Directory.Exists(fullPath); if (!isFile && !isDir) { // if local path is neither file nor folder
throw new FileNotFoundException(StringUtil.Loc(\"PathDoesNotExist\", targetPath)); }". Unlike
`artifact.upload` (C-E06-070) there is **no** empty-directory special case: publishing an empty
directory is a plain success.

[C-E06-093] An artifact name is rejected when it contains any of `" : < > | * ? / \` or a character
below U+0020. —
https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/PipelineArtifact/PipelineArtifactPluginUtil.cs#L12-L27
(checked 2026-08-21) — "// This collection of invalid characters is based on the characters that are
illegal in Windows/NTFS filenames. Also prevent files (pipeline artifact names) from containing
\"/\" or \"\\\" due to the added complexity this introduces for file pattern matching on download."
This set is neither a superset nor a subset of the emulator's `azdo__valid_store_segment`, so the
runtime applies **both**: the agent set as the graded parity rule, and the store-segment guard on
top, which additionally rejects `""`, `.` and `..` — names the agent accepts but which cannot be
directory names under `.artifacts/`. That extra rejection is a recorded local hardening.

[C-E06-094] Publishing a **directory** places the directory's *contents* at the artifact root: the
doc's cross-stage example publishes `$(Build.ArtifactStagingDirectory)/scripts` as artifact `drop`
and then runs `$(Pipeline.Workspace)\drop\test.ps1`, so `scripts/` itself does not appear in the
downloaded tree. —
https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts (checked 2026-08-21)
— "- publish: '$(Build.ArtifactStagingDirectory)/scripts' displayName: 'Publish script' artifact:
drop" / "filePath: '$(Pipeline.Workspace)\\drop\\test.ps1'". The **file** case has no citable
source: the plugin hands `fullPath` straight to the closed BlobStore
`dedupManifestClient.PublishAsync(source, …)`
(https://github.com/microsoft/azure-pipelines-agent/blob/42bde98bea7bb3b9e186d693e3b1554249e93a38/src/Agent.Plugins/Artifact/PipelineArtifactServer.cs#L79).
The emulator therefore reuses the container rule C-E06-071 — a file contributes its basename at the
artifact root — as an **inference**, flagged here so a later oracle run can falsify it.

[C-E06-095] **Delta, deliberately not implemented.** Publishing honors an `.artifactignore` file in
the `targetPath` directory, and in its absence Azure Artifacts silently drops the `.git` folder. —
https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts (checked 2026-08-21)
— "Azure Artifacts automatically ignore the `.git` folder path when you don't have a
*.artifactignore* file. You can bypass this by creating an empty *.artifactignore* file." Both are
server/BlobStore-side filtering outside the scope of E06-S05-T01's **Do**; `azdo_artifact_publish`
copies everything under the target path. A local publish of a work tree therefore contains `.git`
where the service's artifact would not.

[C-E06-096] Artifacts are downloaded automatically **only** in deployment jobs, only for the
`deploy` lifecycle hook, to `$(Pipeline.Workspace)`, and `download: none` suppresses it. —
https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts and
https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/steps-download (checked 2026-08-21)
— "Artifacts are only downloaded automatically in deployment jobs. By default, artifacts are
downloaded to `$(Pipeline.Workspace)`. The download artifact task will be auto injected only when
using the `deploy` lifecycle hook in your deployment. To stop artifacts from being downloaded
automatically, add a `download` step and set its value to none." / "All available artifacts from the
current pipeline and from the associated pipeline resources are automatically downloaded in
deployment jobs and made available for your deployment." Downloading *all* artifacts to
`$(Pipeline.Workspace)` is exactly the no-artifact-name branch of C-E06-087, so the injected step is
`azdo_artifact_download` with no `--artifact`, and each artifact lands at
`$(Pipeline.Workspace)/<name>` — the same layout the `download` keyword produces (C-E06-084).
