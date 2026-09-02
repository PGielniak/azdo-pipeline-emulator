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

---

## E07-S01-T04 — result and `##vso` capture from a real task (`C-E07-007..010`)

Recorded 2026-09-02. The **parser** side is E06-S04's grounding (C-E06-044..068) and is not
re-derived; what is pinned here is task-lib's **emission** side, so the claim that "the parser
inverts it exactly" is checkable rather than assumed.

[C-E07-007] **task-lib emits `##vso[area.action key=value;]message`, escaping properties and the
message with *different* tables.** `TaskCommand.toString` writes `CMD_PREFIX + command`, then each
truthy property as `key + '=' + escape(val) + ';'`, then `]`, then `escapedata(message)`. The two
tables differ:

| | `%` | `\r` | `\n` | `]` | `;` |
| --- | --- | --- | --- | --- | --- |
| `escape` (properties) | `%AZP25` | `%0D` | `%0A` | `%5D` | `%3B` |
| `escapedata` (message) | `%AZP25` | `%0D` | `%0A` | — | — |

A property whose value is falsy is **omitted entirely** (`if (val)`), so an empty property is
indistinguishable from an absent one — the same shape as the empty-input rule (C-E07-002).
  — https://github.com/microsoft/azure-pipelines-task-lib/blob/d4eecb2abcf7f2024f0d09c33f4bca7b63d6658a/node/taskcommand.ts
    (`toString` L26-51, `escapedata` L93-97, `escape` L105-112; checked 2026-09-02)

[C-E07-008] **The agent decodes both halves with one symmetric table, so the emission asymmetry does
not round-trip.** `Command.cs` calls the *same* `CommandStringConvertor.Unescape` for a property
value (L90) and for the message (L95). **Consequence:** a task that emits a message containing the
literal text `%5D` has it decoded to `]` by the agent, even though task-lib's own `unescapedata`
would have left it alone. Our runtime follows the **agent**, because the agent is what actually
consumes the stream — `azdo__logging_unescape` decodes all five tokens for both halves, which is the
behavior a real pipeline exhibits.
  — https://github.com/microsoft/azure-pipelines-agent/blob/018456432195aff4c59112f93426620891703dd5/src/Microsoft.VisualStudio.Services.Agent/Command.cs
    (L87-96; checked 2026-09-02), against task-lib `unescapedata` L99-103 as above

[C-E07-009] **A real task needs no new capture path: it is already inside one.** `azdo_run_step`
runs the step's `.sh` with its stdout and stderr joined into one FIFO which is consumed by
`azdo_logging_stream | azdo_mask_stream` before being teed to the console and log (C-E06-029/033/044,
docs/06 §5 decision 36). A real-task step is that same `.sh` — the emitter writes `azdo_run_task`
into it — so `setvariable`, `setOutput` and `logissue` from a real task reach the store by exactly
the path a script step's do. This is a *structural* claim about our own runtime, recorded because
the obvious implementation of this task would have been a second, parallel capture path.

[C-E07-010] **`exec` in the handler dispatch is what carries the exit code.** `azdo_run_task` ends
in `exec node …` / `exec pwsh …`, so the handler *replaces* the step subshell and its status becomes
the script's status, which `azdo_run_step` already maps through the result machine
(C-E06-036..043). Without `exec` the status would be the shell's, and a failing task would report
success.
  — our runtime, `azdo_run_task`; result mapping grounded by E06-S03
