# E09-S02-T02 — GitHub fetcher, live run through the shipped code

Run: 2026-09-02 against `api.github.com`, **through `packages/fetch/src/repo/github.ts`**. The
private fixture's owner, repository name, branch, commit and payload are redacted; the public
fixtures (`octocat/Hello-World`, `git/git`) are named so the run is reproducible by anyone.

## 1. Ref resolution — the four forms the docs name, measured

Against `git/git`, whose `v2.43.0` is an annotated tag:

| `{ref}` sent to `GET /repos/git/git/commits/{ref}` | result |
| --- | --- |
| `refs/tags/v2.43.0` | 200, `sha` `564d0252ca632e0264ed670534a51d18a689ef5d` |
| `refs/heads/master` | 200 |
| `heads/master` | 200 |
| `v2.43.0` (bare) | 200, same `sha` |
| **`tags/v2.43.0`** | **422** — `"No commit found for SHA: tags/v2.43.0"` |
| `heads/v2.43.0` | 422 (correctly type-scoped) |

The page states the ref "Can be a commit SHA, branch name (heads/BRANCH_NAME), or tag name
(tags/TAG_NAME)" — and `tags/TAG_NAME` is the one form of the three that does not work, while its
`heads/` counterpart does. `commitRefFor` therefore promotes any namespaced shorthand to the full
`refs/…` form, which is accepted for both namespaces and, unlike a bare name, cannot be ambiguous
when a branch and a tag share a name (C-E09-040). Run through the shipped code, the previously
failing input now succeeds:

```text
resolveGitHubRef({git, git}, 'tags/v2.43.0')  -> promoted to refs/tags/v2.43.0, 200
```

## 2. GitHub peels annotated tags for the caller (C-E09-041)

```text
resolveGitHubRef({git, git}, 'refs/tags/v2.43.0')
  -> commit 564d0252ca632e0264ed670534a51d18a689ef5d

GET /repos/git/git/git/ref/tags/v2.43.0        # the Git-refs endpoint, for contrast
  -> object.type: "tag"   object.sha: c089584ac8dedc3aa7c2c404839bc098050298a2

commits sha differs from the tag object: true
```

This is the exact inverse of Azure DevOps (C-E09-031/032), where `objectId` is the tag object and
the caller must ask for `peelTags=true` and read `peeledObjectId`. The asymmetry between
`repo/github.ts` (no peeling step) and `repo/ado-git.ts` (a peeling step) is therefore deliberate.

## 3. `@branch` and `@commit`

```text
resolveGitHubRef({octocat, Hello-World}, 'refs/heads/master')
  -> { ref: 'refs/heads/master', commit: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d' }
resolveGitHubRef({octocat, Hello-World}, '7fd1a60b…')          # a raw SHA
  -> commit '7fd1a60b…'   (round-trips to itself: true)
```

## 4. Snapshot, and the offline cache hit

```text
snapshotGitHubRepo({octocat, Hello-World}, <resolved>)
  -> fetched=true   snapshot.tar.gz 265 bytes, gzip magic true, untars to 10,240 bytes

snapshotGitHubRepo(... , { fetchImpl: throws })
  -> fetched=false   same entry directory
readCachedGitHubSnapshot(cacheDir, coords, commit)  -> hit
```

The second call's fetch implementation **throws on any use**, so it passes only if nothing was
requested. The download is addressed by the resolved SHA (C-E09-042), not by the branch, so a push
between resolve and download cannot change what lands in cache.

## 5. Private repository through the `gh auth token` chain

```text
resolveGitHubRef(<private>, 'refs/heads/<branch>', anonymous)
  -> HTTP 404: "not found, or private and this request was unauthenticated"
resolveGitHubRef(<private>, 'refs/heads/<branch>', chain)
  -> 200, a 40-character commit sha
snapshotGitHubRepo(<private>, <resolved>)
  -> fetched=true   snapshot.tar.gz 199,698 bytes
```

The anonymous arm reproduces C-E09-014/016 through this layer: a private repository answers 404, and
the message says so rather than claiming the repository does not exist.

## 6. Cache layout (docs/05 §4)

```text
<out>/.cache/repos/github.com/<owner>/<owner>/<repo>/<sha>/
    snapshot.tar.gz
    snapshot.json     # { version: 1, method: "tarball", ref, commit, storedAt }
```

`<owner>` fills both the org and project segments of the shared layout, since GitHub has no project
level. The marker names the method for the same reason the ADO fetcher's does: the two fetchers
write different shapes, and `--frozen` must not guess.

## Conclusion

Ref→SHA (branch, tag, raw SHA), the tarball snapshot, the offline cache hit, and the public/private
authentication boundary all work through the shipped code. The one finding that changed the code is
C-E09-040: the documented `tags/TAG_NAME` shorthand is rejected with 422, and the full `refs/…` form
is what to send.
