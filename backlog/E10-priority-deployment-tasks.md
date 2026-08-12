# E10 — Priority deployment task set (group D) + deployment strategies

Phase: P4 · Depends on: E08 (auth/.env plumbing), E09 (registry) · Design: docs/03 group D + §5; docs/01 deployment jobs · Priority per decision 2026-07-30.
Primary grounding set: `microsoft/azure-pipelines-tasks` — pinned `task.json` + implementation per task (incl. `Tasks/Common/` shared modules for Azure auth) · per-task reference pages · service-connection docs (…/pipelines/library/service-endpoints) · CLI vendor docs (az, docker, helm, kubectl, azcopy) for every emitted command.

Global rule (in addition to E09's input-table rule): each handler's Done includes a **live parity check**: run the fixture pipeline once in the real test org and once locally; compare the effective CLI invocations / resulting cloud state; record both transcripts under `research/experiments/E10-<task>/`.

Inherited open cell (from E02-S04-T01 decision 19, re-handed here by E02-S04-T03 on 2026-08-12):
the **deployment-scoped variable slot for the `environment` context** is unmeasured. `environment`
was rejected in every slot E02 could probe — including a deployment job's own `condition:` — but the
deployment-scoped *variable* cell failed together with its control because the test org has no
environment. Whichever E10 task first provisions one should re-run that probe (add the row to
`scripts/expr-context-survey.ts`) and close `SLOT_AVAILABILITY` for it (C-E02-091).

## E10-S01 — As a pipeline developer, Azure service connections have a faithful local substitute, so every Azure task can authenticate.
Acceptance: `.env` contract + `azdo_sc_login` per docs/03 §5, grounded in real endpoint schemas.

- [ ] **E10-S01-T01 — Service-connection `.env` contract generator**
  **Do:** per-connection block synthesis (mode ambient|sp, subscription/tenant/client fields), provenance comments, manifest wiring.
  **Ground:** service-endpoints doc + the AzureRM endpoint's actual field names as consumed by task common code — pin `Tasks/Common` Azure auth module (locate `azure-arm-rest` / `VstsAzureHelpers_` or current equivalent) showing which endpoint fields tasks read (`servicePrincipalId`, `tenantId`, …); our `.env` keys map 1:1 to those, documented.
  **Done:** generator tests; mapping table in research note (endpoint field → env key → consuming task code permalink).
- [ ] **E10-S01-T02 — `azdo_sc_login` runtime helper**
  **Do:** bash: `ambient` no-op probe (`az account show`) vs `sp` login (`az login --service-principal`), subscription selection, logout policy, error hints.
  **Ground:** az CLI docs for `login --service-principal` and `account set` (pin); `AzureCLIV2` source's own login sequence (pin) — mirror its order (login → set subscription).
  **Done:** bats with az mocked; live check once with a throwaway SP.

## E10-S02 — As a pipeline developer, Azure script tasks run locally against my real subscription, so deploy debugging is genuinely local.
- [ ] **E10-S02-T01 — `AzureCLI@2`**
  **Do:** script-type matrix (bash/ps/pscore × inline/path), `addSpnToEnvironment` env injection, `workingDirectory`, `failOnStandardError`.
  **Ground:** `Tasks/AzureCLIV2` task.json + source — pin: temp-script handling, the exact env names it sets for `addSpnToEnvironment` (`servicePrincipalId` etc.), login/logout sequence; reference page for input list.
  **Done:** bats matrix; live parity check (az account listing inside step matches cloud run).
- [ ] **E10-S02-T02 — `AzurePowerShell@5`**
  **Do:** pwsh + Az module invocation, `azurePowerShellVersion` handling (documented delta: use installed Az), Connect-AzAccount ambient/SP.
  **Ground:** `Tasks/AzurePowerShellV5` task.json + source (pin its Connect-AzAccount call and error handling); Az module docs for Connect variants (pin).
  **Done:** bats with pwsh present; doctor rule (pwsh + Az) registered; live parity check.

## E10-S03 — As a pipeline developer, container and Kubernetes tasks map to my local docker/kubectl/helm, so AKS-style pipelines run end-to-end.
- [ ] **E10-S03-T01 — `Docker@2` (build/push/login/logout/buildAndPush)**
  **Do:** command mapping incl. tags list, Dockerfile/context defaults, registry connection → `.env` creds or ambient; image-name construction rules.
  **Ground:** `Tasks/DockerV2` task.json + source — pin: default Dockerfile/context resolution, tag defaulting, how registry endpoint fields form the image path (this naming logic is subtle and must not be invented); docker CLI docs per emitted flag.
  **Done:** bats with docker mocked + one real build/push to a scratch registry; live parity of pushed tags.
- [ ] **E10-S03-T02 — `HelmDeploy@0` + `HelmInstaller@1`**
  **Do:** commands (`install/upgrade/package/…`) arg construction; `connectionType` kubeconfig vs azure (AKS credentials via `az aks get-credentials`); installer → tool cache.
  **Ground:** `Tasks/HelmDeployV0` task.json + source (pin arg assembly per command + connectionType handling); helm CLI docs per flag; `HelmInstallerV1` source for version resolution.
  **Done:** bats arg-assembly snapshots vs pinned source logic; live parity against a kind/AKS test cluster.
- [ ] **E10-S03-T03 — `KubernetesManifest@1`, `Kubernetes@1`, `KubectlInstaller@0`**
  **Do:** `deploy`/`bake`/`scale`/`patch` actions; bake via helm/kustomize per source; namespace/manifest input handling; plain `kubectl` passthrough for Kubernetes@1.
  **Ground:** each task.json + source pinned (KubernetesManifest's deploy/bake logic especially — it rewrites manifests; document what we do/don't reproduce as explicit deltas with claims).
  **Done:** bats snapshots; live parity: deploy fixture manifest to test cluster; deltas listed in coverage gap output.

## E10-S04 — As a pipeline developer, ARM/Bicep, Key Vault and storage tasks work locally, so infra pipelines are debuggable.
- [ ] **E10-S04-T01 — `AzureResourceManagerTemplateDeployment@3` (+ `AzureResourceGroupDeployment@2` legacy)**
  **Do:** `az deployment group create` mapping (template/parameters files incl. Bicep passthrough), `deploymentMode` matrix, `deploymentOutputs` → output variable with the **exact JSON shape the task produces**.
  **Ground:** task.json + source — pin the deploymentOutputs serialization code (its shape is a known gotcha; copy, don't guess); az deployment docs per flag; scope variants (@3 supports multiple scopes — quote which we support with claims).
  **Done:** bats; live parity deploying a trivial template; output-variable shape byte-compared to a real run's.
- [ ] **E10-S04-T02 — `AzureKeyVault@2`**
  **Do:** ambient mode (`az keyvault secret list/show` → secret local variables honoring `secretsFilter`) and offline mode (`KV_<vault>_<secret>` from `.env`); `runAsPreJob` → emitted as first step with note.
  **Ground:** task.json + source — pin: variable naming for fetched secrets (exact transform), secretsFilter semantics, versioned-secret handling; az keyvault docs per command.
  **Done:** bats both modes; live parity: variable names/casing match a real run (transcript).
- [ ] **E10-S04-T03 — `AzureFileCopy@6`**
  **Do:** azcopy invocation for blob/file destinations; auth via ambient azcopy login/SAS from `.env`; `doctor` azcopy rule.
  **Ground:** task.json + source (pin: which azcopy verbs/flags per destination; how it authenticates — recent majors use service connection AAD); azcopy docs per flag; deltas (VM copy unsupported → stub with claim) documented.
  **Done:** bats; live parity uploading to a scratch storage account.

## E10-S05 — As a pipeline developer, rolling/canary deployment strategies execute their hooks locally, so strategy logic is debuggable.
- [ ] **E10-S05-T01 — Strategy runtime (`rolling`, `canary`)**
  **Do:** hook sequencing per iteration, `strategy.*` variables (`name`, `cycle`, `increment`) populated per docs; batching collapsed to sequential with documented delta.
  **Ground:** deployment-jobs doc strategy sections — quote hook order and each documented `strategy.*` variable; verify variable presence/values via a real canary run in test org (transcript).
  **Done:** bats: hook order + variables per claims; delta (no real VM batching) in coverage gaps.
- [ ] **E10-S05-T02 — Doctor rules for the priority set**
  **Do:** tool checks (az, docker, helm, kubectl, azcopy, pwsh+Az) with min versions sourced from each handler's requirements.
  **Ground:** min versions cited from the pinned task sources' own checks or vendor support matrices (pin per tool).
  **Done:** doctor output snapshot for a fixture using all; missing-tool remediation strings reviewed.
