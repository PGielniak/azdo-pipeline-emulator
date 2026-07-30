# Canonical reference index (seed)

Status legend: `VERIFY` = written from knowledge, must be confirmed live and pinned (E00-S02-T02) before first use. After verification, replace with the resolved URL + last-checked date. GitHub references must become commit-pinned permalinks when cited in claims.

## Official docs (learn.microsoft.com)

| Area | URL | Status |
|---|---|---|
| YAML schema reference (landing; per-keyword subpages) | https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/ | verified 2026-07-30 (C-E00-009; canonical `?view=azure-pipelines`; subpage-per-keyword confirmed) |
| Expressions | https://learn.microsoft.com/azure/devops/pipelines/process/expressions | VERIFY |
| Conditions | https://learn.microsoft.com/azure/devops/pipelines/process/conditions | VERIFY |
| Templates | https://learn.microsoft.com/azure/devops/pipelines/process/templates | VERIFY |
| Template parameters | https://learn.microsoft.com/azure/devops/pipelines/process/template-parameters | VERIFY |
| Runtime parameters | https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters | VERIFY |
| Variables | https://learn.microsoft.com/azure/devops/pipelines/process/variables | VERIFY |
| Set variables in scripts | https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts | VERIFY |
| Predefined variables | https://learn.microsoft.com/azure/devops/pipelines/build/variables | VERIFY |
| Logging commands | https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands | VERIFY |
| Jobs (phases) | https://learn.microsoft.com/azure/devops/pipelines/process/phases | VERIFY |
| Stages | https://learn.microsoft.com/azure/devops/pipelines/process/stages | VERIFY |
| Deployment jobs | https://learn.microsoft.com/azure/devops/pipelines/process/deployment-jobs | VERIFY |
| Container jobs | https://learn.microsoft.com/azure/devops/pipelines/process/container-phases | VERIFY |
| Service containers | https://learn.microsoft.com/azure/devops/pipelines/process/service-containers | VERIFY |
| Resources | https://learn.microsoft.com/azure/devops/pipelines/process/resources | VERIFY |
| Multi-repo checkout | https://learn.microsoft.com/azure/devops/pipelines/repos/multi-repo-checkout | VERIFY |
| Pipeline artifacts | https://learn.microsoft.com/azure/devops/pipelines/artifacts/pipeline-artifacts | VERIFY |
| Build artifacts | https://learn.microsoft.com/azure/devops/pipelines/artifacts/build-artifacts | VERIFY |
| Pipeline caching | https://learn.microsoft.com/azure/devops/pipelines/release/caching | VERIFY |
| Run (build) number | https://learn.microsoft.com/azure/devops/pipelines/process/run-number | VERIFY |
| Tasks reference (landing) | https://learn.microsoft.com/azure/devops/pipelines/tasks/reference/ | VERIFY |
| Service connections | https://learn.microsoft.com/azure/devops/pipelines/library/service-endpoints | VERIFY |
| Hosted agents / vmImage labels | https://learn.microsoft.com/azure/devops/pipelines/agents/hosted | VERIFY |
| PATs | https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate | VERIFY |
| Entra/OAuth auth for ADO (incl. resource GUID `499b84ac-…`) | https://learn.microsoft.com/azure/devops/integrate/get-started/authentication/ | VERIFY (locate exact page confirming the GUID) |
| REST API landing + versioning | https://learn.microsoft.com/rest/api/azure/devops/ | VERIFY |
| REST: Pipelines Preview | https://learn.microsoft.com/rest/api/azure/devops/pipelines/preview/preview | VERIFY |
| REST: Pipelines Runs / Artifacts | https://learn.microsoft.com/rest/api/azure/devops/pipelines/ | VERIFY |
| REST: Git Items / Refs | https://learn.microsoft.com/rest/api/azure/devops/git/ | VERIFY |
| REST: Build (definitions, artifacts) | https://learn.microsoft.com/rest/api/azure/devops/build/ | VERIFY |
| REST: Variablegroups | https://learn.microsoft.com/rest/api/azure/devops/distributedtask/variablegroups | VERIFY |
| Task contribution / task.json (extension docs) | https://learn.microsoft.com/azure/devops/extend/develop/integrate-build-task | VERIFY |
| dotnet-install scripts | https://learn.microsoft.com/dotnet/core/tools/dotnet-install-script | VERIFY |

## GitHub source (behavior references — always pin commits)

| Repo | What we use it for | Status |
|---|---|---|
| microsoft/azure-pipelines-agent | Worker step lifecycle (`src/Agent.Worker`, StepsRunner), logging-command handling, secret masker, expressions SDK (`src/Sdk` — locate expressions + object-templating folders), container ops, pipeline-cache plugin, Node handler | VERIFY paths |
| microsoft/azure-pipelines-tasks | Every task's `Tasks/<Name>V<n>/task.json` + implementation; `Tasks/Common` shared modules (Azure auth, npm auth) | VERIFY layout |
| microsoft/azure-pipelines-task-lib | `node/task.ts` (INPUT_/env encodings, getBoolInput, findMatch + MatchOptions), `node/taskcommand.ts` / `internal.ts` (`##vso` emission) | VERIFY paths |
| microsoft/azure-pipelines-vscode | Official machine-readable YAML schema: `service-schema.json` at repo root | verified 2026-07-30 — pinned `2f4500cf` (C-E00-006..008, C-E00-010); vendored in packages/engine/vendor/schema/ |
| actions/runner-images | Hosted image contents (ubuntu manifests) for doctor/E2E image design | VERIFY |
| bats-core/bats-core | Runtime test framework docs (invocation/report claims C-E00-003..005) | verified 2026-07-30 — pinned `ae4b94d7` (release v1.14.0; npm `bats` 1.13.0) + https://bats-core.readthedocs.io/en/stable/usage.html |
| eemeli/yaml (npm `yaml`) | CST/source-position APIs | VERIFY |
| qetza replacetokens (locate current repo name) | Marketplace task ground truth | VERIFY |
| git-scm.com docs / GNU bash manual | git flag + shell semantics citations for runtime/emitter | VERIFY |

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
