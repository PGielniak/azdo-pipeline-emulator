# E08-S02-T02 — a real `Docker@2` run under real-task mode

**The first end-to-end real-task execution in this repo.** The Done field asks for "one real
build/push to a scratch registry" and "parity of pushed tags"; this is that run, and it doubles as
the empirical check on C-E08-047/049/051.

Nothing here touches a cloud resource. The registry is `registry:2` on `localhost:5000`, started
and destroyed by this experiment; the credentials below are literal dummies for a registry that
checks none (`tester` / `notchecked`).

## Setup

| Piece | Value |
|---|---|
| Task package | `Docker@2.276.0`, fetched from the org through E07-S01-T01`s downloader — 11,189 files, 27,319,096 bytes (the bundled `node_modules` is what makes real-task mode possible) |
| Source read for the claims | `docker-common` 2.276.0 @ `4b4690c1ecf5522d8c7f99a11a427d5ceb4a1a1d` — **the same version the downloaded package depends on** |
| Registry | `docker run -d -p 5000:5000 registry:2` |
| Host | our `INPUT_*` contract (C-E07-001) set by hand, and `ENDPOINT_AUTH_scratchreg` derived by `azdo_sc_endpoint_auth_json` (C-E08-044) |
| Dockerfile | `FROM scratch` + `COPY hello.txt /hello.txt` |

The blob our runtime derived, and the task accepted:

```json
{"scheme":"UsernamePassword","parameters":{"username":"tester","password":"notchecked","registry":"localhost:5000","email":""}}
```

## Run 1 — `buildAndPush`, comma-separated tags

Inputs: `repository: E08`, `tags: 1.0.0,latest`, `containerRegistry: scratchreg`.

Result `##vso[task.complete result=Succeeded;]`. Registry afterwards:

```
GET /v2/_catalog        -> {"repositories":["e08"]}
GET /v2/e08/tags/list   -> {"name":"e08","tags":["latest","1.0.0"]}
```

**Tag parity holds** (C-E08-051): both tags built, both tags pushed, nothing else.

## Run 2 — a multi-word repository and newline-separated tags

Inputs: `repository: "E08 Parity"`, `tags: "2.0.0\nv2-newline"`.

```
#5 naming to localhost:5000/e08parity:2.0.0 done
#5 naming to localhost:5000/e08parity:v2-newline done
The push refers to repository [localhost:5000/e08parity]
2.0.0:      digest: sha256:1737a668b5a6186ed533176efd6c7f0fff392868370927df1db597653cf13455 size: 855
v2-newline: digest: sha256:1737a668b5a6186ed533176efd6c7f0fff392868370927df1db597653cf13455 size: 855
##vso[task.complete result=Succeeded;]
```

**C-E08-049 confirmed:** `E08 Parity` became `e08parity` — lower-cased *and* space-stripped — and the
registry host was prefixed. **C-E08-051 confirmed on its other split character:** a newline
separates tags exactly as a comma does, and build and push named the same two images.

## Run 3 — no `containerRegistry` at all

Inputs: `repository: "ambient probe"`, `tags: 3.0.0`, `command: build`, **no** connection.

```
#5 naming to docker.io/library/ambientprobe:3.0.0 done
##vso[task.complete result=Succeeded;]
```

**C-E08-047 confirmed.** The image is named **unqualified**, so docker resolves it to
`docker.io/library/...`. A `push` from here goes to Docker Hub, not to any registry the developer is
logged in to.

## Run 4 — the discriminating test: a real docker config, outside the temp directory

Same as run 3, but `DOCKER_CONFIG` points at a directory holding a valid
`{"auths":{"localhost:5000":{...}}}` — i.e. what a developer`s own `~/.docker` is.

```
#5 naming to docker.io/library/guardprobe:4.0.0 done
##vso[task.complete result=Succeeded;]
```

**Still unqualified.** This is the half of C-E08-047 that a source reading alone leaves arguable:
`getExistingDockerConfigFilePath` requires `isPathInTempDirectory`, so a config the task did not
itself write under `agent.tempDirectory` is ignored **even when `DOCKER_CONFIG` names it**. The
source comment "else, use the currently logged in registries" means registries logged in by an
earlier `Docker@2` step in the same job — never the developer`s own session.

## What this settles about the epic

`Docker@2` runs correctly under real-task mode with our `INPUT_*` host and our derived endpoint
blob, and it leaves `~/.docker` alone (C-E08-048). The one delta worth a warning is the image name,
not the credentials: **authentication is ambient, qualification is not.**
