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
| Expressions | https://learn.microsoft.com/azure/devops/pipelines/process/expressions — **deep-verified 2026-08-18** (E02-S05-T04; page source `MicrosoftDocs/azure-devops-docs@1eeaa8de`). Includes logical/comparison/membership C-E02-028..032; general functions C-E02-040..051; member access C-E02-024..027; conversion C-E02-020..023; value model C-E02-018/019; grammar C-E02-002..009; context availability C-E02-080..091; dependency shapes C-E02-092..095; filtered-array public contract C-E02-160. The live run confirms same-stage `dependencies` is empty without a job dependency while cross-stage `stageDependencies` is stage→job→`outputs['step.var']` plus metadata. |
| Conditions — re-verified 2026-08-12 for default/status summaries (C-E02-062/063) | https://learn.microsoft.com/azure/devops/pipelines/process/conditions |
| Templates | https://learn.microsoft.com/azure/devops/pipelines/process/templates — **verified 2026-08-12** (E03-S01-T01). Carries limits (100 files, 100 nesting levels, 20 MB), reference-path and `@alias`/`@self` rules; the directive *syntax* lives on the template-expressions page below, and neither page states any recognition rule (case, whitespace, parameter splitting) — all of those are C-E03-100..108, measured. The `${{` escape rule (`${{ 'my${{value' }}`) is on the template-expressions page and forces a quote-aware delimiter scan (C-E03-117). |
| Template expressions (directives: `if`/`elseif`/`else`/`each`/`insert`) | https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions — **deep-verified 2026-08-18** (E03-S01-T02 + E03-S01-T03; page source `MicrosoftDocs/azure-devops-docs@7ba9a9ac`). "Conditional insertion" is documented for sequence and mapping parents (C-E03-120) and its mapping example uses adjacent `if`/`elseif`/`else` bodies (C-E03-121); chain grouping, nesting, evaluation order, condition typing and the orphan/`elseif`-after-`else` rejections are **not** documented and were measured live (C-E03-122..134, 22 probes under `research/experiments/E03-if/`) — two of them, C-E03-128 and C-E03-132, invert the natural reading of the page. "Iterative insertion" documents sequence/mapping iteration, the `pair.key`/`pair.value` idiom, `jobList` wrapping, and the `object` fallback for template list inputs (C-E03-140..143); its omissions were resolved live — mappings retain authored order (including integer-like keys) and no iteration index is synthesized (C-E03-145/151; `research/experiments/E03-each/`). ⚠️ **One statement measured false**: "Expressions are only expanded for `stages`, `jobs`, `steps`, and `containers` (inside `resources`). You can't … use an expression inside `trigger`" — refuted by C-E03-109 (`trigger` and `pool.demands` both expand). Real position gating has one measured member, `resources.repositories` (C-E03-110). |
| Template parameters | https://learn.microsoft.com/azure/devops/pipelines/process/template-parameters |
| Runtime parameters | https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters |
| Variables | https://learn.microsoft.com/azure/devops/pipelines/process/variables — **deep-verified 2026-08-19** (E06-S01-T02): non-secret variables enter the process environment with upper-case/dot→underscore names; secrets require explicit task `env:` mapping (C-E06-007/009). Space→underscore, collision precedence, and task-env ordering are agent/runtime claims instead (C-E06-008/010/011; hosted run 540). |
| Set variables in scripts | https://learn.microsoft.com/azure/devops/pipelines/process/set-variables-scripts |
| Predefined variables | https://learn.microsoft.com/azure/devops/pipelines/build/variables |
| Logging commands | https://learn.microsoft.com/azure/devops/pipelines/scripts/logging-commands — **re-verified 2026-08-19** for `task.prependpath`: affects subsequent tasks; agent source plus hosted run 540 establish newest-first ordering (C-E06-012). |
| Jobs (phases) | https://learn.microsoft.com/azure/devops/pipelines/process/phases |
| Stages | https://learn.microsoft.com/azure/devops/pipelines/process/stages |
| Deployment jobs | https://learn.microsoft.com/azure/devops/pipelines/process/deployment-jobs |
| Container jobs | https://learn.microsoft.com/azure/devops/pipelines/process/container-phases |
| Service containers | https://learn.microsoft.com/azure/devops/pipelines/process/service-containers |
| Pipeline resource metadata | https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/resources-pipelines-pipeline — **deep-verified 2026-08-12** (E02-S04-T03, page `git_commit_id` d089fd2dbb54483ec611eeb478e3eff14be74393): §"Pipeline resource metadata as predefined variables" is the canonical 12-name list, and the word **variables** is load-bearing — two real runs proved the same names do *not* exist in the `resources` expression context (C-E02-120/121, superseding the doc-only C-E02-111/112). Same page carries the `projectName`-absent caveat (C-E02-122) and the printenv sample that fixes the env-name rule incl. hyphens (C-E02-127) |
| Resources | https://learn.microsoft.com/azure/devops/pipelines/process/resources — verified 2026-08-12 (page `git_commit_id` 1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32): `resources.repositories.<alias>.{name,ref,type,id,url,version}` confirmed live as **context** members, unlike the pipeline family (C-E02-123/125) |
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
| REST: Pipelines Preview — **deep-verified 2026-07-30** (E00-S03-T01): route/api-version 7.1, body `previewRun`+`yamlOverride`, response `PreviewRun.finalYaml`, scope `vso.build` (C-E00-017..019). **Body re-read 2026-08-11** (E12-S01-T02): the full `RunPipelineParameters` also carries `variables`, `stagesToSkip` and `resources.repositories[].refName/token/tokenType` — the escape hatch for previewing a non-default branch (C-E12-013). **Confirmed against the live service 2026-07-31** (E00-S03-T02): 200 body carries exactly one field `finalYaml`; failure modes recorded, three of which contradict the documented-status intuition — 302 (not 401) on a bad PAT, 500 (not 404) on an unknown pipelineId, 200 (not an error) on an empty `yamlOverride` (C-E00-022..027; transcripts under `research/experiments/oracle-spike/`) | https://learn.microsoft.com/rest/api/azure/devops/pipelines/preview/preview |
| REST: Pipelines Runs / Artifacts | https://learn.microsoft.com/rest/api/azure/devops/pipelines/ |
| REST: Git Items / Refs | https://learn.microsoft.com/rest/api/azure/devops/git/ |
| REST: Git Pushes — Create — **deep-verified 2026-08-11** (E12-S01-T02): `refUpdates[{name, oldObjectId}]` + `commits[{comment, changes[{changeType, item.path, newContent{content, contentType: rawtext}}]}]`; used live to mirror `fixtures/corpus/` into the oracle repo (C-E12-014) | https://learn.microsoft.com/rest/api/azure/devops/git/pushes/create |
| REST: Build (definitions, artifacts) | https://learn.microsoft.com/rest/api/azure/devops/build/ |
| REST: Variablegroups — Add — **verified 2026-08-11** (E12-S01-T02): **org-scoped** POST route (no project segment) needing `variableGroupProjectReferences[].projectReference`, scope `vso.variablegroups_manage`; used live to create the corpus group (C-E12-015) | https://learn.microsoft.com/rest/api/azure/devops/distributedtask/variablegroups/add |
| REST: Environments — Add — **verified 2026-08-11** (E12-S01-T02): project-scoped POST, body `{name, description}`, scope `vso.environment_manage`; used live to create the corpus environments (C-E12-017) | https://learn.microsoft.com/rest/api/azure/devops/distributedtask/environments/add |
| REST: Pipeline Permissions — Update — **verified 2026-08-11** (E12-S01-T02): `PATCH …/_apis/pipelines/pipelinepermissions/{resourceType}/{resourceId}?api-version=7.1-preview.1`, body `{pipelines:[{id, authorized}]}`; the *authorization* half of C-E12-015/017 (creating the object is not enough) | https://learn.microsoft.com/rest/api/azure/devops/approvalsandchecks/pipeline-permissions/update-pipeline-permisions-for-resource |
| REST: Yamlschema — Get — **deep-verified 2026-08-11** (E01-S02-T03): org-scoped route (no project segment), optional `validateTaskNames`, scope `vso.agentpools`; confirmed live (HTTP 200, 611 KB, draft-07 document, C-E01-029/033/036) | https://learn.microsoft.com/rest/api/azure/devops/distributedtask/yamlschema/get |
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
| microsoft/azure-pipelines-agent @ `c59f46aa`; `ExpressionManager.cs` re-pinned @ `9d00422e` for E02-S03-T03; variable/runtime environment source re-pinned @ `15ee11cd728d630f9c9905485449e3359da0a493` for E06-S01 | Worker step lifecycle: `src/Agent.Worker/StepsRunner.cs`; runtime condition evaluation: `src/Agent.Worker/ExpressionManager.cs` (step status arities/truth table deep-verified 2026-08-12, C-E02-061/062; consumes the **closed** `Microsoft.TeamFoundation.DistributedTask.Expressions` NuGet — engine sources are *not* in this repo, C-E00-012); variable state and output wiring: `src/Agent.Worker/{Variables,ExecutionContext,TaskCommandExtension}.cs` plus `src/Misc/layoutbin/en-US/strings.json` (deep-verified 2026-08-12, C-E06-003..006; hosted run 539 establishes enforcement is enabled); environment materialization: `TaskRunner.cs`, `Util/VarUtil.cs`, `Handlers/{Handler,NodeHandler}.cs`, and `TaskCommandExtension.cs` (deep-verified 2026-08-19, C-E06-008/010..012; hosted run 540); containers: `src/Agent.Worker/ContainerOperationProvider.cs` (+`Enhanced`); secret masker: `src/Agent.Sdk/SecretMasking/`; pipeline-cache plugin: `src/Agent.Plugins/PipelineCache/` |
| **actions/runner @ `34ef7f24`** (added 2026-07-30) | Open behavioral reference for the DistributedTask expressions + templating engine: `src/Sdk/DTExpressions2/`, `src/Sdk/DTObjectTemplating/`, `src/Sdk/DTPipelines/` (forked from Azure DevOps; divergence possible → oracle D6 decides, C-E00-013). Error-location format `(Line: {0}, Col: {1})`: `src/Sdk/Resources/TemplateStrings.g.cs` + `DTObjectTemplating/ObjectTemplating/TemplateContext.cs` GetErrorPrefix (C-E01-007). Expression grammar (E02-S01-T01, verified 2026-08-11): `DTExpressions2/Expressions2/Tokens/LexicalAnalyzer.cs` (scan loop L120-L246, legality-by-previous-token table L317-L467), `ExpressionConstants.cs` (operators L50-L59, `MaxDepth`/`MaxLength` L30-L31), `ExpressionParser.cs` (name resolution L126-L146, arity L344-L354, depth L394-L404), `Tokens/TokenKind.cs`, `ParseExceptionKind.cs`. Value shape (E02-S02-T01, verified 2026-08-12): `ValueKind.cs`, `EvaluationResult.cs` `GetKind`, and `Sdk/IReadOnlyArray.cs` corroborate six tagged kinds/read-only collections but omit Azure's Version kind (C-E02-019). Object templating (E03-S01-T01, verified 2026-08-12): `DTObjectTemplating/ObjectTemplating/TemplateConstants.cs#L21` declares `InsertDirective = "insert"` and there is **no** `if`/`elseif`/`else`/`each` counterpart anywhere in that folder — the fork is usable for the walk-loop shape and for nothing about the directive set (C-E03-115). Evaluation loop pinned and read: `TemplateEvaluator.cs#L89-L203` — recursive `Evaluate(DefinitionInfo)` consuming children through `TemplateUnraveler` predicates (`AllowSequenceEnd` L116, `AllowScalar` L196) rather than an index; our walker is the same recursion over an already-materialized DOM and needs no unraveler because T01 expands nothing (C-E03-116). Member access (E02-S02-T03, verified 2026-08-12): `Sdk/Operators/Index.cs` null-propagation + object/array conversion; `DictionaryContextData.cs` and `CaseSensitiveDictionaryContextData.cs` establish per-object ordinal-ignore-case vs ordinal policies (C-E02-024..027). **Caveat now measured, not theoretical:** this fork is the *GitHub Actions* dialect — use it for shape only where live Azure probes agree |
| **actions/runner @ `258d6c85`** (E02-S05-T04, checked 2026-08-18) | Filtered-array evaluator reference: `DTExpressions2/Expressions2/Sdk/Operators/Index.cs#L51-L225`. It keeps `FilteredArray` distinct from ordinary `IReadOnlyArray`, maps later Object/Array access over every child, skips misses/non-collections, flattens nested wildcards, and returns an empty filtered array for a wildcard on a non-collection. The 24-call Azure preview matrix in `research/experiments/E02-filtered-arrays/` agreed in every cell (C-E02-160..164), so these particular fork branches are adopted. |
| microsoft/azure-pipelines-tasks @ `0e983fe4` (HEAD) · snapshot pin tag **v277** = `8ba25cfb` (2026-07-30) | Per-task `Tasks/<Name>V<n>/task.json` + implementation (confirmed: `Tasks/CmdLineV2/task.json`); shared modules `Tasks/Common/` (Deployment, Sanitizer, TlsHelpers, …). Sprint-cadence release tags `v<sprint>`; versioning rules `docs/taskversionbumping.md` (C-E00-014..016). tasks-meta snapshots vendor from the tag pin via `scripts/refresh-tasks-meta.ts` |
| microsoft/azure-pipelines-task-lib @ `b5ef8ae9` | `node/task.ts` (INPUT_/env encodings, getBoolInput, findMatch), `node/taskcommand.ts` + `node/internal.ts` (`##vso` emission), `node/toolrunner.ts` — all confirmed present |
| microsoft/azure-pipelines-vscode @ `2f4500cf` | Official machine-readable YAML schema: `service-schema.json` at repo root (C-E00-006..008, C-E00-010); vendored in `packages/engine/vendor/schema/`. Also (verified 2026-08-11, E01-S02-T03) `src/schema-association-service.ts`: how the extension obtains the *per-org* schema — `taskAgentApi.getYamlSchema()`, session-only cache, and the note that the service offers no version to bust a cache on (C-E01-029/035) |
| **microsoft/azure-devops-node-api @ `cdf57a1407df00ed9465eeaed6c90c7777b74bb1`** (added 2026-08-11, E01-S02-T03) | The REST client the VS Code extension calls through: `api/TaskAgentApiBase.ts` `getYamlSchema()` — area `distributedtask`, locationId `1f9990b9-1dba-441f-9c2e-6485888c42b6`, empty `routeValues` (⇒ organization-scoped route), `validateTaskNames` query parameter (C-E01-029) |
| **microsoft/azure-pipelines-language-server @ `543ceeec`** (added 2026-07-30, E01-S02-T01) | Reference semantics for the schema's non-standard keywords and for pipeline-value typing — `language-service/src/parser/jsonParser.ts`: `firstProperty` branch selection + message (C-E01-009/018), `ignoreCase`/`aliases` (C-E01-017), boolean/number/null→string and `${{ }}`/`$( )`/`$[ ]` exemptions (C-E01-015/016). This is the validator the VS Code extension actually runs over the vendored schema |
| actions/runner-images @ `4055b521` | Hosted image contents: `images/ubuntu/` (`Ubuntu2204/2404/2604[-Arm64]-Readme.md`, `toolsets/`) for doctor/E2E/sandbox-image design |
| bats-core/bats-core @ `ae4b94d7` | Runtime test framework (invocation/report claims C-E00-003..005) + https://bats-core.readthedocs.io/en/stable/usage.html |
| eemeli/yaml — npm **2.9.0** = tag v2.9.0 = `ddb21b04` (pinned 2026-07-30, E01-S01-T01; earlier HEAD check `bf03c0cb`) | CST/source-position APIs verified in `docs/` at the pin: `range=[start,value-end,node-end]`, `lineCounter.linePos` 1-indexed, `keepSourceTokens`→`srcToken`, Scalar.type styles (C-E01-001..006); `docs/07_parsing_yaml.md` CST token table — `&`→`anchor` SourceToken with `offset`/`source`, carried in the `start`/`sep`/`end` arrays (C-E01-027, verified 2026-08-11); rendered docs https://eemeli.org/yaml/ (200) |
| qetza/replacetokens-task @ `3b06eec6` | Marketplace task ground truth (repo name resolved 2026-07-30). Confirmed 2026-08-11 as the only non-`builtIn` extension installed in the oracle org, contributing `replacetokens@3..@7` to the org schema — the live evidence that marketplace task **inputs** validate only under the org document (C-E01-031) |
| **tj/commander.js @ `ba6d13ddb4243e5913367734f8c159089ffe7834`** (added 2026-08-11, E13-S01-T01) | The CLI framework's real behaviour, as depended on by `packages/cli`: `lib/command.js` — `_exit`/`exitOverride` (the override must throw; commander exits afterwards otherwise), `error()` defaulting to exit 1, `unknownOption()` message + did-you-mean, `--help`/`--version` exiting *through* the error path with code 0, and the `getOutHelpWidth`/`useColor` environment dependencies that make help snapshots flaky; `lib/help.js` — the width-80 fallback (C-E13-003..006). npm dist-tag `latest` = 15.0.0, `engines: node >=22.12.0` (C-E13-001/002) |
| git-scm.com/docs · gnu.org/software/bash/manual/bash.html | git flag + shell semantics citations (both 200; deep-checked 2026-08-12 for quoting and exit status, C-E02-129/130; 2026-08-13 for the 127/126 special statuses and `&&`/`||` short-circuiting, C-E02-136/137 — `html_node/Exit-Status.html` and `html_node/Lists.html`). **Rate-limits aggressively:** repeated fetches return 429 and then time out, so pull the pages you need in one pass |
| POSIX.1-2024 (Open Group Base Specifications Issue 8) — https://pubs.opengroup.org/onlinepubs/9799919799/ | The shell facts the GNU manual leaves unstated: `utilities/test.html` EXIT STATUS "0 true / 1 false / >1 An error occurred" (C-E02-135 — the reason the conformance harness asserts an exact status per row) and `utilities/V3_chap02.html` §2.6.3 trailing-newline removal in command substitution (C-E02-140). Verified 2026-08-13 |
| *(measured, not cited)* `research/experiments/E02-conformance/shell-semantics.md` | Locale-collation of `[[ < ]]` and `${v^^}`, and the masking of a status-2 error by `||`, are answered by neither the bash manual nor POSIX; measured per BACKLOG §3.3 and regenerated with `pnpm expr-shell-survey` (C-E02-141/142/143) |

## Tooling (converter runtime & test frameworks)

| Area | URL | Status |
|---|---|---|
| Node.js release schedule (LTS windows for engines floor) | https://nodejs.org/en/about/previous-releases · pinned JSON: https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json | verified 2026-07-30 (claims C-E00-001/002) |
| bats test-authoring semantics (helper loading, scratch dirs, `run` flags) — the L4 harness | https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/source/writing-tests.md · `docs/source/warnings/BW02.rst` · `docs/CHANGELOG.md` (same pin) | verified 2026-08-11 (claims C-E12-001..004) |
| vitest 4.1.10 projects + v8 coverage thresholds — the L1/L2 runner | installed copy: `node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts` (option types), `node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js` (`resolveThresholds`/`checkThresholds`) · https://registry.npmjs.org/@vitest/coverage-v8 (exact peer pin) | verified 2026-08-11 (claims C-E12-005..010); behaviour the sources don't state is measured in `research/experiments/E12-test-harness/` |

## Experiment archives (grow under `research/experiments/`)

- `oracle-spike/` — first preview-API request/response (E00-S03-T02)
- `E12-test-harness/` — vitest project/threshold and bats tmpdir probes (E12-S01-T01)
- `E01-quirks/` — anchors/dup-keys/multi-doc service behavior
- `E02-grammar/` — **survey.md**: 74 live probes settling the expression grammar (literals, operators,
  access, parse-time validation, `$[ ]`) — E02-S01-T01
- `E02-coercion/`, `E02-errors/` — expression edge cases & error shapes
- `E03-visibility/` — compile-time variable visibility matrix
- `E06-env-materialization/` — hosted collision/overlay/secret/PATH environment matrix (run 540)
- `E08-rest/<endpoint>/` — redacted live samples per REST endpoint
- `E10-<task>/` — live parity transcripts for the priority task set
