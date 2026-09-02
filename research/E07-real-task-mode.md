# E07 — real-task execution & stubs: grounding claims

Epic rule (BACKLOG §3): every runtime behavior cites an official doc page or a commit-pinned
GitHub source. This epic's primary sources are `microsoft/azure-pipelines-task-lib` (the
`INPUT_*`/`getInput` contract) and `microsoft/azure-pipelines-agent` (handler env construction).

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E07-001` … `C-E07-029` | E07-S01 real-task execution | |
| `C-E07-030` … `C-E07-059` | E07-S02 stubs | *unallocated* |
| `C-E07-060` … `C-E07-089` | E07-S03 disposition registry | *unallocated* |

---

## E07-S01-T02 — the task-lib emulation host (`C-E07-001..006`)

Recorded 2026-09-02, before implementation. The task's **Ground** field asks for the exact transform
("spaces→`_`, uppercase, prefix `INPUT_`"); reading both sides shows that description is **incomplete
in a way that matters**, which is C-E07-001.

[C-E07-001] **The input env-name transform replaces dots *and* spaces with `_`, then upper-cases —
and the agent and task-lib implement it identically.** task-lib:
`name.replace(/\./g, '_').replace(/ /g, '_').toUpperCase()`; the agent:
`value?.Replace('.', '_').Replace(' ', '_')` followed by `ToUpperInvariant()`. The env var is
`'INPUT_' + key` on both sides. **The dot half is the part the task's Ground field omits**, and an
input legitimately named `sonar.projectKey` — a shape marketplace tasks do use — would be handed to
the task under a name it never reads if only spaces were replaced.
  — https://github.com/microsoft/azure-pipelines-task-lib/blob/d4eecb2abcf7f2024f0d09c33f4bca7b63d6658a/node/internal.ts
    (`_getVariableKey` L309-315; `getInput` in `node/task.ts` L282-291 builds `'INPUT_' + _getVariableKey(name)`)
  — https://github.com/microsoft/azure-pipelines-agent/blob/018456432195aff4c59112f93426620891703dd5/src/Agent.Worker/Handlers/Handler.cs
    (`AddInputsToEnvironment` L172-178) and
    https://github.com/microsoft/azure-pipelines-agent/blob/018456432195aff4c59112f93426620891703dd5/src/Microsoft.VisualStudio.Services.Agent/Util/VarUtil.cs
    (`ConvertToEnvVariableFormat` L77-81) — both checked 2026-09-02

[C-E07-002] **An input whose value is the empty string is never stored, and is therefore
indistinguishable from an absent one.** `_loadData` sweeps `process.env` for `INPUT_`-prefixed names
and, guarded by `if (value)`, stores each into the vault and **deletes it from `process.env`**. An
empty value fails that guard: it is not vaulted, so `getInput` returns `undefined`, and it is *not*
deleted, so it lingers in the environment where a task that reads `process.env` directly can still
see it. **Consequence:** the host emits an `INPUT_` variable for an empty input for the sake of the
second half, and must not treat "empty" as "set" for the first.
  — same task-lib source, `_loadData` L781-818

[C-E07-003] **`getBoolInput` is true only for the literal string `true`, case-insensitively.**
`return (getInput(name, required) || '').toUpperCase() == "TRUE";` — so `1`, `yes`, `on` and `Y` are
all **false**. A host that normalizes a YAML boolean to `1` would silently invert every boolean
input a task reads.
  — task-lib `node/task.ts` L313-315

[C-E07-004] **`getDelimitedInput` drops empty segments.** It splits on the delimiter and pushes only
truthy pieces, so `a,,b` yields `['a','b']` and a trailing delimiter contributes nothing. The host
therefore does not need to trim or compact multi-line inputs itself — and must not, since doing so
would change what a task using plain `getInput` sees.
  — task-lib `node/task.ts` L373-387

[C-E07-005] **task-lib reads inputs out of the process environment and nowhere else**, which is what
makes an emulation host possible at all: `_loadData` enumerates `process.env`, and `getInput`
resolves through the vault it populated. There is no file, no IPC and no agent handshake in the
input path.
  — same task-lib source, `_loadData` L781-818 and `getInput` L282-291

[C-E07-006] **`INPUT_` is one of five prefixes `_loadData` sweeps** — the others are
`ENDPOINT_AUTH_`, `SECUREFILE_TICKET_`, `SECRET_` and `VSTS_TASKVARIABLE_` — and all five are moved
into the vault and deleted from `process.env`. Recorded because it bounds what the host must supply:
service-connection auth reaches a task as `ENDPOINT_AUTH_*`, not as an input, and is E07-S02/E08
work rather than this task's.
  — same task-lib source, `_loadData` L788-818
