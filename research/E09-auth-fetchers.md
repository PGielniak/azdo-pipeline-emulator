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
