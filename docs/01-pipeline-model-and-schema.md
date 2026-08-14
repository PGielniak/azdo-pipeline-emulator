# 01 — Pipeline model & YAML schema coverage

Scope: what we parse, how faithfully, and how the semantic model is shaped. Grounded in the official YAML schema reference (learn.microsoft.com/azure/devops/pipelines/yaml-schema/) and the machine-readable schema (`microsoft/azure-pipelines-vscode` `service-schema.json`; per-org `GET {org}/_apis/distributedtask/yamlschema`).

## 1. Parsing rules (front end)

- YAML 1.2 via the `yaml` npm package, **CST retained** → every node in the DOM carries `{file, line, col}` provenance. Provenance survives template expansion (docs/02 §7) and ends up in step-script headers and error messages.
- **Match server quirks, not the YAML spec**, wherever they differ. Known items to encode as explicit behaviors with tests:
  - YAML anchors/aliases: rejected — and the service rejects the **anchor definition**, not its use: `&x` that is never aliased fails exactly like `&x` + `*x`, and the merge key `<<: *x` produces the same message (`Anchors are not currently supported. Remove the anchor 'x'`). Verified live 2026-08-11 (C-E01-022).
  - Ordinary duplicate mapping keys: error at every nesting level (root, mapping, step), reported against the **second** occurrence: `'<key>' is already defined` (C-E01-023). The comparison is **case-insensitive at the mapping layer**, not just for schema keywords — `displayName`/`displayname` collide, and so do `a`/`A` under `variables:` (C-E01-028). Recognized template directive keys are exempt: byte-identical `${{ if }}` and `${{ each }}` keys are accepted and both bodies expand, while repeated ordinary expression keys such as `${{ pair.key }}` remain duplicates (C-E01-038/039).
  - Only a single document per file: a *second* document is rejected (C-E01-024). A **document marker is not a separator** — a lone leading `---`, and a trailing `...`, are accepted by the service and must not be rejected (C-E01-025).
  - All three checks live in one module, `packages/engine/src/frontend/quirks.ts`, with the conformance table `SERVER_QUIRKS`; transcripts under `research/experiments/E01-quirks/` and `research/experiments/E01-directive-duplicates/` (regenerate with `pnpm oracle-quirks` and `pnpm duplicate-key-survey`). The service positions only the duplicate-key error; ours carry a source range in all three cases, deliberately exceeding it (C-E01-026).
  - Expressions `${{ … }}` are *not* YAML syntax — they are plain strings (or mapping keys) at parse time. The front end does not evaluate them; it only reuses the template engine's directive classifier to apply the duplicate-key exception above (C-E01-038).
- Schema validation runs twice: on the raw root file (loose — templates make many things optional) and on the fully expanded DOM (strict). Validator is generated from the pinned official JSON schema; org-fetched schema (which includes installed marketplace tasks) is used when authenticated.
- Every schema violation reports `file:line:col`, the JSON-path in the document, and the allowed alternatives (the schema is a huge `oneOf`; we post-process to produce readable messages).
- The validator is a **guided walk** over the schema, not a stock JSON-Schema run (E01-S02-T01, `packages/engine/src/frontend/validate.ts`). The vendored file's acceptance semantics are only half draft-07: the VS Code-extension keywords `firstProperty` / `ignoreCase` / `aliases` decide which branch applies and which names match, and pipeline values are strings — YAML booleans/numbers/empty values satisfy `type: string`, and `${{ }}` / `$( )` / `$[ ]` values are exempt from type checks (C-E01-015..018, mirroring `microsoft/azure-pipelines-language-server`). Stock ajv over the raw file both rejects valid pipelines and emits >1000 errors per typo (C-E01-019); it stays in use only as the vendored-file integrity check.
- Where the docs and the vendored schema disagree, **the docs win** and the fix is recorded as a correction applied at load time (`DOCUMENTED_CORRECTIONS`) with its claim — currently one: `target` on task steps (C-E01-011). Re-check these on every schema refresh (E00-S02-T01 tooling).
- Severity: schema violations are errors, except where the vendored schema is knowingly incomplete — an unrecognized `task:` name or an unrecognized input of a known task is a **warning** (the in-box catalog is a snapshot; marketplace tasks only validate against the org schema, C-E01-020).
- The org schema is a **wholesale swap, not a merge** (E01-S02-T03, `org-schema.ts`): the live `yamlschema` response is the same generator's output as the vendored file — draft-07, same `$id`, same four VS Code keywords, same 119 definitions — differing only in the task catalogue, which is a strict superset including marketplace tasks with their inputs (C-E01-030/031). Two consequences: `DOCUMENTED_CORRECTIONS` apply to the org document too, since they fix the *generator* and not our snapshot (C-E01-037); and a document that fails the compatibility gate (wrong dialect, or any keyword the walk does not implement) degrades to the vendored schema instead of being trusted. Under the org schema an unknown `task:` means "not installed in this organization" — which is exactly what the service rejects unless a client asks for `validateTaskNames=false`, its own "accept any task with any inputs" mode (C-E01-033).

## 2. Top-level coverage matrix

Tiers per PLAN.md §6 (`exact / equivalent / degraded / stub / unsupported`). Phase = roadmap phase where it lands.

| Construct | Tier | Phase | Local semantics |
|---|---|---|---|
| `trigger`, `pr`, `schedules` | parsed, ignored | P0 | Recorded in manifest; never executed |
| `name` (run-number format) | equivalent | P2 | Evaluated at run start; `$(Rev:.r)` / `$(Date:…)` / counters from local state file → `Build.BuildNumber` |
| `appendCommitMessageToRunName`, `lockBehavior` | parsed, ignored | P0 | Manifest note |
| `pool` (name / vmImage / demands) | metadata | P2 | Drives `--target-os` inference + `doctor` expectations; `pool: server` switches to server-task emulation (docs/03 group F) |
| `parameters` (runtime parameters) | exact | P1 | Bound at convert time from `--parameter`/config/defaults; `values:` and type validation enforced |
| `variables` (all forms) | exact/equivalent | P1/P3 | §4 below |
| `stages` / `jobs` / `steps` + single-job & single-stage shorthands | exact | P1 | Normalized to full stages→jobs→steps tree |
| `extends` template | exact | P1 | docs/02 |
| `resources.repositories` | exact | P3 | Template resolution + `checkout` source; fetched & pinned |
| `resources.pipelines` | equivalent | P3 | Artifact download at convert time (pinned runId); `trigger:` ignored; `resources.pipeline.*` runtime context populated from pinned run metadata |
| `resources.containers` | equivalent | P6 | Docker images + registry login from `.env` |
| `resources.builds`, `resources.packages`, `resources.webhooks` | stub | P4 | Manifest warning; `getPackage`/`downloadBuild` steps become stubs unless configured |
| Pipeline decorators (org-injected steps) | unsupported | — | Invisible in YAML; README notes their absence |

## 3. Stages, jobs, steps

### Stages
`stage`, `displayName`, `dependsOn` (string/list/empty for parallel), `condition`, `variables`, `pool`, `jobs`, `templateContext` — all `exact` (P1/P2). `isSkippable`, `lockBehavior` → parsed, ignored.

### Jobs (`job`)
| Field | Tier | Notes |
|---|---|---|
| `dependsOn`, `condition` | exact | Graph built & cycle-checked at convert; conditions compiled (docs/02 §6) |
| `strategy.matrix` (incl. `maxParallel`) | exact | Expanded at convert time into N concrete jobs `Job_<key>`; matrix defined via runtime expression `$[ … ]` → convert-time evaluation with warning if it depends on prior-job outputs (degraded: prompts for value) |
| `strategy.parallel` (slicing) | degraded | N sequential slices with `System.JobPositionInPhase` / `System.TotalJobsInPhase` set |
| `continueOnError`, `timeoutInMinutes`, `cancelTimeoutInMinutes` | exact | Runtime enforced (docs/04) |
| `variables` | exact | §4 |
| `workspace.clean: outputs\|resources\|all` | exact | Runtime cleans per setting before job |
| `container`, `services` | equivalent | P6: Docker; workspace bind-mounted at identical paths so scripts are unchanged |
| `uses` (explicit repo/pool grants) | parsed, ignored | Permissions have no local meaning |
| `pool` | metadata | As top-level |

### Deployment jobs (`deployment`)
`equivalent` — `runOnce` lands in **P2** (structural: the priority Helm/K8s pipelines live in deployment jobs), `rolling`/`canary` in P4. `environment` (incl. `resourceType: virtualMachine|kubernetes`) → manifest note only (no environment registry locally). Strategies:
- `runOnce`: hooks `preDeploy → deploy → routeTraffic → postRouteTraffic`, then `on: success|failure` — executed in order, `exact` ordering.
- `rolling` / `canary`: hook sequence executed per iteration; `strategy.name`, `strategy.cycle`/`strategy.increment` variables populated; batching (`maxParallel` over VMs) collapses to sequential iterations — `degraded`, documented.
- Implicit behavior reproduced: deployment jobs **auto-download all `current` pipeline artifacts** before `deploy` unless `download: none`.
- Output variables from deployment jobs use the strategy-qualified naming quirk (`outputs['<lifecycle-hook>.<step>.<var>']`, plus job-name nuances between runOnce and matrix) — encode per docs and verify with the oracle (docs/06 §3).

### Steps — normalization table
Every shorthand normalizes to a canonical task invocation before task handlers run:

| Shorthand | Canonical | Notes |
|---|---|---|
| `script:` | `CmdLine@2` | On Linux target runs via bash-as-sh; on Windows target `cmd` semantics → degraded on Linux host (warning) |
| `bash:` | `Bash@3` (`targetType: inline`) | exact |
| `pwsh:` | `PowerShell@2` (`pwsh: true`) | exact if `pwsh` installed (doctor) |
| `powershell:` | `PowerShell@2` | Windows PowerShell → run under `pwsh` with warning (degraded) on non-Windows |
| `checkout:` | internal CheckoutStep | self / none / repo-alias / GitHub repo; options: `fetchDepth`, `fetchTags`, `lfs`, `submodules`, `path`, `clean`, `persistCredentials` (docs/04 §8) |
| `download:` / `downloadBuild:` / `getPackage:` | `DownloadPipelineArtifact@2` / `DownloadBuildArtifacts@1` / `DownloadPackage@1` | docs/03 |
| `publish:` | `PublishPipelineArtifact@1` | |
| `task:` | as-is | Inputs completed with `task.json` defaults & alias resolution (docs/03 §2) |
| `template:` | expanded by engine | docs/02 |
| `reviewApp:` | stub | |

Common step fields — all `exact`, enforced by the runtime: `name` (identifier for output vars), `displayName`, `condition`, `continueOnError`, `enabled`, `env`, `timeoutInMinutes`, `retryCountOnTaskFailure`, `workingDirectory`, `failOnStderr`, `target` (`host`/container name → P6; `commands: restricted` → parsed, ignored with note).

## 4. The variables system

### Declaration forms (all supported, P1; groups P3)
```yaml
variables:                 # mapping form
  key: value
variables:                 # list form — ORDER MATTERS and is preserved
  - name: a
    value: v
    readonly: true
  - group: my-vars         # variable group (Library)
  - template: vars.yml     # variables template (may take parameters)
```

### Scoping & precedence (exact)
Root → stage → job; inner scope wins on name collision; within one list, later entries override earlier. Step `env:` overlays the process environment only. Queue-time overrides = our `.env` / `--parameter` layer. `readonly` enforced by the runtime store (warning + ignore write, matching agent).

### The three syntaxes (full comparison — the core mental model)

| Syntax | Evaluated | Where allowed | Missing var behaves | Our implementation |
|---|---|---|---|---|
| `${{ variables.x }}` compile-time | During template expansion, before anything runs | Anywhere in YAML | Empty string | Evaluated at **convert time** (docs/02) |
| `$[ variables.x ]` runtime expression | At job dispatch, must be the **entire** RHS | Variable values, conditions | Empty string | Compiled to shell, evaluated at **job start** locally |
| `$(x)` macro | Just before a task executes; textual substitution in task inputs only | Task inputs (incl. inline script bodies), `env:` values | Left **literally** as `$(x)` | Runtime textual expansion in `run_step` (docs/04 §5) — unmatched left literal, same as agent |

Secrets: never auto-exported as environment variables (agent behavior) — available to `$(macro)` expansion and to explicit `env: MY_SECRET: $(mySecret)` mappings only. Our runtime reproduces this exactly; secret values come from `.env`.

Variable → env-var name transform (for non-secrets, applied at step env materialization): uppercase, `.` and space → `_` (`Build.SourceBranch` → `BUILD_SOURCEBRANCH`).

### Output variables (exact, P2)
- Producer: `##vso[task.setvariable variable=v;isoutput=true]val` in a step with `name: stepName`.
- Same job: `$(stepName.v)`.
- Other job: `dependencies.jobA.outputs['stepName.v']` (in `$[ ]` variable or condition).
- Other stage: `stageDependencies.stageA.jobA.outputs['stepName.v']`.
- Local store: `.work/state/outputs/<stage>/<job>/<step>.<var>` (docs/04 §4); compiled expressions read from it.

### Variable groups (P3)
Decision (2026-07-30): variable groups are **never value-resolved** — every `- group: X` maps to a documented block in `.env.example` that the user fills. When authenticated anyway (e.g. for remote templates), the converter lists the group's variable **names** inside that block (values always left empty); unauthenticated, it emits a placeholder block naming the group. Key Vault-backed groups behave the same. Secret-vs-plain flags recorded in the manifest drive log masking.

## 5. Predefined variables → local mapping

Workspace layout per run mirrors the agent (`_work/1` ≡ our `.work/run-<n>/<stage>/<job>`):

| Variable | Local value |
|---|---|
| `Pipeline.Workspace`, `Agent.BuildDirectory` | `<out>/.work/run-<n>/<stage>/<job>` |
| `Build.SourcesDirectory`, `System.DefaultWorkingDirectory`, `Build.Repository.LocalPath` | `<ws>/s` (multi-checkout: repos under `<ws>/s/<repoName>`, per agent rules) |
| `Build.ArtifactStagingDirectory`, `Build.StagingDirectory` | `<ws>/a` |
| `Build.BinariesDirectory` | `<ws>/b` |
| `Common.TestResultsDirectory` | `<ws>/TestResults` |
| `Agent.TempDirectory` | `<ws>/tmp` |
| `Agent.ToolsDirectory` | `~/.azdo-emu/tools` (shared tool cache, hosted-agent-style) |
| `Agent.OS` / `Agent.OSArchitecture` | From `--target-os` (default: host) → `Linux`/`Darwin`/`Windows_NT`, `X64`/`ARM64` |
| `Agent.JobName`, `Agent.Name`, `Agent.MachineName` | Job id / `azdo-emu-local` / hostname |
| `Build.BuildId`, `Build.BuildNumber` | Monotonic counter in `<out>/.work/.state/` + `name:` format evaluation |
| `Build.SourceBranch(Name)`, `Build.SourceVersion`, `Build.Repository.Name` | From the checked-out repo's git metadata; overridable in `.env` (e.g. simulate `refs/heads/main`) |
| `Build.Reason` | `Manual` (overridable — useful for testing reason-dependent conditions) |
| `System.TeamProject`, `System.CollectionUri`, `System.TeamFoundationCollectionUri` | From config (needed by scripts that call ADO REST) |
| `System.JobAttempt`, `System.StageAttempt`, `System.PhaseAttempt` | Retry counters maintained by runtime |
| `System.AccessToken` | Mapped to `.env` `SYSTEM_ACCESSTOKEN` (never embedded); README documents `az account get-access-token --resource 499b84ac-…` as one way to fill it |
| `System.Debug` | `.env`/flag; runtime honors it for `##[debug]` visibility |
| `System.PullRequest.*` | Empty by default; `.env`-overridable to simulate PR builds |

Full list in the official predefined-variables doc; anything not listed above is emitted with a sensible constant + manifest note. Unknown predefined references are a convert-time warning, not an error.

## 6. Semantic model (converter-internal)

```
Pipeline { name?, parameters[], variables: VarScope, stages[] , resources, provenance }
Stage    { id, displayName?, dependsOn[], condition?, variables, jobs[] }
Job      { id, kind: agent|server|deployment, matrixKey?, dependsOn[], condition?,
           variables, container?, services{}, workspace, timeout, steps[] }
Step     { id (ordinal), name?, displayName, task: {name, version}, inputs{},  // fully defaulted
           condition?, env{}, continueOnError, timeout, retryCount, workingDir?,
           fidelity, handler, provenance {file,line}, warnings[] }
```
Invariants after model build: no template/`${{ }}` remnants; every `task:` matched to a handler (or stub); matrix expanded; dependency graphs acyclic & references valid (missing `dependsOn` target = convert error, same as server); every referenced variable classified (inline / group / .env-required / predefined).

The model serializes to `manifest.json` (docs/04 §11) and drives both emission and `doctor`.
