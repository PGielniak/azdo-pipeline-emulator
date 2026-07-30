# E11 — Task breadth (groups C, E, F, G)

Phase: P5 · Depends on: E09 · Design: docs/03 groups C/E/F/G
Primary grounding set: same regime as E09/E10 — per task: pinned `task.json` + implementation source from `microsoft/azure-pipelines-tasks` + reference page; vendor CLI docs for emitted commands. E09's input-table rule applies to every handler task below.

## E11-S01 — As a pipeline developer, toolchain installers and package-manager tasks work, so build pipelines (dotnet/node/python/java) convert fully.
- [ ] **E11-S01-T01 — `UseDotNet@2`**
  **Do:** dotnet-install into `Agent.ToolsDirectory`, PATH prepend, `useGlobalJson`, `packageType` sdk/runtime, version wildcards.
  **Ground:** `Tasks/UseDotNetV2` source (pin: version resolution against releases.json, install-script usage) + dotnet-install script docs (learn.microsoft.com/dotnet/core/tools/dotnet-install-script, pin); wildcard resolution claims from source.
  **Done:** bats: pinned + wildcard versions install to tool cache; global.json path.
- [ ] **E11-S01-T02 — `DotNetCoreCLI@2`**
  **Do:** command matrix restore/build/test/publish/pack/push/custom; test logger + results copy; publish behaviors (`publishWebProjects`, `zipAfterPublish`, `modifyOutputPath`) reproduced from source logic.
  **Ground:** `Tasks/DotNetCoreCLIV2` source — pin each command's argument assembly (publish zip logic especially; copy the rules, don't guess); reference page.
  **Done:** bats per command on a fixture solution; publish output layout byte-compared with a real run's artifact.
- [ ] **E11-S01-T03 — `NodeTool@0`/`UseNode@1`, `Npm@1`**
  **Ground:** task sources pinned (Node dist URL resolution; Npm auth `.npmrc` writing from `Tasks/Common` npm auth module — pin) + reference pages.
  **Done:** bats: node version switch; npm ci/install/custom; private-feed auth via `.env` token writes correct `.npmrc` (compared to pinned module's format).
- [ ] **E11-S01-T04 — `UsePythonVersion@0`**
  **Ground:** source pinned (tool-cache lookup semantics, `PYTHON_VERSION` outputs, PATH additions).
  **Done:** bats with preinstalled python; clear missing-version error + doctor rule.
- [ ] **E11-S01-T05 — `Maven@4`, `Gradle@3`, `JavaToolInstaller@0` (degraded)**
  **Ground:** task sources pinned (goal/option assembly, JAVA_HOME handling); documented deltas for code-analysis sub-features (claims).
  **Done:** bats arg snapshots; fixture builds run.
- [ ] **E11-S01-T06 — `NuGetToolInstaller@1`, `NuGetCommand@2`, `NuGetAuthenticate@1`**
  **Ground:** sources pinned (restore/pack/push arg assembly; NuGetAuthenticate's nuget.config credential injection format — copy exactly).
  **Done:** bats; private-feed restore against ADO feed using `.env` token (live check).

## E11-S02 — As a pipeline developer, test/report tasks degrade gracefully with honest output, so CI-ish feedback exists locally.
- [ ] **E11-S02-T01 — `PublishTestResults@2` (degraded)**
  **Do:** results copy + parsed console summary (JUnit/TRX/xUnit counts), `failTaskOnFailedTests`.
  **Ground:** task.json (supported formats list — quote) + source for merge/failure semantics; delta claims for what we don't render.
  **Done:** bats per format with fixture files; failure gate works.
- [ ] **E11-S02-T02 — `PublishCodeCoverageResults@2` (degraded)**, **`VSBuild@1`/`MSBuild@1`/`VSTest@2` (degraded on Linux)**
  **Ground:** task.jsons + sources pinned; Linux mapping claims (`dotnet msbuild`/`dotnet vstest` capabilities) from Microsoft docs pages (pin); explicit unsupported paths → coverage gaps.
  **Done:** bats happy-path + explicit-failure snapshots; gap text reviewed.

## E11-S03 — As a pipeline developer, flow/server tasks and caching behave sensibly, so full pipelines run without manual skips.
- [ ] **E11-S03-T01 — `ManualValidation@0`, `Delay@1`, `InvokeRESTAPI@1` (server tasks)**
  **Ground:** reference pages + task metadata (server tasks have no Node source — ground behavior in the reference docs and one real-run transcript each; `pool: server` execution rules from the jobs doc — quote).
  **Done:** bats: prompt flow (+ `--non-interactive` per `onTimeout` claim), sleep, curl mapping with `.env` connection.
- [ ] **E11-S03-T02 — `Cache@2`**
  **Do:** local content-addressed cache; key construction (parts, `|` separators, file-pattern hashing) reproduced exactly; `cacheHitVar`, restore-keys prefix matching.
  **Ground:** pipeline-caching doc (…/pipelines/release/caching — quote key syntax + restore-key rules) **and** the agent-side implementation (locate the pipeline cache code — agent plugin in `microsoft/azure-pipelines-agent` — pin the fingerprint/hash logic; the exact hashing matters for hit-parity).
  **Done:** bats: hit/miss/restore-key matrix; same key inputs produce same fingerprints as documented rules.
- [ ] **E11-S03-T03 — `DownloadPackage@1` / `getPackage:` (stub→equivalent later)**
  **Ground:** reference page + REST feeds docs (pin) — implement download when straightforward, else grounded stub with claim.
  **Done:** decision + implementation/stub with tests.

## E11-S04 — As a pipeline developer, top marketplace tasks work or stub cleanly, so real-world pipelines don't faceplant.
- [ ] **E11-S04-T01 — `replacetokens@5/@6` (qetza)**
  **Do:** token pattern presets, target globbing, missing-var actions, output summary.
  **Ground:** the vendor repo (locate qetza's current replacetokens repo on GitHub; pin task.json + source of the used majors) — vendor tasks get the same source-pinning regime as Microsoft's.
  **Done:** bats matrix per preset/action vs pinned semantics.
- [ ] **E11-S04-T02 — SonarQube/SonarCloud set, GitVersion (stub + optional passthrough)**
  **Ground:** vendor repos/pages pinned for input names (SonarSource/sonar-scanner-azdo, GitTools/actions equivalents); passthrough conditions documented with claims.
  **Done:** stubs dump correct input names; optional local-tool passthrough behind config.
