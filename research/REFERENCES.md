# Canonical reference index

Status legend: `VERIFY` = written from knowledge, must be confirmed live and pinned before first
use. After verification, the row states the last-checked date (E00-S02-T02 pass: **2026-07-30**,
curl status + title per URL; GitHub rows pinned to HEAD commits of that day). GitHub references
must become commit-pinned permalinks when cited in claims.

## Official docs (learn.microsoft.com)

All rows below: **verified 2026-07-30** (HTTP 200; learn.microsoft.com redirects to `/en-us/` +
`?view=azure-pipelines` moniker — links kept moniker-free on purpose). The yaml-schema pages
carry their source commit in page metadata (`git_commit_id`); quotes taken 2026-07-30 are from
MicrosoftDocs/azure-devops-yaml-schema-pr @ `d089fd2d` — cite that pin alongside the URL. The
public mirror **MicrosoftDocs/azure-devops-yaml-schema** carries the same `content/*.md` sources
and is the permalink target when a rendered section must be quoted exactly (verified 2026-08-11:
`content/index.md` @ `d089fd2d` — the "See also" statement on unsupported YAML features, C-E01-021,
which is present in the rendered HTML but dropped by markdown converters).

| Area | URL |
|---|---|
| YAML schema reference (landing; per-keyword subpages → see index below) | https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/ (C-E00-009) |
| Expressions | https://learn.microsoft.com/azure/devops/pipelines/process/expressions |
| Conditions | https://learn.microsoft.com/azure/devops/pipelines/process/conditions |
| Templates | https://learn.microsoft.com/azure/devops/pipelines/process/templates |
| Template parameters | https://learn.microsoft.com/azure/devops/pipelines/process/template-parameters |
| Runtime parameters | https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters |
| Variables | https://learn.microsoft.com/azure/devops/pipelines/process/variables |
| Set variables in scripts | https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts |
| Predefined variables | https://learn.microsoft.com/azure/devops/pipelines/build/variables |
| Logging commands | https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands |
| Jobs (phases) | https://learn.microsoft.com/azure/devops/pipelines/process/phases |
| Stages | https://learn.microsoft.com/azure/devops/pipelines/process/stages |
| Deployment jobs | https://learn.microsoft.com/azure/devops/pipelines/process/deployment-jobs |
| Container jobs | https://learn.microsoft.com/azure/devops/pipelines/process/container-phases |
| Service containers | https://learn.microsoft.com/azure/devops/pipelines/process/service-containers |
| Resources | https://learn.microsoft.com/azure/devops/pipelines/process/resources |
| Multi-repo checkout | https://learn.microsoft.com/azure/devops/pipelines/repos/multi-repo-checkout |
| Pipeline artifacts | https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts |
| Build artifacts | https://learn.microsoft.com/azure/devops/pipelines/artifacts/build-artifacts |
| Pipeline caching | https://learn.microsoft.com/azure/devops/pipelines/release/caching |
| Run (build) number | https://learn.microsoft.com/azure/devops/pipelines/process/run-number |
| Tasks reference (landing) | https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/ |
| Service connections | https://learn.microsoft.com/azure/devops/pipelines/library/service-endpoints |
| Hosted agents / vmImage labels | https://learn.microsoft.com/azure/devops/pipelines/agents/hosted |
| PATs — **deep-verified 2026-07-30** (E00-S03-T01): Basic auth w/ empty username, org-scoped creation UI, 84-char format w/ `AZDO` at 76–80, rotation/revocation guidance (C-E00-020/021) | https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate |
| OAuth scopes table (display names ↔ `vso.*`; `vso.build` = "Build (read)", C-E00-019). Page also documents ADO-OAuth deprecation | https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/oauth |
| Auth methods overview (old `…/authentication/` landing **404s**; moved) | https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/authentication-guidance |
| Entra OAuth for ADO — **confirms resource GUID `499b84ac-1321-427f-aa17-267ca6975798`** + resource URI + `.default` scope (C-E00-011). Note: ADO's own OAuth is deprecated (no new registrations since 2025-04; full deprecation announced for 2026) → E08 uses Entra/MSAL | https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/entra-oauth |
| REST API landing + versioning | https://learn.microsoft.com/rest/api/azure/devops/ |
| REST: Pipelines Preview — **deep-verified 2026-07-30** (E00-S03-T01): route/api-version 7.1, body `previewRun`+`yamlOverride`, response `PreviewRun.finalYaml`, scope `vso.build` (C-E00-017..019). **Confirmed against the live service 2026-07-31** (E00-S03-T02): 200 body carries exactly one field `finalYaml`; failure modes recorded, three of which contradict the documented-status intuition — 302 (not 401) on a bad PAT, 500 (not 404) on an unknown pipelineId, 200 (not an error) on an empty `yamlOverride` (C-E00-022..027; transcripts under `research/experiments/oracle-spike/`) | https://learn.microsoft.com/rest/api/azure/devops/pipelines/preview/preview |
| REST: Pipelines Runs / Artifacts | https://learn.microsoft.com/rest/api/azure/devops/pipelines/ |
| REST: Git Items / Refs | https://learn.microsoft.com/rest/api/azure/devops/git/ |
| REST: Build (definitions, artifacts) | https://learn.microsoft.com/rest/api/azure/devops/build/ |
| REST: Variablegroups | https://learn.microsoft.com/rest/api/azure/devops/distributedtask/variablegroups |
| Task contribution / task.json (extension docs) | https://learn.microsoft.com/azure/devops/extend/develop/integrate-build-task |
| dotnet-install scripts | https://learn.microsoft.com/dotnet/core/tools/dotnet-install-script |

### yaml-schema per-keyword subpages (all 73 verified 2026-07-30, HTTP 200)

Pattern: `https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/<slug>`. Slugs:

`pipeline` · `extends` · `jobs` · `jobs-deployment` · `jobs-deployment-environment` ·
`jobs-deployment-strategy` · `jobs-deployment-strategy-canary` · `jobs-deployment-strategy-rolling` ·
`jobs-deployment-strategy-run-once` · `jobs-job` · `jobs-job-container` · `jobs-job-strategy` ·
`jobs-job-uses` · `jobs-template` · `parameters` · `parameters-parameter` · `pool` · `pool-demands` ·
`pr` · `resources` · `resources-builds` · `resources-builds-build` · `resources-containers` ·
`resources-containers-container` · `resources-containers-container-trigger` · `resources-packages` ·
`resources-packages-package` · `resources-pipelines` · `resources-pipelines-pipeline` ·
`resources-pipelines-pipeline-trigger` · `resources-pipelines-pipeline-trigger-branches` ·
`resources-repositories` · `resources-repositories-repository` · `resources-webhooks` ·
`resources-webhooks-webhook` · `resources-webhooks-webhook-filters` ·
`resources-webhooks-webhook-filters-filter` · `schedules` · `schedules-cron` · `stages` ·
`stages-stage` · `stages-template` · `steps` · `steps-bash` · `steps-checkout` · `steps-download` ·
`steps-download-build` · `steps-get-package` · `steps-powershell` · `steps-publish` · `steps-pwsh` ·
`steps-review-app` · `steps-script` · `steps-task` · `steps-template` · `target` ·
`target-settable-variables` · `trigger` · `variables` · `variables-group` · `variables-name` ·
`variables-template` — supporting: `deploy-hook` · `include-exclude-filters` ·
`include-exclude-string-filters` · `mount-read-only` · `on-failure-hook` · `on-success-hook` ·
`on-success-or-failure-hook` · `post-route-traffic-hook` · `pre-deploy-hook` · `route-traffic-hook` ·
`workspace`

## GitHub source (behavior references — always pin commits)

All rows: **verified + pinned 2026-07-30** (HEAD of that day; paths confirmed via contents/trees API).

| Repo (pin) | What we use it for — confirmed paths |
|---|---|
| microsoft/azure-pipelines-agent @ `c59f46aa` | Worker step lifecycle: `src/Agent.Worker/StepsRunner.cs`; runtime condition evaluation: `src/Agent.Worker/ExpressionManager.cs` (consumes the **closed** `Microsoft.TeamFoundation.DistributedTask.Expressions` NuGet — engine sources are *not* in this repo, C-E00-012); handlers: `src/Agent.Worker/Handlers/` (`NodeHandler.cs`); containers: `src/Agent.Worker/ContainerOperationProvider.cs` (+`Enhanced`); secret masker: `src/Agent.Sdk/SecretMasking/`; pipeline-cache plugin: `src/Agent.Plugins/PipelineCache/` |
| **actions/runner @ `34ef7f24`** (added 2026-07-30) | Open behavioral reference for the DistributedTask expressions + templating engine: `src/Sdk/DTExpressions2/`, `src/Sdk/DTObjectTemplating/`, `src/Sdk/DTPipelines/` (forked from Azure DevOps; divergence possible → oracle D6 decides, C-E00-013). Error-location format `(Line: {0}, Col: {1})`: `src/Sdk/Resources/TemplateStrings.g.cs` + `DTObjectTemplating/ObjectTemplating/TemplateContext.cs` GetErrorPrefix (C-E01-007) |
| microsoft/azure-pipelines-tasks @ `0e983fe4` (HEAD) · snapshot pin tag **v277** = `8ba25cfb` (2026-07-30) | Per-task `Tasks/<Name>V<n>/task.json` + implementation (confirmed: `Tasks/CmdLineV2/task.json`); shared modules `Tasks/Common/` (Deployment, Sanitizer, TlsHelpers, …). Sprint-cadence release tags `v<sprint>`; versioning rules `docs/taskversionbumping.md` (C-E00-014..016). tasks-meta snapshots vendor from the tag pin via `scripts/refresh-tasks-meta.ts` |
| microsoft/azure-pipelines-task-lib @ `b5ef8ae9` | `node/task.ts` (INPUT_/env encodings, getBoolInput, findMatch), `node/taskcommand.ts` + `node/internal.ts` (`##vso` emission), `node/toolrunner.ts` — all confirmed present |
| microsoft/azure-pipelines-vscode @ `2f4500cf` | Official machine-readable YAML schema: `service-schema.json` at repo root (C-E00-006..008, C-E00-010); vendored in `packages/engine/vendor/schema/` |
| **microsoft/azure-pipelines-language-server @ `543ceeec`** (added 2026-07-30, E01-S02-T01) | Reference semantics for the schema's non-standard keywords and for pipeline-value typing — `language-service/src/parser/jsonParser.ts`: `firstProperty` branch selection + message (C-E01-009/018), `ignoreCase`/`aliases` (C-E01-017), boolean/number/null→string and `${{ }}`/`$( )`/`$[ ]` exemptions (C-E01-015/016). This is the validator the VS Code extension actually runs over the vendored schema |
| actions/runner-images @ `4055b521` | Hosted image contents: `images/ubuntu/` (`Ubuntu2204/2404/2604[-Arm64]-Readme.md`, `toolsets/`) for doctor/E2E/sandbox-image design |
| bats-core/bats-core @ `ae4b94d7` | Runtime test framework (invocation/report claims C-E00-003..005) + https://bats-core.readthedocs.io/en/stable/usage.html |
| eemeli/yaml — npm **2.9.0** = tag v2.9.0 = `ddb21b04` (pinned 2026-07-30, E01-S01-T01; earlier HEAD check `bf03c0cb`) | CST/source-position APIs verified in `docs/` at the pin: `range=[start,value-end,node-end]`, `lineCounter.linePos` 1-indexed, `keepSourceTokens`→`srcToken`, Scalar.type styles (C-E01-001..006); `docs/07_parsing_yaml.md` CST token table — `&`→`anchor` SourceToken with `offset`/`source`, carried in the `start`/`sep`/`end` arrays (C-E01-027, verified 2026-08-11); rendered docs https://eemeli.org/yaml/ (200) |
| qetza/replacetokens-task @ `3b06eec6` | Marketplace task ground truth (repo name resolved 2026-07-30) |
| git-scm.com/docs · gnu.org/software/bash/manual/bash.html | git flag + shell semantics citations (both 200) |

## Tooling (converter runtime & test frameworks)

| Area | URL | Status |
|---|---|---|
| Node.js release schedule (LTS windows for engines floor) | https://nodejs.org/en/about/previous-releases · pinned JSON: https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json | verified 2026-07-30 (claims C-E00-001/002) |

## Experiment archives (grow under `research/experiments/`)

- `oracle-spike/` — first preview-API request/response (E00-S03-T02)
- `E01-quirks/` — anchors/dup-keys/multi-doc service behavior
- `E02-coercion/`, `E02-errors/` — expression edge cases & error shapes
- `E03-visibility/` — compile-time variable visibility matrix
- `E08-rest/<endpoint>/` — redacted live samples per REST endpoint
- `E10-<task>/` — live parity transcripts for the priority task set
