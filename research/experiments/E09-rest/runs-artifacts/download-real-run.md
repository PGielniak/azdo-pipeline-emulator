# E09-S03-T02 §4 re-run — the download half, now measured

The 2026-09-02 transcript closed §4 with "the thing to re-run once a pipeline with a
`PublishPipelineArtifact` step has executed once". E11-S05-T01 executed one: run 553 of
`oracle-l6-shell-artifacts` publishes `drop`. This is that re-run.

**Reads only.** The outward-facing write the old note declined to take unilaterally had
already happened for another task; nothing here queues a build.

- Pipeline `36`, run `553`, result `succeeded`
- Runs visible on this pipeline: 1

## Artifact metadata, with `$expand=signedContent`

```text
GET <org>/<project>/_apis/pipelines/36/runs/553/artifacts
      ?artifactName=drop&$expand=signedContent&api-version=7.1
  -> HTTP 200
     name:             drop
     url:              <container url, redacted>
     signatureExpires: 2026-09-22T13:38:36.0401954Z
     signedContent.url shape:
       https://artprodsu6weu.artifacts.visualstudio.com/{redacted}/_apis/public/artifact/{redacted}/signedContent ?format={redacted}&urlExpires={redacted}&urlSignature={redacted}&urlSigningMethod={redacted}
```

**Neither the signature nor the path is recorded, and the path is the interesting half.**
`signedContent.url` grants "limited-time anonymous access" (C-E09-071) — a bearer credential in
a query string. But the *path* carries a **base64** segment that decodes to
`pipelineartifact://<org>/projectId/<guid>/buildId/<n>/artifactName/<name>`, so printing the
path verbatim puts the organization name in the transcript in a form neither `redact()` nor the
runbook's `grep` for the org name can see — both come back clean (C-E09-094). Only structural
literals survive here; every other segment and every parameter value is redacted.

## The download, unauthenticated by design

The request carries **no** `Authorization` header — the signature is the grant (C-E09-071).

```text
GET <signed content url>   [no Authorization header]
  -> HTTP 200, application/zip
     unpacked: 1 file(s), 150 bytes
     cache path: .cache/.cache/artifacts/l6-shell-artifacts/553/drop
```

The layout is docs/05 §4's `.cache/artifacts/<alias>/<runId>/<artifactName>/`, with the
archive kept beside its extraction as `artifact.zip`.

## The lockfile pin, against the same download

```text
pipelines.l6-shell-artifacts = { pipelineId: 36, runId: 553, artifacts: ["drop"] }
verifyLockfile -> satisfied (0 missing pins)
```

`verifyLockfile` resolves the artifact directory **from the pinned `runId`**, so a satisfied
verify is evidence that the pin and the downloader agree on the cache layout — not merely that
the schema has a `runId` field. The 2026-09-02 note reassigned this clause to E09-S03-T06; the
schema and the verify path were already here, and what it was actually missing was item 1’s
artifact.

## What this closes

Done item 1 of E09-S03-T02 — "fixture pipeline artifact lands in `.cache/artifacts/...`" —
which had been the only thing standing between this task and `[x]` since 2026-09-02.

Regenerate with `pnpm e09-runs-artifacts-live` (reads an existing run; queues nothing).
