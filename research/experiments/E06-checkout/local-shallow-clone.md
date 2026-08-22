# Experiment — `--depth` against a local path, and the agent's fetch sequence

- **Date:** 2026-08-21
- **Why:** E06-S05-T02 `clone` mode. docs/04 §8 specifies a "reference clone from pinned
  origin+commit". `fetchDepth` must be honored, and git documents that `--depth` interacts with the
  local-path optimization. Nothing in the Azure DevOps docs settles this — it is a **git** behavior
  the emulator inherits, so it is settled by running it (BACKLOG §3 step 3).
- **Environment:** git 2.47.3, this container. No network, no Azure DevOps credentials involved —
  purely local repositories, so there is nothing to redact beyond the temp path (`<TMP>`).
- **Claims produced:** C-E06-109 (corroborating C-E06-097/098/102).

## Setup

A three-commit repository at `<TMP>/src` (`one`, `two`, `three`).

## Transcript

```console
$ git --version
git version 2.47.3

$ git clone --depth 1 ./src d1
Cloning into 'd1'...
warning: --depth is ignored in local clones; use file:// instead.
done.
$ git -C d1 rev-list --count HEAD
3
$ test -f d1/.git/shallow && echo shallow || echo 'not shallow'
not shallow

$ git clone --depth 1 file://<TMP>/src d2
Cloning into 'd2'...
$ git -C d2 rev-list --count HEAD
1
$ test -f d2/.git/shallow && echo shallow || echo 'not shallow'
shallow

$ # the agent's own sequence (C-E06-102): init + remote add + fetch + checkout
$ git init -q d3 && git -C d3 remote add origin file://<TMP>/src
$ git -C d3 fetch --force --tags --prune --prune-tags --no-recurse-submodules origin --depth=1
From file://<TMP>/src
 * [new branch]      master     -> origin/master
$ git -C d3 checkout --force 2111422391cb900addbff88e55ec3b30a5a00e93
Note: switching to '2111422391cb900addbff88e55ec3b30a5a00e93'.
You are in 'detached HEAD' state. ...
HEAD is now at 2111422 three
$ git -C d3 rev-list --count HEAD
1
$ test -f d3/.git/shallow && echo shallow || echo 'not shallow'
shallow

$ # depth 0 on an already-shallow repo → --unshallow (C-E06-098)
$ git -C d3 fetch --force --tags --prune --no-recurse-submodules origin --unshallow
$ git -C d3 rev-list --count 2111422391cb900addbff88e55ec3b30a5a00e93
3
```

## Transcript — `--no-tags` against `--prune-tags` (2026-08-22)

```console
$ git -C src tag v2.0.0
$ git init -q t && git -C t remote add origin file://<TMP>/src
$ git -C t fetch --force --no-tags --prune --prune-tags --no-recurse-submodules origin
From file://<TMP>/src
 * [new branch]      main       -> origin/main
 * [new tag]         v2.0.0     -> v2.0.0
$ git -C t tag --list
v2.0.0
$ git -C t for-each-ref
fd6f82d… commit	refs/remotes/origin/main
fd6f82d… commit	refs/tags/v2.0.0
```

The tag arrives despite `--no-tags`, because `--prune-tags` is a shorthand for the explicit
`refs/tags/*:refs/tags/*` refspec and an explicit refspec beats automatic-tag-following
suppression. This is the agent's own flag combination (C-E06-097), with the `DisableFetchPruneTags`
knob at its built-in default of `false` — so `fetchTags: false` on a hosted agent does not stop
tags from being synced (C-E06-111).

## Transcript — submodules over a `file://` origin (2026-08-22)

```console
$ git -C src submodule add <TMP>/sub vendor/sub
Cloning into '<TMP>/src/vendor/sub'...
fatal: transport 'file' not allowed
fatal: clone of '<TMP>/sub' into submodule path '<TMP>/src/vendor/sub' failed
$ echo $?
128

$ git -C src -c protocol.file.allow=always submodule add <TMP>/sub vendor/sub
Cloning into '<TMP>/src/vendor/sub'...
done.

$ # the emulated checkout, then the agent's submodule sequence verbatim
$ git -C t submodule update --init --force
Submodule 'vendor/sub' (<TMP>/sub) registered for path 'vendor/sub'
fatal: transport 'file' not allowed
Failed to clone 'vendor/sub' a second time, aborting
$ echo $?
1

$ git -C t -c protocol.file.allow=always submodule update --init --force
Submodule path 'vendor/sub': checked out 'f0a9045…'
$ ls t/vendor/sub
inner
s.txt
$ ls t/vendor/sub/inner        # one level only, as documented
$ git -C t -c protocol.file.allow=always submodule update --init --force --recursive
$ ls t/vendor/sub/inner
d.txt

$ git -C t submodule foreach --recursive "git clean -ffdx"   # no relaxation needed
Entering 'vendor/sub'
Entering 'vendor/sub/inner'
$ echo $?
0
```

Since CVE-2022-39253 git refuses the `file` transport for submodule clones. The emulator's origin
is `file://` by construction, so `submodules: true` fails outright without
`-c protocol.file.allow=always`; the hosted agent never meets this because its submodule URLs are
https. `submodule foreach` clones nothing and needs no relaxation. See C-E06-112 and decision 40f.

## Findings

1. **`--depth` is silently ignored for a local *path* clone.** `d1` asked for depth 1 and got the
   full three-commit history with no `.git/shallow` marker; git only *warns*, exit status 0. An
   emulated checkout that clones `<source-dir>` directly would therefore accept `fetchDepth: 1` and
   do nothing with it — a silent parity hole, not a visible error.
2. **`file://<abs-path>` honors it.** `d2` has exactly one commit and a `.git/shallow` marker.
   The cost is that `file://` forgoes git's local hardlink/alternates fast path, so the objects are
   copied rather than shared.
3. **The agent's four-step sequence reproduces both halves.** `init` + `remote add origin
   file://…` + `fetch --depth=1` + `checkout --force <sha>` yields a shallow repository at a
   detached HEAD, which is exactly the hosted shape (C-E06-102). Reproducing the sequence rather
   than substituting a `git clone` is therefore both closer to the agent *and* the only way
   `fetchDepth` means anything locally.
4. **`--unshallow` restores the history in place**, confirming that the agent's `fetchDepth: 0`
   branch (C-E06-098) is a real state transition and not a no-op: `rev-list --count` goes 1 → 3
   without re-cloning.

## Consequence for the implementation

`clone` mode builds `file://<source>` as `origin` and follows the agent's sequence. docs/04 §8's
"reference clone" wording is corrected accordingly (docs/06 §5 decision 40).
