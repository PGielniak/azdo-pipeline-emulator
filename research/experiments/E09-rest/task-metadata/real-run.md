# E09-S03-T05 — installed task metadata, measured

Run: 2026-09-02 against the test organization. Organization name and PAT redacted; task names, GUIDs
and versions are public marketplace/in-box identifiers and are kept.

The task's **Ground** field says this endpoint's docs are thin and directs that route and
api-version claims be experiment-backed. They are: everything below is measured, with
`microsoft/azure-pipelines-agent` as the code reference for how a task is addressed.

## 1. The list is organization-scoped and already complete

```text
GET <org>/_apis/distributedtask/tasks?api-version=7.1
  -> HTTP 200, count 269   (172 distinct names, 66 names with more than one entry)

  CmdLine entry keys:
    _buildConfigMapping, author, category, contentsUploaded, dataSourceBindings,
    definitionType, demands, description, execution, friendlyName, groups,
    helpMarkDown, helpUrl, iconUrl, id, inputs, instanceNameFormat, name,
    postJobExecution, preJobExecution, releaseNotes, runsOn, satisfies,
    serverOwned, showEnvironmentVariables, sourceDefinitions, version, visibility
```

That is a whole `task.json`, inputs and `execution` included — so **metadata costs one call and no
download** (C-E09-085). Only real-task *execution* needs the zip.

## 2. `version` is an object, and the GUID is not a version key

```text
CmdLine  {major: 1, minor: 1,   patch: 3, isTest: false}  id=d9bafed4-…  serverOwned=true
CmdLine  {major: 2, minor: 279, patch: 0, isTest: false}  id=d9bafed4-…  serverOwned=true
         -> ids equal across majors: true

across all 269 entries, names with two entries sharing a major: 0
```

So `replacetokens@6` is matched on `version.major` — a string compare against `"6"` matches nothing
(C-E09-086) — and `name@major` selects exactly one definition while the GUID stays constant
(C-E09-087).

**The list is not ordered.** `replacetokens` came back as majors `[3, 4, 6, 7, 5]`, so "latest" is
something to compute, never the last element.

## 3. The marketplace fixture

```text
replacetokens  contributionIdentifier = qetza.replacetokens.replacetokens-task
               id = a8515ec8-7254-4ffd-912c-86772e2b5962   serverOwned = null
  majors 3 (3.12.4), 4 (4.4.4), 5 (5.6.1), 6 (6.3.1), 7 (7.0.0)
  latest entry adds: contributionVersion, minimumAgentVersion, outputVariables
  inputs: rootDirectory, targetFiles, tokenPattern, tokenPrefix, tokenSuffix,
          caseInsensitivePaths, includeDotPaths, encoding, …
  execution: Node20_1, Node24
```

`contributionIdentifier` is the marketplace marker; an in-box task carries `serverOwned: true` and a
null `contributionIdentifier` instead (C-E09-089).

## 4. The zip needs the exact three-part version

```text
GET <org>/_apis/distributedtask/tasks/a8515ec8-…/6.3.1?api-version=7.1
  -> HTTP 200  Content-Type: application/zip; api-version=7.1
     700,058 bytes, PK magic, contains exec-child.js …

GET <org>/_apis/distributedtask/tasks/a8515ec8-…/6.4.0?api-version=7.1
  -> HTTP 404
     {"message":"No task definition found matching ID a8515ec8-… and version 6.4.0.
       You must register the task definition before uploading the package.",
      "typeKey":"TaskDefinitionNotFoundException"}
```

The 404 message is misleading — it talks about *uploading* a package when the caller was only
reading one — so the useful signal is the `typeKey`, not the prose. More importantly, **a download
cannot be issued from `name@major` alone** (C-E09-088): the list call must supply `major.minor.patch`
first. The agent works the same way, calling `GetTaskContentZipAsync(task.Id, version)` with an
already-resolved `TaskVersion`, and caching at `<tasks>/<name>_<id>/<version>`.

## Conclusion

`name@major` → definition is one call and needs `version.major` arithmetic over an unordered list;
`name@major` → zip is necessarily two calls. The marketplace fixture `replacetokens` exists in this
organization across five majors, which is what lets the Done criterion be met without any write.
