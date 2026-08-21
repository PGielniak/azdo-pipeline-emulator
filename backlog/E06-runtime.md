# E06 — Runtime library (bash)

Phase: P2 · Depends on: E00 (can run parallel to E02–E04) · Design: docs/04 §3–§9
Primary grounding set: logging-commands doc (…/pipelines/scripts/logging-commands) · variables doc (macro + secret + env-name rules) · set-variables-scripts doc (…/process/set-variables-scripts) · agent repo `microsoft/azure-pipelines-agent` `src/Agent.Worker` (StepsRunner, ExecutionContext, worker command handling — locate & pin exact files) · task-lib `microsoft/azure-pipelines-task-lib` `node/` (command emission side of the protocol).

All tasks here are bash (`packages/runtime/src/*.sh`) with bats tests; shellcheck-clean is a global Done criterion.

## E06-S01 — As a pipeline developer, variables behave exactly as on the agent (store, env mapping, secrets), so scripts see identical environments locally.
Acceptance: store + env materialization per docs/04 §4–§5 with cited agent behavior.

- [~] **E06-S01-T01 — Variable store**
  *Superseded 2026-08-12 by E06-S01-T04: real run 539 proves strict read-only enforcement (error + original value retained), contradicting this task's required warning+ignore behavior (C-E06-006).*
  **Do:** file-per-value store (`state/vars/<scope>/<NAME>` + `.meta` flags secret/output/readonly); scope copy at job start; API `azdo_var`, `azdo_var_set`, `azdo_var_meta`.
  **Ground:** docs/04 §4 spec; job-isolation claim (setvariable never crosses jobs except outputs) from set-variables-scripts doc — quote; pin agent `Variables` handling reference.
  **Done:** bats: newline/quote/unicode values survive; readonly write → warning + ignored (behavior per logging-commands doc — quote exact wording).
- [~] **E06-S01-T02 — Env materialization & name transform**
  *Superseded 2026-08-19 by E06-S01-T05: hosted run 540 refutes the Done criterion "env: overlay wins" — the automatically mapped public variable overwrote the same-named explicit step mapping. Agent source also exposes no stable precedence for `A.B`/`A_B` collisions, although `A.B` won all four run-540 variants (C-E06-007..012).*
  **Do:** non-secret vars exported as `UPPER` with `.`/space→`_`; secrets **not** auto-exported; step `env:` overlay (values macro-expanded); PATH assembly from `path.d`.
  **Ground:** variables doc "Environment variables" + "Secret variables" sections — quote both rules (the secret non-export rule is the critical one); verify collision behavior (`A.B` vs `A_B`) via real-run experiment; transcript stored.
  **Done:** bats matrix: transform cases, secret exclusion, env: overlay wins, PATH order.
- [x] **E06-S01-T03 — `.env` loader**
  **Do:** documented `KEY=value` parser (quoting rules stated in generated README), `--env-file` overlay, values registered into store with secret flags from manifest.
  **Ground:** docs/04 §10 load rules; POSIX shell quoting claims from GNU bash manual (pin).
  **Done:** bats: quoting/multiline edge cases; overlay precedence.
- [x] **E06-S01-T04 — Variable store (strict read-only correction)**
  **Do:** file-per-value store (`state/vars/<scope>/<NAME>` + `.meta` flags secret/output/readonly); scope copy at job start; APIs `azdo_var`, `azdo_var_set`, and `azdo_var_meta`. An attempt to overwrite an existing readonly name emits the grounded error and retains the original value.
  **Ground:** docs/04 §4 spec; job-isolation and output-reference claims from set-variables-scripts/variables docs; pinned agent variable handling; real-run transcript `research/experiments/E06-readonly-variables/real-run.md` (C-E06-001..006).
  **Done:** bats: newline/quote/unicode values survive; readonly overwrite errors and retains the first value; output variable fixture covers same-job and cross-job storage paths.
- [x] **E06-S01-T05 — Env materialization & name transform (public-over-explicit correction)**
  **Do:** materialize step `env:` entries with macro-expanded values, then overwrite collisions with non-secret variables exported as `UPPER` with `.`/space→`_`; secrets are not auto-exported; assemble PATH from `path.d` newest-first. Do not promise a winner when distinct public names collapse to one environment key.
  **Ground:** variables doc "Environment variables" + "Secret variables" sections; pinned agent `TaskRunner`, `Handler`, `VarUtil`, and prepend-path handling; hosted run transcript `research/experiments/E06-env-materialization/real-run.md` (C-E06-007..012).
  **Done:** bats matrix: transform cases, secret exclusion with explicit secret mapping, public variable overwrites colliding explicit `env:`, PATH order; transformed-public collision behavior is documented without asserting a universal winner; shellcheck clean.

## E06-S02 — As a pipeline developer, `$(macro)` expansion is agent-identical (just-in-time, textual, unmatched left literal), so timing bugs reproduce locally.
Acceptance: macro engine with cited semantics.

- [x] **E06-S02-T01 — Macro expansion engine**
  **Do:** `azdo_expand_macros <file>`: model the agent's two phases — recursively recalculate stored variable values before the step, then scan the file once using exact case-insensitive `$(Name)` candidates without revisiting inserted bytes. Leave unmatched candidates literal, advance through nested-looking misses as `VarUtil` does, and write the result as a private temp file under `Agent.TempDirectory`.
  **Ground:** variables doc macro-syntax section for before-task timing and literal unmatched macros; hosted run 541 for runtime-created chains and nested-looking input; commit-pinned agent trace through `TaskCommandExtension` → `ExecutionContext.SetVariable` → `Variables.Set` → `StepsRunner.RecalculateExpanded` → `TaskRunner`/`VarUtil.ExpandValues` (C-E06-018..024).
  **Done:** bats: runtime-created `a=$(b)` chain resolves at the next step; unmatched literal; secret values expand; exact prefix-related names remain distinct; nested-looking `$(a$(b))` becomes the run-541 result `$(ainner)`; temp file is under `Agent.TempDirectory`; shellcheck clean.

## E06-S03 — As a pipeline developer, each step runs through the full agent lifecycle (condition → env → exec → result), so control flow matches cloud runs.
Acceptance: `run_step` per docs/04 §5, each numbered behavior grounded.

- [x] **E06-S03-T01 — `run_step` skeleton & exec**
  **Do:** argument contract per docs/04 §5; temp-script write, cwd default = `System.DefaultWorkingDirectory` (verify per-shell-task default), `timeout` wrapper honoring job deadline; log tee to `logs/…`.
  **Ground:** yaml-schema `steps-*` pages for `workingDirectory` defaults per step type (quote each); agent StepsRunner flow (pin) as lifecycle reference.
  **Done:** bats: exec, cwd, timeout kill, log file exists.
- [x] **E06-S03-T02 — Result semantics: exit codes, `continueOnError`, `failOnStderr`, retries**
  **Do:** result state machine `Succeeded/SucceededWithIssues/Failed/Skipped/Canceled`; `failOnStderr` (any stderr output → failure, while still streaming — verify exact trigger: any bytes vs at-exit check); `retryCountOnTaskFailure` re-exec loop; `continueOnError` downgrade.
  **Ground:** yaml-schema steps pages for each field (quote definitions); `failOnStderr` precise semantics from the Bash/PowerShell task sources in `microsoft/azure-pipelines-tasks` (pin the stderr handling code) — task-level, not agent-level, behavior.
  **Done:** bats truth table per combination; claims cited per row.
- [x] **E06-S03-T03 — Condition evaluation & skip flow**
  **Do:** compiled `cond_*` invocation with `StatusContext` from results store; default `succeeded()` when absent; `--no-condition` override; skip logging format.
  **Ground:** conditions doc default-condition statement (quote); interplay with `continueOnError` (does `succeeded()` see `SucceededWithIssues`? — quote doc; verify via real run if ambiguous, transcript).
  **Done:** bats: skip on failed predecessor, always() runs after failure, SucceededWithIssues treated per claim.

## E06-S04 — As a pipeline developer, `##vso` logging commands work, so scripts that set variables/paths/artifacts behave identically.
Acceptance: parser + handlers for the docs/04 §6 table, grounded command-by-command.

- [x] **E06-S04-T01 — `##vso` line parser**
  **Do:** streaming line parser: `##vso[area.action prop=val;…]message` grammar incl. escaping rules; unknown command → warning passthrough.
  **Ground:** logging-commands doc "Command format"/escaping section (quote); cross-check emission side in task-lib `node/taskcommand.ts` (pin — shows exact escaping the parser must invert).
  **Done:** bats: parse table incl. escaped `;`/`%`/newlines per claims.
- [x] **E06-S04-T02 — `task.setvariable` (+`isoutput`, `issecret`, `isreadonly`)**
  **Do:** store writes; output vars additionally to `outputs/<stage>/<job>/<step>.<var>`; within-job `$(step.var)` availability; secret registration to masker.
  **Ground:** set-variables-scripts doc (quote availability rules: subsequent steps only, not current; output-var reference forms) — each rule a claim; verify "not current step" via bats-replicated experiment matching a real-run transcript.
  **Done:** bats: subsequent-step visibility, output cross-job read via store, secret masked in logs.
- [x] **E06-S04-T03 — `task.prependpath`, `task.setsecret`, `task.complete`, `task.logissue`, formatting commands**
  **Do:** per docs/04 §6 table; `##[debug]` gated on `System.Debug`; issue counters feed result machine; ANSI rendering for group/section/warning/error.
  **Ground:** logging-commands doc per-command sections — one claim per command encoding its documented effect and scope (e.g. prependpath "for subsequent tasks" — quote).
  **Done:** bats per command; debug gating test.
  *Done 2026-08-21 — C-E06-057..068; `packages/runtime/test/core.bats` cases 42–55. Two docs/04 statements were corrected rather than implemented, in the §6 table and the §5 step-6 result summary (docs/06 §5 decision 36): issue counts do not move the step result (a failing command or the exit status does), and the agent gates its debug channel rather than filtering raw `##[debug]` output — console hiding of those lines is a recorded local decision. No hosted counterpart run: this environment has no oracle credentials.*
- [!] **E06-S04-T04 — Artifact/attachment commands (`artifact.upload`, `task.uploadfile`, `build.updatebuildnumber`, `build.addbuildtag`)**
  **Do:** map to `.artifacts/` copy, `logs/attachments/`, store updates per docs/04 §6.
  **Ground:** logging-commands doc entries (quote `artifact.upload` properties `containerfolder`, `artifactname`).
  **Done:** bats: artifact appears under `.artifacts/<name>/`, build number visible to later steps.

## E06-S05 — As a pipeline developer, artifacts and checkout behave like the agent's, so multi-stage artifact hand-offs work offline.
Acceptance: publish/download flows + checkout modes per docs/04 §7–§8.

- [ ] **E06-S05-T01 — Artifact publish/download (current)**
  **Do:** `azdo_artifact_publish/download` with pattern support; deployment-job auto-download injection point; download target `$(Pipeline.Workspace)/<name>`.
  **Ground:** pipeline-artifacts doc (…/pipelines/artifacts/pipeline-artifacts — quote default download path & auto-download behavior for deployment jobs); `PublishPipelineArtifactV1`/`DownloadPipelineArtifactV2` task.json defaults (pin).
  **Done:** bats: publish→download round trip across two jobs; deployment auto-download fixture.
- [ ] **E06-S05-T02 — Checkout (self) modes & options**
  **Do:** `clone` (reference clone from pinned origin+commit), `copy` (rsync worktree), `worktree`; options `fetchDepth fetchTags lfs submodules path clean`; `Build.SourceBranch/SourceVersion/Repository.*` seeding from repo state.
  **Ground:** yaml-schema `steps-checkout` page (quote each option's effect); multi-repo layout claims deferred to T03; git flag mapping cited from git-scm.com docs (pin per flag).
  **Done:** bats: each mode produces working repo; options matrix (depth, lfs skipped if unavailable w/ warning).
- [ ] **E06-S05-T03 — Multi-checkout layout**
  **Do:** path rules: single self → `s/`; multiple checkouts → `s/<repoName>` incl. self; `path:` override interplay; `Build.Repository.LocalPath` semantics.
  **Ground:** multi-repo-checkout doc (…/pipelines/repos/multi-repo-checkout — quote the layout rules table verbatim; they're subtle); verify one ambiguous combination (self+path+second repo) via real run, transcript.
  **Done:** bats matrix for 1/2/3-repo layouts matching quoted rules.

## E06-S06 — As a pipeline developer, runs end with a truthful summary and no secret leakage, so local logs are safe to share.
Acceptance: summary table + masking hardened.

- [ ] **E06-S06-T01 — Secret masking**
  **Do:** streaming masker replacing registered secret values (and `setsecret` additions) with `***`; applied to console and log files; handles values split across lines? (verify agent behavior — likely no; document delta).
  **Ground:** logging-commands `setsecret` + variables doc masking statements (quote); agent masker source (locate `SecretMasker` in agent repo; pin) for behavior reference.
  **Done:** bats: secrets in stdout/stderr masked; delta note recorded if partial-line only.
- [ ] **E06-S06-T02 — Run summary & exit codes**
  **Do:** end-of-run table (step, result, duration, log path); pipeline exit code from aggregate result per docs/04 §3.
  **Ground:** docs/04 §3 aggregation spec; result aggregation claims from E06-S03-T02.
  **Done:** bats snapshot of summary; exit-code matrix.
