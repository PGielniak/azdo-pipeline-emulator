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

## E06-S02-T01 grounding composition and blocker

C-E06-018 establishes the documented timing and unmatched rule. C-E06-019 establishes the
agent's individual-pass scanner. C-E06-020/021 are the required hosted experiment and distinguish
the observable cross-task chain behavior from nested text in one input. Run 541 contradicts T01's
required end-to-end non-recursion, so no macro runtime implementation was written. The subsequent
source trace stopped when GitHub code search returned HTTP 401, per the session's explicit
auth-error stop condition.
