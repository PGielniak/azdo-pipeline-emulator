# E09-S03-T03 — build artifacts and definition lookup, measured

Run: 2026-09-02 against the test organization. Organization, project and PAT redacted; definition
and build ids kept so the owner can reproduce it.

## 1. Two different answers for "no artifact"

```text
GET <org>/<project>/_apis/build/builds/527/artifacts?api-version=7.1
  -> HTTP 200  {"count":0,"value":[]}

GET <org>/<project>/_apis/build/builds/527/artifacts?artifactName=drop&api-version=7.1
  -> HTTP 404
     {"message":"Artifact drop was not found for build 527.",
      "typeKey":"ArtifactNotFoundException",
      "typeName":"Microsoft.TeamFoundation.Build.WebApi.ArtifactNotFoundException, …"}
```

"This build published nothing" is a 200; "this build has no artifact by that name" is a 404
(C-E09-075). Only the second is an error, and the fallback path has to tell them apart.

Compare the Pipelines wording for the identical condition (C-E09-072):

```text
Pipelines: An Artifact with name "drop" was not found.
           Microsoft.Azure.Pipelines.WebApi.ArtifactNotFoundException
Build:     Artifact drop was not found for build 527.
           Microsoft.TeamFoundation.Build.WebApi.ArtifactNotFoundException
```

Same `typeKey`, different message and different namespace — so **`typeKey` is the discriminator and
the message is not** (C-E09-076). A fallback that matched on message text would work against one API
and silently not the other.

## 2. The Definitions `name` filter is exact-with-wildcards, not prefix

```text
name=oracle-anch    -> 0   []
name=oracle-anch*   -> 1   [oracle-anchor]
name=oracle*        -> 14  [oracle-anchor, oracle-status-probe, …]
name=*anchor        -> 1   [oracle-anchor]
name=ORACLE-ANCHOR  -> 1   [oracle-anchor]
name=oracle-anchor  -> 1   [oracle-anchor]
```

This is the **opposite** of the Git Refs `filter`, which the docs describe as "(starts with)"
(C-E09-030). Here a bare prefix matches nothing; `*` is a wildcard at either end; and matching is
case-insensitive (C-E09-077). Both traps are live: assuming prefix semantics returns zero results,
and a definition name containing a literal `*` would be read as a pattern.

## 3. The list item does not carry the YAML path

```text
GET <org>/<project>/_apis/build/definitions?name=oracle-anchor&api-version=7.1
  -> 1 result, keys: _links, authoredBy, createdDate, drafts, id, name, path,
                     project, quality, queue, queueStatus, revision, type, uri, url
     {id: 19, name: oracle-anchor, path: "\\", type: build, queueStatus: enabled, revision: 1}

GET <org>/<project>/_apis/build/definitions/20?api-version=7.1
  -> adds: process, repository, properties, tags, triggers, jobAuthorizationScope
     process    = {"yamlFilename": "/experiments/status-skipped.yml", "type": 2}
     repository = {id, name: oracle, type: TfsGit,
                   defaultBranch: refs/heads/main, url: <org-url>/<project>/_git/oracle}
```

So name → id → **yaml path** is necessarily two calls (C-E09-078) — the same list/detail asymmetry
Runs-List has (C-E09-068).

## 4. The download half — not measured

As in `../runs-artifacts/real-run.md` §4: no build in this organization has ever published an
artifact, because every experiment used `previewRun: true`. The `resource.downloadUrl` fetch and the
cache write are unit-tested against the documented `ArtifactResource` shape only (C-E09-079). One
queued build with a publish step closes this section and that one together.
