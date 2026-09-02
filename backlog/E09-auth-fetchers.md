# E09 — Auth, REST fetchers, cache & lockfile

Phase: P3 · Depends on: E00; integrates into E03 (bundler, cross-repo) and E06 (checkout/artifacts) · Design: docs/05
Primary grounding set: learn.microsoft.com/rest/api/azure/devops/ (per-endpoint pages — every endpoint task pins its page **and** a live sample response) · Entra auth for ADO (…/azure/devops/integrate/get-started/authentication/) · MSAL Node docs · GitHub REST docs.

> **Repurposed by the simplification (docs/07).** The central fetch — the `preview` expansion — now
> lives in E00-S04. This epic supplies everything around it: sign-in, cross-repo template fetch (so
> the bundler can inline `@other` templates), task metadata, variable-group names, and the lockfile.
> S02's repo fetchers feed the bundler (E03) rather than a local template engine.

Global rule: **every REST task's Done includes a redacted live request/response sample** committed
under `research/experiments/E09-rest/<endpoint>/` from the test org — the sample is the
anti-hallucination proof for routes, api-versions and payload shapes.

## E09-S01 — As a user, I sign in to Azure DevOps interactively once, and the converter reuses it safely, so fetching never needs manual token juggling.
Acceptance: three auth modes with secure storage, per docs/05 §1.

- [!] **E09-S01-T01 — MSAL device-code flow** *(**Grounded 2026-08-26, not implemented — blocked on a step only a human can take.** The Ground field is done and is the durable part: the protocol is pinned end to end in `research/E09-auth-fetchers.md` (C-E09-001..006) from two freshly deep-verified pages — the Entra-OAuth page (`git_commit_id f7bd73fb…`) for the resource GUID `499b84ac-1321-427f-aa17-267ca6975798`, the `https://app.vssps.visualstudio.com` resource URI and the `.default` scope, **re-confirmed on learn.microsoft.com exactly as the field demands rather than carried over from C-E00-011**; and the device-code page (`git_commit_id a4be4ac4…`) for the `/devicecode` and `/token` endpoints, the `urn:ietf:params:oauth:grant-type:device_code` grant, the four polling outcomes, and the fact that a refresh token is issued **only** when `offline_access` is in scope. **The blocker:** the Done criterion is "e2e against test org: sign in → probe call succeeds", and a device-code sign-in requires a person at a browser typing a user code — no agent can produce that transcript. The implementation was not started, so this is `[!]` and not partial. **A finding that changes the epic, recorded now rather than discovered later (C-E09-002):** "Microsoft Entra apps don't natively support Microsoft account (MSA) users for the Azure DevOps resource" — a personal-account sign-in is exactly the shape a solo developer converting their own pipelines has, so the device-code arm cannot be assumed available for every user, and docs/05 §1's mode auto-selection has to survive that arm being *unavailable* rather than merely unattempted. That makes **E09-S01-T02** (`az` + PAT) load-bearing rather than a convenience — it was taken next for that reason, and both of its modes are live-checkable in this environment.)*
  **Do:** `packages/fetch/src/auth/azdo.ts`: public-client device-code with the Azure DevOps resource scope; org discovery; refresh handling.
  **Ground:** the official docs page documenting ADO's Entra resource/scope `499b84ac-1321-427f-aa17-267ca6975798/.default` (locate & pin — do not trust the GUID from our docs until confirmed on learn.microsoft.com); MSAL Node device-code sample (pin). Live sign-in transcript (redacted) stored.
  **Done:** e2e against test org: sign in → probe call succeeds; token never logged.
- [!] **E09-S01-T02 — `az` token reuse + PAT mode** *(**Blocked 2026-08-26: half of "one live check per mode" is unreachable without an interactive sign-in.** Measured, not assumed: `az` is installed and `az account show` succeeds, but `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` returns `AADSTS700082: The refresh token has expired due to inactivity` — so the `az` arm needs `az login`, which is a browser sign-in no agent can complete. The PAT arm *is* checkable here (the oracle PAT in `.env.oracle` authenticates against the test org), so this task is genuinely half-doable and was left whole rather than split: implementing one mode and stubbing the other would bury the auto-selection order docs/05 §1 specifies, which is the part that has to be right. **Run `az login` and this unblocks immediately** — nothing else is missing.)*
  **Do:** shell-out `az account get-access-token --resource <ADO-guid>` parse; `AZDO_PAT`/`AZURE_DEVOPS_EXT_PAT` Basic auth; mode auto-selection order per docs/05.
  **Ground:** az CLI docs for `get-access-token` (pin); PAT usage header format from ADO auth docs (quote the Basic scheme construction).
  **Done:** unit tests with fakes + one live check per mode.
- [x] **E09-S01-T03 — Token storage & `auth status`**
  **Do:** OS keyring via `@napi-rs/keyring` with 0600-file fallback; `auth status` probe (use the cheapest documented call; pin it).
  **Ground:** keyring lib docs (pin); chosen probe endpoint page + live sample.
  **Done:** status shows org/identity/mode/expiry; storage never world-readable (test).
- [x] **E09-S01-T04 — GitHub auth chain**
  **Do:** `gh auth token` reuse → `GITHUB_TOKEN` → anonymous (public); applied to tarball + contents calls.
  **Ground:** gh CLI manual page for `auth token` (pin); GitHub REST auth docs.
  **Done:** fetch of a public and a private fixture repo path.

## E09-S02 — As a pipeline developer, templates from other repos resolve at convert time, so the bundler can inline them and cross-repo pipelines convert completely.
Acceptance: alias resolution + repo snapshot fetch with SHA pinning, per docs/05 §2–§3.

- [x] **E09-S02-T01 — ADO Git fetcher**
  **Do:** ref→SHA resolve (Refs endpoint), snapshot via `git clone --bare` with token credential (preferred) or Items `$format=zip` fallback; cache layout per docs/05 §4.
  **Ground:** Git Refs + Items REST pages (pin; note `versionDescriptor` params) + live samples; git credential embedding format from git-scm docs (pin).
  **Done:** fixture: fetch repo@branch and @commit; cache hit path tested offline.
- [x] **E09-S02-T02 — GitHub fetcher**
  **Do:** ref→SHA via commits API; tarball download; same cache layout.
  **Ground:** GitHub REST "download tarball" + commits pages (pin) + live samples.
  **Done:** as T01 for a GitHub fixture repo.
- [x] **E09-S02-T03 — Alias resolution & config overrides**
  **Do:** `resources.repositories` → fetcher dispatch per docs/05 §3 incl. local-path override (redirect alias to a working copy) and `@self`; endpoint substitution note into manifest.
  **Ground:** resources-repositories yaml-schema page (quote `type`/`name`/`ref` semantics + default-branch rule).
  **Done:** E03 bundler cross-repo resolution works through this layer; local-override integration test.
- [x] **E09-S02-T04 — Extract archive snapshots so their files are readable**
  **Do:** unpack an Items `$format=zip` (ADO) or tarball (GitHub) cache entry into a readable tree beside the archive, and point the CLI's `repositoryFetcher` read path at it. Added 2026-09-02 by E09-S02-T03, which resolves and pins these repositories correctly but can only *read* files from a working copy or a bare mirror (`git show <commit>:<path>`); an archive-backed alias is currently reported as `unreadable` rather than silently answering "no such file". This is the whole GitHub arm, since tarball is its only route.
  **Ground:** the archive shapes are already pinned (C-E09-033/037 for the ADO zip, C-E09-014/015/042 for the tarball) and both are measured in `research/experiments/E09-rest/{ado-git,github-fetcher}/real-run.md`; ground only the extraction mechanics — note the GitHub tarball's `<owner>-<repo>-<sha>/` top-level prefix, which a live sample can confirm.
  **Done:** a cross-repo `template:` reference resolves out of both an ADO zip and a GitHub tarball entry through `repositoryFetcher`; `unreadable` is empty for both.

## E09-S03 — As a pipeline developer, artifacts, variable-group names and task metadata are fetched and pinned, so re-conversion is reproducible offline.
Acceptance: endpoints wrapped + lockfile discipline per docs/05 §4.

- [x] **E09-S03-T01 — Typed ADO REST client core**
  **Do:** fetch wrapper: base URLs, api-version pinning module (single table), retry/backoff, error surfacing, **redaction middleware** (no tokens in errors/logs).
  **Ground:** REST versioning doc (…/rest/api/azure/devops/ versioning section — quote api-version negotiation rules).
  **Done:** unit tests incl. redaction proof; version table cites pages.
- [!] **E09-S03-T02 — Pipelines runs + artifact download** *(**Implemented and grounded 2026-09-02; one Done item is unreachable without an outward-facing write.** Everything is built and tested in `packages/fetch/src/rest/runs.ts` — runs list, client-side branch/tag selection, artifact metadata with `$expand=signedContent`, unauthenticated signed-URL download, and the `.cache/artifacts/<alias>/<runId>/<name>/` write. **Measured against the live org:** the runs list, the run detail that carries the branch, and the artifact 404. **What is missing:** "fixture pipeline artifact lands in `.cache/artifacts/...`" — the test org has **13 pipelines and 29 completed runs and not one artifact**, because every oracle experiment to date used `previewRun: true`, which never executes. Producing a fixture means queueing a real build in a personal organization; that was not taken unilaterally. The download and cache write are therefore unit-tested against the documented `SignedUrl` shape only, and the lockfile `runId` pin belongs to E09-S03-T06. **Run any pipeline with a `PublishPipelineArtifact` step once and this closes** — re-run §4 of `research/experiments/E09-rest/runs-artifacts/real-run.md`. **Two findings that change the task as written (C-E09-067/068):** Runs-List has **no** branch or tag filter parameters at all, and its list items omit `resources`, so "runs list w/ branch/tag filters" is necessarily client-side at one extra request per candidate run.)*
  **Do:** runs list w/ branch/tag filters, artifacts with `$expand=signedContent`, zip download+extract into cache.
  **Ground:** Pipelines Runs + Artifacts REST pages (pin) + live samples incl. a real `signedContent.url`; resources-pipelines yaml-schema page for default-version-resolution rules.
  **Done:** fixture pipeline artifact lands in `.cache/artifacts/...`; pinned runId in lockfile.
- [!] **E09-S03-T03 — Build artifacts fallback + definitions lookup** *(**Implemented and grounded 2026-09-02; the name→id lookup half is done, the classic-artifact download blocks on the same missing fixture as E09-S03-T02.** Built in `packages/fetch/src/rest/build.ts`. **Done item 2 — "name→id lookup used by the harness" — is met and live-measured.** Done item 1 — "classic-artifact fixture downloads" — is not: no build in the test org has ever published an artifact (C-E09-073/079), because every experiment used `previewRun: true`. The download is unit-tested against the documented `ArtifactResource` shape; the definition lookup, the empty artifact list and the 404 are measured. **One queued build with a publish step closes this and E09-S03-T02 together.** **Two findings worth the read (C-E09-076/077):** both artifact APIs use the same `typeKey` but different message wording and namespaces, so the fallback must discriminate on `typeKey`; and the Definitions `name` filter is **exact, case-insensitive, with `*` wildcards** — the inverse of the Git Refs "(starts with)" filter, so a prefix returns nothing and a literal `*` in a name would be read as a pattern.)*
  **Ground:** Build Artifacts + Definitions REST pages (pin) + samples.
  **Done:** classic-artifact fixture downloads; name→id lookup used by the harness.
- [x] **E09-S03-T04 — Variable groups (names only)**
  **Do:** fetch by name; extract variable **names** + secret flags; never persist values even if returned for non-secrets (decision 2026-07-30).
  **Ground:** Variablegroups REST page (pin) + live sample; the discard-values rule is internal policy — enforce with a test asserting values absent from all outputs.
  **Done:** `.env.example` group blocks show names; value-absence test green.
- [x] **E09-S03-T05 — Task metadata fetch (marketplace)**
  **Do:** list installed tasks, match name@major, cache `task.json`.
  **Ground:** the DistributedTask tasks endpoint has thin docs — ground via live samples from the test org and, as code reference, how the agent downloads tasks (pin). Mark route/api-version claims as experiment-backed.
  **Done:** marketplace fixture task's `task.json` cached and consumed by E07 real-task mode.
- [!] **E09-S03-T06 — Lockfile + `--frozen`/`--update`** *(**Schema, write/read/verify and the offline guarantee are done 2026-09-02 in `packages/fetch/src/lockfile.ts`; the `fetch-artifacts.sh` clause of Do waits on E09-S03-T02's blocked artifact half.** Done — "two converts from lock → identical output hashes" — is **met and is what caught the one real bug**: sorting map keys alone was not enough, because each pin's *own* field order followed whichever code path built it, so a lockfile written from a fresh pin differed from one written from a re-read pin by field order alone. Canonicalization now fixes per-pin field order too. The offline guarantee is proven, not asserted: a test replaces `globalThis.fetch` with a throwing stub and verifies a warm cache. **What is left:** `fetch-artifacts.sh` emission, which needs the artifact download E09-S03-T02 could not fixture; it lands with that task's unblocking, and `--update` is CLI surface belonging to E10-S02.)*
  **Do:** `azdo-emu.lock.json` schema per docs/05 §4; write/read/verify; `--frozen` offline guarantee; `fetch-artifacts.sh` emission (curl fallback documented).
  **Ground:** docs/05 §4 spec; offline guarantee proven by a network-disabled CI job converting from warm cache.
  **Done:** reproducibility test: two converts from lock → identical output hashes.
- [x] **E09-S03-T07 — Org yamlschema fetch** (feeds E01-S02-T03)
  **Ground:** live sample from test org (already required there); this task pins caching+refresh.
  **Done:** cached schema used when present; refresh path tested.
