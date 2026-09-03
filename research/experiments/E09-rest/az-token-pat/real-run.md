# E09-S01-T02 — live measurement: `az` token reuse vs PAT against the test organization

Date: 2026-09-03 · Host: Linux · `azure-cli` 2.89.1 (`az version`).
Redacted per the E09 epic rule: the organization is written `{org}`, tokens are never captured.
Only HTTP status codes, response *field names* and derived booleans were recorded — no token,
no access-token payload and no profile values are reproduced here.

## 1. What `az account get-access-token` actually returns

Key/type shape of the JSON for `--resource 499b84ac-1321-427f-aa17-267ca6975798`
(values withheld; captured with `python3 -c "…{k: type(v).__name__…}"`):

| Field | Type |
| --- | --- |
| `accessToken` | `str` |
| `expiresOn` | `str` |
| `expires_on` | `int` |
| `subscription` | `str` |
| `tenant` | `str` |
| `tokenType` | `str` |

`tokenType` is `Bearer`. `expiresOn` was observed as `"2026-09-03 09:04:33.000000"` — **no timezone
offset and no `Z`**; `expires_on` is the POSIX sibling. See C-E09-019: the reference page tells
downstream applications to use `expires_on` for exactly this reason.

## 2. Probe used

The cheapest documented authenticated call, already pinned for `auth status` (C-E09-009/010):

```
GET https://vssps.dev.azure.com/{org}/_apis/profile/profiles/me?api-version=7.1
```

plus two organization-scoped calls to separate "endpoint rejects the token" from
"organization rejects the identity":

```
GET https://dev.azure.com/{org}/_apis/projects?api-version=7.1
GET https://dev.azure.com/{org}/_apis/connectionData?api-version=7.1
```

## 3. Results

| Credential | Profile `me` | `_apis/projects` | `_apis/connectionData` |
| --- | --- | --- | --- |
| PAT — `Authorization: Basic base64(":" + PAT)` | **200** | **200** | 400 (api-version) |
| `az` access token — `Authorization: Bearer <token>` | **302** | **302** | **302** |

The PAT response carried the documented compact profile: `coreRevision`, `displayName`,
`emailAddress`, `id`, `publicAlias`, `revision`, `timeStamp`.

A 302 is the sign-in redirect, i.e. *unauthenticated* — the same signature C-E00-025 records for a
lapsed PAT. Its `location` host was `https://spsprodweu2.vssps.visualstudio.com/`.

**The `az` rejection is not endpoint-specific.** Every organization endpoint rejected the bearer
token while the PAT was accepted on the same URL in the same minute.

## 4. Why: the organization is MSA-backed

Unauthenticated probe of `https://dev.azure.com/{org}/_apis/projects?api-version=7.1`, response
headers:

```
www-authenticate: Basic realm="https://tfsprodweu5.visualstudio.com/"
www-authenticate: Bearer
x-vss-authorizationendpoint: https://vssps.dev.azure.com/{org}/
x-vss-resourcetenant: 00000000-0000-0000-0000-000000000000
```

`x-vss-resourcetenant` is the **all-zeros tenant**: the organization is backed by a Microsoft
account, not by a Microsoft Entra tenant. The token `az` issues is minted in an Entra tenant, so
its `oid` is a different principal from the organization's identity — verified directly: the `oid`
claim of the acquired token **does not equal** the `id` the PAT-authenticated Profile call returns.

## 5. Every tenant `az` can reach was tried

`az account list --all` offered three tenants (masked here — their identity adds nothing to the
finding); the Microsoft-account consumers tenant `9188040d-6c67-4c5b-b112-36a304b66dad` — a fixed,
public Microsoft constant, not a tenant of this account — was tried as a fourth:

| Tenant (prefix) | `get-access-token` | Org probe |
| --- | --- | --- |
| tenant-A | refused | — |
| tenant-B | refused | — |
| tenant-C (the account's home tenant) | token acquired | **302** |
| `9188040d` (MSA consumers) | refused | — |

**Conclusion.** The `az` arm's token *acquisition* is live-verified and correct. Its *authorization
against this organization* is not reachable — not because of a lapsed sign-in, but because the
organization is MSA-backed. This is C-E09-002 measured rather than predicted, and it is a permanent
property of this test organization, not a blocker a later session can clear by running `az login`.
