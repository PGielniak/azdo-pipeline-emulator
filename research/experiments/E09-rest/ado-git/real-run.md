# E09-S02-T01 — ADO Git fetcher, live run through the shipped code

Run: 2026-09-02 against the test organization, **through `packages/fetch/src/repo/ado-git.ts`** —
not through hand-built requests. The organization name, project name and PAT are redacted; the
fixture repository name (`azdo-emu-templates`) and its commit SHA are not secrets and are kept so the
run is reproducible by the repository owner.

Environment: git 2.43.0, so `supportsConfigEnv` is true and the bare-mirror route is the default.

## 1. Ref resolution, and the prefix trap as a negative control

```text
readGitVersion()            -> { major: 2, minor: 43 }   supportsConfigEnv -> true

resolveAdoRef(<org>/<project>/azdo-emu-templates, 'refs/heads/main')
  -> { ref: 'refs/heads/main', commit: 'fa03743821b7e01caa17f4387b30338c43fac4df' }

resolveAdoRef(..., 'refs/heads/mai')          # deliberate prefix of the real branch
  -> AdoGitError: ref refs/heads/mai does not exist in azdo-emu-templates
                  (1 prefix match(es), none exact)
```

The second call is the point of the section. `filter=heads/mai` is a *starts-with* filter
(C-E09-030), so the service happily returned `refs/heads/main` for it; a resolver that took the
first result would have pinned the wrong branch and reported success. The exact-name check turns
that into an error, and the message distinguishes it from "no refs matched".

No annotated tag exists in either repository of the test organization, so the peeling behavior
(C-E09-031/032) is **not** exercised here — see C-E09-036 for what would close that.

## 2. Bare-mirror snapshot, and the three leak channels checked on disk

```text
snapshotAdoRepo(..., { gitVersion: 2.43 })
  -> method=bare-mirror  fetched=true   33 files under <entry>/mirror.git

mirror config contains "extraheader":            false
mirror config contains the PAT:                  false
mirror config remote line:  url = <org-url>/<project>/_git/azdo-emu-templates
git --git-dir <mirror> rev-parse refs/heads/main
  -> fa03743821b7e01caa17f4387b30338c43fac4df   (matches the resolved commit: true)
```

The credential reached git only through `--config-env=http.extraheader=AZDO_EMU_GIT_EXTRAHEADER`,
i.e. via the environment. It is absent from argv (asserted in the unit tests), absent from the
persisted `.git/config`, and absent from the remote URL. The `rev-parse` line is what makes this a
snapshot rather than an empty directory.

## 3. Cache hit — fully offline

```text
snapshotAdoRepo(..., { fetchImpl: throws, gitRunner: throws })
  -> fetched=false   same entry directory as the first call
readCachedSnapshot(cacheDir, coords, commit)  -> hit
```

Both the fetch and the git runner were replaced with implementations that **throw on any use**, so
this passes only if the second call touched neither the network nor a subprocess. That is the
property `--frozen` depends on.

## 4. `@commit` via the Items zip route — and one documented-shape correction

The first attempt, built from the endpoint's parameter table, failed:

```text
GET .../items?path=/&recursionLevel=full&resolveLfs=true&download=true
             &$format=zip&versionDescriptor.version=<sha>
             &versionDescriptor.versionType=commit&api-version=7.1
  -> HTTP 400
     {"message":"Cannot specify a \"recursionLevel\" other than \"None\" when providing a single
       item \"path\". Use the \"scopePath\" query parameter filter instead to get a collection of
       items.","typeKey":"ArgumentException"}
```

`path` is the route's only required parameter and `recursionLevel` is listed as an independent
filter; nothing in the prose says they conflict. Swapping `path=/` for `scopePath=/` fixes it, and
the code was changed to match (C-E09-037):

```text
GET .../items?scopePath=/&recursionLevel=full&resolveLfs=true&download=true
             &$format=zip&versionDescriptor.version=<sha>
             &versionDescriptor.versionType=commit&api-version=7.1
  -> HTTP 200   Content-Type: application/octet-stream; api-version=7.1
     1,032 bytes, PK magic, 6 entries (README.md, cross/abs.yml, cross/back-to-self.yml, …)

snapshotAdoRepo(..., { method: 'items-zip' })
  -> method=items-zip  fetched=true  snapshot.zip 1,032 bytes, PK magic true
```

Note the response `Content-Type` is `application/octet-stream`, not `application/zip` — the
`Accept` header the client sends is a preference the service does not echo.

## 5. Cache layout (docs/05 §4)

```text
<out>/.cache/repos/dev.azure.com/<org>/<project>/azdo-emu-templates/fa03743821b7e01caa17f4387b30338c43fac4df/
```

Each entry carries a `snapshot.json` marker naming the method that filled it. The two methods leave
different shapes in the same directory — `mirror.git/` versus `snapshot.zip` — so without the marker
a later `--frozen` run would assume a mirror that may not be there.

## Conclusion

Ref→SHA, both snapshot routes, and the offline cache-hit path all work through the shipped code.
Two findings came from the service rather than the docs: the `scopePath`/`path` conflict
(C-E09-037), and the confirmation that no credential survives on disk after a `--config-env` clone
(C-E09-038). The one gap is the annotated-tag peeling path, which the test organization cannot
exercise (C-E09-036).
