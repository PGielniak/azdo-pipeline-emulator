# E08 — priority deployment tasks: grounding claims

Epic rule (BACKLOG §3): every runtime behavior cites an official doc page or a commit-pinned
GitHub source. This epic's primary sources are `microsoft/azure-pipelines-tasks` (what a task reads
off a service connection) and `microsoft/azure-pipelines-task-lib` (how those reads reach it).

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E08-001` … `C-E08-029` | E08-S01 the connection contract | |
| `C-E08-030` … `C-E08-042` | E08-S02-T01 `AzureCLI@2` + `AzurePowerShell@5` | |
| `C-E08-043` … `C-E08-059` | E08-S02-T02…T04 per-task verification | *unallocated* |

---

## E08-S01-T01 — the service-connection `.env` contract (`C-E08-001..005`)

Recorded 2026-09-02, before implementation. The task's **Ground** field asks for the mapping
*endpoint field → env key → consuming code*; the three claims below are that table, and the fourth
is a distinction the obvious implementation gets wrong.

[C-E08-001] **A service connection reaches a task as three families of environment variable, and
the key is upper-cased while the connection *name* is not.**

| what a task calls | environment variable | vaulted? |
| --- | --- | --- |
| `getEndpointAuthorizationScheme(id)` | `ENDPOINT_AUTH_SCHEME_<id>` | yes |
| `getEndpointAuthorizationParameter(id, key)` | `ENDPOINT_AUTH_PARAMETER_<id>_<KEY>` | yes |
| `getEndpointDataParameter(id, key)` | `ENDPOINT_DATA_<id>_<KEY>` | **no** |

Verbatim: `im._vault.retrieveSecret('ENDPOINT_AUTH_PARAMETER_' + id + '_' + key.toUpperCase())` and
`process.env['ENDPOINT_DATA_' + id + '_' + key.toUpperCase()]`. **The `id` is interpolated
untransformed** — only the *key* is upper-cased — so a connection named `MyProd-Sub` produces
`ENDPOINT_AUTH_PARAMETER_MyProd-Sub_TENANTID`, and a generator that upper-cased the whole name would
emit a variable no task ever reads.
  — https://github.com/microsoft/azure-pipelines-task-lib/blob/d4eecb2abcf7f2024f0d09c33f4bca7b63d6658a/node/task.ts
    (`getEndpointDataParameter` L486-495, `getEndpointAuthorizationScheme` L517-518,
    `getEndpointAuthorizationParameter` L548-557; checked 2026-09-02)

[C-E08-002] **Auth values are treated as secrets and *removed* from the process environment; data
values are not.** `_loadData` sweeps five prefixes into the vault and deletes each from
`process.env` (C-E07-006) — `ENDPOINT_AUTH_` is among them and **`ENDPOINT_DATA_` is not**.
**Consequence:** after task-lib initializes, a subscription id is still visible to anything reading
`process.env` while a service-principal key is not. That is the right split for us to reproduce, and
it decides which `.env` keys carry a secret marker.
  — same file, `internal.ts` `_loadData` L788-818 (pinned in C-E07-006)

[C-E08-003] **The AzureRM endpoint's field names, as a real task reads them.** `AzureCLIV2` — the
task E08-S02-T01 must run — reads: `SubscriptionID` and `environment` as **data**; and
`serviceprincipalid`, `tenantid`, `serviceprincipalkey`, `servicePrincipalCertificate`,
`authenticationType`, `idToken` as **auth**. All become upper-cased env keys, so `SubscriptionID`
is `ENDPOINT_DATA_<id>_SUBSCRIPTIONID`.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/093f47b9598eb48af6a972dbc2b223c244b344b9/Tasks/AzureCLIV2/azureclitask.ts
    (`loginAzureRM` L308-360, `getIdToken` L460-465; checked 2026-09-02)

[C-E08-004] **The scheme selects which fields exist, and the two live schemes are
`serviceprincipal` and workload-identity federation.** `loginAzureRM` branches on
`getEndpointAuthorizationScheme(...).toLowerCase()`: the `serviceprincipal` arm reads
`authenticationType` and then either `serviceprincipalkey` (secret) or
`servicePrincipalCertificate`; the federation arm uses `idToken` and exports
`AZURESUBSCRIPTION_SERVICE_CONNECTION_ID` / `_CLIENT_ID` / `_TENANT_ID` for downstream tooling.
**Consequence for us:** a generated `.env` block is scheme-shaped — emitting every field for every
connection would ask a user to fill in credentials their connection does not have.
  — same file as C-E08-003

[C-E08-005] **Our `ambient` mode is ours, and it is the point of the epic.** No source describes it:
docs/03 D's premise is that a developer converting their own pipeline is usually *already* logged in
to `az`/`docker`/`kubectl`, so the default connection mode reuses that ambient session and emits no
credential fields at all. `sp` is the explicit-credential fallback. Recorded so the mode switch is
not mistaken for a service behavior.
  — project design (docs/03 D, docs/05 §1); no source claims otherwise

---

## E08-S01-T02 — the `azdo_sc_login` runtime helper (`C-E08-006..010`)

Recorded 2026-09-02, before implementation.

[C-E08-006] **`az login --service-principal` takes the app id as `--username`, the secret as
`--password`, and the tenant as `--tenant`.** Verbatim example:
`az login --service-principal --username APP_ID --password CLIENT_SECRET --tenant TENANT_ID`.
  — https://learn.microsoft.com/en-us/cli/azure/reference-index?view=azure-cli-latest#az-login
    (deep-verified 2026-09-02; `git_commit_id` `8b680860f395c637c57e0feeee26c7d4735b2776`,
    `ms.date` 2026-08-04)

[C-E08-007] **A certificate is *no longer* passed through `--password`.** The page carries an
explicit warning: "`--password` no longer accepts a service principal certificate. Use
`--certificate` to pass a service principal certificate", with the example
`az login --service-principal --username APP_ID --certificate /path/to/cert.pem --tenant TENANT_ID`.
**Consequence:** the `spnCertificate` arm of C-E08-004 must write the PEM to a file and pass
`--certificate`; reusing the secret arm would fail against any current `az`.
  — same page

[C-E08-008] **A client secret beginning with `-` must be passed as `--password=secret`.** Verbatim:
"Use --password=secret if the first character of the password is '-'." Without the `=` form the CLI
parses the value as another flag. **This is the kind of failure that looks like a wrong credential**
— `az` reports an authentication error, not an argument error — so the helper always uses the `=`
form rather than only when the value happens to start with a dash.
  — same page

[C-E08-009] **`--allow-no-subscriptions` exists for tenants without a subscription:** "Support
accessing tenants without subscriptions. It's useful to run tenant-level commands, such as 'az ad'."
Recorded because a connection whose `SubscriptionID` is empty is a legitimate configuration, not a
missing field, and the helper should not demand one.
  — same page

[C-E08-010] **`AzureCLIV2` logs in and then selects the subscription, in that order**, and exports
`AZURESUBSCRIPTION_SERVICE_CONNECTION_ID` / `_CLIENT_ID` / `_TENANT_ID` on the federation arm for
downstream tooling to pick up. Our helper mirrors that order: authenticate, then `az account set`,
because selecting a subscription before there is a session fails with a message about the
subscription rather than about the login.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/093f47b9598eb48af6a972dbc2b223c244b344b9/Tasks/AzureCLIV2/azureclitask.ts
    (`loginAzureRM` L308-360; checked 2026-09-02)

---

## E08-S03-T01 — deployment strategies (`C-E08-011..017`)

Recorded 2026-09-02, before implementation. Page deep-verified: `git_commit_id`
`1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`, `ms.date` 2025-07-17.

[C-E08-011] **One hook order serves all three strategies:** `preDeploy` → `deploy` → `routeTraffic`
→ `postRouteTraffic`, then `on: failure` **or** `on: success` — never both. The page describes the
hooks once, for every strategy, and each strategy section repeats "Then, either `on: success` or
`on: failure` is executed."
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/deployment-jobs
    (deep-verified 2026-09-02)

[C-E08-012] **What iterates differs per strategy, and canary is not "rolling with numbers".**
runOnce: "all the lifecycle hooks … are executed once". rolling: "`preDeploy`, `deploy`,
`routeTraffic`, and `postRouteTraffic` are executed **once per batch size defined by
`maxParallel`**" — all four iterate. canary: "supports the `preDeploy` lifecycle hook (**executed
once**) and iterates with the `deploy`, `routeTraffic`, and `postRouteTraffic` lifecycle hooks" —
`preDeploy` runs **once**, outside the loop. Treating the two the same would run canary's
initialization once per increment.
  — same page

[C-E08-013] **The task's Do field names the wrong third variable: it is `strategy.action`, not
`strategy.cycle`.** The page lists exactly three under canary — `strategy.name` ("Name of the
strategy. For example, canary"), `strategy.action` ("The action to be performed on the Kubernetes
cluster. For example, deploy, promote, or reject") and `strategy.increment` ("The increment value
used in the current interaction") — and under rolling only "The `strategy.name` variable is
available in this strategy block". **No `strategy.cycle` appears anywhere on the page.** Implementing
`cycle` would have created a variable no pipeline can meaningfully read, and omitted `action`, which
the page's own canary example passes to `KubernetesManifest@1` as `action: $(strategy.action)`.
  — same page

[C-E08-014] **`strategy.increment` is scoped to three hooks, not to the whole job.** Verbatim: "This
variable is available only in `deploy`, `routeTraffic`, and `postRouteTraffic` lifecycle hooks." So
it is absent in `preDeploy` — consistent with C-E08-012's "executed once" — and absent in the `on:`
hooks.
  — same page

[C-E08-015] **`increments` is a *list*, `maxParallel` is a number or a percentage.** canary:
`increments: [ number ]`, and the worked example is `increments: [10, 20]` — "first deploy the
changes with 10-percent pods, followed by 20 percent". rolling: `maxParallel: [ number or percentage
as x% ]`, "for percentages, mention as x%". So a canary iteration count is the list length, while a
rolling iteration count depends on how many VMs exist — which is why the local delta differs between
them (C-E08-017).
  — same page

[C-E08-016] **Output-variable keys are strategy-shaped, which is the naming C-E04-154 reserved for
this epic.** Verbatim: runOnce is `dependencies.<job-name>.outputs['<job-name>.<step-name>.<variable-name>']`;
runOnce with a `resourceType` is `'Deploy_<resource-name>.<step-name>.<variable-name>'`; canary is
`'<lifecycle-hookname>_<increment-value>.<step-name>.<variable-name>'` (the example reads
`deploy_10.setvarStep.myOutputVar`, lower-case hook name); rolling is
`'<lifecycle-hookname>_<resource-name>.<step-name>.<variable-name>'`.
  — same page

[C-E08-017] **The local deltas, stated rather than hidden (PLAN D10).** Two things this runtime
cannot reproduce and must therefore report: (a) **rolling has no VM set locally** — the page says
"We currently only support the rolling strategy to VM resources", and a converted project has no
deployment group, so a rolling strategy collapses to **one** iteration rather than one per batch;
(b) **`maxParallel` is not honoured** — batching is collapsed to sequential execution (the task's own
Do says so), so a `maxParallel: 5` pipeline runs its single local iteration serially. Canary is the
better-behaved case: `increments` is authored data, so the iteration *count* is reproducible even
though the percentages mean nothing without a cluster.
  — page as above for the VM-only constraint; the collapse is our documented limitation

---

## E08-S03-T02 — doctor rules for the priority set (`C-E08-018..020`)

Recorded 2026-09-02. The task's **Do** says minimums should be "sourced from each task's own
requirements", and its **Ground** offers a fallback: "or vendor support matrices". Both were
checked, and neither yields a usable floor — for two different reasons.

[C-E08-018] **The task-side source yields nothing, as C-E10-009 already established.** No task in
the priority set declares a minimum for the CLI it invokes: `demands` is `[]` on every one that
carries the field, and `minimumAgentVersion` is an *agent* version (C-E10-008), not a tool version.
  — the five `task.json` files at `azure-pipelines-tasks @ 093f47b9598eb48af6a972dbc2b223c244b344b9`

[C-E08-019] **Vendor support matrices exist, but they state *supported-ness*, not *functionality* —
and using one as a doctor floor would fail working installations.** Kubernetes: "`kubectl` is
supported within one minor version (older or newer) of `kube-apiserver`", and "The Kubernetes
project maintains release branches for the most recent three minor releases". Helm: "Helm is assumed
to be compatible with `n-3` versions of Kubernetes it was compiled against", with 4.0.x the oldest
listed as supported. **Neither says the older version stops working** — a kubectl a few minors behind
still drives most clusters, and a doctor that refused it would report a perfectly functional setup
as outdated. That is the same failure C-E10-008 describes, reached from the other direction.
  — https://kubernetes.io/releases/version-skew-policy/ and https://helm.sh/docs/topics/version_skew/
    (both checked 2026-09-02)

[C-E08-020] **So the priority set's doctor rules declare tools and no floors, and the bar for adding
one is stated rather than left to judgement.** A `min` is justified only by evidence that the tool
*fails* below it — a task-side version check, or a vendor statement that a feature the task uses was
introduced in a given release. A support-lifecycle date is not that evidence. `checkToolContract`
(E10-S04-T02) enforces the citation, so this cannot be quietly reversed.
  — project policy, following the Ground field's "doctor never invents versions"

---

## E08-S02-T01 — `AzureCLI@2` + `AzurePowerShell@5` under real-task mode (`C-E08-030..042`)

Recorded 2026-09-03, before implementation. Two sources: the two tasks' own `task.json` and
implementation, vendored/pinned at `v277` = `8ba25cfb5c7736ba98a37488c0323f7320cb5b3e`; and five
oracle transcripts under `research/experiments/E08-azure-auth/`, which answer what the **expansion**
does with these steps — the only half of the question the service can settle, because the emitter
builds its model from `finalYaml`.

The Ground field asks to "pin the login sequence and env injection each performs, so our glue
matches rather than guesses". The measurement is that **there is no glue to write**: neither task
has a path that reuses an ambient session, and both actively destroy one. That inverts the Do's
"wire `azdo_sc_login`/`Connect-AzAccount` ambient glue" into a *preflight and a warning*, and it is
the substance of this task.

### What the expansion does — and does not — do (`C-E08-030..034`)

[C-E08-030] **A task input's `aliases` are interchangeable with its name in YAML.** Verbatim: "you
can add an `aliases` array to the `input` definition. It's an array of strings which will be
considered equivalent to the input's real name." Both tasks here declare the connection input with
the alias `azureSubscription`, which is the spelling nearly every real pipeline writes.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/docs/authoring/yaml-tasks.md
    (L65-70; checked 2026-09-03)

[C-E08-031] **The expansion does *not* resolve an alias to the declared name — inputs are passed
through verbatim.** `azureSubscription: my-azure-sub` comes back as `azureSubscription:`;
`connectedServiceNameARM: my-azure-sub` comes back as `connectedServiceNameARM:`. **Consequence:**
alias resolution is entirely ours. A host that matches step inputs to declarations by name only
hands an aliased input to the task under a name it never reads — `INPUT_AZURESUBSCRIPTION` instead
of `INPUT_CONNECTEDSERVICENAMEARM` — and the task fails as if the connection were missing.
  — `research/experiments/E08-azure-auth/azurecli-alias.md` +
    `research/experiments/E08-azure-auth/azurecli-declared-name.md` (checked 2026-09-03)

[C-E08-032] **The expansion does not normalize input-name case either.** `ScriptType:` and `Inline:`
survive as authored against `AzurePowerShell@5`, whose `task.json` declares them in exactly that
case; a `scripttype:` would have survived too. So the case-folded lookup `resolveTaskInputs` already
performs is load-bearing rather than defensive.
  — `research/experiments/E08-azure-auth/azurepowershell-alias.md` (checked 2026-09-03)

[C-E08-033] **An input the task does not declare is not rejected at expansion time.** `noSuchInput:
whatever` expands successfully. So `InputResolution.undeclared` is a shape the emitter really does
see, and dropping it would be a silent behavior change.
  — `research/experiments/E08-azure-auth/azurecli-unknown-input.md` (checked 2026-09-03)

[C-E08-034] **A missing `required: true` input is not an expansion-time error either.** A step with
no connection input at all expands. Requiredness is enforced by the task, at
`getInput(name, true)` — so the converter must report it itself or the user meets it as a task-lib
throw at run time.
  — `research/experiments/E08-azure-auth/azurecli-missing-connection.md` (checked 2026-09-03)

### The connection input, as each task declares it (`C-E08-035`)

[C-E08-035] **Both tasks declare their connection input with type `connectedService:AzureRM`,
`required: true`, and the alias `azureSubscription` — but under different *names* and different
*case*.** `AzureCLI@2`: `connectedServiceNameARM`. `AzurePowerShell@5`: `ConnectedServiceNameARM`.
**Consequence:** a collector that looks for a hard-coded input name is wrong for at least one of
them and for every other Azure task; keying on the declared `type` prefix `connectedService:` is
what generalizes.
  — `packages/emit/vendor/tasks-meta/AzureCLI@2/task.json` and
    `packages/emit/vendor/tasks-meta/AzurePowerShell@5/task.json`, both pinned at `v277` =
    `8ba25cfb5c7736ba98a37488c0323f7320cb5b3e` with `PROVENANCE.json` beside them (checked 2026-09-03)

### `AzureCLI@2`: no ambient path, and it clears the session it did not create (`C-E08-036..038`)

[C-E08-036] **`AzureCLI@2` requires the endpoint and always logs in — there is no arm that reuses an
existing `az` session.** The task reads
`tl.getEndpointAuthorizationScheme(connectedService, true)` — `required = true`, so an absent
`ENDPOINT_AUTH_SCHEME_<name>` throws before anything else happens — and `loginAzureRM` branches
`workloadidentityfederation` → `az login --service-principal … --federated-token`,
`serviceprincipal` → `az login --service-principal … --password=/--certificate=`,
`managedserviceidentity` → `az login --identity`, `else` → `throw tl.loc('AuthSchemeNotSupported')`.
**Consequence:** connection `mode: ambient` (C-E08-005) cannot work for a task run in real-task
mode. Ambient remains correct only for a *native* script step that calls `az` itself and signs in
through `azdo_sc_login`.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/AzureCLIV2/azureclitask.ts
    (`run` L79-83, `loginAzureRM` L305-417; checked 2026-09-03)

[C-E08-037] **Even a successful ambient `az login` would be invisible to the task: it repoints
`AZURE_CONFIG_DIR` at a fresh per-invocation directory** unless the step sets
`useGlobalConfig: true`. Verbatim from `setConfigDirectory`: "use a freshly-created, unpredictable
per-invocation directory so that an earlier step cannot pre-seed `$(Agent.TempDirectory)/.azclitask/config`
with a poisoned `extension.index_url`". So the "just log in first" workaround does not work either —
the second, independent reason C-E08-036's conclusion holds.
  — same file (`setConfigDirectory` L419-437; checked 2026-09-03)

[C-E08-038] **`AzureCLI@2` ends with `az account clear`.** `logoutAzure()` runs unconditionally when
the task logged in. With the default per-invocation config dir it clears only that throwaway
profile; with `useGlobalConfig: true` it clears **the developer's own `az` profile**.
**Consequence:** a converted step carrying `useGlobalConfig: true` will sign the developer out of
`az` on their own machine. That is a data-loss hazard in the emitted project's path, not a fidelity
note, and it is warned about at convert time and again at run time.
  — same file (`run` L216-218, `logoutAzure` L447-455; checked 2026-09-03)

### `AzurePowerShell@5`: it clears the developer's saved Az context, unconditionally (`C-E08-039..041`)

[C-E08-039] **`InitializeAz.ps1` runs `Clear-AzContext -Scope CurrentUser -Force` before connecting,
and nothing gates it.** The Node handler builds the endpoint object
(`new AzureRMEndpoint(serviceName).getEndpoint()` — so the endpoint is required here too) and
unconditionally appends `InitializeAz.ps1 -endpoint '<json>'` to the generated script; the script
then runs `Clear-AzContext -Scope Process` **and** `Clear-AzContext -Scope CurrentUser -Force
-ErrorAction SilentlyContinue`. `CurrentUser` scope is the **on-disk** context store.
**Consequence:** running this task locally in real-task mode deletes the developer's saved
`Connect-AzAccount` session. There is no `useGlobalConfig` equivalent to opt out, so the honest
output is a warning, not a mitigation.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/AzurePowerShellV5/azurepowershell.ts
    (L47-48, L96-107) and
    https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/AzurePowerShellV5/InitializeAz.ps1
    (L50-53; both checked 2026-09-03)

[C-E08-040] **On a non-Windows host `AzurePowerShell@5` accepts only `SPNKey`, and only two
schemes.** `InitializeAz.ps1`: the `ServicePrincipal` arm throws "Only SPNKey auth type is supported
for ServicePrincipal auth scheme using non windows agent." for any other `authenticationType`, and
the outer `else` throws "Only SPN credential and WorkloadIdentityFederation auth schemes are
supported for non windows agent." **Consequence for the `.env` generator:** a connection consumed
only by this task must **not** be offered a `servicePrincipalCertificate` line — that would ask the
user to fill in a credential the task rejects. (Windows host is out of scope, CLAUDE.md.)
  — same `InitializeAz.ps1` (L76-95, L128-131; checked 2026-09-03)

[C-E08-041] **`AzurePowerShell@5` requires the `Az.Accounts` PowerShell module, by name.**
`InitializeAz.ps1` does `Get-Module -Name Az.Accounts -ListAvailable` and, when nothing is found,
throws "Could not find the module Az.Accounts with given version." **Consequence:** the doctor rule
for this task is `pwsh` *plus* `Az.Accounts` — a `pwsh` that is present but has no Az module fails
the task, and a doctor that reported only `pwsh` would call that machine ready.
  — same `InitializeAz.ps1` (L21-45; checked 2026-09-03)

[C-E08-042] **Both tasks need `Agent.TempDirectory`, and the runtime already provides it.**
`AzurePowerShell@5` calls `tl.checkPath(tempDirectory, …)` on `agent.tempDirectory` and throws when
it is unset; `AzureCLI@2` warns and falls back to the global config dir. `emitEntrypoints` seeds
`Agent.TempDirectory` as `"$AZDO_WORKSPACE_DIR/tmp"` before any step runs, so this is a checked
prerequisite rather than a gap — recorded so a later reader does not re-derive it.
  — `azurepowershell.ts` L18-19 and `azureclitask.ts` L425-429 (same commit) ·
    `packages/emit/src/entrypoints.ts` L167 (checked 2026-09-03)
