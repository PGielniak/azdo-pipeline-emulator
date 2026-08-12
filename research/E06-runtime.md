# E06 — Runtime library claims

[C-E06-001] A `task.setvariable` command makes its value available to following tasks, and secret values are saved as secrets and excluded from automatic task environments — https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands (checked 2026-08-12) — "The first task can set a variable, and following tasks are able to use the variable." / "Secret variables aren't passed into tasks as environment variables".

[C-E06-002] Cross-job variable transfer requires an output variable and a dependency expression; same-job task output variables use `TASK.VARIABLE` — https://learn.microsoft.com/azure/devops/pipelines/process/variables (checked 2026-08-12) — "To reference a variable from a different job, use `dependencies.JOB.outputs['TASK.VARIABLE']`."

[C-E06-003] The agent keeps variables in case-insensitive concurrent dictionaries and persists each value with secret/read-only metadata — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/Variables.cs#L44-L103 (checked 2026-08-12) — "ConcurrentDictionary<string, Variable>(StringComparer.OrdinalIgnoreCase)".

[C-E06-004] The agent warns and still sets a read-only variable when `agent.readOnlyVariables` is disabled, but throws before setting it when the flag is enabled — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/TaskCommandExtension.cs#L629-L662 and https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Misc/layoutbin/en-US/strings.json (checked 2026-08-12) — "Overwriting readonly variable '{0}'. This behavior will be disabled in the future.".

[C-E06-005] An agent output variable is persisted on the task record and made available within its job as `<referenceName>.<name>` with read-only status — https://github.com/microsoft/azure-pipelines-agent/blob/15ee11cd728d630f9c9905485449e3359da0a493/src/Agent.Worker/ExecutionContext.cs#L395-L413 (checked 2026-08-12) — "Variables.Set($\"{_record.RefName}.{name}\", value, secret: isSecret, readOnly: (isOutput || isReadOnly)".
