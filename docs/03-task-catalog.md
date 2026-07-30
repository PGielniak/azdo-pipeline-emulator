# 03 — Task catalog & handler architecture

How individual tasks become script code. Source of truth for behavior: `microsoft/azure-pipelines-tasks` (each task's `task.json` + TypeScript implementation) and the tasks reference docs. Fidelity tiers per PLAN.md §6.

## 1. Handler architecture (converter-side)

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

Handlers are pure: normalized inputs in, script text out — trivially unit-testable. Registry keyed by `Name@major` (task GUIDs also recognized, since YAML may reference tasks by GUID).

## 2. Input normalization (before handlers run)

Per `task.json` of the referenced major version:
- **Defaults** applied for unspecified inputs; **aliases** resolved to canonical names; `required` enforced (convert error, server-style).
- Type handling: `boolean` (server's loose true/y/1 parsing), `filePath` (resolved against `System.DefaultWorkingDirectory` default), `multiLine`, `pickList` (validated), `connectedService:*` (→ `.env` contract, §5).
- Metadata source: a **pinned snapshot** of in-the-box `task.json`s vendored at converter build time from `microsoft/azure-pipelines-tasks`; marketplace tasks fetched per-org at convert time (`GET {org}/_apis/distributedtask/tasks` — docs/05) and cached. No metadata available → stub with raw inputs.
- Glob-type inputs (`projects`, `Contents`, …) use **minimatch** semantics. Runtime provides `azdo_match <pattern>…` implementing the minimatch subset used by tasks (`**`, `*`, `?`, `!` negation lines, `;`/newline multi-patterns) on bash `globstar` + filters; exotic patterns → warning (`degraded`).

## 3. The catalog

Grouped; **bold** = must-have for MVP-adjacent phases. "Strategy" describes the emitted script.

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
| **`AzureResourceManagerTemplateDeployment@3`** (+ legacy `AzureResourceGroupDeployment@2`) | `az deployment group create` for ARM & Bicep; `deploymentMode` Incremental/Complete/Validate; `deploymentOutputs` JSON parsed into an output variable via the store |
| **`AzureKeyVault@2`** | Two modes: **ambient** — `az keyvault secret list/show` pulls real values into local **secret** variables (`equivalent`); **offline** — `KV_<vault>_<secret>` entries from `.env`; `secretsFilter`/`runAsPreJob` honored |
| **`AzureFileCopy@6`** | `azcopy` to blob/file share, ambient or SAS auth from `.env` (doctor checks `azcopy`); storage-account operations written as `AzureCLI` steps (`az storage …`) are covered by the AzureCLI handler |

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

## 4. Unknown-task policy & user handlers

Default: **stub** — the step logs `##[warning] Task 'X@n' has no local handler`, dumps its fully resolved inputs as JSON to the log, result per config (`skip` default / `fail` / `prompt`).

Drop-in escape hatch: before stubbing, the runtime looks for an executable at `<out>/handlers/<TaskName>@<major>` (and `~/.azdo-emu/handlers/…`). It is invoked with the **real task-lib env contract**: inputs as `INPUT_<UPPERCASENAME>`, endpoint data as `ENDPOINT_*` from `.env`, standard `##vso` output honored. A handler written for us is therefore shaped like a real task — and real-task knowledge transfers.

## 5. Service connections (`connectedService:*` inputs)

Never resolvable via API by design → structured `.env` contract per connection, generated from usage:

```dotenv
# -- Service connection 'my-azure-sub' (AzureRM) — used by: AzureCLI@2 "Deploy" (Deploy/DeployJob/030)
SC_MY_AZURE_SUB_MODE=ambient            # ambient = reuse your `az login` | sp = service principal below
SC_MY_AZURE_SUB_SUBSCRIPTION_ID=
SC_MY_AZURE_SUB_TENANT_ID=
SC_MY_AZURE_SUB_CLIENT_ID=
SC_MY_AZURE_SUB_CLIENT_SECRET=
```

Runtime helper `azdo_sc_login <name> <kind>` implements the mode switch once; handlers call it.

## 6. High-fidelity execution mode (P6, opt-in)

For tasks where transpilation is lossy (complex marketplace tasks, `DotNetCoreCLI` edge behaviors): download the **real task package** (in-the-box tasks are MIT; per-org fetch `GET {org}/_apis/distributedtask/tasks/{id}/{version}` returns the zip) and execute its Node target with an emulated agent host: `INPUT_*`/`ENDPOINT_*`/`SECRET_*` env, `azure-pipelines-task-lib` command protocol on stdout (which our `##vso` parser already speaks), tool cache pointed at `Agent.ToolsDirectory`. Per-task opt-in via config (`tasks.execute: ["Npm@1"]`). Requires Node at run time — the only mode that adds a runtime dependency, clearly marked in the generated README.
