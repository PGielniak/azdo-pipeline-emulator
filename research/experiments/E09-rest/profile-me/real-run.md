# E09-S01-T03 — authenticated profile probe

Run: 2026-08-28 against the configured Azure DevOps Services test organization with the oracle PAT.
The organization, user fields, and authorization value are redacted. No token was printed or stored
in this transcript.

## Probe selection

The REST reference publishes
`https://app.vssps.visualstudio.com/_apis/profile/profiles/{id}?api-version=7.1` and documents `me`
as the current authenticated user. With this organization-scoped PAT, that global host returned an
empty 401. The official `microsoft/azure-devops-node-api` README separately says Profile APIs must
use the deployment host `https://vssps.dev.azure.com/{org}`. Repeating the same operation there
succeeded, so the implementation uses the organization-specific deployment URL.

## Redacted request

```http
GET https://vssps.dev.azure.com/{org}/_apis/profile/profiles/me?api-version=7.1
Accept: application/json
Authorization: Basic {redacted}
```

## Redacted response

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8; api-version=7.1
```

```json
{
  "coreRevision": 0,
  "displayName": "{redacted}",
  "emailAddress": "{redacted}",
  "id": "{redacted-guid}",
  "publicAlias": "{redacted}",
  "revision": 0,
  "timeStamp": "{redacted-timestamp}"
}
```

`coreRevision`, `revision`, and `timeStamp` above preserve types but not the live values. The failed
global-host attempt was `401 Unauthorized`, no content type, zero response-body bytes.

## Implementation confirmation

After `packages/fetch` was implemented and built, its exported `authStatus()` was run through an
in-memory keyring entry containing the test-org PAT. The production URL/header/parser path returned
`kind: authenticated`, the configured org, `mode: pat`, `expiresAt: null`, and all four redacted
identity fields (`id`, `displayName`, `emailAddress`, `publicAlias`). The serialized result was checked
not to contain the PAT. No fallback file was created by this confirmation run.
