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
