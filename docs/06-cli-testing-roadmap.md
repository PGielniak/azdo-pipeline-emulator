# 06 — CLI & config, testing strategy, detailed roadmap

## 1. CLI

```
azdo-emu auth login [--github] [--org URL] [--mode interactive|az|pat]
azdo-emu auth status

azdo-emu convert <pipeline.yml> -o <dir>
    [--org URL --project NAME]            # context for @alias resolution, variable groups, schema
    [--parameter key=value]...            # runtime parameters (repeatable); complex via @file.json
    [--target-os linux|windows|macos]     # override pool inference
    [--checkout-mode clone|copy|worktree]
    [--exec-env auto|sandbox|host]        # D11: default execution environment baked into the project (docs/04 §9)
    [--sandbox-image IMG]                 # override the default vmImage→image mapping
    [--group-names | --no-group-names]    # list variable-group names in .env.example when signed in (values never fetched)
    [--min-coverage <pct>]                # exit 3 if the coverage report (docs/04 §13) is below threshold
    [--frozen | --update [what]]          # lockfile behavior (docs/05 §4)
    [--offline]
    [--only-stage NAME]...                # partial conversion for huge pipelines

azdo-emu doctor <outdir> [--sandbox]      # verify tool prereqs from manifest.json — on the host, or inside the sandbox image (D11)
azdo-emu fetch-artifacts <outdir> [--refresh|--latest]
azdo-emu preview-diff <pipeline.yml>      # dev/CI parity check vs the real service (docs/02 §8)
azdo-emu run <outdir> [...]               # thin convenience proxy to <outdir>/run.sh (optional sugar)
```

Conventions: human-readable output with `--json` for tooling; exit codes 0 ok / 1 conversion errors / 2 warnings-as-errors (`--strict`) / 3 below `--min-coverage`. `convert` always ends with the coverage one-liner (docs/04 §13).

## 2. Config file — `azdo-emu.yaml` (next to the pipeline, all keys optional; CLI > config > defaults)

```yaml
organization: https://dev.azure.com/contoso
project: Platform
auth: { azdo: interactive, github: gh }          # interactive|az|pat / gh|pat
parameters: { deployEnv: dev }                    # default runtime parameters
repositories:                                     # alias overrides (docs/05 §3)
  templates: { path: ../pipeline-templates }      #   e.g. local working copy while editing templates
variableGroups: { listNames: true }               # names only — values are always user-filled in .env
coverage: { min: 0 }                              # optional convert gate (0 = report-only)
tasks:
  unknown: stub                                   # stub|fail|prompt
  overrides: { "SonarQubePrepare@5": skip }       # per-task: skip|stub|fail
  execute: []                                     # P6 high-fidelity list, e.g. ["Npm@1"]
output:
  targetOs: linux
  checkoutMode: clone
  sharedWorkspace: false
  execution:                                      # D11 sandbox (docs/04 §9)
    environment: auto                             #   auto|sandbox|host — auto = sandbox when docker/podman present
    image: null                                   #   override the default vmImage→image mapping
    dockerSocket: auto                            #   auto|share|none — host-socket passthrough for docker-using pipelines
```

## 3. Testing strategy

| Layer | What | How |
|---|---|---|
| L1 Expression unit | Full function/coercion table (~300 cases from the expressions doc + oracle-resolved edge cases) | Table-driven; same tables run against **both** backends (eval + compiled-shell via bats) so the two can never diverge |
| L2 Expansion goldens | Fixture YAML in → expanded YAML out | Snapshot tests; fixtures include every directive, template type, parameter type, nesting patterns |
| L3 **Server oracle** | Our expansion ≡ service `finalYaml` | `preview-diff` over the corpus against a dedicated test org (PAT in CI secret), nightly + pre-release gate; every discovered divergence becomes a permanent L2 fixture |
| L4 Runtime unit | `runtime.sh` behaviors: setvariable/isoutput propagation, prependpath, masking, macro edge cases (unmatched literal), conditions vs results, continueOnError/failOnStderr/retries, artifact flow, deps outputs across jobs/stages | bats-core; runs in CI on ubuntu + macos |
| L5 E2E | Convert & run sample apps (dotnet, node, python, docker) in containers approximating hosted images | Docker; assert artifacts produced, exit codes, key log lines |
| L6 Real-run parity spot checks | Same fixture pipeline run in real ADO and locally; compare artifact contents, produced variables, step result sequence | Manual-triggered CI job (costs real pipeline minutes); release gate for majors |

Corpus: ≥30 pipelines patterned after real-world shapes — nested cross-repo templates, `extends` + `each` over `jobList`, matrix builds, deployment jobs with runOnce/canary, multi-checkout, artifact hand-offs between stages, variable groups + runtime expressions, monorepo path-heavy pipelines. Grown continuously from bug reports (every bug → corpus entry first).

## 4. Detailed roadmap & exit criteria

| Phase | Size | Contents | Exit criteria |
|---|---|---|---|
| **P0 Foundations** | S | TS monorepo scaffold, CLI skeleton, YAML front end (source maps, schema validation), model dump, preview-oracle harness plumbing | `convert --dry-run` prints validated model of a template-free pipeline; `preview-diff` works against test org for a trivial file |
| **P1 Core engine** | L | Expression evaluator (both backends' AST; eval backend first), template expansion (local files incl. `extends`, all directives, typed params), variables model, matrix, dependency graph | Oracle-green on the no-remote-resources corpus subset; L1/L2 suites in CI |
| **P2 Emission MVP** | L | Emitter + `runtime.sh` + compiled conditions, groups A/B tasks, checkout self, deployment jobs (`runOnce` + artifact auto-download), predefined vars, `.env.example`, manifest, **coverage report** (docs/04 §13), generated README, `--only-step`/`--resume`, **sandbox execution wrapper** (D11, E14-S04-T01/T02) | **Dogfood**: a real single-repo Linux pipeline converts and runs to green locally with an accurate `coverage.md`; same pipeline green under `--sandbox` on a docker host; L4 suite in CI |
| **P3 Fetchers & auth** | M | ADO interactive/az/PAT, GitHub, cross-repo templates, multi-checkout, `resources.pipelines` artifacts, variable groups → `.env.example` (names when signed in), lockfile/`--frozen`, `fetch-artifacts.sh` | Corpus pipelines with remote templates + artifacts convert offline-reproducibly after first fetch |
| **P4 Priority deployment tasks** | L | Handler registry as stable API + the priority set (docs/03 group D): `AzurePowerShell@5`, `AzureCLI@2`, `Docker@2` build/push, `HelmInstaller@1`+`HelmDeploy@0`, `KubectlInstaller@0`+`Kubernetes@1`+`KubernetesManifest@1`, `AzureResourceManagerTemplateDeployment@3` (+`AzureResourceGroupDeployment@2`), `AzureKeyVault@2`, `AzureFileCopy@6`; service-connection `.env` contract + `azdo_sc_login`; `rolling`/`canary` strategies; `doctor`; unknown-task stubs + user handlers | A real build → docker push → helm-deploy pipeline runs locally end-to-end; Key Vault ambient mode verified against a live vault |
| **P5 Task breadth** | M | Groups C/E/F/G: toolchains (dotnet/node/python/maven/gradle), feed auth, test/coverage publishing, `Cache@2`, `replacetokens`, stub set | Coverage % ≥ agreed target across corpus; unknown-task flow polished |
| **P6 Fidelity & DX** | M | Real-task execution mode, container jobs + services, `step.target`, sandbox × container-job composition (D11 socket policy, E14-S04-T03), `--parallel` + slicing, `--shell-at`, masking/UX polish | Opt-in real-task mode runs `Npm@1`/`replacetokens` byte-faithfully; container-job pipeline runs via Docker, including from inside the sandbox |
| **Future — Windows host** | M | Native pwsh emission set (`run-job.ps1`, `steps/*.ps1`) for Windows-targeted jobs, cmd step semantics, Windows runner testing | Windows-targeted corpus pipeline runs on a Windows host (deferred by decision 2026-07-30; emitter backend seam reserved from P2) |

Suggested converter repo layout (monorepo, pnpm):
```
packages/cli  packages/engine (front-end, templates, expressions, model)
packages/fetch (auth+REST)  packages/emit (handlers, runtime templates)
packages/runtime (bash sources + bats tests)  fixtures/  docs/
```

## 5. Decisions record & remaining open questions

Decided 2026-07-30 (with the user):
1. **Azure DevOps Server (on-prem): out of scope.**
2. **Task priority = the Azure/Kubernetes deployment set** — AzurePowerShell, PowerShell/Bash, Helm install/deploy, Docker build/push, Azure resource-group (ARM/Bicep) deployment, Kubernetes actions, Key Vault, storage-account operations → group D moved to P4, general toolchains to P5 (docs/03).
3. **Windows host: skipped for now, must remain addable** — emitter keeps a per-job target-OS backend seam; scheduled as the "Future" phase.
4. **Variable groups → `.env.example` only**, filled by the user (names listed when signed in; values never fetched).
5. **Every conversion emits a coverage report** (docs/04 §13) with the `--min-coverage` gate.
6. **Grounding-source correction (2026-07-30, E00-S02-T02):** the C# expressions/object-templating engine sources are **not** in `microsoft/azure-pipelines-agent` (it consumes the closed `Microsoft.TeamFoundation.DistributedTask.Expressions` NuGet; conditions evaluated in `src/Agent.Worker/ExpressionManager.cs`). Open behavioral reference for E02/E03 is the `actions/runner` fork `src/Sdk/DTExpressions2`/`DTObjectTemplating`/`DTPipelines`, with the oracle (D6) outranking it on divergence. Corrected: PLAN §9, docs/02 intro, E02/E03 epic grounding sets, REFERENCES.md (claims C-E00-012/013).
7. **Isolated execution by default (D11)** — decided 2026-07-30 (user requirement: local debugging must run in a container-isolated environment): the generated project executes inside one long-lived sandbox container per run when a container runtime is available (`auto`; `--host` opts out), project bind-mounted at the identical absolute path so the same scripts run unchanged in both environments (D2 intact); docker-socket passthrough is opt-in for docker-using pipelines. Distinct from ADO `container:` jobs (E14-S02). Added: PLAN §5 D11, docs/04 §9, config `output.execution.*`, story E14-S04 (T01/T02 scheduled at P2 tail).

8. **Schema validation is a guided walk, and the docs outrank the vendored schema (2026-07-30, E01-S02-T01).** The vendored `service-schema.json` is not self-sufficient: acceptance depends on the VS Code-extension keywords (`firstProperty`/`ignoreCase`/`aliases`) and on pipeline values being strings, so a stock ajv run *rejects valid pipelines* (documented `target:` on task steps) and emits >1000 errors for a single mistyped key (C-E01-011, C-E01-019). Decided: implement the walk in `packages/engine/src/frontend/validate.ts` mirroring `microsoft/azure-pipelines-language-server` semantics; keep ajv only as the vendored-file integrity smoke test; carry doc-proven schema fixes as an explicit `DOCUMENTED_CORRECTIONS` list re-checked on every schema refresh; treat unknown tasks/inputs as warnings until the org schema lands (E01-S02-T03). Two behaviors are oracle-pending in `research/E01-yaml-frontend.md` (Q1 discriminator ordering — warning for now; Q2 unknown task inputs). Updated: docs/01 §1.

9. **Doc correction — `---` is a marker, not always a separator (2026-08-11, E01-S01-T02).** docs/01 §1 said "Only a single document per file; `---` separators rejected". The live service accepts a single document opened by a leading `---` and closed by a trailing `...` (both HTTP 200), and rejects only a *second* document (C-E01-025/024); reading the old wording literally would have produced false rejections on the very common `---`-prefixed pipeline file. Also corrected in the same pass: anchors are rejected on the **definition**, not on alias use, so the placeholder `ALIAS_UNSUPPORTED` error from E01-S01-T01 is replaced by `ANCHOR_UNSUPPORTED` (C-E01-022), and duplicate keys are reported at the second occurrence with the service's own wording and collide **case-insensitively even for user-chosen names** (C-E01-023/028) — the yaml package's `uniqueKeys` check is therefore turned off so our check owns the message. Updated: docs/01 §1; evidence `research/experiments/E01-quirks/`.

Still open:
1. Distribution: npm global install acceptable, or single static binary required?
2. Should `coverage.min` have an opinionated default (e.g. warn under 60%), or stay report-only until asked?
