# E08 — priority deployment tasks: grounding claims

Epic rule (BACKLOG §3): every runtime behavior cites an official doc page or a commit-pinned
GitHub source. This epic's primary sources are `microsoft/azure-pipelines-tasks` (what a task reads
off a service connection) and `microsoft/azure-pipelines-task-lib` (how those reads reach it).

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E08-001` … `C-E08-029` | E08-S01 the connection contract | |
| `C-E08-030` … `C-E08-059` | E08-S02 per-task verification | *unallocated* |

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
