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
