# 04 — Generated project layout & runtime specification

The contract of the output: what `convert` emits and how the scripts behave at run time. Behavior reference: `microsoft/azure-pipelines-agent` (worker step lifecycle, `_work` layout) and the logging-commands doc (…/scripts/logging-commands).

## 1. Output layout

```
out/
├── run.sh                        # whole pipeline (topological stage order)
├── .env.example                  # every unresolved input, documented (§10)
├── .env                          # user-filled copy (gitignored)
├── .gitignore                    # .env .work/ .artifacts/ logs
├── README.md                     # conversion report: fidelity table, warnings, how-to (§12)
├── pipeline.expanded.yml         # the fully resolved YAML (≈ service "final YAML")
├── expansion-map.json            # provenance: expanded node → source file:line chain
├── manifest.json                 # machine-readable graph + metadata (§11)
├── coverage.md                   # how much of the pipeline this project reproduces (§13)
├── coverage.json                 # same, machine-readable — drives --min-coverage
├── azdo-emu.lock.json            # pins: template repo SHAs, artifact run IDs (docs/05)
├── fetch-artifacts.sh            # optional refresh of downloaded artifacts
├── lib/
│   ├── runtime.sh                # step runner, var store, ##vso parser, artifacts, checkout
│   ├── expr.sh                   # compiled expression helpers actually used
│   └── sandbox.sh                # sandbox-mode wrapper: whole-run container lifecycle (§9, D11)
├── environment/                  # sandbox image: pinned default image ref + optional Dockerfile (§9, D11)
├── handlers/                     # user drop-in task handlers (docs/03 §4)
├── stages/
│   └── 010-Build/
│       ├── run-stage.sh
│       ├── conditions.sh         # compiled condition fns for this stage's jobs/steps
│       └── jobs/
│           └── 010-BuildJob/     # matrix jobs: 010-BuildJob__linux_x64/
│               ├── run-job.sh
│               └── steps/
│                   ├── 010-checkout-self.sh
│                   ├── 020-usedotnet.sh
│                   └── 030-build-solution.sh
├── .cache/                       # convert-time fetches: repos (bare), artifacts, task metadata
├── .artifacts/                   # artifacts published by local runs (and download source for `current`)
│   ├── <artifactname>/           # keyed by artifact name; `.meta/<artifactname>` holds the container folder
│   └── .meta/
└── .work/                        # created at run time: workspaces, state, logs (gitignored)
    ├── .state/                   # run counter, counters/, last run pointer
    └── run-3/
        ├── state/                # vars/, outputs/, results/, path.d/
        ├── logs/                 # per-step logs + summary
        └── Build/BuildJob/       # = Pipeline.Workspace for that job: s/ a/ b/ tmp/ TestResults/
```

Numbering (`010-`) leaves gaps for hand-inserted debugging steps. Names are slugged `displayName` (fallback: task name).

## 2. Entry points & debugging UX

```
./run.sh [--sandbox|--host] [--env-file f] [--parallel] [--keep-going] [--list]
./stages/010-Build/run-stage.sh
./stages/010-Build/jobs/010-BuildJob/run-job.sh
    [--from-step 030] [--to-step 050] [--only-step 030]
    [--shell-at 030]        # prepare env exactly as step 030 would see it, drop into a shell
    [--no-condition]        # force-run steps regardless of conditions
    [--resume]              # reuse last run's workspace & state instead of a fresh one
```

Key debugging affordances (the point of the tool):
- **Single-step re-run**: `--only-step` re-executes one step against the last run's state/workspace (`--resume` implied), so you can edit the step script and iterate.
- **`--shell-at N`**: materializes the exact env (vars, PATH prepends, cwd) of step N and opens `$SHELL` — inspect, run commands by hand.
- Every step file is standalone-readable: header comments carry displayName, source provenance, condition source text, fidelity tier, and warnings.
- `run.sh --list` prints the tree with ids, conditions, and fidelity — a table of contents for the pipeline.
- End-of-run summary table (step, result, duration, log path), mirroring the ADO UI's job view.
- **Sandboxed by default (D11)**: every entry point accepts `--sandbox|--host` (default `auto`: sandbox when docker/podman is present and the job targets Linux). The script re-executes itself inside the run's sandbox container; `--only-step`, `--resume` and `--shell-at` re-enter the *same* container, so iteration speed and state survive isolation. Spec: §9.

## 3. Job execution model

`run.sh` topologically orders stages (then jobs) honoring `dependsOn`; ties broken by YAML order; sequential by default (`--parallel` opt-in, P6). For each job:

1. Evaluate job condition (compiled; against dependency results/outputs). Skipped → record `Skipped`, continue.
2. Create workspace `<run>/<stage>/<job>/{s,a,b,tmp,TestResults}` (or reuse with `--resume`; `workspace.clean` honored).
3. Evaluate `$[ ]` runtime-expression variables (compiled) into the job's variable store; seed predefined variables.
4. Run steps in order via `run_step` (§5).
5. Aggregate job result (`Succeeded`, `SucceededWithIssues`, `Failed`); persist to `state/results/<stage>/<job>`; enforce job `timeoutInMinutes` as a deadline passed to steps.

Stage result aggregates job results; `continueOnError: true` jobs degrade to `SucceededWithIssues`; run exit code is non-zero iff the pipeline result is `Failed`.

## 4. State store (filesystem, no daemons)

```
state/vars/<scope>/<NAME>          # value file; .meta sidecar: secret,output,readonly flags
state/outputs/<stage>/<job>/<step>.<var>
state/results/<stage>[/<job>[/<step>]]   # Succeeded|SucceededWithIssues|Failed|Skipped|Canceled
state/path.d/NNN-<step>            # PATH prepends, applied in order to subsequent steps
state/masks/mask.*                 # private exact values registered for streaming log masking
```
File-per-value dodges quoting/newline pitfalls entirely. Variable keys are case-insensitive, matching the agent dictionary (C-E06-003). Job variable scope is copied at job start — `setvariable` never leaks across jobs except through `outputs/` (agent-faithful).

The runner exports `AZDO_STATE_DIR` and the current `AZDO_VAR_SCOPE` before it sources the runtime.
`azdo_var <name> [scope]` reads a value (missing → empty); `azdo_var_set <name> <value> [secret] [output] [readonly] [scope]` writes it; and `azdo_var_meta <name> [scope]` prints the flags sidecar. `azdo_var_scope_copy <source> <target>` seeds a fresh job scope. An output write requires `AZDO_STEP_NAME` and `AZDO_OUTPUT_DIR`; it is stored as `<step>.<name>` in the current job and in `outputs/`, read cross-job by `azdo_output <stage> <job> <step.variable>`. Read-only overwrites emit an error and preserve the first value (C-E06-005/006).
Once a name is secret, later writes preserve that status and register the replacement value with
the masker rather than allowing a secret-to-public downgrade (C-E06-056).

## 5. `run_step` lifecycle (the heart of parity)

```
run_step --id 030 --file steps/030-build-solution.sh --cond cond_step_030
         --display "Build solution" --wd '$(System.DefaultWorkingDirectory)'
         --continue-on-error false --fail-on-stderr false --retries 0 --timeout 3600
```

The job runner sets `AZDO_LOG_DIR` to that job's `logs/<stage>/<job>` directory. `--wd` may be
omitted or empty, in which case the step starts in `System.DefaultWorkingDirectory` (C-E06-026/027;
hosted run 542 distinguishes it from `Build.SourcesDirectory`). `--timeout` is seconds already
capped to the smaller of the step limit and the remaining job deadline; the agent likewise binds
both cancellation sources to execution (C-E06-025/030). The remaining arguments are stable from
the first `run_step` skeleton even though their condition/result policies land in E06-S03-T02/T03.

1. **Condition**: call the compiled `cond_*` function against the job status accumulated from prior step results; an absent authored condition uses `succeeded()`. False → `Skipped` and the hosted raw line `Skipping step due to condition evaluation.`; an evaluation error → `Failed`. `--no-condition` is the explicit local force-run override (C-E06-038..043; hosted run 543).
2. **Env materialization**: load step `env:` entries and macro-expand their values, then add predefined vars + all *non-secret* scope vars (name transform `UPPER`, `.`/space→`_`), then assemble `PATH` from `path.d` newest-first. Explicit `env:` is the only way secrets enter the process environment. Counterintuitively, public variables are added *after* the task environment, so an automatic variable whose transformed name collides with an explicit `env:` key overwrites that mapping (C-E06-007..012; hosted run 540). The source exposes no stable ordering contract when two public names such as `A.B` and `A_B` collapse to the same environment key; run 540 observed `A.B` winning in four order variants, so that collision remains an explicit parity risk rather than an invented universal rule.
3. **Macro pass**: mirror the agent's two phase boundary. Immediately before the step, recursively recalculate stored variable values (exact case-insensitive references, inherited secret status, depth/cycle guards); then read the step file and run the separate non-recursive target scan, substituting `$(Name)` from that expanded view (secrets included), leaving unmatched candidates **literal**, and never revisiting inserted bytes. Write the result as a private file under `$(Agent.TempDirectory)/steps/`. This explains both hosted run-541 observations without contradiction: a runtime-created `a=$(b)` is recalculated to `inner` before the next task, while target text `$(a$(b))` first misses the outer candidate, expands the inner `$(b)`, and remains `$(ainner)` even when `ainner` exists (C-E06-018..024; docs/06 §5 decision 29).
4. **Execute**: `timeout <remaining>` bash (or pwsh) on the expanded file, cwd = workingDirectory, stdout+stderr streamed.
5. **Stream processing** (line-wise): parse `##vso[…]` (§6) and `##[…]` formatting; apply **secret masking** (all values flagged secret + `task.setsecret` additions → `***`); tee to `logs/<stage>/<job>/030.log`. A successful secret `task.setvariable` registration affects the very next physical output line in the same step and every later step (C-E06-053; hosted run 544).
6. **Result** (precedence, C-E06-059..061): `task.complete` **merges** worst-wins into the result; a thrown step failure (nonzero exit, timeout, cancellation) then **assigns** `Failed`/`Canceled`, overriding an earlier `task.complete result=Succeeded`; accumulated command failures merge next; `continueOnError` downgrades a final `Failed`→`SucceededWithIssues` for control flow; an unset result completes as `Succeeded`. `failOnStderr` is not an agent-level input at all: it is the Bash/PowerShell shortcuts' own flag, where any stderr bytes set a failure flag and the task marks itself failed after process exit (C-E06-033). Error/warning **issue counts are recorded per step but never move the result** — only a failing logging command or the step's own exit status does (docs/06 §5 decision 36). `retryCountOnTaskFailure` re-executes the step while the attempt result is exactly `Failed`, resetting per-attempt command state (C-E06-035).
7. **Persist**: variable/PATH/output deltas become visible to subsequent steps.

## 6. Logging commands supported (`##vso`)

| Command | Behavior |
|---|---|
| `task.setvariable` (`variable`, `isSecret`, `isOutput`, `isReadOnly`) | Required name + Boolean flags feed the store; plain values become visible to following tasks only, output vars additionally use the read-only `<step>.<var>` alias and `outputs/`, secrets register immediately with the masker, and read-only overwrites retain the original value (C-E06-005/006, C-E06-050..056; hosted runs 539/544) |
| `task.setsecret` | Add value to the masker for the rest of the job; earlier occurrences are not retroactively masked (C-E06-058) |
| `task.prependpath` | Nonempty value appended to `path.d` → subsequent steps, repeats move to newest (C-E06-012/057) |
| `artifact.upload` (`artifactname`, `containerfolder`) | Nonempty `artifactname` required; `containerfolder` defaults to it. The message may name a **file or a directory**; the copy reproduces the container item paths, so a file contributes its basename and a directory contributes its *contents* — its own name never appears. Destination is `.artifacts/<artifactname>/`, keyed by artifact **name** because that is what a download asks for; the container folder is the coordinate *inside* the container and is recorded in `.artifacts/.meta/<artifactname>` rather than becoming a directory level (C-E06-069/071/072; docs/06 §5 decision 37). A nonexistent path fails the command; an **empty directory is a counted warning and a success** (C-E06-070) |
| `artifact.associate` (`artifactname`, `type`) | Requires name, type and location; the location is a *server-side* coordinate (container path, UNC share, TFVC path, git ref), so nothing is materialized. Accepted, validated and recorded in `.artifacts/.meta/<artifactname>` with a gated debug note — the `task.setprogress` pattern, not the unknown-command path, because the hosted agent accepts it (C-E06-073) |
| `task.uploadfile`, `task.uploadsummary`, `task.addattachment` | One implementation, three type/name derivations: `addattachment` takes both from required properties, the two upload commands derive the name as the file's own name and supply a fixed type. Copy to `logs/attachments/<type>/<name>` (degraded: no UI). The file must exist and be a **file** — unlike `artifact.upload`, a directory is refused (C-E06-074/075). `type`/`name` are guarded by `azdo__valid_store_segment` rather than .NET's platform-dependent `Path.GetInvalidFileNameChars()` (C-E06-076) |
| `task.logissue type=error\|warning` | Message rendered as a tagged `##[error]`/`##[warning]` line and counted per step; issue **counts alone do not change the step result** — only a failing logging command or the step's own exit status does (C-E06-062..064; docs/06 §5 decision 36). `task.issue` is a registered alias of the same handler, so both spellings behave identically (C-E06-068) |
| `task.complete result=…` | `result` is required and merges worst-wins into the step result; a nonzero exit still overrides it, then command failures merge, then `continueOnError` downgrades (C-E06-059..061) |
| `task.setprogress` | Ignored with a gated debug note; percent-complete has no local timeline (C-E06-067) |
| `build.updatebuildnumber` | Nonempty message required and **not trimmed**; sets `Build.BuildNumber` in the store, visible to subsequent steps through the ordinary environment pass. The write **bypasses the read-only rule**: `build.buildNumber` is a member of `Constants.Variables.ReadOnlyVariables`, but the agent enforces read-only in `TaskSetVariableCommand`, not in `Variables.Set`, and the source comment names this command as the reason — so the local runtime uses an unchecked store write that still preserves the flag (C-E06-080/081) |
| `build.addbuildtag` | Message is **trimmed** before the emptiness check (unlike `updatebuildnumber`), then appended to `state/tags`, de-duplicated case-insensitively because server-side tags are a set (C-E06-082). The doc's "you can't use a colon" restriction is server-side and is deliberately *not* reproduced locally |
| `build.uploadlog`, `build.uploadsummary` | Real attachment commands, **not** ignored as this table previously stated: `uploadlog` attaches an existing file under the fixed name `Log/CustomToolLog`, and the deprecated-but-installed `build.uploadsummary` (absent from the doc page) attaches under `Distributedtask.Core.Summary/CustomMarkDownSummary-<filename>` (C-E06-077/078) |
| `release.*`, `task.logdetail`, `task.setendpoint`, `task.settaskvariable` | Not registered: they act on server-side state with no local counterpart, so they take the unknown-command path — a counted warning plus verbatim passthrough (C-E06-047/048/049) |
| Formatting `##[group]/[endgroup]/[section]/[command]/[warning]/[error]/[debug]` | ANSI-colored console rendering by a filter placed *after* the log tee, so `logs/<step>.log` stays byte-faithful; the hosted agent emits these tags and its web UI colors them (C-E06-066). The debug **channel** (`##vso[task.debug]`, per-command `Processed:` notes) is gated on `System.Debug` exactly as the agent gates `context.Debug` (C-E06-065); a raw `##[debug]` line echoed by a script is ordinary output that the log keeps either way, and the local renderer hides it from the console unless `System.Debug` is true (docs/06 §5 decision 36) |

The runtime parses logging commands as physical UTF-8 output lines and reverses task-lib escaping
before dispatch. Unknown or malformed `##vso` lines produce a warning and remain visible unchanged;
the hosted agent consumes a successfully parsed unknown-area command after warning, but local
passthrough is intentional so unsupported task output is never silently lost (C-E06-044..049).
Because macro expansion and environment materialization occur before execution, a set-variable
command cannot change either view inside its emitting process. The next step sees a plain name as
`$(name)` and its public environment mapping, or an output as `$(step.name)`; dependent jobs read
the same output through the persisted dependency path (C-E06-050..052; hosted run 544).

## 7. Artifacts

- **Publish** → `rsync` into `<out>/.artifacts/<name>/` (build-artifact container semantics preserved for `PublishBuildArtifacts`).
- **Download, `current`** → copy from `.artifacts/` into `$(Pipeline.Workspace)/<name>` (deployment jobs auto-download unless `download: none` — injected implicit step).
- **Download, specific run / `resources.pipelines`** → served from `.cache/artifacts/<alias>/<runId>/<name>/`, fetched at convert time and pinned in the lockfile; `fetch-artifacts.sh` re-fetches (uses `azdo-emu` if installed, else documented `curl` + `SYSTEM_ACCESSTOKEN` fallback).
- Item patterns / `itemPattern`/`patterns` inputs honored via `azdo_match`.

## 8. Checkout emulation

| Form | Behavior |
|---|---|
| `checkout: self` | Default when steps exist. Modes (config `--checkout-mode`): `clone` (default; from lockfile-pinned origin+commit via local reference clone — fast, honest) / `copy` (rsync current working tree — for testing uncommitted changes) / `worktree` (git worktree of current repo) |
| `checkout: none` | Skip |
| `checkout: <alias>` / github repo | Clone from `.cache/repos/...` bare mirror (pinned SHA) into `s/` or `s/<name>` (multi-checkout path rules per agent docs) |
| Options | `fetchDepth` (shallow), `fetchTags`, `lfs`, `submodules` (incl. recursive), `path` (within `Agent.BuildDirectory`), `clean`; `persistCredentials` → git credential helper wired to `SYSTEM_ACCESSTOKEN` from `.env` |

`Build.SourceBranch`/`SourceVersion`/`Repository.Name` seeded from the resolved repo state; overridable via `.env` to simulate other branches/PRs.

## 9. Execution environments & OS targets: sandbox, container jobs, services (sandbox: P2; container jobs: P6; Windows host: future)

- **Sandbox execution environment (D11)** — isolation for the *whole run*, independent of any `container:` in the YAML. Default `auto`: when a container runtime (docker/podman, auto-detected in that order) is present and the job targets Linux, every entry point re-executes itself inside **one long-lived sandbox container per run** (`create`/`start` once; `--only-step`/`--resume`/`--shell-at` `exec` back into it, TTY preserved). Mounts: project root bind-mounted at the **identical absolute path** (same invariant as container jobs — scripts, state store, logs and artifacts are the same files in both environments, so `--sandbox` and `--host` runs are interchangeable) plus a named volume over the tool cache (`Agent.ToolsDirectory`, D9). `.env` is sourced only inside the sandbox; nothing is installed on or exported to the host. `--host` opts out; `--sandbox` errors if no runtime is found.
  - **Image resolution**: config `output.execution.image` / emitted `environment/Dockerfile` → default per-`vmImage` mapping to a hosted-approximation image (exact default image: VERIFY at E14-S04-T02 against `actions/runner-images` manifests; act-style approximation images evaluated there). Chosen image+digest recorded in `manifest.json` and the lockfile; `doctor --sandbox` runs its checks *inside the image* instead of against the host.
  - **Docker-using pipelines** (`Docker@2`, container jobs, `docker` in scripts): `output.execution.dockerSocket: auto|share|none`. `share` mounts the host socket — job/tool containers become *siblings* of the sandbox (path-correct, because the project mount is host-backed at the same absolute path) at a documented isolation cost (README + coverage warning). `auto` shares only when the manifest says the pipeline needs docker. `none` degrades docker-dependent steps with remediation notes. Docker-in-Docker is deliberately not the default (evaluated in E14-S04-T03).
  - macOS- and Windows-targeted jobs cannot be sandboxed on a Linux engine → host mode + warning (target-OS rules below unchanged).
- Per-job **target OS** from `pool` (`vmImage: windows-*` etc.) or `--target-os`. Linux/macOS jobs → bash emission. Windows-targeted jobs today: bash emission whose PowerShell steps run via `pwsh` on the Linux host (`degraded`; cmd-specific steps flagged). A native Windows-host script set (`run-job.ps1`, `steps/*.ps1`) is the deferred "Future — Windows host" phase (decision 2026-07-30); the emitter's per-target-OS backend seam exists from day one so it bolts on without rework.
- **Container jobs**: `docker run -d` the job container with the workspace bind-mounted at the *same absolute path* (scripts unchanged inside/outside), steps executed via `docker exec` with the step env file; `services:` started on a shared network with alias names; `resources.containers` registry auth via `.env`. From inside the sandbox, container jobs run as siblings via socket passthrough (E14-S04-T03).
- `step.target: <container|host>` honored per step.

## 10. `.env.example` synthesis

One entry per unresolved input, each with provenance comments; sections in order:

1. Run identity overrides (`BUILD_SOURCEBRANCH`, `BUILD_REASON`, `SYSTEM_PULLREQUEST_*`) — optional, for simulating triggers.
2. `SYSTEM_ACCESSTOKEN` — needed by steps that call ADO REST / feeds; README shows how to mint one.
3. Variable groups — per group: known non-secret values prefilled (if resolved at convert), secret names empty.
4. Runtime parameters passed through to runtime positions (prefilled with defaults).
5. Service connections — structured blocks (docs/03 §5).
6. Secure files — `SECUREFILE_<name>=` local path.

Load rules: `run.sh` loads `.env`, then loads `--env-file` (when supplied) in the same
non-interactive Bash process, so the latter wins repeated names and can reference a value assigned
by the former. The loader registers each final value in the case-insensitive variable store; the
generated runner projects `manifest.json`'s `env` entries into `AZDO_MANIFEST_ENV=(NAME=secret …)`,
and those flags mark secret store values for later masking (C-E06-013).

The generated README must state this `.env` contract verbatim in substance:

- This is a **trusted Bash assignment file**, not a generic dotenv dialect. Use direct
  `NAME=value` statements; a name contains only letters, digits, and underscores and cannot begin
  with a digit. `export NAME=value` is not part of the loader contract (C-E06-014).
- Empty and unquoted values are accepted. Bash performs tilde, parameter, command, and arithmetic
  expansion plus quote removal on assignment values. Consequently, command/process substitutions
  can have external side effects: never load an `.env` obtained from an untrusted source
  (C-E06-014).
- Single quotes preserve every character literally and may span lines, but cannot contain a single
  quote. Double quotes may span lines and still expand `$`, backquotes, and the documented
  backslash escapes. Outside quotes, backslash escapes the next character and backslash-newline is
  removed as a continuation (C-E06-015/016).
- A `#` begins a comment only at the beginning of a shell word (start of line or after unquoted
  whitespace/operator). Thus `NAME=value#part` includes `#part`, while `NAME=value # comment` does
  not (C-E06-017).

## 11. `manifest.json` (drives `doctor`, `--list`, tooling)

```json
{ "pipeline": {"name": "...", "parameters": {"baked": {"deployEnv": "dev"}}},
  "stages": [{ "id": "Build", "dependsOn": [], "condition": {"source": "succeeded()"},
    "jobs": [{ "id": "BuildJob", "kind": "agent", "targetOs": "linux",
      "steps": [{ "id": "030", "displayName": "Build solution", "task": "DotNetCoreCLI@2",
        "fidelity": "equivalent", "file": "stages/010-Build/jobs/010-BuildJob/steps/030-build-solution.sh",
        "source": {"file": "templates/build.yml", "line": 14, "via": ["azure-pipelines.yml:22"]},
        "warnings": [] }]}]}],
  "env": [{"name": "SC_MY_AZURE_SUB_CLIENT_SECRET", "secret": true, "origin": "service connection 'my-azure-sub'"}],
  "tools": [{"cmd": "dotnet", "min": "8.0", "neededBy": ["Build/BuildJob/030"]}],
  "warnings": [], "unsupported": [] }
```

## 12. Sample emitted step (illustrative)

```bash
#!/usr/bin/env bash
# ── Step 030 · "Build solution" · DotNetCoreCLI@2 (command: build) ─────────────
# from: templates/build.yml:14  (via azure-pipelines.yml:22 «template: templates/build.yml»)
# condition: succeeded()        continueOnError: false     timeout: job default
# fidelity: equivalent — transpiled to `dotnet build`; see README §fidelity
# NOTE: $(buildConfiguration) below is an ADO macro — run_step expands it just-in-time.
set -euo pipefail
source "$AZDO_EMU_LIB/runtime.sh"

azdo_match '**/*.sln' | while IFS= read -r project; do
  azdo_group "dotnet build $project"
  dotnet build "$project" --configuration "$(buildConfiguration)" --no-restore
  azdo_endgroup
done
```

The generated project's `README.md` repeats the fidelity table for its steps, lists all warnings, documents `.env` filling, states the tool prereqs (`azdo-emu doctor` re-checks them), and embeds the coverage summary (§13).

## 13. Coverage report (`coverage.md` / `coverage.json`)

Every conversion answers, per pipeline: **how much of the original does this project actually reproduce?**

Metric definition:
- **Unit** = unique emitted step definition after template expansion; matrix variants of the same step count once.
- **Weight** = fidelity tier weight (PLAN.md §6): `exact` 1.0 · `equivalent` 1.0 · `degraded` 0.5 · `stub`/`unsupported` 0.
- **Structural caps**: steps inside a job/stage whose own construct is degraded/stub (e.g. a container job before P6) score at most that construct's weight — a step can't count as covered if its job can't run.
- **Coverage % = Σ weights / step count.** Parsed-but-ignored constructs with no local runtime meaning (triggers, schedules, approvals/checks, `lockBehavior`) are excluded from the denominator but listed in the report so nothing disappears silently.

`coverage.md` contains: headline % + tier histogram; per-stage/per-job breakdown table; a **ranked gap list** (location, task, tier, reason, concrete remediation — "drop an executable at `handlers/Foo@2`", "install `pwsh` ≥ 7.4", "fill `SC_X_*` in `.env`"); the excluded-constructs list. `coverage.json` mirrors it for tooling (derived from `manifest.json` step fidelity data).

`convert` ends with a one-liner:

```
Coverage: 87.2% — 41 steps · 33 full · 5 degraded · 3 stubbed   (details: coverage.md)
```

`--min-coverage <pct>` fails conversion (exit code 3) below the threshold — usable as a CI gate.
