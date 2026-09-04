# E08 — priority deployment tasks: grounding claims

Epic rule (BACKLOG §3): every runtime behavior cites an official doc page or a commit-pinned
GitHub source. This epic's primary sources are `microsoft/azure-pipelines-tasks` (what a task reads
off a service connection) and `microsoft/azure-pipelines-task-lib` (how those reads reach it).

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E08-001` … `C-E08-029` | E08-S01 the connection contract | |
| `C-E08-030` … `C-E08-042` | E08-S02-T01 `AzureCLI@2` + `AzurePowerShell@5` | |
| `C-E08-043` … `C-E08-052` | E08-S02-T02 `Docker@2` | |
| `C-E08-053` … `C-E08-059` | E08-S02-T03/T04 per-task verification | *unallocated* |

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

---

## E08-S02-T02 — `Docker@2` under real-task mode (`C-E08-043..052`)

Recorded 2026-09-04, before implementation. Sources: `Tasks/DockerV2` at the `v277` pin
`8ba25cfb5c7736ba98a37488c0323f7320cb5b3e`, and `docker-common` at
`4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d` in `microsoft/azure-pipelines-tasks-common-packages` —
**the commit where that package is version 2.276.0, which is exactly what `DockerV2@v277`'s
`package.json` depends on.** HEAD of that repo is 2.279.0; reading HEAD would have meant reading
code this task version does not run. The common packages moved out of the tasks repo
(`common-npm-packages/MIGRATION_OF_COMMON_PACKAGES.md`), which is why the obvious in-repo path 404s.

E08-S02-T01 found a task that cannot use an ambient session and destroys the local one. **`Docker@2`
is the opposite on the second count and subtler on the first**, and both differences are measured
below rather than assumed by symmetry.

### The connection, and a fourth variable family (`C-E08-043..046`)

[C-E08-043] **`Docker@2`'s connection input is `containerRegistry`, declared
`connectedService:dockerregistry` — a different endpoint kind from `connectedService:AzureRM`, in
lowercase — with no aliases and, notably, `required` unset.** A pipeline that only builds needs no
registry at all. **Consequence:** the collector's type-prefix match (C-E08-035) finds it, but the
`.env` fields for it are *not* the AzureRM set — a connection block offering
`ENDPOINT_DATA_<name>_SUBSCRIPTIONID` to a Docker registry asks for a value nothing reads.
  — `packages/emit/vendor/tasks-meta/Docker@2/task.json`, pinned at `v277` with `PROVENANCE.json`
    beside it (checked 2026-09-04)

[C-E08-044] **A generic registry connection is read through a *fourth* endpoint variable family:
`ENDPOINT_AUTH_<id>`, a JSON blob — and the keys inside it are lowercase, verbatim.** task-lib's
`getEndpointAuthorization(id, optional)` does
`im._vault.retrieveSecret('ENDPOINT_AUTH_' + id)` and `JSON.parse`s it;
`GenericAuthenticationTokenProvider` then reads
`parameters["username"]`, `["password"]`, `["registry"]`, `["email"]` with **no `toUpperCase()`
anywhere on that path**, unlike `ENDPOINT_AUTH_PARAMETER_<id>_<KEY>` (C-E08-001).
**Consequence:** the per-key variables our `.env` contract emits are not read on this path at all,
and a blob generated with upper-cased keys parses cleanly and yields `undefined` for every field —
C-E08-001's failure mode in a new costume.
  — https://github.com/microsoft/azure-pipelines-task-lib/blob/c377a1115fdc0e5aea896df36219b59c181d9bc4/node/task.ts
    (`getEndpointAuthorization` L593-613) and
    https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/docker-common/registryauthenticationprovider/genericauthenticationtokenprovider.ts
    (L15-25; both checked 2026-09-04)

[C-E08-045] **A missing blob is an unexplained crash, not `LIB_EndpointAuthNotExist`.** Unlike its
sibling readers, `getEndpointAuthorization(id, false)` calls
`setResult(TaskResult.Failed, loc('LIB_EndpointAuthNotExist', id))` and then **returns `undefined`**
rather than throwing; `GenericAuthenticationTokenProvider` immediately dereferences
`.parameters`, so the user sees a `TypeError`. **Consequence:** this is the case a preflight is
worth the most — the task's own diagnostic is a stack trace.
  — same `task.ts` L593-613 (checked 2026-09-04)

[C-E08-046] **ACR and generic are chosen by a data parameter, and ACR needs one more field.**
`getDockerRegistryEndpointAuthenticationToken` branches on
`getEndpointDataParameter(endpointId, "registrytype", true) === "ACR"`; the ACR arm additionally
reads auth parameter `loginServer` **required** (`getEndpointAuthorizationParameter(id, key, false)`
throws when absent) and authenticates as a service principal, while everything else goes to the
generic provider and the blob of C-E08-044.
  — https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/docker-common/registryauthenticationprovider/registryauthenticationtoken.ts
    (L58-72; checked 2026-09-04)

### The ambient path is narrower than the source comment suggests (`C-E08-047`)

[C-E08-047] **`dockerbuild.ts` says "else, use the currently logged in registries" — but the config
it consults is one the task itself wrote, never the developer's `~/.docker/config.json`.**
`getExistingDockerConfigFilePath` resolves **only** through `tl.getVariable("DOCKER_CONFIG")` and
then requires `isPathInTempDirectory(configurationFilePath)`, i.e. the path must start with
`agent.tempDirectory` (or `os.tmpdir()`); otherwise it returns `null`. So with no
`containerRegistry`, `getRegistryUrlsFromDockerConfig` is empty and
`getQualifiedImageNamesFromConfig` takes its documented "tag the image to refer locally" branch —
the **bare, unqualified repository name**. Exporting `DOCKER_CONFIG=~/.docker` does not help: the
temp-directory guard rejects it.

**But the split matters, and it is the useful half of this claim:** with no token,
`openRegistryEndpoint` returns without writing anything (`if (authenticationToken)`), so
`DOCKER_CONFIG` stays unset and the **`docker` CLI itself falls back to `~/.docker/config.json`**.
So a local run has **ambient authentication and non-ambient image-name qualification**. A build
succeeds and tags `myapp:1`; a push then goes wherever an unqualified name resolves — Docker Hub —
rather than to the registry the developer is logged in to.
  — https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/docker-common/containerconnection.ts
    (`getExistingDockerConfigFilePath` L305-313, `isPathInTempDirectory` L389-397,
    `getRegistryUrlsFromDockerConfig` L363-380, `getQualifiedImageNamesFromConfig` L95-121,
    `openRegistryEndpoint` L251-253) and
    https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/DockerV2/dockerbuild.ts
    (L26-36; all checked 2026-09-04)
  — **confirmed by running the real task** (`research/experiments/E08-docker/real-task-run.md`,
    runs 3 and 4): with no connection the image is named `docker.io/library/ambientprobe:3.0.0`,
    and it stays unqualified even when `DOCKER_CONFIG` points at a directory holding a valid
    `auths` entry — the temp-directory guard rejects it. Run 4 is the discriminating test, because
    the source reading alone leaves "would `DOCKER_CONFIG` be enough?" arguable.

### `Docker@2` does **not** clobber the local session (`C-E08-048`)

[C-E08-048] **Measured, not assumed by symmetry with C-E08-038/039: this task leaves the
developer's docker credentials alone.** Three independent guards. (1) `close()` calls `logout()`
only when `isLogoutRequired` — `command === "logout"` **or** a registry is present — so with no
connection a build/push does not log out at all. (2) `logout()` restores `oldDockerConfigContent`,
cached in `open()` when it overwrote an existing auth for the same registry. (3) Deletion goes
through `removeConfigDirAndUnsetEnvVariable`, which deletes only when
`isPathInTempDirectory(dockerConfigDirPath)` holds. **Consequence:** `Docker@2` gets no
session-clobber warning, and the registry that records these hazards must be able to say "this task
was checked and is safe" rather than being silent about it.
  — same `containerconnection.ts` (`close` L124-138, `logout` L158-208,
    `removeConfigDirAndUnsetEnvVariable` L209-217, `isLogoutRequired` L223-225; checked 2026-09-04)

### Image names and tags, which the Do field says not to invent (`C-E08-049..052`)

[C-E08-049] **A qualified image name is `prefixRegistryIfRequired` then `generateValidImageName`, and
the second step is lossy.** The registry host is prefixed as `hostname + "/" + repository` — taken
from `url.parse(registry)`, `host` when the value has slashes and `href` when it does not — **unless
the hostname is `index.docker.io`**, because a Docker Hub repository name is already qualified. Then
`generateValidImageName` **lower-cases the whole name and strips every space**.
**Consequence:** `repository: MyApp` silently becomes `myapp`, and that is the name that gets pushed.
  — same `containerconnection.ts` (`getQualifiedImageName` L86-93, `prefixRegistryIfRequired`
    L392-405) and
    https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/docker-common/containerimageutils.ts
    (`generateValidImageName` L27-31, `hasRegistryComponent` L8-14; checked 2026-09-04)
  — **confirmed by running the real task** (same transcript, run 2): `repository: "E08 Parity"` was
    built and pushed as `localhost:5000/e08parity` — lower-cased, space-stripped, registry
    prefixed.

[C-E08-050] **The default `Dockerfile` input is a glob, and it resolves to the *first* match.**
`findDockerFile` treats a value containing `*` or `?` as a pattern, lists
`tl.find(tl.getVariable('System.DefaultWorkingDirectory'))` and matches with `{ matchBase: true }`,
returning `matchingResultsFiles[0]`. The declared default is `**/Dockerfile`.
**Consequence:** in a repository with several Dockerfiles the one built depends on directory-walk
order, and the search root is `System.DefaultWorkingDirectory` — **not** the step's working
directory, so a `workingDirectory` on the step does not narrow it.
  — https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/docker-common/fileutils.ts
    (`findDockerFile` L29-46; checked 2026-09-04)

[C-E08-051] **Tags split on newlines *and* commas, and build and push construct the tag identically —
which is why pushed tags match built ones by construction.** Both do
`tagsInput.split(/[\n,]+/)` and then, per image name, `imageName + ":" + tag` for each non-empty
tag; with no tags at all both fall back to the bare `imageName` (docker's own `latest` default).
The declared default is `$(Build.BuildId)` — a macro, so the runtime expands it before the task sees
it. **Consequence for the Done field's "parity of pushed tags":** parity is structural, not
coincidental; what can break it is the *image name* half (C-E08-047/049), not the tag half.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/DockerV2/dockerbuild.ts
    (L45-66) and
    https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/DockerV2/dockerpush.ts
    (`pushMultipleImages` L18-55; both checked 2026-09-04)
  — **confirmed by running the real task** (same transcript, runs 1 and 2): `1.0.0,latest` and
    `2.0.0\nv2-newline` each produced exactly two tags, and the registry afterwards held exactly
    the tags the build named — `{"name":"e08","tags":["latest","1.0.0"]}`. Both split characters
    exercised against the real implementation, not only read.

[C-E08-052] **`buildAndPush` ignores the `arguments` input, with a warning.** `dockerbuildandpush.ts`
warns `IgnoringArgumentsInput` when `arguments` is set, and both sub-commands are invoked with
`isBuildAndPushCommand = true`, which forces `commandArguments` to `""`. The `task.json`
`visibleRule` agrees (`command != buildAndPush`), so this is only reachable from hand-written YAML —
which is exactly what a converted pipeline is.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/DockerV2/dockerbuildandpush.ts
    (L7-11; checked 2026-09-04)

## E08-S02-T03 — the Kubernetes/Helm set under real-task mode (`C-E08-053..071`)

Recorded 2026-09-04. Sources: `Tasks/{KubernetesV1,KubernetesManifestV1,HelmDeployV0,HelmInstallerV1,KubectlInstallerV0}`
at the `v277` pin `8ba25cfb5c7736ba98a37488c0323f7320cb5b3e`; `kubernetes-common` at
`4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d` in `microsoft/azure-pipelines-tasks-common-packages` —
**the commit where that package is version 2.272.0, which is what all five tasks' `package.json`
depends on** (`^2.272.0`), and by coincidence the same commit E08-S02-T02 pinned for
`docker-common`; and `microsoft/azure-pipelines-tool-lib`.

Five tasks in one backlog item, and they split cleanly in two: three that consume a cluster
connection and two that install a binary. The connection three broke an assumption the collector was
built on, and the installer two do not run here at all without a runtime change.

### The kind, the fields, and a fifth variable family (`C-E08-053..058`)

[C-E08-053] **The endpoint kind is `connectedService:kubernetes`, lowercase, in all three
consuming tasks — a third kind alongside `AzureRM` and `dockerregistry`.** `Kubernetes@1` and
`HelmDeploy@0` declare `kubernetesServiceEndpoint`, `KubernetesManifest@1` the same name aliased
`kubernetesServiceConnection`. **Consequence:** `connectionKind`'s "unknown kinds fall back to
AzureRM" was safe while one kind existed and is a bug generator with three — it would offer a
Kubernetes connection `ENDPOINT_DATA_<name>_SUBSCRIPTIONID`. An unrecognized kind now answers
`unknown`, contributes no fields, and is reported.
  — the three vendored `task.json` files at `v277` with `PROVENANCE.json` beside them (checked 2026-09-04)

[C-E08-054] **The field set is chosen at run time by `ENDPOINT_DATA_<id>_AUTHORIZATIONTYPE`, read
optionally — and there is no `else`.** `generickubernetescluster.getKubeConfig` does
`getEndpointDataParameter(endpoint, 'authorizationType', true)`, sends `!authorizationType` and
`"Kubeconfig"` to `getKubeconfigForCluster`, sends `"ServiceAccount"` and `"AzureSubscription"`
to `createKubeconfig`, and **returns `undefined` for anything else** — which the caller then writes
into the kubeconfig file. **Consequence:** the two arms want disjoint `.env` lines, so a preflight
that checked both would call a complete ServiceAccount connection broken; and an unrecognized value
must be refused rather than treated as the default.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/KubernetesV1/src/clusters/generickubernetescluster.ts
    (L6-17) — "if (!authorizationType || authorizationType === \"Kubeconfig\")" (checked 2026-09-04)

[C-E08-055] **`ENDPOINT_URL_<id>` is a fifth endpoint variable family, and the first that is neither
auth nor data.** `createKubeconfig` sets `clusters[0].cluster.server` from
`tl.getEndpointUrl(kubernetesServiceEndpoint, false)`, which task-lib reads straight out of
`process.env['ENDPOINT_URL_' + id]` with none of the vaulting `ENDPOINT_AUTH_*` gets (C-E08-002).
**Consequence:** nothing in this repo emitted it before this task, so a ServiceAccount-authorized
connection produced a kubeconfig whose server was `null` — a connection refusal standing in for an
unfilled `.env` line.
  — https://github.com/microsoft/azure-pipelines-tasks-common-packages/blob/4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d/common-npm-packages/kubernetes-common/kubectlutility.ts
    (L59-70) (checked 2026-09-04)

[C-E08-056] **The `kubeconfig` parameter is a whole multi-line YAML document in one environment
variable, and it is *not* base64.** `getKubeconfigForCluster` reads
`getEndpointAuthorizationParameter(endpoint, 'kubeconfig', false)` and hands the string to
`yaml.safeLoad` unchanged. **Consequence:** `.env` can carry it, because `azdo_env_load` sources
the file with real bash and the DEBUG-trap parser is built for multi-line quoted assignments
(C-E06-014..016) — a single-quoted heredoc-shaped value is one assignment. The ergonomic form is
`ENDPOINT_AUTH_PARAMETER_<name>_KUBECONFIG="\$(cat "\$HOME/.kube/config")"`, which is inside the
documented contract (command substitution in `.env` is permitted and deliberate). Proved by test,
not asserted: `core.bats` "a multi-line kubeconfig survives .env loading".
  — same `kubectlutility.ts` (L91-102) (checked 2026-09-04)

[C-E08-057] **`clusterContext` is genuinely optional, and its absence is not a defaulted value but a
different code path.** `getKubeconfigForCluster` returns the kubeconfig **byte-for-byte** when
`clusterContext` is empty, and only otherwise parses it, rewrites `current-context` and re-dumps it
through `yaml.safeDump`. **Consequence:** filling it in is not free — it round-trips the document
through a YAML serializer, so comments and key order do not survive.
  — same `kubectlutility.ts` (L91-102) (checked 2026-09-04)

[C-E08-058] **`apiToken` is base64-encoded, and the task decodes it.**
`Buffer.from(getEndpointAuthorizationParameter(endpoint, 'apiToken', false), 'base64').toString()`
becomes the kubeconfig's `users[0].user.token`. **Consequence:** a raw service-account token pasted
into `.env` reaches the cluster as decoded binary — an authentication failure that looks like a
wrong token rather than a wrongly-encoded one. The generator comment says base64 for this reason.
  — same `kubectlutility.ts` (L66-67) (checked 2026-09-04)

### Which connection input a task actually reads (`C-E08-059..064`)

[C-E08-059] **These tasks declare two to four `connectedService:*` inputs and read exactly one,
selected at run time by another input.** `Kubernetes@1` declares four
(`kubernetesServiceEndpoint`, `azureSubscriptionEndpoint`, `dockerRegistryEndpoint`,
`azureSubscriptionEndpointForSecrets`); `clusterconnection.ts` dispatches on `connectionType` and
`kubernetessecret.ts` on `secretType`/`containerRegistryType`, itself reached only when
`secretName` is non-empty. **Consequence:** the collector's unconditional walk over every declared
connection input over-collects on every step of every one of these tasks.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/KubernetesV1/src/clusterconnection.ts
    (L27-47, L64-73) and `.../KubernetesV1/src/kubernetes.ts` (L58-62),
    `.../KubernetesV1/src/kubernetessecret.ts` (L26, L99-106) (checked 2026-09-04)

[C-E08-060] **`connectionType: None` returns before any endpoint is read — so the warning the
collector used to emit for it was actively false.** `open()` is
`if (connectionType === "None") { return this.initialize(); }`, and `initialize()` only resolves a
kubectl path. **Consequence:** a `Kubernetes@1` step with `connectionType: None` — the arm that uses
the developer's own kubectl context, and the natural local arm — was told its empty
`azureSubscriptionEndpoint` would make the task "fail with LIB_InputRequired". That is the defect
`CONNECTION_INPUT_RULES` exists to remove, and its first test.
  — same `clusterconnection.ts` (L64-69) (checked 2026-09-04)

[C-E08-061] **The same two arms are spelled differently by tasks in the same family, and
`KubernetesManifest@1`'s picklist has no `None` although its code still tests for one.**
`Kubernetes@1`/`HelmDeploy@0`: `'Azure Resource Manager'`, `'Kubernetes Service Connection'`,
`'None'`. `KubernetesManifest@1`: `'azureResourceManager'`, `'kubernetesServiceConnection'` — and
`open()` compares against `"None"` regardless. **Consequence:** copying an arm value between tasks
silently selects the *other* branch, with nothing to validate it (C-E08-034); and
`connectionType: None` is reachable on `KubernetesManifest@1` by writing it in YAML even though the
UI never offers it. That is this task's ambient arm, and it is undocumented.
  — the two vendored `task.json` files, and
    https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/KubernetesManifestV1/src/clusterconnection.ts
    (L25-32, L64-69) (checked 2026-09-04)

[C-E08-062] **`HelmDeploy@0`'s ARM arm needs `connectionType` *and* a non-empty subscription
input.** `getKubeConfigFile` is
`if (connectionType === "Azure Resource Manager" && azureSubscriptionEndpoint)`, and `getClusterType`
repeats the same conjunction. **Consequence:** a step naming the ARM connection type and no
subscription does not fail — it falls through to the generic reader and demands
`kubernetesServiceEndpoint` instead. `Kubernetes@1` has no such second gate.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/HelmDeployV0/src/helm.ts
    (L32-40, L53-64) (checked 2026-09-04)

[C-E08-063] **`azureSubscriptionEndpointForACR` is declared `"required": true` with no
`visibleRule`, and is read by exactly one command, optionally.** Its only reader is
`helmcommands/helmregistrylogin.ts`, reached from `runHelm(…, "registry", …)`, reached only from
`runHelmSaveCommand`, reached only when `command === "save"`; and it reads it with
`tl.getInput("azureSubscriptionEndpointForACR")` — no required flag. **Consequence:** this is the
case that settles the discriminator question. `visibleRule` is a web-form hint the agent does not
evaluate, so a `visibleRule`-driven collector would demand a `.env` block for this input on every
`HelmDeploy@0` step. The task's own dispatch is the only sound source, which is why
`CONNECTION_INPUT_RULES` is a table of readings rather than a grammar.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/HelmDeployV0/src/helmcommands/helmregistrylogin.ts
    (L11-14) and `.../HelmDeployV0/src/helm.ts` (L72-87, L161-171) (checked 2026-09-04)

[C-E08-064] **`KubernetesManifest@1`'s `action: bake` needs no cluster connection at all.**
`run.ts` returns `bake()` before `utils.getConnection()` is ever called. **Consequence:** a bake
step is the one member of this set that converts with no `.env` block whatsoever.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/KubernetesManifestV1/src/run.ts
    (L18-22) (checked 2026-09-04)

### What running these locally costs (`C-E08-065..071`)

[C-E08-065] **`Kubernetes@1` destroys nothing of yours — measured, not assumed by symmetry with
C-E08-038/039.** `close()` unlinks `this.kubeconfigFile` and unsets `KUBECONFIG`, but that file is
always `path.join(this.userDir, "config")` under the task's own new temp directory: both arms
*construct* a kubeconfig document and write it there rather than pointing at an existing file.
**Consequence:** your `~/.kube/config` is untouched — and equally, it is not what the task uses.
  — same `KubernetesV1/src/clusterconnection.ts` (L75-82, L97-108) (checked 2026-09-04)

[C-E08-066] **`HelmDeploy@0` has a documented ambient path, and three near-misses on deleting your
kubeconfig, each guarded.** With `connectionType: None` and `install`/`upgrade` it sets the
`KUBECONFIG` variable to `$HOME/.kube/config` and deploys through your current context. The
deletion risk is real and does not fire: `kubernetescli.logout()` is `fs.unlinkSync` on whatever
path it holds, but `isKubConfigLogoutRequired` excludes `connectionType === "None"` (the
`externalAuth` case, mutually exclusive with it) and excludes `command === "logout"` (the only other
path that puts a user-supplied `KUBECONFIG` there). **Consequence:** the one task in the set whose
ambient arm is intended, and worth stating precisely because the guard is three lines away from an
`unlink` of the user's own file.
  — same `HelmDeployV0/src/helm.ts` (L42-50, L89-107, L152-158) and
    https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/HelmDeployV0/src/kubernetescli.ts
    (L26-31) (checked 2026-09-04)

[C-E08-067] **Both installers download a binary into the tool cache and prepend it to `PATH` for
later steps.** `configureKubectl`/`configureHelm` call `toolLib.prependPath(dirname(path))`, which
emits `##vso[task.prependpath]`. **Consequence:** the runtime already honours that command across
steps, so the cross-step half works; what does not is the cache itself (C-E08-068). Both defaults
resolve a version over the network on every run — `kubectlVersion: latest` fetches
`https://dl.k8s.io/release/stable.txt`, `helmVersionToInstall: latest` the GitHub releases API — so
the version installed depends on the day, not on the pipeline.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/KubectlInstallerV0/src/kubectltoolinstaller.ts
    (L10-18), `.../HelmInstallerV1/src/helmtoolinstaller.ts` (L12-19), and the two `utils.ts`
    (checked 2026-09-04)

[C-E08-068] **Nothing in the generated project set `Agent.ToolsDirectory`, and tool-lib throws
before doing anything else without it.** `_getCacheRoot()` is
`let cacheRoot = tl.getVariable('Agent.ToolsDirectory'); if (!cacheRoot) { throw new Error('Agent.ToolsDirectory is not set'); }`,
and every `findLocalTool`/`cacheFile`/`cacheDir` path goes through it. **Consequence:** both
installers — and `Kubernetes@1` on any non-default `versionSpec` (C-E08-070) — failed on their first
line with an error naming no task and no input. The generated project now seeds
`Agent.ToolsDirectory` to `$AZDO_WORKSPACE_DIR/tools` alongside `Agent.TempDirectory`. This is a
runtime capability that benefits **every** tool-lib task, not only these two (docs/06 §5 decision 79).
  — https://github.com/microsoft/azure-pipelines-tool-lib/blob/15fbc483ded6746d5c7c1cfc8274fd3d1b24d174/tool.ts
    (`_getCacheRoot`) (checked 2026-09-04)

[C-E08-069] **`HelmDeploy@0` cannot detect a Helm 4 CLI, because it probes with a flag Helm 4
removed — measured live on this machine.** `helmcli.getHelmVersion()` runs
`helm version --client --short` unless the `UseHelmVersionV3orHigher` pipeline feature is on (it is
off by default and locally always off), and `isHelmV3orHigher()` regex-matches
`getHelmVersion().stdout`. Against `helm v4.2.4+g3900f43`: **exit 1, stdout empty, stderr
`Error: unknown flag: --client`** — while `helm version --short` alone prints `v4.2.4+g3900f43` and
exits 0. **Consequence:** `isHelmV3orHigher()` answers *false* on a Helm 4 host, so `command: save`
fails with `SaveSupportedInHelmsV3Only` against a CLI that supports it. Not a defect of ours and not
patchable under PLAN D4 — reported as a delta, with "install a Helm 3 CLI" as the remedy.
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/HelmDeployV0/src/helmcli.ts
    (L51-77) and `.../helm.ts` (L72-78); local measurement 2026-09-04

[C-E08-070] **`Kubernetes@1` silently stops using your local kubectl the moment you pin a version.**
`getKubectl()` with the declared default `versionSpec: "1.13.2"` and `checkLatest: false` returns
the machine's kubectl if one exists; **any other `versionSpec`, or `checkLatest: true`, downloads
that version into the tool cache instead**. **Consequence:** a step that looks like it merely records
a version requirement changes which binary runs and adds a network dependency — and, before
C-E08-068, made the task fail outright.
  — same `KubernetesV1/src/clusterconnection.ts` (L150-183) (checked 2026-09-04)

[C-E08-071] **`assertAgent` passes when `Agent.Version` is unset — so seeding it would be a risk
with no benefit.** `assertAgent(minimum)` reads `getVariable('Agent.Version')` and throws only
`if (agent && semver.lt(agent, minimum))`. **Consequence:** `toolLib.prependPath`'s and
`_getCacheRoot`'s `assertAgent('2.115.0')` calls are satisfied by absence, and supplying a value
would flip every other `assertAgent` gate in every task from unasserted to asserted-at-a-number-we-
chose. `Agent.ToolsDirectory` is seeded (C-E08-068); `Agent.Version` deliberately is not.
  — https://github.com/microsoft/azure-pipelines-task-lib/blob/master/node/task.ts (`assertAgent`,
    L183-192) (checked 2026-09-04)

### Not verified here

- **`Kubelogin`.** Both `Kubernetes@1` and `HelmDeploy@0` convert the kubeconfig through
  `kubelogin` when `kubelogin.isAvailable()`. It is not installed on this machine, so that branch is
  **unverified by absence** — not verified safe. It matters only for AAD-authenticated AKS clusters.
- **The AKS/ARM arm** (`azure-arm-rest/aksUtility`) needs an Azure service connection, the same
  outward-facing write E08-S01-T02 and E08-S02-T01 are blocked on.
