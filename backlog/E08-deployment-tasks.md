# E08 — Priority deployment tasks

Phase: P3 · Depends on: E07 (real-task mode), E09 (auth/.env plumbing) · Design: docs/03 D, docs/05 · Priority per decision 2026-07-30.
Primary grounding set: `microsoft/azure-pipelines-tasks` — pinned `task.json` + implementation per task · per-task reference pages · service-connection docs (…/pipelines/library/service-endpoints) · CLI vendor docs (az, docker, helm, kubectl, azcopy).

> **Approach changed by the simplification (docs/07).** The original E10 hand-wrote a bash
> transpiler per task. That ambition is dropped (PLAN D4). Deployment tasks now run through
> **real-task mode** (E07) — the real task package against an emulated `azure-pipelines-task-lib` —
> with a service-connection `.env` contract and ambient-auth helpers where the task shells out to
> `az`/`docker`/`helm`/`kubectl`. This epic's work is therefore: (1) the connection contract,
> (2) ambient-auth glue, and (3) a **verification pass** that proves each priority task behaves
> under real-task mode, documenting deltas instead of transpiling around them.

Inherited open cell (from E02-S04-T01 decision 19): the **deployment-scoped variable slot for the
`environment` context** is unmeasured (the test org has no environment). Whichever task here first
provisions one should re-run that probe and close `SLOT_AVAILABILITY` for it (C-E02-091).

## E08-S01 — As a pipeline developer, Azure service connections have a faithful local substitute, so every Azure task can authenticate.
Acceptance: `.env` contract + `azdo_sc_login` per docs/03 §5, grounded in real endpoint schemas.

- [!] **E08-S01-T01 — Service-connection `.env` contract generator** *(**The contract, the generator and the mapping table are done 2026-09-02 in `packages/emit/src/service-connection.ts`; "manifest wiring" waits on the model carrying `connectedService:*` inputs, which is E08-S02 work.** `connectionManifestEntry` produces the entry — nothing yet collects the connections a pipeline references, because no step model exposes them. Both other Done items are met: generator tests, and the endpoint-field → env-key → consuming-code table is C-E08-001..004.)*
  **Do:** per-connection block synthesis (mode `ambient`|`sp`, subscription/tenant/client fields), provenance comments, manifest wiring.
  **Ground:** service-endpoints doc + the AzureRM endpoint's field names as consumed by task common code — pin the task `Common` Azure auth module showing which endpoint fields tasks read (`servicePrincipalId`, `tenantId`, …); our `.env` keys map 1:1.
  **Done:** generator tests; mapping table in research note (endpoint field → env key → consuming code permalink).
- [!] **E08-S01-T02 — `azdo_sc_login` runtime helper** *(**Built and fully tested with `az` mocked 2026-09-02; the "live check once with a throwaway SP" half of Done is not reachable here.** Creating a service principal is an outward-facing write to the owner's Entra tenant, and `az` on this machine has an expired refresh token (the same blocker E09-S01-T02 recorded). Every branch — ambient probe, spnKey, spnCertificate, no-subscription, each error path — is covered by bats against a stub `az` that records its argv. **Run `az login`, create a throwaway SP, and the remaining check is one invocation.** **docs/03 §5 was corrected in this task** (decisions entry 73): its `SC_<NAME>_*` keys were transpiler-era and would be read by nobody under real-task mode.)*
  **Do:** bash: `ambient` no-op probe (`az account show`) vs `sp` login (`az login --service-principal`), subscription selection, logout policy, error hints.
  **Ground:** az CLI docs for `login --service-principal` and `account set` (pin); `AzureCLIV2` source's own login sequence (pin) — mirror its order.
  **Done:** bats with az mocked; live check once with a throwaway SP.

## E08-S02 — As a pipeline developer, the priority Azure/K8s tasks run locally against my real subscription, so deploy debugging is genuinely local.
Acceptance: each task verified under real-task mode; deltas documented, not transpiled.

- [!] **E08-S02-T01 — `AzureCLI@2` + `AzurePowerShell@5`** *(**Everything offline is done 2026-09-04 and Done item 1 is met; the live parity check is not reachable without an owner decision.** The Do field's "wire `azdo_sc_login`/`Connect-AzAccount` ambient glue" turned out to be **unwriteable, and that is the task's finding** (C-E08-036/037/039): neither task has a path that reuses an ambient session — `AzureCLI@2` reads the endpoint scheme with `required=true`, logs in unconditionally, and repoints `AZURE_CONFIG_DIR` at a throwaway directory; `AzurePowerShell@5` requires the endpoint object too. Both then **destroy a local session** — `az account clear` and `Clear-AzContext -Scope CurrentUser -Force`, the latter with no opt-out. So the glue became a preflight (`azdo_sc_preflight`, wired into every real-task step that names a connection) plus a convert-time hazard warning, and the collector forces such connections to `sp` mode. Doctor rules registered: `az`, `pwsh`, **and `Az.Accounts`** — a module, not a binary (C-E08-041); confirmed live on this machine (`az` 2.89.1 ok, `pwsh` 7.6.5 ok, `Az.Accounts` missing). **Blocked 2026-09-04 on Done item 2 only:** "one live parity check (a task-side `az account show` matches the cloud run)" needs an Azure **service connection** in the test org, which means creating a service principal in the owner's personal Entra tenant — the same outward-facing write E08-S01-T02 is blocked on. Authorize that and the check is one hosted run.)*
  **Do:** verify both run under real-task mode with the `.env` connection; wire `azdo_sc_login`/`Connect-AzAccount` ambient glue; register doctor rules (az, pwsh + Az).
  **Ground:** `Tasks/AzureCLIV2` + `Tasks/AzurePowerShellV5` task.json + source — pin the login sequence and env injection each performs, so our glue matches rather than guesses.
  **Done:** bats with az/pwsh present; one live parity check (a task-side `az account show` matches the cloud run).
- [ ] **E08-S02-T02 — `Docker@2` (build/push/login)**
  **Do:** verify under real-task mode; registry connection → `.env` creds or ambient docker login; document image-name construction deltas (if any).
  **Ground:** `Tasks/DockerV2` task.json + source — pin default Dockerfile/context resolution and image-path construction (do not invent); docker CLI docs per flag.
  **Done:** one real build/push to a scratch registry; parity of pushed tags.
- [ ] **E08-S02-T03 — `HelmDeploy@0` / `HelmInstaller@1` / `KubectlInstaller@0` / `Kubernetes@1` / `KubernetesManifest@1`**
  **Do:** verify under real-task mode; `connectionType` kubeconfig vs AKS credentials via `az aks get-credentials`; installers → tool cache.
  **Ground:** each task.json + source pinned (arg assembly per command, connectionType handling); helm/kubectl docs per flag; manifest-rewrite deltas documented as claims.
  **Done:** bats arg-assembly snapshots; live parity against a kind/AKS test cluster; deltas in the warnings list.
- [ ] **E08-S02-T04 — `AzureResourceManagerTemplateDeployment@3`, `AzureKeyVault@2`, `AzureFileCopy@6`**
  **Do:** verify under real-task mode; ambient `az deployment group create` / `az keyvault secret` / azcopy glue; Key Vault ambient mode + offline `KV_<vault>_<secret>` from `.env`.
  **Ground:** each task.json + source — pin the `deploymentOutputs` JSON shape (a known gotcha), Key Vault variable-naming transform, and azcopy verbs/auth per destination.
  **Done:** live parity: deploy a trivial template, read a secret, upload to a scratch storage account; output-variable shape byte-compared.

## E08-S03 — As a pipeline developer, deployment strategies execute their hooks locally, so strategy logic is debuggable.
Acceptance: `runOnce`/`rolling`/`canary` hook sequencing with service-matching `strategy.*` variables.

- [!] **E08-S03-T01 — Strategy runtime (`runOnce`, `rolling`, `canary`)** *(**Both Done items are met 2026-09-02 — bats for hook order and variables, and the deltas in the warnings list — but the Ground field also asks to "verify variable presence/values via a real canary run in the test org", which needs a queued deployment run (the same blocker as E09-S03-T02/T03).** Everything is grounded from the deployment-jobs page instead (`git_commit_id` `1eeaa8de…`), and one **Do-field correction** is recorded: the third variable is `strategy.action`, **not `strategy.cycle`** — no `cycle` exists anywhere on the page, and `action` is the one the page's own canary example passes to `KubernetesManifest@1` (C-E08-013).)*
  **Do:** hook sequencing per iteration, `strategy.*` variables (`name`, `cycle`, `increment`) populated; batching collapsed to sequential with a documented delta.
  **Ground:** deployment-jobs doc strategy sections — quote hook order and each `strategy.*` variable; verify variable presence/values via a real canary run in the test org.
  **Done:** bats: hook order + variables per claims; delta in the warnings list.
- [x] **E08-S03-T02 — Doctor rules for the priority set**
  **Do:** tool checks (az, docker, helm, kubectl, azcopy, pwsh+Az) with min versions sourced from each task's own requirements.
  **Ground:** min versions cited from the pinned task sources' checks or vendor support matrices (pin per tool).
  **Done:** doctor output snapshot for a fixture using all; missing-tool remediation strings reviewed.
