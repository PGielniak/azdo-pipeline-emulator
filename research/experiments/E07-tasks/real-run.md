# E07-S01-T01 — the task package path, run live through the shipped code

Run: 2026-09-02 against the test organization. Organization name and PAT redacted; the task name,
GUID and version are public marketplace identifiers and are kept so the run is reproducible.

E09-S03-T05 measured the endpoints with `curl` and built resolution and `task.json` caching. This
transcript exercises the **shipped** code end to end, which is what E07-S01-T01's Done criterion
("a fixture task package lands in `.cache/tasks/` offline-reproducibly; lockfile pins the version")
actually asks for.

## Resolve → cache metadata → download package

```text
listInstalledTasks() then selectTask(_, 'replacetokens', 6)
  -> version { major: 6, minor: 3, patch: 1, isTest: false }

cacheTaskMetadata({ reference: 'replacetokens@6' })
  -> <cache>/.cache/tasks/replacetokens@6.3.1/task.json   10,416 bytes

downloadTaskZip(...)
  -> fetched=true   zip 700,058 bytes   5 files extracted
     entry contents:      task.json, task.zip, tree
     sample tree files:   exec-child.js, icon.png, index.js, lib.json
```

The zip size matches the 700,058 bytes E09-S03-T05 measured with `curl` (C-E09-088), which is the
point of re-running it: the number now comes from the code that ships rather than from a shell.

## The offline guarantee

```text
downloadTaskZip(client whose fetchImpl THROWS, same task, same cacheDir)
  -> fetched=false   same entry directory   files=5
```

The second call's fetch implementation raises on any use, so this line passes only if nothing was
requested. The reuse marker is the **unpacked tree**, not the zip: a zip present without a tree means
an extraction that did not finish, and reusing it would hand real-task mode an entry with no files
in it. A unit test covers that case directly.

## The lockfile pin

```text
pinTask(lock, 'replacetokens@6', taskPin(task, 'replacetokens@6'), now)
  -> tasks: { "replacetokens@6": { "id": "a8515ec8-7254-4ffd-912c-86772e2b5962",
                                   "version": "6.3.1" } }
verifyLockfile(lock, { cacheDir })  ->  0 missing
```

The key is the reference **as the YAML wrote it** — that is what a re-convert looks up — while the
value carries the exact `major.minor.patch` the download route requires (C-E09-088). Pinning only
the major would leave the package unaddressable on the next run. `verifyLockfile` returning zero is
the round trip closing: the pin E07 writes is the pin `--frozen` checks.
