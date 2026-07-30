# azdo-pipeline-emulator — Master Plan

Status: **Design / planning** · Date: 2026-07-29 · Working CLI name: `azdo-emu`

## 1. Problem & vision

Debugging Azure DevOps YAML pipelines today means: edit YAML → push → queue → wait → read logs → repeat. There is no official way to run a pipeline locally (the template expansion happens server-side, and tasks assume a hosted agent).

**Vision:** a converter that takes any Azure DevOps pipeline YAML and emits a **self-contained local project of plain scripts** that reproduces the pipeline's behavior step by step:

```
azdo-emu convert azure-pipelines.yml -o ./local-run
cd local-run && cp .env.example .env   # fill in secrets/service-connection creds
./run.sh                               # or run one stage / job / single step
```

The generated project:

- mirrors the pipeline structure (stages → jobs → steps) as individual scripts, so any single step can be re-run in isolation with the exact same environment;
- ships a small runtime library that emulates the agent contract: variable store, `$(macro)` expansion, `##vso[...]` logging commands, conditions, `dependsOn`, artifacts, predefined variables and the agent folder layout;
- resolves **templates** (including templates in other repos via `resources.repositories`), **pipeline artifacts** from other pipelines, and **multi-repo checkouts** — fetched at convert time using **Azure DevOps interactive sign-in** and/or **GitHub auth**;
- contains **no secrets**: everything unresolvable (variable-group secrets, service connections, `System.AccessToken`, secure files) becomes a documented entry in `.env.example`;
- has **zero runtime dependency on the converter** — it is bash (later also pwsh) + standard tools, readable and hand-editable, because readability is the point of debugging.

## 2. Goals

1. Parse the full Azure Pipelines YAML schema as documented in the official schema reference; validate against the official JSON schema.
2. Reimplement the server-side **template engine** and **expression language** (`${{ }}`, `$[ ]`, `$( )`) with parity verified against the real service (see §6, "oracle testing").
3. Cover the most frequently used tasks with an explicit **fidelity tier** per task — prioritized (decision 2026-07-30) on the **deployment set**: `AzurePowerShell`, `PowerShell`/`Bash`, `AzureCLI`, Docker build/push, Helm install/deploy, Kubernetes actions, Azure resource-group (ARM/Bicep) deployment, Key Vault and storage-account operations — followed by toolchains (`DotNetCoreCLI`, `Npm`, `Maven`), test publishing and top marketplace tasks (`replacetokens`).
4. Resolve remote inputs at convert time: templates from other ADO/GitHub repos, multi-repo `checkout`, artifacts from `resources.pipelines`, marketplace `task.json` metadata — with a lockfile for reproducible regeneration. Variable groups are mapped to `.env` (names listed when signed in; values always user-filled).
5. Emit a debuggable project: per-step scripts with provenance comments (original file:line), `pipeline.expanded.yml` (the fully resolved YAML), a manifest of the stage/job graph, a README listing every warning and unsupported construct, and `.env.example`.
6. Same-behavior local execution: dependency ordering, conditions evaluated at run time against actual job/step results, output variables across jobs and stages, `continueOnError`, `failOnStderr`, timeouts, matrix expansion, artifact publish/download flow.
7. **A coverage report per conversion**: every generated project states what % of the original pipeline it reproduces (weighted by fidelity tier), with a ranked gap list and remediation hints (docs/04 §13).

## 3. Non-goals

- Triggers, schedules, PR policies, approvals/checks/gates, environment protection — parsed, recorded in the manifest, **not executed** (ManualValidation becomes an interactive prompt).
- Extracting secrets from Azure DevOps (not possible via API by design) — they go to `.env`.
- Pipeline decorators, classic (designer) pipelines, billing/parallelism semantics.
- Perfect replication of Microsoft-hosted images — instead: a `doctor` command checks required tools, and an optional container mode runs jobs in Docker.
- Being an agent that reports back to Azure DevOps. This is strictly local.
- Azure DevOps Server (on-prem): **out of scope** (decision 2026-07-30). Nothing in the architecture blocks it — PAT auth + adjusted URL shapes would be the entry point if that ever changes.
- Windows **host** execution for now — deferred, not dropped (decision 2026-07-30): the emitter keeps a per-job target-OS backend seam so a native pwsh emission set bolts on later (roadmap "Future"). `PowerShell`/`AzurePowerShell` steps already run on Linux/macOS via `pwsh` from P2/P4.

## 4. Architecture

```
                         ┌───────────────────────── convert time ─────────────────────────┐
 azure-pipelines.yml     │                                                                │
 templates @self     ──► │ Loader/Fetcher ─► YAML Front End ─► Template Engine ─► Semantic│
 templates @repo     ──► │  (FS, ADO Git,     (yaml lib,         (${{ }}, if/each/        │
 resources.pipelines ──► │   GitHub, cache,    source maps,       insert, extends,        │
 task.json metadata  ──► │   lockfile)         schema check)      parameters)             │
                         │        ▲                                     │                 │
                         │        │                                     ▼                 │
                         │   Auth (ADO device-code / az / PAT,    Semantic Model          │
                         │         GitHub gh / PAT)               (normalize steps,       │
                         │                                         matrix, deps graph,    │
                         │                                         variable scopes)       │
                         │                                              │                 │
                         │                    Task Handler Registry ◄───┤                 │
                         │                    (per-task emitters)       ▼                 │
                         │                                          Emitter ──────────────┼──► out/
                         └────────────────────────────────────────────────────────────────┘
                          out/ = run.sh + stages/**/jobs/**/steps/*.sh + lib/runtime.sh
                                + .env.example + pipeline.expanded.yml + manifest.json + README
                         ┌────────────────────────── run time ────────────────────────────┐
                         │ run.sh ─► topological job order ─► run_step(): condition eval, │
                         │ env materialization, $(macro) expansion, exec, ##vso parsing,  │
                         │ var store / outputs / artifacts / results persistence          │
                         └────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Detail doc |
|---|---|---|
| Loader/Fetcher | Resolve file references: local FS, `templates@repoAlias` (ADO Git REST, GitHub), artifact downloads; content-addressed cache + `azdo-emu.lock.json` | [docs/05](docs/05-fetching-and-auth.md) |
| YAML Front End | Parse YAML with source positions, validate against official schema, produce raw DOM (expressions still inert strings) | [docs/01](docs/01-pipeline-model-and-schema.md) |
| Template Engine | Expand includes/`extends`, bind typed parameters, evaluate compile-time `${{ }}` incl. `if/elseif/else`, `each`, `insert`; enforce server limits; emit `pipeline.expanded.yml` + provenance map | [docs/02](docs/02-template-and-expression-engine.md) |
| Expression Compiler | One AST for the ADO expression language, two backends: evaluate now (compile time) or compile to bash/pwsh predicates (runtime conditions, `$[ ]`) | [docs/02](docs/02-template-and-expression-engine.md) |
| Semantic Model | Typed pipeline model: shorthand steps normalized to canonical tasks with `task.json` defaults applied, matrix expanded, dependency graph validated, variable scoping resolved | [docs/01](docs/01-pipeline-model-and-schema.md) |
| Task Handler Registry | Plugin per task (`Name@major`) that emits script body + env requirements + tool prereqs + fidelity warnings; stub policy for unknown tasks; user-supplied handlers | [docs/03](docs/03-task-catalog.md) |
| Emitter | Generate the output project: scripts, runtime lib, `.env.example` synthesis, manifest, README with warnings table | [docs/04](docs/04-generated-project-and-runtime.md) |
| Runtime lib (generated) | `lib/runtime.sh`: step lifecycle, variable store, logging-command parser, artifacts, checkout, secret masking | [docs/04](docs/04-generated-project-and-runtime.md) |
| Auth & REST clients | ADO Entra device-code / `az` token reuse / PAT; GitHub `gh` reuse / PAT; ADO Git, Pipelines, Build, DistributedTask APIs | [docs/05](docs/05-fetching-and-auth.md) |
| CLI, config, doctor | `convert`, `auth`, `doctor`, `fetch-artifacts`, `preview-diff`; project config file | [docs/06](docs/06-cli-testing-roadmap.md) |
| Parity harness (dev) | Golden tests + **server oracle**: the real `pipelines/{id}/preview` REST endpoint returns the service's final expanded YAML for comparison | [docs/06](docs/06-cli-testing-roadmap.md) |

## 5. Key design decisions

**D1 — Converter in TypeScript / Node ≥ 22.**
The entire in-the-box task ecosystem (`microsoft/azure-pipelines-tasks`, `azure-pipelines-task-lib`) is Node, which unlocks the later high-fidelity mode (D3) and lets us reuse input-parsing conventions. The `yaml` package exposes a CST for precise source maps (error messages and provenance comments need file:line). MSAL handles device-code sign-in. Distribution: npm package + optional single-binary build. *Alternatives:* Go (nicer binary, but re-implements everything, no task-lib synergy), Python (weaker typing for a large object model).

**D2 — Generated output is dependency-free bash (pwsh emission later), never calls back into the converter to run.**
The user must be able to read, edit and re-run any step script without our tool installed. Runtime = bash ≥ 4 + coreutils + git (+ whatever the pipeline itself needs: dotnet, docker…). Only optional refresh helpers (`fetch-artifacts.sh`) shell out to `azdo-emu` if present.

**D3 — Transpile-first; optional "high-fidelity task execution" mode later.**
Default: each task is *transpiled* to a readable script (this is what makes local debugging pleasant). Phase 6 adds an opt-in mode that downloads the real task package (they are Node programs, fetchable per org via the DistributedTask REST API) and executes it with an emulated `azure-pipelines-task-lib` host (`INPUT_*` env contract) for near-perfect parity on complex tasks. Both modes share the same runtime contract.

**D4 — Expressions are compiled, not interpreted at run time.**
Compile-time `${{ }}` is evaluated during conversion. Runtime constructs — step/job/stage `condition:`, `$[ ]` variable values, `dependencies.*.outputs` — are compiled by the converter into small bash functions that read the local state store. No expression interpreter ships in the output, yet conditions still react to actual local results. Macro `$( )` stays textual and is expanded by the runtime just before each step, exactly like the agent does (unmatched macros stay literal — same observable behavior as the real agent).

**D5 — Fetch at convert time, cache, and lock.**
Remote templates, repos, artifacts and task metadata are downloaded during `convert` into `.cache/` and pinned (commit SHAs, run IDs) in `azdo-emu.lock.json`. Re-converting with `--frozen` is fully offline and reproducible. Generated `fetch-artifacts.sh` allows refreshing artifacts without re-converting.

**D6 — Parity oracle = the real service.**
Azure DevOps' template expansion is closed source, so we verify instead of guessing: the REST *preview* endpoint (`POST …/_apis/pipelines/{pipelineId}/preview`, `previewRun: true`, with `yamlOverride`) returns the service's **final YAML** without running anything. A `preview-diff` command diffs our expansion against it; CI runs it nightly over a fixture corpus against a test org. Where docs are ambiguous (e.g. compile-time variable visibility inside templates), the oracle decides.

**D7 — Task support is a plugin registry with explicit fidelity tiers.**
Every construct/task gets one of: `exact` / `equivalent` / `degraded` / `stub` / `unsupported` (defined in §6). The generated README and step headers state the tier, so the user always knows what to trust. Unknown marketplace tasks become stubs that dump their resolved inputs; users can drop a script into `handlers/` (receiving `INPUT_*` env vars, same convention as real tasks) to implement them without touching the converter.

**D8 — Hard secret boundary: everything secret goes through `.env`.**
The converter never writes tokens, variable-group secret values, or service-connection credentials into scripts, YAML dumps, logs or the lockfile. `.env.example` documents each required entry with its origin (which variable group, which task, which service connection) and how to obtain it. The generated project gets its own `.gitignore` (`.env`, `.work/`, `.artifacts/`, `.cache/`).

**D9 — Faithful workspace semantics by default.**
Each job gets its own `Pipeline.Workspace` (fresh `s/`, `a/`, `b/` folders, own checkout) because that's how agents behave and it surfaces real bugs (e.g. relying on a previous job's files without artifacts). `--shared-workspace` exists for speed. A shared tool cache (`~/.azdo-emu/tools`) emulates `Agent.ToolsDirectory` for `UseDotNet`/`NodeTool` installers.

**D10 — Every conversion is measured: the coverage report.**
`convert` always emits `coverage.md` + `coverage.json` quantifying how much of the original pipeline the generated project reproduces: % of steps weighted by fidelity tier (§6), per-stage/job breakdown, ranked gap list with concrete remediation hints. `--min-coverage N` turns it into a gate. Spec: docs/04 §13.

## 6. Fidelity tiers (used everywhere; basis of the coverage metric)

| Tier | Coverage weight | Meaning | Example |
|---|---|---|---|
| `exact` | 1.0 | Same observable behavior as the hosted agent | `bash` step, `$(macro)` expansion, `task.setvariable` |
| `equivalent` | 1.0 | Same outcome via equivalent local commands | `HelmDeploy@0` → `helm`, `AzureCLI@2` with ambient `az login` |
| `degraded` | 0.5 | Meaningful local approximation, documented deltas | `PublishTestResults@2` → copy + console summary; Windows batch steps on Linux |
| `stub` | 0 | Logs inputs, does nothing; configurable skip/fail/prompt | SonarQube tasks, unknown marketplace tasks |
| `unsupported` | 0 | Convert-time error or explicit runtime failure with remediation note | pipeline decorators, YAML anchors (match server behavior) |

The weights feed the per-pipeline coverage report (D10, docs/04 §13).

## 7. Roadmap summary

Sizes: S ≈ 1–2 weeks, M ≈ 3–4, L ≈ 5–8 (single developer). Details & exit criteria: [docs/06](docs/06-cli-testing-roadmap.md).

| Phase | Size | Deliverable |
|---|---|---|
| P0 Foundations | S | CLI skeleton, YAML front end with source maps + schema validation, `pipeline.expanded.yml` dump for template-free files, preview-oracle harness |
| P1 Core engine | L | Expression evaluator, template expansion (local files), typed parameters, variables model, matrix, dependency graph — oracle-green on corpus |
| P2 Script emission (MVP) | L | Emitter + bash runtime lib, core steps (script/bash/pwsh/powershell, checkout self, publish/download, file ops), deployment jobs (`runOnce`), predefined vars, `.env.example`, manifest, **coverage report**, README — a real single-repo Linux pipeline runs locally |
| P3 Fetchers & auth | M | ADO device-code + `az`/PAT, GitHub, cross-repo templates, multi-repo checkout, variable groups → `.env`, artifact download, lockfile |
| P4 **Priority deployment tasks** | L | The decided priority set: `AzurePowerShell`, `AzureCLI`, Docker build/push, Helm installer+deploy, kubectl/`KubernetesManifest`, ARM/Bicep resource-group deployment, `AzureKeyVault`, `AzureFileCopy`/storage ops; service-connection `.env` contract; `rolling`/`canary` strategies; `doctor`; unknown-task stubs + user handlers |
| P5 Task breadth | M | Toolchains (`UseDotNet`/`DotNetCoreCLI`, Node/`Npm`, Python, Maven/Gradle), feed auth, test/coverage publishing, `Cache@2`, `replacetokens`, stub set |
| P6 Fidelity & DX | M | Real-task execution mode (D3), container jobs & service sidecars via Docker, parallel jobs & slicing, `--shell-at` debug shell, secret masking polish |
| Future — Windows host | M | Native pwsh emission set for Windows-targeted jobs on a Windows host, cmd semantics (deferred by decision 2026-07-30; emitter backend seam reserved) |

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Parity drift with server-side expansion (closed source, evolving) | Oracle CI against real preview API (D6); agent source as behavior reference; pinned schema snapshots |
| Undocumented behaviors (variable visibility in templates, coercion edge cases) | Table-driven tests generated from oracle answers; mark known ambiguities in docs/02 |
| Secrets & service connections fundamentally unobtainable | `.env` contract (D8) with per-entry provenance and instructions; ambient-CLI auth mode for `az`/`docker`/`kubectl` |
| Windows-targeted pipelines on a Linux host | `--target-os` awareness, pwsh where possible, explicit `degraded` warnings, container mode |
| Marketplace long tail | Stub + inputs dump + user handler drop-in (D7); org-level `task.json` fetch for input defaults |
| Hosted images have tools preinstalled that the laptop lacks | `doctor` checks per generated project; optional Docker job mode |
| Scope explosion toward "reimplement the whole agent" | Fidelity tiers make partial support explicit; non-goals list; phased roadmap |
| Licensing | Everything we depend on (agent, tasks, task-lib, schema) is MIT; we do not redistribute marketplace binaries, we fetch them per-org with the user's own auth |

## 9. Grounding in official references

The parsing engine and runtime are built **from the official references**, per area:

- YAML schema: learn.microsoft.com/azure/devops/pipelines/yaml-schema/ + machine-readable schema from the `microsoft/azure-pipelines-vscode` repo and per-org `GET {org}/_apis/distributedtask/yamlschema` (includes installed marketplace task input schemas).
- Expressions & conditions: learn.microsoft.com/azure/devops/pipelines/process/expressions (+ the C# Expressions SDK inside `microsoft/azure-pipelines-agent` as behavioral reference).
- Templates: …/process/templates; runtime parameters: …/process/runtime-parameters.
- Variables & predefined variables: …/process/variables, …/build/variables.
- Logging commands (`##vso`): …/scripts/logging-commands.
- Tasks: reference docs at …/pipelines/tasks/reference/ and **source of truth** `microsoft/azure-pipelines-tasks` (each task's `task.json` for inputs/defaults/aliases, `.ts` for behavior).
- Agent behavior (folder layout, step lifecycle, handlers): `microsoft/azure-pipelines-agent`, `microsoft/azure-pipelines-task-lib`.
- REST: learn.microsoft.com/rest/api/azure/devops/ (Git items, Pipelines runs/artifacts/preview, Build, DistributedTask variable groups & tasks). Entra resource for ADO tokens: `499b84ac-1321-427f-aa17-267ca6975798`.
- Hosted image contents (for `doctor` expectations): `actions/runner-images`.

Exact `api-version`s and numeric server limits are re-verified against live docs at implementation time (flagged inline in the detail docs).

## 10. Document index

1. [docs/01-pipeline-model-and-schema.md](docs/01-pipeline-model-and-schema.md) — schema coverage matrix, variables system, predefined variables → local mapping
2. [docs/02-template-and-expression-engine.md](docs/02-template-and-expression-engine.md) — expansion algorithm, expression grammar/functions, compilation to shell, oracle
3. [docs/03-task-catalog.md](docs/03-task-catalog.md) — task-by-task emulation strategy, handler plugin API, unknown-task policy
4. [docs/04-generated-project-and-runtime.md](docs/04-generated-project-and-runtime.md) — output layout, runtime spec, logging commands, artifacts, `.env`, debugging UX
5. [docs/05-fetching-and-auth.md](docs/05-fetching-and-auth.md) — sign-in flows, REST endpoints, caching & lockfile, security
6. [docs/06-cli-testing-roadmap.md](docs/06-cli-testing-roadmap.md) — CLI/config, testing strategy, detailed phases, open questions
