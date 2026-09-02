# E07 — Real-task execution & stubs

Phase: P3 · Depends on: E05, E06 (task download also needs E09) · Design: docs/03 §6, docs/04 §9
Primary grounding set: `microsoft/azure-pipelines-task-lib` (`node/` — the `INPUT_*`/`getInput` contract and `##vso` emission side) · `microsoft/azure-pipelines-agent` (`src/Agent.Worker` handler execution, env construction) · DistributedTask REST (task download).

> **New epic — the simplification's task story (docs/07).** The original plan hand-transpiled every
> task to readable bash (old E09/E10/E11) and deferred "real-task mode" to the last phase. That is
> now inverted (PLAN D4): script steps run natively, and **every other task runs its real
> implementation** against an emulated `azure-pipelines-task-lib`, or stubs. One emulation host
> serves all tasks instead of N transpilers.
>
> **Absorbs the old `E14-S01` (real-task mode).** The fidelity/DX epic E14 was folded here: its
> real-task story is this epic; its container-jobs/sandbox/parallel/`--shell-at` scope is deferred
> (see E12-cleanup). The old E09/E11 task transpilers are superseded (see E12-cleanup).

## E07-S01 — As a pipeline developer, non-script tasks run their *real* implementation locally, so complex tasks behave faithfully without a transpiler.
Acceptance: a marketplace/in-box Node task executes via the `INPUT_*` host and its `##vso` output feeds the runtime.

- [x] **E07-S01-T01 — Task package downloader**
  **Do:** resolve a step's `task: Name@major` to a concrete version; download the task package (from the org via DistributedTask, or the vendored `task.json` + a fetched bundle) into `.cache/tasks/`; pin in the lockfile.
  **Ground:** how the agent locates/downloads a task (pin the agent repo's task-download path); DistributedTask REST live sample from the test org (E09-S03-T05 supplies `task.json`).
  **Done:** a fixture task package lands in `.cache/tasks/` offline-reproducibly; lockfile pins the version.
- [x] **E07-S01-T02 — task-lib emulation host (`INPUT_*`)**
  **Do:** emit a runner that materializes `INPUT_<name>` env vars from resolved inputs using the task's own `task.json` name/type/transform rules, sets the `AGENT_*`/`ENDPOINT_*`/`BUILD_*` env the task reads, and invokes the task's handler (node/ps/script).
  **Ground:** `azure-pipelines-task-lib` `getInput` name/type conventions and the agent's `HandlerFactory` env contract — pin the exact transform (spaces→`_`, uppercase, prefix `INPUT_`).
  **Done:** a `CmdLine@2`-backed script task and one real Node task both observe the same `INPUT_*` values their `task.json` declares.
- [x] **E07-S01-T03 — Script-handler passthrough**
  **Do:** tasks whose handler is a plain script already map to the native script path (E05); ensure the disposition registry classifies them as `native`, not `real-task`, with no double-exec.
  **Ground:** the task `task.json` `execution` shapes (Node/Node16/PowerShell3/script) — pin the field.
  **Done:** `Bash@3`/`PowerShell@2`/`CmdLine@2` are classified `native`; classification tests cover each execution kind.
- [ ] **E07-S01-T04 — Result & `##vso` capture**
  **Do:** the real task's stdout/stderr is streamed through the E06 `##vso[]` parser and masker, so `setvariable`/`setOutput`/`logissue` from a real task land in the runtime store like any other step; exit code → result machine.
  **Ground:** task-lib `node/taskcommand.ts` emission side (pin) so the parser inverts it exactly; E06-S04 parser claims reused.
  **Done:** a Node task that sets an output variable is readable by a later step; secret from a real task is masked.

## E07-S02 — As a pipeline developer, unknown tasks fail or skip *honestly*, never silently.
Acceptance: stub policy + user handler drop-in.

- [ ] **E07-S02-T01 — Stub emitter**
  **Do:** unknown task → emit a stub that dumps its resolved inputs + `task.json` metadata and exits per config (`skip` | `fail` | `prompt`); the fidelity label is `stub`.
  **Ground:** docs/03 §4 stub policy; PLAN D4.
  **Done:** stub output snapshot; the three config modes tested.
- [ ] **E07-S02-T02 — User handler drop-in**
  **Do:** `handlers/<Name>@<major>.sh` (or `.js`) discovered at run time, receives the same `INPUT_*` env as a real task; documented contract in the generated README.
  **Ground:** docs/03 §4 (user handlers); the `INPUT_*` convention from E07-S01-T02 (cite its claim).
  **Done:** a user handler substitutes for an unknown task in a fixture; missing handler → clear hint.

## E07-S03 — As a converter developer, every task has a declared disposition and fidelity label, so the README is truthful.
Acceptance: disposition registry consumed by the emitter and warnings list.

- [x] **E07-S03-T01 — Task disposition registry**
  **Do:** `name@major → native | real-task | stub` resolution (built-ins natively mapped; the rest default to real-task, falling back to stub when the package is unavailable); per-step fidelity label computed and surfaced in the emitter (E05) and warnings list.
  **Ground:** PLAN D4 + §6 fidelity labels; docs/03 §6.
  **Done:** disposition table-driven; every corpus step carries a correct label; a task that can't download degrades to `stub` with a warning.
