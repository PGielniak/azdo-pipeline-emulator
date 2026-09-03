# E09 — auth, REST fetchers, cache & lockfile: grounding claims

Epic rule (BACKLOG, E09 header): **every REST task's Done includes a redacted live request/response
sample** under `research/experiments/E09-rest/<endpoint>/`. The sample is the anti-hallucination
proof for routes, api-versions and payload shapes — a claim quoting a docs page is necessary here
and not sufficient.

## Claim-ID blocks

| Block | Task | Notes |
| --- | --- | --- |
| `C-E09-001` … `C-E09-029` | E09-S01 sign-in (device code, `az`, PAT, storage, GitHub) | |
| `C-E09-030` … `C-E09-059` | E09-S02 repository fetchers | *unallocated* |
| `C-E09-060` … `C-E09-089` | E09-S03 task metadata & artifacts | *unallocated* |
| `C-E09-090` … `C-E09-119` | E09-S04 lockfile & cache | *unallocated* |

---

## E09-S01-T01 — the device-code flow (`C-E09-001..006`)

Recorded 2026-08-26. The task's **Ground** field is emphatic that the Azure DevOps resource GUID is
not to be trusted from our own docs until confirmed on `learn.microsoft.com`, so it was re-fetched
and re-quoted here rather than carried over from C-E00-011.

[C-E09-001] **Azure DevOps' Entra resource identifier is `499b84ac-1321-427f-aa17-267ca6975798`,
its resource URI is `https://app.vssps.visualstudio.com`, and a token is requested with the
`.default` scope.** Independently re-confirmed against the live page (C-E00-011 said the same on
2026-07-30).
  — https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth
    (**deep-verified 2026-08-26**; `git_commit_id` `f7bd73fbf08aed577f62dceb04fa31aa16643c19`,
    `ms.date` 2026-04-02, `updated_at` 2026-05-08)
  — "Azure DevOps' resource identifier: `499b84ac-1321-427f-aa17-267ca6975798`" ·
    "Azure DevOps' resource URI: `https://app.vssps.visualstudio.com`" · "Use the `.default` scope
    when requesting a token with all scopes that the app is permissioned for."

[C-E09-002] **⚠ Entra apps do not natively support Microsoft account (MSA) users for the Azure
DevOps resource.** This is the single most consequential sentence on the page for this project: a
personal-account sign-in is exactly the shape a solo developer converting their own pipelines has,
and the documented remedy is the *other* app model.
  — as C-E09-001 (checked 2026-08-26)
  — "Microsoft Entra apps don't natively support Microsoft account (MSA) users for the Azure DevOps
    resource. If you're building an app that must cater to MSA users or support both Microsoft Entra
    and MSA users, Azure DevOps OAuth apps remain your best option."
  — **Consequence for E09-S01-T01:** the device-code arm cannot be assumed to work for every user
    the tool targets, and the `az`/PAT arms (E09-S01-T02) are not merely conveniences — for an MSA
    user they may be the only arms that work. The mode auto-selection order docs/05 §1 specifies has
    to survive a device-code arm that is unavailable rather than merely unattempted.

[C-E09-003] **The device authorization request is `POST /{tenant}/oauth2/v2.0/devicecode` with
`client_id` and `scope`, form-encoded**, where `tenant` may be `/common`, `/consumers`,
`/organizations`, or a directory tenant. The user has **15 minutes** by default (`expires_in`).
  — https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code
    (**deep-verified 2026-08-26**; `git_commit_id` `a4be4ac419c4e857b1c4de7dee22c9f7e0c750f9`,
    `ms.date` 2025-01-04, `updated_at` 2026-06-15)
  — "From the moment the request is sent, the user has 15 minutes to sign in. This is the default
    value for `expires_in`."

[C-E09-004] **The response carries `device_code`, `user_code`, `verification_uri`, `expires_in`,
`interval` and `message`**, and `verification_uri_complete` is **not** supported — so a client must
show the code for the user to type rather than embedding it in a link.
  — as C-E09-003 (checked 2026-08-26)
  — "The `verification_uri_complete` response field is not included or supported at this time."

[C-E09-005] **The token request is `POST /{tenant}/oauth2/v2.0/token` with
`grant_type=urn:ietf:params:oauth:grant-type:device_code`, `client_id` and `device_code`**, polled
while the user signs in.
  — as C-E09-003 (checked 2026-08-26)
  — "`grant_type` | Required | Must be `urn:ietf:params:oauth:grant-type:device_code`"

[C-E09-006] **The four polling outcomes are a protocol, not error handling.** `authorization_pending`
→ "Repeat the request after at least `interval` seconds"; `authorization_declined` → "Stop polling
and revert to an unauthenticated state"; `bad_verification_code` → the `device_code` was not
recognized; `expired_token` → "Stop polling and revert to an unauthenticated state". A refresh token
is issued **only if** the original `scope` included `offline_access`.
  — as C-E09-003 (checked 2026-08-26)
  — "`refresh_token` | Opaque string | Issued if the original `scope` parameter included
    `offline_access`."
  — Also load-bearing for what we may log: "Don't attempt to validate or read tokens for any API you
    don't own … may also be encrypted for consumer (Microsoft account) users." So `auth status` must
    report identity from the *store's* metadata or a probe call, never by decoding the access token.

---

## E09-S01-T02 — `az` token reuse and PAT mode (`C-E09-018..024`)

Recorded 2026-09-03 before implementation. The redacted live measurement — both modes probed against
the test organization in the same minute — is at
`research/experiments/E09-rest/az-token-pat/real-run.md`.

[C-E09-018] **`az account get-access-token` acquires a token for an arbitrary Azure resource, and
`--resource` and `--scope` are different Microsoft Entra generations rather than aliases.**
`--resource` takes "Azure resource endpoints in Microsoft Entra v1.0"; `--scope` takes
"Space-separated scopes in Microsoft Entra v2.0. Default to Azure Resource Manager." The Azure
DevOps resource identifier (C-E09-001) is a v1.0 endpoint identifier, so `--resource` is the
matching flag and docs/05 §1 prescribes it. The page also bounds the lifetime: "The token will be
valid for at least 5 minutes with the maximum at 60 minutes."
  — https://learn.microsoft.com/en-us/cli/azure/account?view=azure-cli-latest#az-account-get-access-token
    (`git_commit_id` `6eda315c56043d2331b33b5d5b77bca41b526645`; checked 2026-09-03)
  — Measured against `azure-cli` 2.89.1; the returned `tokenType` is `Bearer`.

[C-E09-019] **⚠ The output carries two expiry fields and only one is unambiguous.** The reference
page states: "In the output, `expires_on` represents a POSIX timestamp and `expiresOn` represents a
local datetime. It is recommended for downstream applications to use `expires_on` because it is in
UTC." The measured `expiresOn` was `"2026-09-03 09:04:33.000000"` — **no offset and no `Z`** — so
parsing it as UTC silently misdates the credential by the host's offset. The implementation reads
`expires_on` and falls back to `expiresOn` only when the POSIX sibling is absent.
  — as C-E09-018 (checked 2026-09-03)

[C-E09-020] **A PAT is sent as HTTP Basic with an *empty* username and the PAT in the password
position.** "To provide the PAT through an HTTP header, first convert it to a `Base64` string. Then,
provide it as an HTTP header in the following format: `Authorization: Basic
BASE64_USERNAME_PAT_STRING`", and the Linux/macOS sample is `curl -u :{PAT}
https://dev.azure.com/{organization}/_apis/build-release/builds` — the colon with nothing before it
is the empty username. This is exactly the construction `authorizationHeader()` in
`packages/fetch/src/oracle.ts` already performs, so the PAT arm reuses it rather than restating it.
  — https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops
    (`git_commit_id` `9c456ac04db629b53b1b8195a48bdaad19ed5611`; checked 2026-09-03)

[C-E09-021] **⚠ The PAT page says the profiles APIs accept only Microsoft Entra tokens; the live
organization accepts a PAT there anyway.** The page's FAQ reads: "You can use PATs with most Azure
DevOps REST APIs, but organizations and profiles ... support only Microsoft Entra tokens." The
measured behaviour is the opposite: `GET
https://vssps.dev.azure.com/{org}/_apis/profile/profiles/me?api-version=7.1` returned **200** with a
PAT on 2026-09-03, reproducing C-E09-010's 2026-08-28 result. Both sides are recorded because
`authStatus()` is built on that probe (C-E09-009/010): if the documented restriction is ever
enforced, `auth status` breaks for the **only** mode that works on a Microsoft-account organization
(C-E09-022), and this claim is where that diagnosis starts.
  — as C-E09-020 (checked 2026-09-03)
  — `research/experiments/E09-rest/az-token-pat/real-run.md` §3 (redacted live measurement)

[C-E09-022] **⚠ On a Microsoft-account-backed organization the `az` arm cannot authenticate at all,
and this is a permanent property of the organization rather than a lapsed sign-in.** With a valid
`az` session, every organization endpoint rejected the bearer token with **302** (the sign-in
redirect, the same unauthenticated signature as C-E00-025) while a PAT returned **200** on the same
URLs in the same minute. The cause is measured twice over: the unauthenticated probe returns
`x-vss-resourcetenant: 00000000-0000-0000-0000-000000000000` — the all-zeros tenant that marks an
MSA-backed organization — and the `oid` claim of the acquired token does **not** equal the `id` the
PAT-authenticated Profile call returns, so the two credentials name different principals. Every
tenant `az account list --all` offered, plus the Microsoft-account consumers tenant
`9188040d-6c67-4c5b-b112-36a304b66dad`, was tried; only the account's home tenant minted a token and
that token still got 302. This is C-E09-002 measured rather than predicted.
  — `research/experiments/E09-rest/az-token-pat/real-run.md` §3–§5 (redacted live measurement,
    2026-09-03)
  — supersedes the E09-S01-T02 blocker note dated 2026-08-26, which asserted that running `az login`
    would unblock the task; the sign-in was completed and the arm still cannot authenticate.

[C-E09-023] **Consequence for docs/05 §1: the three-mode auto-selection must survive *two* of its
three arms being unavailable.** On an MSA-backed organization `interactive` is unavailable by
C-E09-002 and `az` is unavailable by C-E09-022, leaving `pat` as the only working mode — and
C-E09-002 already notes that a personal-account organization "is exactly the shape a solo developer
converting their own pipelines has", so this is the default configuration, not an edge case. The
selection chain therefore reports each arm as *unavailable with a reason* instead of throwing, and
distinguishes "no token could be acquired" (remediation: sign in) from "a token was acquired but the
organization rejected it" (remediation: use a PAT) — E10-S03-T01's failure hints consume that
distinction.
  — derived from C-E09-002 + C-E09-022; recorded in docs/05 §1 and docs/06 §5 decision 76.

[C-E09-024] **`AZURE_DEVOPS_EXT_PAT` is honored as a second PAT source by project policy, not by an
Azure DevOps API behavior.** It is the variable the `az devops` CLI extension reads, and the task's
**Do** field names it alongside `AZDO_PAT`; no page consulted for this task documents it as a
general Azure DevOps PAT input. `AZDO_PAT` is checked first because it is this project's own
variable (`ORACLE_ENV_VARS`). Presented here as policy so a later reader does not mistake it for a
grounded service behavior — the same convention C-E09-012's note uses for the GitHub chain order.

---

## E09-S01-T03 — token storage and authenticated status (`C-E09-007..011`)

Recorded 2026-08-28 before implementation. The live probe transcript is redacted at
`research/experiments/E09-rest/profile-me/real-run.md`.

[C-E09-007] **`@napi-rs/keyring` stores a password under an `Entry(service, username)` and exposes
set, get, and delete operations.** The async getter's declared result is `string | undefined`, and
`deleteCredential` returns whether it deleted an entry.
  — https://github.com/Brooooooklyn/keyring-node/blob/e46be75c3ba8d5fde6b88a17c6153b87ffe4b946/index.d.ts#L3-L78
    (commit-pinned v1.3.0; checked 2026-08-28)
  — `README.md` at the same pin demonstrates `new Entry(...)`, `setPassword`, `getPassword`, and
    `deletePassword`.

[C-E09-008] **A missing or ambiguous OS credential may surface as a native keyring error.** The
adapter therefore treats native lookup failures as the boundary for consulting the protected file,
but it must not reinterpret a corrupt password value returned by a successful lookup as absence.
  — https://github.com/Brooooooklyn/keyring-node/blob/e46be75c3ba8d5fde6b88a17c6153b87ffe4b946/index.d.ts#L35-L78
    (commit-pinned v1.3.0; checked 2026-08-28)
  — The v1.3.0 declarations name `NoEntry` and `Ambiguous` errors on get/delete operations.

[C-E09-009] **The Azure DevOps Profile 7.1 endpoint accepts the special id `me` to return the current
authenticated user's profile.** A successful response includes stable identity fields such as `id`
and may include `displayName`, `emailAddress`, and `publicAlias`; the documented permission is
`vso.profile`.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/profile/profiles/get?view=azure-devops-rest-7.1
    (checked 2026-08-28)
  — "'me' to get the profile of the current authenticated user"; API version `7.1`.

[C-E09-010] **For an organization-scoped PAT, the working Profile deployment URL is
`https://vssps.dev.azure.com/<org>/_apis/profile/profiles/me?api-version=7.1`.** Microsoft's Node
client notes that Profile APIs cannot be called at the ordinary org URL and must use the deployment
host. The test-org run returned 200 and the documented seven-field compact profile; the Learn page's
global `app.vssps.visualstudio.com` example returned an empty 401 for the same PAT.
  — https://github.com/microsoft/azure-devops-node-api/blob/881adee3ff1974c83bf69cd7b85e518bc371b6b8/README.md#L34-L38
    (commit-pinned; checked 2026-08-28)
  — `research/experiments/E09-rest/profile-me/real-run.md` (redacted live measurement, 2026-08-28)

[C-E09-011] **A portable 0600 fallback requires an explicit permission repair after replacement.**
Node's creation `mode` applies only when a file is newly created, while `chmod` changes an existing
file; therefore an atomic temp-file rename is followed by `chmod(0o600)` on the destination.
  — https://nodejs.org/download/release/v22.23.2/docs/api/fs.html#fspromisesopenpath-flags-mode
  — https://nodejs.org/download/release/v22.23.2/docs/api/fs.html#fspromiseschmodpath-mode
    (checked 2026-08-28)

---

## E09-S01-T04 — GitHub authentication (`C-E09-012..016`)

Recorded 2026-08-28 before implementation. The redacted public/private request matrix is at
`research/experiments/E09-rest/github-auth/real-run.md`. The selection order — `gh auth token`,
then `GITHUB_TOKEN`, then anonymous — is project policy from the task and is not presented as a
GitHub API behavior.

[C-E09-012] **`gh auth token --hostname github.com` prints the token for the active account on the
selected host and fails when no token is available.** Without `--user`, the active account is used;
the implementation writes the token followed by a newline to standard output. A caller can
therefore treat status zero plus non-empty trimmed stdout as the reusable credential while ignoring
all command diagnostics so a secret never enters its own errors or logs.
  — https://cli.github.com/manual/gh_auth_token (checked 2026-08-28)
  — https://github.com/cli/cli/blob/2ea46117e59a9fbcb31f673565eb2b5207e08aae/pkg/cmd/auth/token/token.go
    (commit-pinned official source; checked 2026-08-28)

[C-E09-013] **GitHub REST accepts a token in `Authorization: Bearer <token>` and recommends an
explicit `X-GitHub-Api-Version` header.** The current official examples use API version
`2026-03-10`; requests in this task also ask for `application/vnd.github+json`.
  — https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api
  — https://github.com/github/docs/blob/b61ae1130e3fa80990dd869b8bb3bfe672e71aa2/content/rest/authentication/authenticating-to-the-rest-api.md
    (commit-pinned official source; checked 2026-08-28)

[C-E09-014] **The repository Contents and tarball endpoints both allow anonymous access to public
resources; private access requires repository Contents read permission.** This supports the final
anonymous arm without weakening private-repository behavior.
  — https://docs.github.com/en/rest/repos/contents (checked 2026-08-28; endpoint sections
    "Get repository content" and "Download a repository archive (tar)")

[C-E09-015] **The tarball endpoint returns an HTTP redirect to the archive bytes, and a private
repository's redirect URL is temporary.** The first request should therefore be made with manual
redirect handling: authenticate only the GitHub API origin, then let the eventual downloader use
the returned storage URL without forwarding the GitHub credential cross-origin.
  — https://docs.github.com/en/rest/repos/contents (checked 2026-08-28; tar archive endpoint)

[C-E09-016] **The live matrix matches the documented boundary.** Anonymous contents and tarball
requests for `octocat/Hello-World` returned 200 and 302 respectively; an anonymous contents request
for an accessible private fixture returned 404, while the same contents request with the token from
`gh auth token` returned 200 and its authenticated tarball request returned 302. Token, redirect
locations, private owner/repository/path, and payload contents are absent from the transcript.
  — `research/experiments/E09-rest/github-auth/real-run.md` (redacted live measurement,
    2026-08-28)

[C-E09-017] **A private repository's tarball storage URL is honored with no `Authorization` header.**
Measured through the shipped chain, not merely inferred from C-E09-015: the manual redirect from
`GET /repos/<private>/tarball/<ref>` was followed with an empty header set and returned the complete
199,698-byte archive from `codeload.github.com`. The signed storage URL carries its own grant, so
`fetchGitHubTarball` forwards nothing cross-origin — the GitHub API origin is the only origin that
ever sees the bearer token.
  — `research/experiments/E09-rest/github-auth/real-run.md` §"Second run — through the implemented
    chain" (redacted live measurement, 2026-09-02)

---

## E09-S02-T01 — the ADO Git fetcher (`C-E09-030..036`)

Recorded 2026-09-02 before implementation. The redacted live transcript is at
`research/experiments/E09-rest/ado-git/real-run.md`. Both REST pages carry the same
`git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`.

[C-E09-030] **Ref listing is `GET {org}/{project}/_apis/git/repositories/{repositoryId}/refs`, and
its `filter` is a *prefix* match, not an exact one.** The parameter is documented as "[optional] A
filter to apply to the refs (starts with)", and the samples pass `filter=heads/master` — i.e. the
filter omits the leading `refs/` that the returned `name` carries. **Consequence:**
`filter=heads/main` also matches `refs/heads/main-2` and `refs/heads/mainline`, so a resolver must
select the entry whose `name` equals `refs/` + the filter and must not take the first result.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/list
    (deep-verified 2026-09-02; `git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`,
    api-version 7.1)

[C-E09-031] **`GitRef` carries both `objectId` and `peeledObjectId`, and the latter is populated
only when `peelTags=true` is requested.** The parameter reads "[optional] Annotated tags will
populate the PeeledObjectId property. default is false." The existence of the second field is the
documentation that `objectId` is *not* always a commit.
  — same page as C-E09-030

[C-E09-032] **An annotated tag's ref names a tag object whose SHA is not the commit's SHA; a
lightweight tag's ref names the commit directly.** Measured locally with git 2.43.0 because the
test organization contains no annotated tag (see C-E09-036): in a scratch repository at commit
`9dd2a98c…`, `git rev-parse refs/tags/<annotated>` returned `53b81d2d…` while
`refs/tags/<annotated>^{commit}` returned `9dd2a98c…`, and `git cat-file -t` reported `tag`; the
lightweight tag resolved to `9dd2a98c…` both ways. **Consequence:** docs/05 §4's lockfile field is
`"commit"`, so the resolver requests `peelTags=true` and prefers `peeledObjectId` when the service
supplies it — taking `objectId` for an annotated tag would pin a tag object into every lockfile and
fail only later, at checkout.
  — local git measurement, 2026-09-02 (git 2.43.0); the ADO field that carries the peeled value is
    documented by C-E09-031

[C-E09-033] **The whole-repository snapshot is the Items route with `$format=zip`, and specifying
`$format` obliges the caller to pass `api-version` as a query parameter.** Verbatim: "If specified,
this overrides the HTTP Accept request header to return either 'json' or 'zip'. If $format is
specified, then api-version should also be specified as a query parameter." The response media types
include `application/zip`, and the endpoint description notes zipped content "is always returned as
a download".
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/git/items/get
    (deep-verified 2026-09-02; `git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`)

[C-E09-034] **The ref a snapshot is taken at is expressed by `versionDescriptor.version` plus
`versionDescriptor.versionType`, whose `GitVersionType` values are exactly `branch`, `tag` and
`commit`.** The version parameter is "Version string identifier (name of tag/branch, SHA1 of
commit)" and the type "Determines how Id is interpreted": `branch` = "Interpret the version as a
branch name", `tag` = "as a tag name", `commit` = "as a commit ID (SHA1)". A full-repository
snapshot also needs `recursionLevel=full` — "Return specified item and all descendants" — since the
default is "'none', no recursion".
  — same page as C-E09-033

[C-E09-035] **The agent authenticates git over HTTP with an `http.extraheader` config value of
`AUTHORIZATION: bearer <token>` (Entra/OAuth) or `AUTHORIZATION: basic <base64(user:pass)>` (PAT),
and passes it via `--config-env` rather than `-c` whenever git is at least 2.31.** `GenerateAuthHeader`
returns `$"bearer {password}"` or `$"basic {base64encodedAuthHeader}"`; `ComposeGitArgs` builds
`$"AUTHORIZATION: {…}"`, and when `gitSupportsConfigEnv` it returns `$"--config-env={configKey}={envVariableName}"`,
otherwise `$"-c {configKey}=\"{configValue}\""`. The threshold is `_minGitVersionConfigEnv = new Version(2, 31)`,
commented "v2.31 git supports --config-env." The agent also calls `executionContext.SetSecret(base64encodedAuthHeader)`
on the basic value, i.e. upstream treats the encoded header as a secret in its own right.
  — https://github.com/microsoft/azure-pipelines-agent/blob/4f7b9d0d37f74eb2a81b9b12f34e77d2ccf7b8c4/src/Agent.Plugins/GitSourceProvider.cs
    (commit-pinned official source; `GenerateAuthHeader` L239-257, `ComposeGitArgs` L1919-1945,
    `_minGitVersionConfigEnv` L222; checked 2026-09-02)

  **Why we implement only the `--config-env` arm.** `git --config-env=<name>=<envvar>` reads the
  value "from which to retrieve the value" out of the environment, so the header — and therefore the
  token — never appears in the process command line, where any local user can read it from `ps`. The
  `-c` arm does put it there, so on git < 2.31 this fetcher takes the C-E09-033 zip route instead of
  degrading its secret handling. Two further leak channels are closed the same way: the token is
  never written into the clone URL, and never persisted into the mirror's `.git/config` — the agent
  spends a dedicated block (L785-805) *removing* leftover `extraheader` keys and warns that a
  surviving one "may cause errors", which is upstream evidence that a persisted header is a real
  hazard rather than a theoretical one.
  — https://git-scm.com/docs/git (`--config-env=<name>=<envvar>`, "Like -c <name>=<value>, give
    configuration variable <name> a value, where <envvar> is the name of an environment variable
    from which to retrieve the value"; verified against the local git 2.43.0 manual page 2026-09-02)

[C-E09-036] **Scope note — the annotated-tag path is documented, not measured against the service.**
The test organization's two repositories carry a single ref between them (`refs/heads/main`) and no
tag of either kind, so the ADO-side half of C-E09-032 rests on C-E09-031's field documentation
rather than on a live sample. Creating a tag would have been an outward-facing write to a personal
organization, which was not taken unilaterally. **To close this:** create an annotated tag in
`azdo-emu-templates` and re-run the transcript's ref-resolution section; the assertion to check is
that `objectId` differs from `peeledObjectId` for that ref.

[C-E09-037] **The whole-repository zip is scoped with `scopePath`, not `path`, and the service
answers `application/octet-stream`.** Measured, and it contradicts the shape the endpoint's own
parameter table suggests: `path` is the route's only *required* parameter and `recursionLevel` is
listed as an independent filter, with nothing saying the two conflict. Sending
`path=/&recursionLevel=full&$format=zip` returns **HTTP 400** —
`"Cannot specify a \"recursionLevel\" other than \"None\" when providing a single item \"path\". Use
the \"scopePath\" query parameter filter instead to get a collection of items."` Substituting
`scopePath=/` returns 200 with a 1,032-byte PK-magic archive of six entries. The page's own Download
sample does use `scopePath`, which is the only hint the prose gives. `Content-Type` came back as
`application/octet-stream; api-version=7.1`, so an `Accept: application/zip` is a preference the
service does not echo.
  — `research/experiments/E09-rest/ado-git/real-run.md` (redacted live measurement, 2026-09-02);
    endpoint documented by C-E09-033/034

[C-E09-038] **The bare mirror leaves no credential on disk, and the three leak channels are closed
in practice.** Measured through the shipped code against the test organization: after
`snapshotAdoRepo` completed a `--config-env` clone, the mirror's `config` contained no `extraheader`
key and no occurrence of the PAT, and its `url =` line is the plain clone URL with no embedded
credential. `git --git-dir <mirror> rev-parse refs/heads/main` returned exactly the SHA the resolver
had pinned, so the mirror is a usable snapshot and not merely a directory that was created.
  — `research/experiments/E09-rest/ado-git/real-run.md` (redacted live measurement, 2026-09-02);
    mechanism documented by C-E09-035

---

## E09-S02-T02 — the GitHub fetcher (`C-E09-039..043`)

Recorded 2026-09-02. The redacted live transcript is at
`research/experiments/E09-rest/github-fetcher/real-run.md`. Authentication is E09-S01-T04's chain
(C-E09-012..017) and the cache layout is E09-S02-T01's (docs/05 §4); only the two GitHub-specific
mechanics are grounded here.

[C-E09-039] **Ref → commit SHA is `GET /repos/{owner}/{repo}/commits/{ref}`, whose `ref` "Can be a
commit SHA, branch name (heads/BRANCH_NAME), or tag name (tags/TAG_NAME)" and whose response `sha`
is a required string.**
  — https://docs.github.com/en/rest/commits/commits (checked 2026-09-02, "Get a commit")
  — https://github.com/github/docs/blob/484d28e95db7c592c368da359ff1a9fecb08a08a/content/rest/commits/commits.md
    (commit-pinned official source; checked 2026-09-02)

[C-E09-040] **The documented `tags/TAG_NAME` shorthand does not work; the full `refs/...` form
does.** Measured against `git/git`, whose `v2.43.0` is an annotated tag:

| `{ref}` sent | result |
| --- | --- |
| `refs/tags/v2.43.0` | 200, `sha` `564d0252…` |
| `refs/heads/master` | 200 |
| `heads/master` | 200 |
| `v2.43.0` (bare) | 200, same `sha` |
| **`tags/v2.43.0`** | **422** `"No commit found for SHA: tags/v2.43.0"` |
| `heads/v2.43.0` | 422 (correctly type-scoped) |

So the one shorthand the page names for tags is exactly the one the service rejects, while its
`heads/` counterpart works. The fetcher therefore always sends the **full `refs/…` form**: it is
accepted for both namespaces, and unlike the bare name it cannot be ambiguous when a branch and a
tag share a name.
  — `research/experiments/E09-rest/github-fetcher/real-run.md` (live measurement, 2026-09-02)

[C-E09-041] **The commits endpoint dereferences an annotated tag for the caller — the opposite of
the Azure DevOps Refs endpoint.** For `git/git` `refs/tags/v2.43.0`, the Git-refs endpoint reports
`object.type: "tag"` with `object.sha` `c089584ac8dedc3aa7c2c404839bc098050298a2`, while the commits
endpoint returns `sha` `564d0252ca632e0264ed670534a51d18a689ef5d` — the commit. **Consequence:**
this fetcher needs no peeling step, and the asymmetry with C-E09-031/032 is deliberate rather than
an inconsistency between the two fetchers.
  — same transcript as C-E09-040

[C-E09-042] **The tarball endpoint accepts a commit SHA as its `{ref}` and answers 302 there too.**
`GET /repos/octocat/Hello-World/tarball/7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` returned 302, so
the snapshot can always be pinned by the SHA the resolver produced rather than by the moving ref —
which closes the window in which a push between resolve and download would change what lands in
cache.
  — same transcript as C-E09-040; endpoint and redirect behavior documented by C-E09-014/015

[C-E09-043] **Scope note.** Redirect handling, the no-cross-origin-credential rule, and the
anonymous-404 reading are inherited unchanged from `packages/fetch/src/auth/github.ts`
(C-E09-013/014/015/017) rather than re-grounded here; this task adds only ref resolution and the
cache write.

---

## E09-S02-T03 — alias resolution & config overrides (`C-E09-044..049`)

Recorded 2026-09-02. The schema page was **re-fetched rather than carried over from C-E03-198**,
because the Ground field names it directly; it had in fact been updated the day before
(`ms.date` 2026-09-01, `git_commit_id` `dfe4b567894f928e93425629bf5e85fe7e0a2f7f`).

[C-E09-044] **`ref` defaults to the literal `refs/heads/main`, not to the repository's default
branch.** Verbatim: "**`ref`** string. ref name to checkout; **defaults to 'refs/heads/main'**. The
branch checked out by default whenever the resource trigger fires." The default is a constant, so a
repository whose default branch is `master` still gets `refs/heads/main` when the resource omits
`ref:` — and the resolution then legitimately fails rather than silently using `master`.
**This corrects `docs/05` §3 item 4**, which said "Ref default: repo default branch" (fixed in this
task; decisions record entry dated 2026-09-02). C-E03-198 already quoted the same sentence; this is
an independent re-confirmation against a newer revision of the page.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/resources-repositories-repository
    (**deep-verified 2026-09-02**; `git_commit_id` `dfe4b567894f928e93425629bf5e85fe7e0a2f7f`,
    `ms.date` 2026-09-01)

[C-E09-045] **There are four repository types, not three: `git | github | githubenterprise |
bitbucket`.** Verbatim: "**`type`** string. Type of repository: git, github, githubenterprise, and
bitbucket." The page states **no default** for `type`. `docs/05` §3 lists only the first three, so
`bitbucket` is a fourth arm with no fetcher; both it and `githubenterprise` route to the
warnings/unsupported list (PLAN D10) rather than to an exception.
  — same page as C-E09-044

[C-E09-046] **`name` is spelled differently per type, and the `git` form is project-qualified only
when it crosses projects.** Verbatim: "If your pipeline is in the same Azure DevOps project as the
repository, for example a repository named `tools`, you reference it using `name: tools`. If your
pipeline is in the same Azure DevOps organization as the repository, but in a different Azure DevOps
project, for example a project named `ToolsProject`, you must qualify the repository name with the
project name: `name: ToolsProject/tools`." For `github` and `bitbucket`, "the `name` value is the
full name of the … repo and includes the user or organization", e.g. `Microsoft/vscode`. So one
slash means *project/repo* under `git` and *owner/repo* under `github` — the same text parses two
ways, and the type is what disambiguates it.
  — same page as C-E09-044

[C-E09-047] **A ref may be written without its `refs/heads/` prefix.** The page's own Variables
example declares `ref: main` on a `type: git` resource. The resolver therefore accepts a bare name
and promotes it, rather than treating it as an invalid ref.
  — same page as C-E09-044

[C-E09-048] **`endpoint` is a service-connection id, and locally it has no meaning.** Verbatim:
"**`endpoint`** string. ID of the service endpoint connecting to this repository", and "GitHub repos
require a GitHub service connection for authorization." Locally our own credential chain
(C-E09-012..017 for GitHub, the stored Azure credential for `git`) substitutes for whatever the
service connection would have supplied, so an `endpoint:` on a resource is **ignored** — and,
because ignoring something the author wrote silently is exactly what a fidelity report exists to
prevent (PLAN D10), every ignored endpoint emits a manifest note naming the alias and the endpoint.
  — same page as C-E09-044; substitution policy is `docs/05` §3 item 3

[C-E09-049] **Scope note.** Alias case folding (`C-E03-213`), the `self` alias (`C-E03-197`), and
the once-per-pipeline pinning that lets a resolved repository carry a commit rather than a ref
(`C-E03-196`) are inherited from E03's reference resolution and are not re-grounded here. The
local-path override is project policy from `docs/05` §3 item 1, not a service behavior.

---

## E09-S02-T04 — extracting archive snapshots (`C-E09-050..054`)

Recorded 2026-09-02. Both archive *routes* were pinned by earlier tasks (C-E09-033/037 for the ADO
zip, C-E09-014/015/042 for the GitHub tarball); what is measured here is what is **inside** them.
The transcript is `research/experiments/E09-rest/archive-shapes/real-run.md`.

[C-E09-050] **The GitHub tarball prefixes every entry with `<owner>-<repo>-<abbreviated sha>/`, and
the sha is abbreviated to seven characters, not the full forty.** The archive for
`octocat/Hello-World` at `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` contains
`octocat-Hello-World-7fd1a60/` and `octocat-Hello-World-7fd1a60/README`. **Consequence:** a prefix
computed from the SHA the resolver pinned would never match. The extractor instead *derives* the
prefix — it strips one leading path component only when **every** entry shares it — which is correct
for this archive and a no-op for one with no prefix.
  — live measurement, 2026-09-02

[C-E09-051] **The ADO Items zip has no prefix at all: its entries are repository-relative.** The
same fixture repository yields `README.md`, `cross/abs.yml`, `cross/leaf.yml`, … So the two archive
formats disagree about the prefix, and only the "strip a *common* leading component" rule of
C-E09-050 handles both without a per-format special case.
  — live measurement, 2026-09-02

[C-E09-052] **The tarball's first member is a PAX global header, not a file.** Its typeflag is `g`
(`pax_global_header`, 52 bytes) and the archive's magic is `ustar\0`; directories carry typeflag `5`
and regular files `0`. A parser that treats every header as a file writes a spurious
`pax_global_header` into the tree, so typeflags other than `0`/`\0` (regular) are skipped.
  — live measurement, 2026-09-02

[C-E09-053] **Every entry in the ADO zip is deflate-compressed (method 8).** Method 0 (stored) is
also legal in the format and is handled, but the service used 8 for all six members of the fixture,
so `inflateRawSync` is the path that actually runs.
  — live measurement, 2026-09-02

[C-E09-054] **Extraction is the point where an archive becomes untrusted input, and the guard is
ours, not a documented behavior.** Neither service documents any constraint on the entry names it
may emit, so the extractor rejects any member whose resolved destination is not strictly inside the
target directory — absolute paths, `..` traversal, and anything reached through a symlink. This is
local hardening (classic zip-slip), recorded here so it is not mistaken for parity with a service
behavior.
  — project policy; no source claims otherwise

---

## E09-S03-T01 — the typed ADO REST client core (`C-E09-060..066`)

Recorded 2026-09-02. Live transcript: `research/experiments/E09-rest/client-core/real-run.md`.

[C-E09-060] **"API version **must** be specified with every request", and versions are formatted
`{major}.{minor}[-{stage}[.{resource-version}]]`.** The page also fixes the preview lifecycle: "After
an API is released (`1.0`, for example), its preview version (`1.0-preview`) is deprecated and can be
deactivated after 12 weeks… Once a preview API is deactivated, requests that specify a `-preview`
version get rejected." A version may be given as a query parameter *or* in the header
`Accept: application/json;api-version=1.0`.
  — https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rest-api-versioning
    (deep-verified 2026-09-02; `git_commit_id` `b7e60d58ebef4428b3048b7c164bf22cdd02fbbd`,
    `ms.date` 2025-04-10)

[C-E09-061] **The "must" is a contract, not an enforcement: omitting `api-version` silently
succeeds against a server-chosen version.** Measured — `GET …/_apis/git/repositories` with **no**
`api-version` returned **200**, and the response announced the version the server picked in its own
`Content-Type`: `application/json; charset=utf-8; api-version=7.1`. **Consequence:** an omission is
not a loud failure but a silent floating dependency that moves when the server does, so the client
pins a version on every request and never relies on the default.
  — `research/experiments/E09-rest/client-core/real-run.md` (live measurement, 2026-09-02)

[C-E09-062] **The negotiated version is echoed in the response `Content-Type`, which makes the pin
verifiable rather than merely asserted.** The same request with an explicit pin returns the pinned
version in that parameter. The client parses it and surfaces it on every response, so a server that
quietly serves something other than what was asked for is observable instead of invisible.
  — same transcript as C-E09-061

[C-E09-063] **An out-of-range version is a 400 that names the server's ceiling.** `api-version=99.0`
returned HTTP 400 with
`"The requested REST API version of 99.0 is out of range for this server. The latest REST API version
this server supports is 7.2."` and `typeName` `Microsoft.VisualStudio.Services.WebApi.VssVersionOutOfRangeException`.
Two things follow: the failure is diagnosable without guesswork, and the test organization's ceiling
today is **7.2** — above the 7.1 this project pins, so the pin is conservative rather than stale.
  — same transcript as C-E09-061

[C-E09-064] **`Retry-After` arrives on a *successful* response, not only on an error.** Verbatim:
"Honor the Retry-After header: If you receive it in a response, wait the specified time before
sending another request. **The response still returns HTTP 200, so retry logic isn't required.**"
This inverts the usual assumption: a client that inspects `Retry-After` only on 429/503 misses the
throttling signal entirely and keeps hammering a service that just asked it to slow down. The client
therefore reads `Retry-After` on **every** response and delays the *next* request accordingly.
  — https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits
    (deep-verified 2026-09-02; `git_commit_id` `3e3ebeebf68fa2c6bfce11f79680994c5a25690c`,
    `ms.date` 2025-09-15)

[C-E09-065] **Blocking — as opposed to delaying — is HTTP 429 with a `TF400733` message, and the
rate-limit headers are advisory.** "When an individual user's requests are blocked, the user receives
responses with HTTP code 429 (too many requests) and a message similar to the following:
`TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource
<resource name> in namespace <namespace ID>.`" The documented headers are `Retry-After`,
`X-RateLimit-Resource`, `X-RateLimit-Delay`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
`X-RateLimit-Reset` and `X-RateLimit-Cost`; the page qualifies them with "If available" and warns
that `X-RateLimit-Resource` is for display, "not relying on it for computation". **Measured: none of
them are present on an ordinary 200** from the test organization, so every one is optional and the
client must behave correctly when all are absent.
  — page as C-E09-064; absence measured in the transcript for C-E09-061

[C-E09-066] **Redaction is ours, not a documented behavior.** No source says what a client may put in
an error, so the rule is local policy: the client never places an `Authorization` value, a PAT, or a
bearer token into a message, and it strips credential-bearing query parameters from any URL it
echoes. Recorded here so it is not mistaken for parity.
  — project policy (CLAUDE.md rule 4); no source claims otherwise

---

## E09-S03-T02 — pipeline runs and artifact download (`C-E09-067..073`)

Recorded 2026-09-02. Live transcript: `research/experiments/E09-rest/runs-artifacts/real-run.md`.
Both REST pages carry `git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`.

[C-E09-067] **The Runs-List endpoint has *no* filter parameters at all.** "Gets top 10000 runs for a
particular pipeline", and its only URI parameters are `organization`, `project`, `pipelineId` and
`api-version`. **This contradicts the task's premise of a "runs list w/ branch/tag filter":** there is
nothing to pass, so branch and tag selection is necessarily **client-side**, over a list capped at
10,000.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/runs/list
    (deep-verified 2026-09-02)

[C-E09-068] **The list response omits the very field a branch filter needs.** The `Run` definition
documents `resources` (a `RunResources` carrying `repositories.<alias>.refName`), but a live list
item's keys are exactly `_links, createdDate, finishedDate, id, name, pipeline, result, state,
templateParameters, url` — **no `resources`**. Runs-**Get** for the same run returns
`resources.repositories.self.refName = "refs/heads/main"` plus `version` and
`repository.type = "azureReposGit"`. **Consequence:** filtering by branch costs one extra request per
candidate run, so the client filters newest-first and stops at the first match rather than expanding
the whole list.
  — `research/experiments/E09-rest/runs-artifacts/real-run.md` (live measurement, 2026-09-02)

[C-E09-069] **Runs-Get also returns `tags` and `yamlDetails`, neither of which the `Run` definition
lists.** Observed on a real run alongside the documented fields. `tags` is what a `resources.pipelines`
`tags:` filter needs, so the tag arm reads a field the reference page does not mention — recorded
because a future reader will otherwise look for it in the docs and not find it.
  — same transcript as C-E09-068

[C-E09-070] **`$expand=signedContent` is the only expansion, and what it returns is a *limited-time
anonymous* URL.** `GetArtifactExpandOptions` is exactly `none | signedContent` ("Default is None"),
and `SignedUrl` is documented as "A signed url allowing **limited-time anonymous access** to private
resources", with fields `url` and `signatureExpires` ("Timestamp when access expires").
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/artifacts/get
    (deep-verified 2026-09-02)

[C-E09-071] **Two consequences of "limited-time anonymous" that shape the code.** First, the download
must **not** carry our `Authorization` header: the URL grants access on its own, exactly as GitHub's
tarball storage URL does (C-E09-015/017), and forwarding a credential to a storage origin is
gratuitous. Second, `signatureExpires` means **the signed URL is not lockfile material** — pinning it
would pin something that expires. The lockfile pins `runId` and the artifact *name*, and the URL is
re-fetched on every download, which is what docs/05 §4's `pipelines.<alias>.{runId, artifacts}` shape
already assumes.
  — page as C-E09-070; storage-origin rule shared with C-E09-015/017

[C-E09-072] **A missing artifact is a clean 404, not an empty success.** Requesting
`artifactName=drop` on a real run without one returned HTTP 404 with `typeKey`
`ArtifactNotFoundException` and message `An Artifact with name "drop" was not found.` So "no such
artifact" is distinguishable from "the run has no artifacts yet" without guesswork.
  — same transcript as C-E09-068

[C-E09-073] **Scope note — the download half is not live-verified, and cannot be here.** The test
organization has **13 pipelines and 29 completed runs, and not one of them published an artifact**:
every oracle experiment to date used `previewRun: true`, which never produces one. Producing a fixture
means queueing a real build in a personal organization — an outward-facing write that was not taken
unilaterally. Everything up to and including the artifact *metadata* call is measured; the signed-URL
download and the `.cache/artifacts/` write are covered by unit tests only. **To close it:** run a
pipeline containing a `PublishBuildArtifacts`/`PublishPipelineArtifact` step once, then re-run the
transcript's §4.

---

## E09-S03-T03 — classic build artifacts and definition lookup (`C-E09-074..079`)

Recorded 2026-09-02. Live transcript: `research/experiments/E09-rest/build-fallback/real-run.md`.
Page `git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`.

[C-E09-074] **A classic build artifact is downloaded through `resource.downloadUrl`, and
`resource.type` is what says whether that is meaningful.** `BuildArtifact` is `{id, name, resource,
source}`; `ArtifactResource` carries `downloadUrl` ("A link to download the resource"), `type` ("The
type of the resource: **File container, version control folder, UNC path, etc.**"), `data`
("Type-specific data about the artifact"), `properties` and `url`. The response media types are
`"application/zip", "application/json"`. **Consequence:** only a container-backed artifact has a URL
we can fetch; a `FilePath` (UNC) artifact names a share that does not exist on this machine, so it is
reported rather than attempted.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/build/artifacts/get-artifact
    (deep-verified 2026-09-02)

[C-E09-075] **A missing build artifact is a 404, but the *list* of artifacts for the same build is a
200 with an empty array.** Measured on build 527: `…/artifacts?api-version=7.1` returned
`{"count":0,"value":[]}` while `…/artifacts?artifactName=drop&api-version=7.1` returned 404 with
`"Artifact drop was not found for build 527."`, `typeKey` `ArtifactNotFoundException`. So "this build
published nothing" and "this build has no artifact by that name" are two different answers from two
different calls, and only the second is an error.
  — `research/experiments/E09-rest/build-fallback/real-run.md` (live measurement, 2026-09-02)

[C-E09-076] **The two artifact APIs report the same failure with different wording and different
namespaces.** Pipelines says `An Artifact with name "drop" was not found.`
(`Microsoft.Azure.Pipelines.WebApi.ArtifactNotFoundException`, C-E09-072); Build says
`Artifact drop was not found for build 527.`
(`Microsoft.TeamFoundation.Build.WebApi.ArtifactNotFoundException`). The `typeKey` is the same
string in both, so **`typeKey` is the safe discriminator and the message is not** — which matters
because the fallback path decides on it.
  — same transcript as C-E09-075

[C-E09-077] **The Definitions `name` filter is an exact, case-insensitive match that accepts `*`
wildcards — it is *not* a prefix filter.** Measured: `name=oracle-anch` → **0** results, while
`name=oracle-anch*` → 1, `name=oracle*` → 14, `name=*anchor` → 1, and `name=ORACLE-ANCHOR` → 1.
**This is the opposite trap from the Git Refs filter (C-E09-030), which *is* starts-with:** here a
caller who assumes prefix matching gets nothing, and a definition name legitimately containing `*`
would be interpreted as a pattern. The lookup therefore sends the name unescaped only when it
contains no `*`, and verifies the returned name case-insensitively rather than trusting the count.
  — same transcript as C-E09-075

[C-E09-078] **The definition *list* item omits both the YAML path and the repository; only the
detail call has them.** A live list item's keys are `_links, authoredBy, createdDate, drafts, id,
name, path, project, quality, queue, queueStatus, revision, type, uri, url`. Fetching
`…/definitions/{id}` adds `process`, `repository`, `properties`, `tags`, `triggers` and
`jobAuthorizationScope`, where `process` is `{"yamlFilename": "/experiments/status-skipped.yml",
"type": 2}` and `repository` is `{id, name, type: "TfsGit", defaultBranch: "refs/heads/main", url}`.
**Consequence:** name → id → *yaml path* is necessarily two calls — the same list/detail asymmetry as
Runs-List (C-E09-068), and for the same reason it is worth stating rather than rediscovering.
  — same transcript as C-E09-075

[C-E09-079] **Scope note — the classic download is not live-verified, for the same reason as
E09-S03-T02.** No build in the test organization has ever published an artifact (C-E09-073), so the
`downloadUrl` fetch and the cache write are unit-tested only. The definition lookup, the empty
artifact list and the 404 **are** measured. The same single queued build closes both tasks.

---

## E09-S03-T04 — variable groups, names only (`C-E09-080..084`)

Recorded 2026-09-02. Live transcript: `research/experiments/E09-rest/variable-groups/real-run.md`.
Page `git_commit_id` `cb0d0b30ca71a83e03cc7a7bbd9361e1a432b377`.

[C-E09-080] **The endpoint hands back non-secret values in plaintext; only *secret* values come back
`null`.** The page's own sample is unambiguous: `"key1": {"value": "value1"}` alongside
`"key2": {"value": null, "isSecret": true}`. Confirmed live — the test organization's group returns
`corpusPlainValue` with its `value` present. **This is the whole reason the project's discard rule
exists** (decision 2026-07-30, docs/05 §1): the API volunteers the values, so not persisting them is
an act, not a side effect of the API withholding them.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/distributedtask/variablegroups/get-variable-groups
    (deep-verified 2026-09-02) and
    `research/experiments/E09-rest/variable-groups/real-run.md` (live measurement)

[C-E09-081] **`isSecret` is *absent* on a non-secret variable, not `false`.** Measured: the live
group's two members carry key sets `['value']` and `['isReadOnly', 'value']` — no `isSecret` key at
all. The docs' sample matches: only the secret member has the field. **Consequence:** a check written
as `variable.isSecret === false` is never true, and `isSecret === undefined` must be read as "not
secret". `isReadOnly` behaves the same way.
  — same sources as C-E09-080

[C-E09-082] **`groupName` accepts a `*` wildcard, like the Definitions `name` filter.** The page's
second example is `?groupName=Test*&queryOrder=IdDescending`. The same trap as C-E09-077 therefore
applies: a group whose name legitimately contains `*` cannot be sent as a filter, and the returned
name must be re-checked rather than trusting the result count.
  — page as C-E09-080

[C-E09-083] **`VariableValue` is `{isReadOnly, isSecret, value}` and `VariableGroup` carries
`variableGroupProjectReferences` and `isShared`.** The full member list is `createdBy, createdOn,
description, id, isShared, modifiedBy, modifiedOn, name, providerData, type,
variableGroupProjectReferences, variables`; the live response returned all of those except
`providerData`. `type` was `Vsts` (as opposed to a key-vault-backed group).
  — page as C-E09-080; live key set in the transcript

[C-E09-084] **The discard rule is ours and is enforced structurally, not by convention.** No source
says a client must drop the values — the API returns them and would happily let us cache them. So
the fetcher's return type has **no value field at all**: values are dropped at the parse boundary
rather than carried and filtered later, which is what makes "never persisted" checkable by a test
that asserts the plaintext value appears in no output, including `JSON.stringify` of the whole
result.
  — project policy (CLAUDE.md rule 4; docs/05 §1 decision 2026-07-30); no source claims otherwise

---

## E09-S03-T05 — installed task metadata (`C-E09-085..089`)

Recorded 2026-09-02. This endpoint's reference page is thin, so — as the task's **Ground** field
directs — the route, api-version and payload shape are **experiment-backed**, with the agent as the
code reference for how a task is addressed and cached. Transcript:
`research/experiments/E09-rest/task-metadata/real-run.md`.

[C-E09-085] **`GET {org}/_apis/distributedtask/tasks?api-version=7.1` is organization-scoped and
returns the *full* task definition for every installed version — 269 entries over 172 distinct names
in the test organization.** Each entry carries what a `task.json` carries: `id, name, version,
inputs, execution, instanceNameFormat, runsOn, demands, groups, outputVariables, …`. **Consequence:**
metadata needs **no** second download; only real-task *execution* needs the zip.
  — `research/experiments/E09-rest/task-metadata/real-run.md` (experiment-backed, 2026-09-02)

[C-E09-086] **`version` is an object, not a string: `{major, minor, patch, isTest}`.** So a YAML
`replacetokens@6` is matched on `version.major`, and a naive string comparison against `"6"` never
matches anything. Measured on `CmdLine`: `{major: 1, minor: 1, patch: 3, isTest: false}` and
`{major: 2, minor: 279, patch: 0, isTest: false}`.
  — same transcript

[C-E09-087] **One task `id` spans every major, and no two entries share a major.** `CmdLine`'s two
entries and `replacetokens`' five all carry a single GUID each (`d9bafed4-…` and `a8515ec8-…`), and
across all 269 entries **zero** names have two entries with the same major. So `name@major` selects
exactly one definition, and the GUID is *not* a version discriminator. The list is **not ordered** —
`replacetokens` came back as majors `[3, 4, 6, 7, 5]` — so "latest" must be computed, never taken as
the last element.
  — same transcript

[C-E09-088] **The task zip is `GET {org}/_apis/distributedtask/tasks/{id}/{major.minor.patch}` and
needs the *exact* three-part version.** Measured: `.../a8515ec8-…/6.3.1` returned **200**,
`application/zip; api-version=7.1`, 700,058 bytes with PK magic; `.../6.4.0` — a version that does
not exist — returned **404** with `typeKey` `TaskDefinitionNotFoundException` and the misleading
message *"No task definition found matching ID … and version 6.4.0. You must register the task
definition before uploading the package."* **Consequence:** a download cannot be issued from
`name@major` alone; the list call must supply the exact version first. This matches the agent, which
calls `GetTaskContentZipAsync(task.Id, version)` with a resolved `TaskVersion`.
  — same transcript, and
    https://github.com/microsoft/azure-pipelines-agent/blob/018456432195aff4c59112f93426620891703dd5/src/Agent.Worker/TaskManager.cs
    (commit-pinned official source; `DownloadAsync` L209-245, `GetDirectory` L469-478; checked 2026-09-02)

[C-E09-089] **A marketplace task is distinguished by `contributionIdentifier`; an in-box task has
`serverOwned: true` instead.** The test organization has exactly one marketplace extension installed
— `replacetokens`, `contributionIdentifier` `qetza.replacetokens.replacetokens-task`, five majors
3–7 — and it is the fixture this task's Done criterion uses. In-box tasks such as `CmdLine` report
`serverOwned: true` and a null `contributionIdentifier`. The agent lays its own cache out as
`<tasks>/<name>_<id>/<version>` (`GetDirectory`), which is the layout docs/05 §4's
`tasks/<TaskName>@<version>/` mirrors.
  — same transcript and pinned source as C-E09-088

---

## E09-S03-T07 — org schema caching and refresh (`C-E09-090..092`)

Recorded 2026-09-02. The endpoint's *behavior* was grounded by E01-S02-T03 (C-E01-029/033..036) and
is not re-derived; this task owns the caching and refresh policy, and re-took a live sample as the
Ground field requires. Transcript: `research/experiments/E09-rest/yamlschema/real-run.md`.

[C-E09-090] **The body's instability is *intermittent*, which makes a hash no more usable than if it
were constant.** C-E01-034 recorded three fetches inside ten minutes differing (the
`definitions.task.anyOf` alternatives reorder). Re-measured 2026-09-02: two consecutive fetches were
**byte-identical**, sha256 `2c3f6556…` both times, 611,234 bytes each. That does not retract
C-E01-034 — it sharpens it. A body that *sometimes* reorders is exactly as unusable for
change-detection as one that always does, because a differing hash cannot be told from a reorder and
a matching hash proves only that this pair of calls happened to agree. The cache therefore expires
**by age**, never by digest.
  — `research/experiments/E09-rest/yamlschema/real-run.md` (live measurement, 2026-09-02)

[C-E09-091] **The document changed without changing length or `$comment` — the cleanest possible
demonstration that neither is a freshness signal.** The live document and the snapshot committed at
`research/experiments/E01-orgschema/yamlschema.json` are **both exactly 611,234 bytes** and both
report `$comment: "v1.183.0"`, yet their sha256 digests differ: `2c3f6556…` today against
`ffd81760…` for the stored copy. Identical size, identical version marker, different bytes — which
is the `definitions.task.anyOf` reordering of C-E01-034 seen across weeks rather than minutes.
**Consequence:** neither `$comment` (C-E01-035) nor a length check nor a digest can decide whether a
cached schema is current, which is why age is the only workable expiry.
  — same transcript; the committed E01 snapshot is the second data point

[C-E09-092] **The cache policy is ours, and it is age plus an explicit override.** No source
prescribes one — the service exposes no version to bust on (C-E01-035) — so: a cached
`schema/yamlschema-<org>.json` is used while it is younger than a TTL, `--refresh` forces a re-fetch
regardless of age, and a fetch failure over a cache entry that is merely *stale* falls back to that
entry with a warning rather than failing the convert. The last part is the deliberate one: a
validation schema that is a few days old is far better than a conversion that will not run, and the
consumer (`resolvePipelineSchema`) already degrades to the vendored schema when the document is
unusable.
  — project policy, following docs/05 §4's "Expire by age and let `--refresh` force a re-fetch"
