# 05 — Fetching, auth, caching & lockfile

Everything that leaves the local machine happens **at convert time** through this layer. Reference: learn.microsoft.com/rest/api/azure/devops/.

## 1. Authentication

### Azure DevOps (three modes, auto-selected in this order unless configured)
| Mode | Mechanism | Notes |
|---|---|---|
| `interactive` | MSAL public-client **device-code / browser** flow; scope `499b84ac-1321-427f-aa17-267ca6975798/.default` (the Azure DevOps resource) | The requested "interactive sign-in". Refresh tokens cached in OS keyring (`@napi-rs/keyring`; fallback `~/.azdo-emu/tokens.json` chmod 600) |
| `az` | Reuse Azure CLI: `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` | Zero-setup when `az login` already done |
| `pat` | `AZDO_PAT` env var (also honors `AZURE_DEVOPS_EXT_PAT`), Basic auth | CI-friendly. (Azure DevOps Server / on-prem: out of scope — decision 2026-07-30) |

`azdo-emu auth login` runs interactive and verifies with a probe call; `auth status` shows org, identity, mode, expiry.

### GitHub (for `resources.repositories` with `type: github`, and github templates)
1. Reuse `gh` CLI token (`gh auth token`) when present — default.
2. `GITHUB_TOKEN` env var.
3. (Later) our own OAuth device flow — requires registering an OAuth app; deferred until demand.

Anonymous fallback for public repos (tarball download without auth).

## 2. REST endpoints used (api-versions pinned in one module, re-verified at impl)

| Purpose | Call |
|---|---|
| Whole-repo snapshot at ref (templates, checkout sources) | `GET {org}/{proj}/_apis/git/repositories/{repo}/items?path=/&versionDescriptor.version={ref}&versionDescriptor.versionType=branch\|tag\|commit&resolveLfs=true&$format=zip` — or `git clone --bare` with the token as credential (preferred for large repos / when git available; enables reference clones at run time) |
| Single file (probe, small templates) | same route with `path={file}&download=true` |
| Resolve ref → commit SHA (lockfile pin) | `GET …/_apis/git/repositories/{repo}/refs?filter=heads/{branch}` |
| Pipeline runs (pin `resources.pipelines` w/o explicit run) | `GET {org}/{proj}/_apis/pipelines/{pipelineId}/runs` (+ branch/tag filtering per resource spec: `version`, `branch`, `tags`) |
| Artifact download | `GET {org}/{proj}/_apis/pipelines/{pipelineId}/runs/{runId}/artifacts?artifactName={n}&$expand=signedContent` → download `signedContent.url` (zip) |
| Classic build artifacts fallback | `GET {org}/{proj}/_apis/build/builds/{buildId}/artifacts` |
| Pipeline definition lookup (name → id, yaml path/repo) | `GET {org}/{proj}/_apis/build/definitions?name=…` |
| Variable groups (names only) | `GET {org}/{proj}/_apis/distributedtask/variablegroups?groupName={n}` — used solely to list variable **names** for `.env.example`; values (secret or not) are never consumed (decision 2026-07-30) |
| Installed task metadata (marketplace `task.json`) | `GET {org}/_apis/distributedtask/tasks` (list; filter by name/version) and `GET …/tasks/{taskId}/{version}` (zip, for P6 execution mode) |
| Org YAML schema (validation incl. marketplace inputs) | `GET {org}/_apis/distributedtask/yamlschema?api-version=7.1` — **org-scoped, no project segment**; optional `validateTaskNames=false` (C-E01-029/033) |
| **Oracle**: server-side final YAML | `POST {org}/{proj}/_apis/pipelines/{pipelineId}/preview` body `{"previewRun": true, "yamlOverride": …, "templateParameters": …}` → `finalYaml` |
| GitHub repo snapshot | `GET https://api.github.com/repos/{owner}/{repo}/tarball/{ref}` (or `git clone`); ref→SHA via `GET …/commits/{ref}` |

## 3. Repo alias resolution

`resources.repositories[].repository` entries map alias → `{type: git|github|githubenterprise, name, ref, endpoint}`. Resolution for template refs (`file.yml@alias`) and `checkout: alias`:

1. Config override (`repositories:` in `azdo-emu.yaml`) — lets users redirect an alias to a local path (killer feature: point `templates` at a local working copy of the template repo while debugging templates themselves).
2. `type: git` (ADO): same-org project/repo via ADO auth.
3. `type: github`: via GitHub auth. `endpoint:` (service connection) is irrelevant locally — our own auth substitutes; a manifest note records the substitution.
4. Ref default: repo default branch; explicit `ref:` honored; always pinned to a commit SHA in the lockfile.

`@self` = the source repo of the root YAML (local working copy / its origin).

## 4. Cache & lockfile

```
<out>/.cache/
  repos/<host>/<org-or-owner>/<project>/<repo>/<sha>/...      # bare mirror or extracted snapshot
  artifacts/<pipelineAlias>/<runId>/<artifactName>/...
  tasks/<TaskName>@<version>/task.json (+ zip in P6)
  schema/yamlschema-<org>.json
  expansion/<requestHash>/final.yml (+ provenance.json)       # preview expansion, E00-S04
```

**`schema/yamlschema-<org>.json` cache policy** (measured in E01-S02-T03, `research/experiments/E01-orgschema/`):
the service exposes **no version to bust the cache on** — the VS Code extension says so outright and
therefore caches per session only, and the document's `$comment` is not a freshness signal (the live
org reported `v1.183.0` against the vendored snapshot's `v1.261.1` while carrying the *newer* task
list, C-E01-035). The response is also **not byte-stable**: consecutive calls reorder
`definitions.task.anyOf`, so a body hash is not a validity check (C-E01-034). Expire by age and let
`--refresh` force a re-fetch. Reading the cache goes through `parseOrgSchema()`/`resolvePipelineSchema()`
(`packages/engine/src/frontend/org-schema.ts`), which falls back to the vendored schema rather than
failing when the document is unusable. Scope: this operation is documented under **`vso.agentpools`**,
wider than the `vso.build` the oracle needs (C-E01-036).

`azdo-emu.lock.json` (committed by the user if they want reproducibility):

```json
{
  "version": 1,
  "convertedAt": "2026-07-30T12:00:00Z",
  "root": { "file": "azure-pipelines.yml", "sha256": "…" },
  "parameters": { "deployEnv": "dev" },
  "repositories": {
    "self":      { "url": "https://dev.azure.com/contoso/App/_git/app", "ref": "refs/heads/main", "commit": "8c1f…" },
    "templates": { "type": "azdo", "url": "…/_git/pipeline-templates", "ref": "refs/heads/main", "commit": "ab12…" }
  },
  "pipelines": {
    "upstream": {
      "projectId": "2f2cfc9d-…", "projectName": "Fabrikam",
      "pipelineId": 42, "pipelineName": "SmartHotel-CI",
      "runId": 1234, "runName": "20260812.3", "runUri": "vstfs:///Build/Build/1234",
      "sourceBranch": "refs/heads/main", "sourceCommit": "69d3…", "sourceProvider": "TfsGit",
      "requestedFor": "Jane Doe", "requestedForId": "a49d…",
      "artifacts": ["drop"]
    }
  },
  "tasks": { "replacetokens@5": { "id": "guid", "version": "5.6.1" } },
  "expansion": {
    "requestHash": "2a138e6a…", "finalYamlHash": "sha256 of finalYaml",
    "apiVersion": "7.1", "pipelineId": 19, "storedAt": "2026-08-22T12:00:00Z"
  }
}
```

The `pipelines.<alias>` entry was widened from `{pipelineId, runId, artifacts}` in E02-S04-T03: a
pinned run has to reproduce **all twelve** `resources.pipeline.<alias>.*` predefined variables a real
run exposes (C-E02-120), so every documented field is pinned. `projectName` is written **only** when
the YAML resource declares `project:` — the service omits the variable otherwise, and absence is
observable in the emitted environment (C-E02-122). Lockfile keys use the repo's camelCase
(`pipelineId`, `runUri`); `pipelineResourceVariables()` in `packages/engine/src/expr/resources.ts`
maps them to the service's own spelling (`pipelineID`, `runURI`).

**Expansion cache (E00-S04-T02, added 2026-08-22).** The `preview` expansion is cached under
`.cache/expansion/<requestHash>/` keyed by the sha256 of the `yamlOverride`; `final.yml` holds the
**raw** expansion (functional — D8 guarantees the document carries no secret *values*, and `.cache/`
is gitignored), and `provenance.json` holds the lock entry. `--frozen` resolves the expansion from
cache and raises `ExpansionCacheMissError` on a miss, so a `--frozen` re-convert is byte-identical
and fully offline.

- `convert --frozen`: fully offline, errors if anything required is missing from cache — reproducible regeneration.
- `convert --update [alias|artifact|all]`: re-resolve pins.
- `fetch-artifacts.sh --refresh` in the output re-downloads pinned (or latest, `--latest`) artifacts.

## 5. Security posture

- Tokens: keyring or 0600 file; never in the output project, lockfile, manifest, logs, or error messages (redaction middleware on the HTTP client).
- Variable-group **secret values are never fetched** (API doesn't return them; we don't try exotic workarounds) — names only, into `.env.example`.
- Generated `.gitignore` covers `.env`, `.work/`, `.artifacts/`, `.cache/` — cached repo snapshots may contain private source; treated as secret-adjacent.
- Runtime log masking for all `.env` values flagged secret + `task.setsecret` additions (docs/04 §5).
- Convert-time linter warns on plaintext secrets spotted in YAML (heuristic, opt-out).
- `--offline` conversion works with zero auth for pipelines that need no remote resources.
