# 03 — Task catalog & handler architecture

How individual tasks become script code. Source of truth for behavior: `microsoft/azure-pipelines-tasks` (each task's `task.json` + TypeScript implementation) and the tasks reference docs. Fidelity tiers per PLAN.md §6.

> **Re-scoped 2026-08-22 by E12-S02-T03 (PLAN D4 revised, docs/07 §5).** The per-task *transpiler*
> is dropped: we do not hand-write a bash emitter per task. Non-script tasks run their **real**
> implementation against an emulated `azure-pipelines-task-lib` (§6, promoted from "P6, opt-in" to
> the default) or **stub** (§4) — E07 owns both, and E07-S03-T01's disposition registry
> (`native | real-task | stub`) replaces the handler registry of §1. What stays live here: §2 input
> normalization (it feeds the `INPUT_*` materialization of E07-S01-T02), §4 unknown-task policy and
> user handlers (E07-S02), §5 service connections (E08), and §3 **as a prioritization and fidelity
> reference** — which tasks matter first, what their local equivalents are, and where the ambient-auth
> model applies. §1 and §3's "Strategy" column are archived as *transpilation* plans; nothing reads
> them as an emitter spec any more.
>
> **Phase labels here (`P2`, `P4`, `P5`, …) are the archived P0–P6 roadmap** (docs/06 §4), kept by
> number because committed changelog entries cite them; the live plan is PLAN §7's three phases
> (E12-S03-T01, 2026-08-22).

## 1. Handler architecture (converter-side) — **archived (E12-S02-T03)**

> Superseded by E07-S03-T01's **task disposition registry** (`name@major → native | real-task | stub`).
> No `TaskHandler`/`emit` interface is built: script steps are emitted natively by E05, everything
> else is dispatched to §6 or stubbed. The `EmittedStep` payload below is *not* dead, though — its
> four channels (script body, `envRequired`, `tools`, `warnings`) are still what a step contributes
> to `.env.example` (E05-S02-T01), `doctor`, and the generated README's warnings list
> (E05-S02-T02); they are produced per *disposition*, not per hand-written handler. Kept verbatim
> for that shape and for the record.

```ts
interface TaskHandler {
  matches: { name: string; majorVersions: number[] }[];   // e.g. { name: "DotNetCoreCLI", majorVersions: [2] }
  fidelity(step: NormalizedTask): Fidelity;               // may depend on inputs (e.g. command=publish vs custom)
  emit(step: NormalizedTask, ctx: EmitCtx): EmittedStep;
}
interface EmittedStep {
  body: string;                 // script template (may contain $(macros) — expanded at run time)
  envRequired: EnvRequirement[]; // → .env.example entries with provenance ("service connection 'x' used by …")
  tools: ToolRequirement[];     // → doctor checks, e.g. { cmd: "dotnet", min: "8.0" }
  warnings: Warning[];          // → README + step header
}
```

Handlers are pure: normalized inputs in, script text out — trivially unit-testable. Registry keyed by `Name@major` (task GUIDs also recognized, since YAML may reference tasks by GUID). *(Archived. The `Name@major` **keying** survives in E07-S03-T01's disposition registry — including GUID recognition, which the expansion makes unavoidable: the service rewrites `checkout`/`download` shortcuts to task GUIDs, C-E12-019/020.)*

## 2. Input normalization (before a task is dispatched) — **live**

> Unchanged by E12-S02-T03. Normalized inputs are what E07-S01-T02 turns into `INPUT_<NAME>` env for
> a real task, what a stub dumps (§4), and what the `connectedService:*` contract of §5 reads.

Per `task.json` of the referenced major version:
- **Defaults** applied for unspecified inputs; **aliases** resolved to canonical names; `required` enforced (convert error, server-style).
- Type handling: `boolean` (server's loose true/y/1 parsing), `filePath` (resolved against `System.DefaultWorkingDirectory` default), `multiLine`, `pickList` (validated), `connectedService:*` (→ `.env` contract, §5).
- Metadata source: a **pinned snapshot** of in-the-box `task.json`s vendored at converter build time from `microsoft/azure-pipelines-tasks`; marketplace tasks fetched per-org at convert time (`GET {org}/_apis/distributedtask/tasks` — docs/05) and cached. No metadata available → stub with raw inputs.
- Glob-type inputs (`projects`, `Contents`, …) use **minimatch** semantics. Runtime provides `azdo_match <pattern>…` implementing the minimatch subset used by tasks (`**`, `*`, `?`, `!` negation lines, `;`/newline multi-patterns) on bash `globstar` + filters; exotic patterns → warning (`degraded`).

## 3. The catalog — **reference, not an emitter spec (E12-S02-T03)**

> Retained for what it still decides: **which tasks matter first** (the group D priority below is a
> user decision, docs/06 §5 item 2), each task's **fidelity expectation**, its **tool prerequisites**
> for `doctor`, and the **ambient-auth model** the service-connection contract (§5) implements.
> The "Strategy" column is archived as a *transpilation* plan — under PLAN D4 (revised) these tasks
> run their real implementation (§6) or stub, so read a strategy as "what the task does and what it
> would need locally", never as "the bash we emit for it".

Grouped; **bold** = must-have for MVP-adjacent phases. "Strategy" describes what the task does locally *(archived as an emission plan — see the banner above)*.

Priority (decision 2026-07-30): **group D — the Azure/Kubernetes deployment set — lands in P4, before general toolchains** (group C → P5). Shell steps (`Bash`, `PowerShell`, `pwsh`) are already core in P2.

### A — Shell & pipeline-structure steps (P2, `exact`)
| Task | Strategy |
|---|---|
| **`CmdLine@2` / `script:`** | bash on Linux/macOS targets; Windows target on Linux host → run via bash with `degraded` warning (cmd built-ins flagged when detected) |
| **`Bash@3`** | inline → temp script; `filePath` → invoke file; honors `workingDirectory`, `failOnStderr`, `bashEnvValue` |
| **`PowerShell@2` / `pwsh:` / `powershell:`** | `pwsh` invocation; `errorActionPreference`, `failOnStderr`, `ignoreLASTEXITCODE` reproduced in a generated wrapper preamble |
| **`checkout:`** | docs/04 §8 (clone/copy from cache or origin; fetchDepth/lfs/submodules/path/clean) |
| **`publish:` / `PublishPipelineArtifact@1`**, `PublishBuildArtifacts@1` | copy to `<out>/.artifacts/<name>` (Container path semantics for build artifacts) |
| **`download:` / `DownloadPipelineArtifact@2`**, `DownloadBuildArtifacts@1` | from `.artifacts/` (current) or `.cache/artifacts/` (specific/resource; pinned at convert) into `$(Pipeline.Workspace)/<name>`; patterns honored |
| `DownloadSecureFile@1` | `.env` entry `SECUREFILE_<name>=/path/to/local/file`; sets `secureFilePath` output variable |

### B — Files & archives (P2, `exact`/`equivalent`)
| Task | Strategy |
|---|---|
| **`CopyFiles@2`** | `azdo_match` + `cp --parents` semantics incl. `CleanTargetFolder`, `OverWrite`, `flattenFolders` |
| `DeleteFiles@1` | `azdo_match` + `rm` |
| `ArchiveFiles@2` | `zip`/`tar` (+`7z` if requested & present); `replaceExistingArchive`, `includeRootFolder` |
| `ExtractFiles@1` | `unzip`/`tar` by extension |

### C — Toolchains & package managers (P5, `equivalent`)
| Task | Strategy |
|---|---|
| **`UseDotNet@2`** | official `dotnet-install.sh` into `Agent.ToolsDirectory`, PATH prepend, `global.json` support |
| **`DotNetCoreCLI@2`** | map `command`: restore/build/test (`--logger trx` + results copy)/publish (honors `publishWebProjects`, `zipAfterPublish`, `modifyOutputPath`)/pack/push (feed auth via env token)/custom |
| `NuGetToolInstaller@1`, `NuGetCommand@2` | `nuget`/`dotnet nuget` equivalents; restore/pack/push |
| `NuGetAuthenticate@1` | generate user-level `nuget.config` with credential from `SYSTEM_ACCESSTOKEN`/feed PAT in `.env` |
| **`NodeTool@0` / `UseNode@1`** | node dist download into tool cache, PATH prepend |
| **`Npm@1`** | install/ci/publish/custom; `.npmrc` auth from `.env` for private feeds |
| `UsePythonVersion@0` | locate via `python3.X` on PATH / pyenv / uv; PATH prepend; clear error if version absent (doctor) |
| `Maven@3/@4`, `Gradle@3` | `mvn`/`gradlew` invocation with options/goals mapping; JAVA_HOME handling via `JavaToolInstaller@0` (degraded: verifies from `.env`/system, does not install) |

### D — **Priority set**: containers, Azure & Kubernetes deployment (P4, `equivalent` with ambient-auth model)
| Task | Strategy |
|---|---|
| **`Docker@2`** | build/push/login/logout/buildAndPush → `docker` CLI; registry service connection → `.env` creds or "ambient" (already-logged-in daemon) per config |
| `DockerCompose@0` | `docker compose` mapping |
| **`AzureCLI@2`** | wrap inline/file script; auth modes: `ambient` (reuse current `az login`) or `sp` (`az login --service-principal` from `.env` service-connection block); `addSpnToEnvironment` reproduced |
| **`AzurePowerShell@5`** | `pwsh` + Az module; `Connect-AzAccount` ambient or SP from `.env` |
| `AzureWebApp@1`, `AzureRmWebAppDeployment@4`, `AzureFunctionApp@2` | degraded-equivalent: `az webapp deploy` / `az functionapp deployment` mappings; warnings for slot/takeover niceties |
| **`KubernetesManifest@1`**, **`Kubernetes@1`**, **`HelmDeploy@0`** | `kubectl`/`helm` against current kubeconfig context (or from `.env`); helm `install`/`upgrade`, `bake` action via helm/kustomize |
| `HelmInstaller@1`, `KubectlInstaller@0` | Pinned versions downloaded into `Agent.ToolsDirectory`, PATH prepend |
| **`AzureResourceManagerTemplateDeployment@3`** (+ legacy `AzureResourceGroupDeployment@2`) | Real-task mode. `deploymentOutputs` is **not** "an output variable": it is one variable per *leaf* of the outputs object (`out.region.type`, `out.region.value`) **plus** one holding the whole object, and every leaf is JSON-encoded unless `useWithoutJSON` — so a string output carries its quotes (C-E08-077) |
| **`AzureKeyVault@2`** | Real-task mode. Each secret becomes a variable named **exactly as the secret is named in the vault** — no prefix, no transform (C-E08-078). Its `prejobexecution` handler is not run here (C-E08-079), and disabled/expired secrets are filtered out server-side under `SecretsFilter: *` (C-E08-080) |
| **`AzureFileCopy@6`** | **Stub — it cannot run on this host.** It ships only a `PowerShell3` handler, whose contract is that the agent imports `VstsTaskSdk` from the task's `ps_modules` first (C-E08-076), and it is Windows-only regardless: the package contains `AzCopy.exe` and no other binary (C-E08-081). Use `az storage blob upload-batch` in a `script:` step |

### E — Build & test publishing (P5; Windows-native ones `degraded` on Linux)
| Task | Strategy |
|---|---|
| `VSBuild@1` / `MSBuild@1` | Windows target: pwsh emission (P5); on Linux host try `dotnet msbuild` with explicit `degraded` warning, else fail with note |
| `VSTest@2` | map to `dotnet vstest` where possible; otherwise degraded warning |
| **`PublishTestResults@2`** | copy result files to `<out>/.results/<job>/`; parse JUnit/TRX/xUnit counts → console summary + run summary table; nonzero-fail if `failTaskOnFailedTests` |
| `PublishCodeCoverageResults@2` | copy + summary line |

### F — Flow, server tasks (`pool: server`), misc (P4–P5)
| Task | Strategy |
|---|---|
| `ManualValidation@0` | interactive terminal prompt (instructions shown); `--non-interactive` → auto-resume or fail per `onTimeout` |
| `Delay@1` | `sleep` |
| `InvokeRESTAPI@1` | `curl` with connection URL/auth from `.env` |
| **`Cache@2`** | local content-addressed cache under `~/.azdo-emu/cache`, key hashing per docs (parts, file-hash segments), restore→run→save semantics incl. `cacheHitVar` |
| `PublishSymbols@2`, `ManifestGeneratorTask`, governance/compliance tasks | stub |

### G — Popular marketplace (P5, best-effort)
| Task | Strategy |
|---|---|
| **`replacetokens@5/@6`** (qetza) | reimplement token replacement (patterns, targets, missing-var actions) — `equivalent` |
| `SonarQubePrepare/Analyze/Publish`, `SonarCloud*` | stub by default; optional passthrough to locally installed `sonar-scanner` |
| `gitversion/setup+execute` (GitTools) | run `dotnet-gitversion` if installed, else stub |
| Others | unknown-task policy (§4) |

## 4. Unknown-task policy & user handlers — **live**

**Order of resolution (E07-S03-T01, revised 2026-08-22 by E12-S02-T03):** a task is `native` (its
handler is a plain script → the E05 script path), else **real-task mode** (§6), else — package
unavailable, no metadata, or `tasks.overrides` says so — **stub**. "Unknown" below is therefore the
*fallback* case, not the default for every non-script task.

Stub behavior: the step logs `##[warning] Task 'X@n' was stubbed — no runnable implementation locally` (reworded by E12-S02-T03: "no local handler" was transpiler-era vocabulary, and under real-task mode the reason is a missing *package*, not a missing handler), dumps its fully resolved inputs as JSON to the log, result per config (`skip` default / `fail` / `prompt`).

Drop-in escape hatch: before stubbing, the runtime looks for an executable at `<out>/handlers/<TaskName>@<major>` (and `~/.azdo-emu/handlers/…`). It is invoked with the **real task-lib env contract**: inputs as `INPUT_<UPPERCASENAME>`, endpoint data as `ENDPOINT_*` from `.env`, standard `##vso` output honored. A handler written for us is therefore shaped like a real task — and real-task knowledge transfers.

## 5. Service connections (`connectedService:*` inputs) — **live** (E08)

Never resolvable via API by design → structured `.env` contract per connection, generated from usage.

**Corrected 2026-09-04 (E08-S02-T04).** The `AzureKeyVault@2` row above used to promise
`KV_<vault>_<secret>` entries from `.env`, and an "ambient mode" that shelled out to
`az keyvault secret list/show`. Both were transpiler-era: under real-task mode (PLAN D4) the task
runs its own implementation, and that implementation calls `setVariable(secretName, …)` with **no
transform at all** (C-E08-078). A `KV_`-prefixed key would be read by nobody — the same error, in
the same place, as the `SC_<NAME>_*` keys corrected below. Recorded as decisions record entry 81.

**Corrected 2026-09-02 (E08-S01-T01/T02).** The `SC_<NAME>_*` keys this section used to show were
transpiler-era: under the old design *our own* generated bash read them. Under real-task mode
(PLAN D4) the **real task** reads the connection, through `azure-pipelines-task-lib`, under names we
do not get to choose (C-E08-001) — so an `SC_*` key would be read by nobody. The credential keys are
therefore task-lib's own:

```dotenv
# ── Service connection 'my-azure-sub' · mode: ambient ────────
# used by: 030-deploy.sh
# Ambient mode reuses the session you already have — `az login`, `docker login`, your kubeconfig.
ENDPOINT_DATA_my-azure-sub_SUBSCRIPTIONID=
ENDPOINT_DATA_my-azure-sub_ENVIRONMENT=
# …and under `mode: sp`, additionally:
ENDPOINT_AUTH_SCHEME_my-azure-sub=
ENDPOINT_AUTH_PARAMETER_my-azure-sub_SERVICEPRINCIPALID=
ENDPOINT_AUTH_PARAMETER_my-azure-sub_TENANTID=
ENDPOINT_AUTH_PARAMETER_my-azure-sub_SERVICEPRINCIPALKEY=      # secret
```

Two details are not free choices: the **key** is upper-cased while the **connection name is used
verbatim**, case and all (C-E08-001); and `ENDPOINT_AUTH_*` is vaulted and deleted from
`process.env` by task-lib while `ENDPOINT_DATA_*` is not (C-E08-002), which is what decides the
secret markers.

The one key that stays ours is the mode, because a mode is not an endpoint field:
`AZDO_SC_<NAME>_MODE`, defaulting to `ambient`, with the name folded the way every other variable
name is (dots and spaces to underscores, upper-cased — C-E06-008).

Runtime helper `azdo_sc_login <name> <kind>` implements the mode switch once; handlers call it. It
authenticates and *then* selects the subscription, mirroring `AzureCLIV2` (C-E08-010).

## 6. Real-task execution mode — **the default path for non-script tasks (E07-S01)**

> **Promoted 2026-08-22 by E12-S02-T03** from "P6, opt-in" (PLAN D3's deferred high-fidelity mode) to
> the default disposition for every task that is not a script step, per PLAN D4 (revised) and
> docs/07 §5 phase 2. There is no allowlist to opt into any more: the old `tasks.execute` config key
> was the transpiler-era shape (real-task mode as the exception) and was removed with this task.
> Opting *out* stays possible per task via `tasks.overrides: { "Name@major": skip|stub|fail }`.
> Cost, stated plainly: this is the one mode that adds a **run-time Node dependency**, and the
> generated README must say so (E05-S02-T02) — `doctor` checks it (E10-S03).

For every non-script task (and especially where a hand-written equivalent would be lossy — complex marketplace tasks, `DotNetCoreCLI` edge behaviors): download the **real task package** (in-the-box tasks are MIT; per-org fetch `GET {org}/_apis/distributedtask/tasks/{id}/{version}` returns the zip) and execute its Node target with an emulated agent host: `INPUT_*`/`ENDPOINT_*`/`SECRET_*` env, `azure-pipelines-task-lib` command protocol on stdout (which our `##vso` parser already speaks), tool cache pointed at `Agent.ToolsDirectory`. Requires Node at run time — the only mode that adds a runtime dependency, clearly marked in the generated README.
