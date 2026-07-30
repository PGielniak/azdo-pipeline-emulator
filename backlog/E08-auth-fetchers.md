# E08 — Auth, REST fetchers, cache & lockfile

Phase: P3 · Depends on: E00; integrates into E03 (remote templates) and E06 (checkout/artifacts) · Design: docs/05
Primary grounding set: learn.microsoft.com/rest/api/azure/devops/ (per-endpoint pages — every endpoint task pins its page **and** a live sample response) · Entra auth for ADO (…/azure/devops/integrate/get-started/authentication/ — locate current Entra/OAuth page) · MSAL Node docs · GitHub REST docs (docs.github.com/rest).

Global rule for this epic: **every REST task's Done includes a redacted live request/response sample** committed under `research/experiments/E08-rest/<endpoint>/` from the test org — the sample is the anti-hallucination proof for routes, api-versions and payload shapes.

## E08-S01 — As a user, I sign in to Azure DevOps interactively once, and the converter reuses it safely, so fetching never needs manual token juggling.
Acceptance: three auth modes with secure storage, per docs/05 §1.

- [ ] **E08-S01-T01 — MSAL device-code flow**
  **Do:** `packages/fetch/src/auth/azdo.ts`: public-client device-code with the Azure DevOps resource scope; org discovery; refresh handling.
  **Ground:** the official docs page documenting ADO's Entra resource/scope `499b84ac-1321-427f-aa17-267ca6975798/.default` (locate & pin — do not trust the GUID from our docs until confirmed on learn.microsoft.com); MSAL Node device-code sample (pin). Live sign-in transcript (redacted) stored.
  **Done:** e2e against test org: sign in → probe call succeeds; token never logged.
- [ ] **E08-S01-T02 — `az` token reuse + PAT mode**
  **Do:** shell-out `az account get-access-token --resource <ADO-guid>` parse; `AZDO_PAT`/`AZURE_DEVOPS_EXT_PAT` Basic auth; mode auto-selection order per docs/05.
  **Ground:** az CLI docs for `get-access-token` (pin); PAT usage header format from ADO auth docs (quote the Basic scheme construction).
  **Done:** unit tests with fakes + one live check per mode.
- [ ] **E08-S01-T03 — Token storage & `auth status`**
  **Do:** OS keyring via `@napi-rs/keyring` with 0600-file fallback; `auth status` probe (use ConnectionData or Projects list — pick the cheapest documented call; pin it).
  **Ground:** keyring lib docs (pin); chosen probe endpoint page + live sample.
  **Done:** status shows org/identity/mode/expiry; storage never world-readable (test).
- [ ] **E08-S01-T04 — GitHub auth chain**
  **Do:** `gh auth token` reuse → `GITHUB_TOKEN` → anonymous (public); applied to tarball + contents calls.
  **Ground:** gh CLI manual page for `auth token` (pin); GitHub REST auth docs.
  **Done:** fetch of a public and a private fixture repo path.

## E08-S02 — As a pipeline developer, templates and checkouts from other repos resolve at convert time, so cross-repo pipelines convert completely.
Acceptance: alias resolution + repo snapshot fetch with SHA pinning, per docs/05 §2–§3.

- [ ] **E08-S02-T01 — ADO Git fetcher**
  **Do:** ref→SHA resolve (Refs endpoint), snapshot via `git clone --bare` with token credential (preferred) or Items `$format=zip` fallback; cache layout per docs/05 §4.
  **Ground:** Git Refs + Items REST pages (pin; note `versionDescriptor` params) + live samples; git credential embedding format from git-scm docs (pin).
  **Done:** fixture: fetch repo@branch and @commit; cache hit path tested offline.
- [ ] **E08-S02-T02 — GitHub fetcher**
  **Do:** ref→SHA via commits API; tarball download; same cache layout.
  **Ground:** GitHub REST "download tarball" + commits pages (pin) + live samples.
  **Done:** as T01 for a GitHub fixture repo.
- [ ] **E08-S02-T03 — Alias resolution & config overrides**
  **Do:** `resources.repositories` → fetcher dispatch per docs/05 §3 incl. local-path override (redirect alias to a working copy) and `@self`; endpoint substitution note into manifest.
  **Ground:** resources-repositories yaml-schema page (quote `type`/`name`/`ref` semantics + default-branch rule).
  **Done:** E03 cross-repo fixtures now resolve through this layer; local-override integration test.

## E08-S03 — As a pipeline developer, artifacts, variable-group names and task metadata are fetched and pinned, so re-conversion is reproducible offline.
Acceptance: endpoints wrapped + lockfile discipline per docs/05 §4.

- [ ] **E08-S03-T01 — Typed ADO REST client core**
  **Do:** fetch wrapper: base URLs, api-version pinning module (single table), retry/backoff, error surfacing, **redaction middleware** (no tokens in errors/logs).
  **Ground:** REST versioning doc (…/rest/api/azure/devops/ versioning section — quote api-version negotiation rules).
  **Done:** unit tests incl. redaction proof; version table cites pages.
- [ ] **E08-S03-T02 — Pipelines runs + artifact download**
  **Do:** runs list w/ branch/tag filters (resource pinning rules from resources doc), artifacts with `$expand=signedContent`, zip download+extract into cache.
  **Ground:** Pipelines Runs + Artifacts REST pages (pin) + live samples incl. a real `signedContent.url`; resources-pipelines yaml-schema page for default-version-resolution rules (quote — which run is picked when unspecified).
  **Done:** fixture pipeline artifact lands in `.cache/artifacts/...`; pinned runId in lockfile.
- [ ] **E08-S03-T03 — Build artifacts fallback + definitions lookup**
  **Ground:** Build Artifacts + Definitions REST pages (pin) + samples.
  **Done:** classic-artifact fixture downloads; name→id lookup used by oracle harness.
- [ ] **E08-S03-T04 — Variable groups (names only)**
  **Do:** fetch by name; extract variable **names** + secret flags; never persist values even if returned for non-secrets (decision 2026-07-30).
  **Ground:** Variablegroups REST page (pin) + live sample; the discard-values rule is internal policy — enforce with a test asserting values absent from all outputs.
  **Done:** `.env.example` group blocks show names; value-absence test green.
- [ ] **E08-S03-T05 — Task metadata fetch (marketplace)**
  **Do:** list installed tasks, match name@major, cache `task.json`.
  **Ground:** the DistributedTask tasks endpoint has thin docs — ground via live samples from test org (list + single task) and, as code reference, how the agent downloads tasks (locate task download in agent repo; pin). Mark route/api-version claims as experiment-backed.
  **Done:** marketplace fixture task's `task.json` cached and consumed by E09 normalization.
- [ ] **E08-S03-T06 — Lockfile + `--frozen`/`--update`**
  **Do:** `azdo-emu.lock.json` schema per docs/05 §4; write/read/verify; `--frozen` offline guarantee; `fetch-artifacts.sh` emission (curl fallback documented).
  **Ground:** docs/05 §4 spec; offline guarantee proven by a network-disabled CI job (unshare/no-proxy) converting from warm cache.
  **Done:** reproducibility test: two converts from lock → identical output hashes.
- [ ] **E08-S03-T07 — Org yamlschema fetch** (feeds E01-S02-T03)
  **Ground:** live sample from test org (already required there); this task pins caching+refresh.
  **Done:** cached schema used when present; refresh path tested.
