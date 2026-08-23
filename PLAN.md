# azdo-pipeline-emulator — Master Plan (revised)

Status: **Design / planning (revised)** · Date: 2026-08-22 · Working CLI name: `azdo-emu`

> **Revision note.** This file is the **simplified** plan. It replaces the original
> "reimplement Azure Pipelines end-to-end" plan after an architecture review on `main`
> (commit `b187501`). The review — *isn't this already too complicated?* — and the reasoning
> behind every cut are in [docs/07-simplification-review.md](docs/07-simplification-review.md).
> In one sentence: **the hardest 60% of the original plan (reimplementing the server-side template
> engine and compile-time expression language) is work the Azure DevOps service already does for
> free, so we stop reimplementing it and delegate it.**
>
> **Reconciliation addendum (2026-08-22).** After this revision, the branch was rebased onto
> parallel work that had *already built* most of the local template engine (E03) and bash runtime
> (E06). So those two are **retained as a completed offline fallback** rather than reimplemented:
> the `preview`-delegation path below remains the *default*, but the local engine is now a working
> fallback, not a cost to be avoided. The framing in §2–§7 stands; the "cut the reimplementation"
> argument now reads as "stop *extending* it, keep what exists as fallback".

---

## 1. Problem & vision

Debugging Azure DevOps YAML pipelines today means: edit YAML → push → queue → wait → read logs →
repeat. There is no official way to run a pipeline locally.

**Vision (unchanged):** a tool that turns a pipeline into a **self-contained local project of plain
bash scripts** that reproduces the pipeline's *runtime* behavior step by step, so a developer can
edit locally and debug without committing to the repo every time:

```
azdo-emu convert azure-pipelines.yml -o ./local-run
cd local-run && cp .env.example .env   # fill in secrets/service-connection creds
./run.sh                               # or run one stage / job / single step
```

**What changed (the simplification):** how the tool gets from "the user's YAML" to "a runnable
project". The original plan reimplemented the server's template expansion and compile-time
expression evaluation locally, to byte parity, oracle-probed at every step — two full epics of
compiler cloning that would never stop needing parity fixes. The revised plan instead **asks the
service to expand the pipeline** (it already offers this via the Pipelines *preview* endpoint), and
builds the local runner from the service's own fully-expanded YAML. Expansion parity is then **true
by construction**, and the work left to us is only the *runtime* half — the part the **agent** does
at run time — which is small and stable.

## 2. Goals

1. **Delegate expansion, don't reimplement it.** Call the Pipelines `preview` endpoint
   (`POST …/_apis/pipelines/{id}/preview`, `previewRun: true`) with the user's *local* YAML; take
   back `finalYaml` (templates resolved, `${{ }}` evaluated, parameters bound) and emit it as
   `pipeline.expanded.yml` so local **execution** stays offline and reproducible.
2. **Bundle local edits into the expansion request.** A mechanical inliner packs local `@self`
   template files into the override so editing templates (not just the root file) works without
   committing.
3. **Reproduce the runtime contract.** Parse the expanded YAML and run it with an agent-faithful
   bash runtime: `$( )` macro expansion, `$[ ]` runtime conditions, `##vso[…]` logging commands,
   variables/outputs/artifacts, `dependsOn`, secret masking, and `.env` for everything unresolvable.
4. **Run script steps natively; delegate the rest to real task code.** `script`/`bash`/`pwsh`/
   `powershell`/`checkout` steps are the debugging surface and are emitted as readable bash. Every
   other task runs either in **real-task mode** (download the actual task package and execute it
   against an emulated `azure-pipelines-task-lib`, the `INPUT_*` contract) or as a **stub** that
   dumps its resolved inputs. There is no per-task transpiler.
5. **Prioritize the deployment set.** The agreed priority set (AzureCLI/PowerShell, Docker,
   Helm/kubectl, ARM/Bicep, Key Vault, storage) is delivered first, on top of real-task mode and the
   service-connection `.env` contract.

## 3. Non-goals (v1)

- **Reimplementing server-side expansion.** Templates, `extends`, `each`/`insert`/`if` directives,
  compile-time `${{ }}` evaluation, parameter binding and server limits are the service's job. The
  original in-repo template engine and compile-time evaluator are retained only as an **offline
  fallback** (off the critical path) for when a user has no preview access.
- **A per-task transpiler.** We do not hand-write a readable-bash emitter for every task in the
  catalogue. Complex tasks run Microsoft's own code in real-task mode; unknown tasks stub.
- **A weighted coverage report** (the original D10). Replaced by a plain **warnings/unsupported
  list** in the generated README. Fidelity *labels* (exact/equivalent/degraded/stub) are kept; the
  percentage metric and `--min-coverage` gate are dropped.
- **Sandbox-by-default** (the original D11). Host execution is the default; an optional container
  sandbox is deferred.
- **Faithful per-job workspace isolation** (the original D9). A shared workspace is the default
  first; per-job `Pipeline.Workspace` fidelity is deferred.
- **Triggers, schedules, PR policies, approvals/checks/gates, environments** — recorded, not
  executed.
- **Windows host execution** — deferred (unchanged). `pwsh` steps run on Linux/macOS via `pwsh`.
- **Azure DevOps Server (on-prem)** — out of scope (unchanged).
- **Perfect hosted-image parity, classic pipelines, pipeline decorators, billing semantics** —
  unchanged non-goals.

## 4. Architecture

```
                    ┌────────────────────────── convert time ──────────────────────────┐
 azure-pipelines.yml │                                                               │
 (+ local @self      │  Bundler ──► POST preview ──► finalYaml (fully expanded)      │
  templates)         │  (inline      (service does    (templates + ${{ }} + params    │
                     │   local files)  the expansion)  resolved by the service)       │
                     │        ▲                    │                                 │
                     │        │                    ▼                                 │
                     │   Auth (device-code/az/PAT)│  YAML Front End (expanded schema)│
                     │   + cache/lockfile         │  ──► Semantic Model (normalize    │
                     │                            │      steps, matrix, deps graph)  │
                     │                            │  ──► Emitter ────────────────────┼─► out/
                     └──────────────────────────────────────────────────────────────┘
   out/ = run.sh + stages/**/jobs/**/steps/*.sh + lib/runtime.sh
        + pipeline.expanded.yml + .env.example + README (warnings list)
                    ┌────────────────────────── run time ───────────────────────────┐
                    │ run.sh ─► jobs in dependsOn order ─► run_step(): $( ) macro    │
                    │ expansion, $[ ] condition eval, exec, ##vso[] parsing, var    │
                    │ store / outputs / artifacts / results persistence            │
                    │ non-script tasks: real-task mode (task-lib INPUT_*) or stub  │
                    └──────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Detail doc |
|---|---|---|
| **Bundler** | Mechanically inline local `@self` template files into the override; collect parameters | docs/02 §5, docs/05 §4 |
| **Expansion client** | `POST preview` with the local YAML; return `finalYaml` + provenance; cache + lockfile | docs/05 §2, `packages/fetch` |
| **YAML Front End** | Parse the *expanded* YAML with source positions; validate the runtime subset (no directives, no `${{ }}`) | docs/01 §1–§2 |
| **Semantic Model** | Normalize shorthand steps → canonical tasks, expand matrix, build/validate the dependency graph, resolve variable scopes | docs/01 §3–§6 |
| **Emitter** | Generate `run.sh`, per-step scripts, `lib/runtime.sh` (or link it), `.env.example` synthesis, `pipeline.expanded.yml`, README with warnings | docs/04 §1–§2, §10–§12 |
| **Runtime lib (generated)** | `lib/runtime.sh`: step lifecycle, variable store, `$( )`/`$[ ]` evaluation, `##vso[]` parser, artifacts, secret masking | docs/04 §3–§9 |
| **Real-task mode** | Download the real task package; execute it with an emulated `azure-pipelines-task-lib` (`INPUT_*` env); stub policy for the rest | docs/03 §6, docs/04 §9 |
| **Auth & REST clients** | ADO device-code / `az` / PAT; preview, task-metadata and artifact endpoints; cache + lockfile | docs/05 |
| **CLI, config, doctor** | `convert`, `auth`, `doctor`, `bundle`; project config file | docs/06 §1–§2 |
| **Parity harness (dev)** | Golden tests + the preview oracle as the *expansion* source; conformance + nightly drift check | docs/06 §3 |

## 5. Key design decisions (revised)

Decisions marked **(revised)** change a decision from the original plan; the review rationale is in
docs/07. Unmarked decisions carry over unchanged.

- **D1 — Converter in TypeScript / Node ≥ 22.** *(unchanged)* The task ecosystem is Node; MSAL for
  device-code; npm package + optional single-binary.
- **D2 — Generated output is dependency-free bash, never calls back into the converter.** *(unchanged)*
  Runtime = bash ≥ 4 + coreutils + git (+ whatever the pipeline itself needs).
- **D3 — Server-expanded, not reimplemented (revised, replaces old D4/D6).** The Pipelines `preview`
  endpoint is the expansion step, promoted from test-only oracle to the product path. The emitted
  `pipeline.expanded.yml` freezes the result so execution is offline and reproducible. The original
  in-repo template engine and compile-time expression evaluator are demoted to an **offline fallback**
  (see D4), not deleted.
- **D4 — Script-native execution; real-task mode for the rest (revised, replaces old D3/D7).**
  `script`/`bash`/`pwsh`/`powershell`/`checkout` steps are emitted as readable bash. Non-script tasks
  run via **real-task mode** (real task package + emulated `azure-pipelines-task-lib`) or a **stub**
  that dumps resolved inputs. No per-task transpiler. Fidelity *labels* are kept; the weighted
  coverage metric is dropped.
- **D5 — Fetch at convert time, cache, lock (unchanged).** The preview expansion, task metadata and
  artifacts are downloaded during `convert`, cached, and pinned in `azdo-emu.lock.json`; `--frozen`
  is fully offline after the first fetch.
- **D6 — The runtime expression subset is local; the compile-time half is delegated (revised — a
  *new* decision on a recycled number; old D6 was "parity oracle = the real service", now part of
  D3. Old→new map: docs/06 §5, the note above entry 48).**
  `$[ ]` runtime conditions, `dependencies.*.outputs`, status functions and `$( )` macros are local
  (they are evaluated by the *agent* at run time and cannot be delegated). The compile-time `${{ }}`
  evaluator is retained only as the offline fallback (D3/D4) and is not on the critical path.
- **D7 — Hard secret boundary: everything secret goes through `.env` (unchanged, was D8).** The
  converter never writes tokens, variable-group secret values, or service-connection credentials into
  scripts, YAML dumps, logs, or the lockfile. `.env.example` documents each entry with its origin.
- **D8 — Shared workspace by default (revised, was D9).** One shared workspace per run; per-job
  `Pipeline.Workspace` fidelity and a shared tool cache are deferred polish.
- **D9 — Host execution by default (revised, was D11).** The run executes on the host; an optional
  container sandbox is deferred. `container:` *jobs* remain a future pipeline feature, orthogonal to
  this.
- **D10 — Warnings list, not a coverage metric (revised, was D10/D7-metric).** Every conversion
  emits a README with a ranked warnings/unsupported list and per-step fidelity labels. No percentage
  coverage, no `--min-coverage` gate.

## 6. Fidelity labels (used on every step; no longer a weighted metric)

| Label | Meaning | Example |
|---|---|---|
| `exact` | Same observable behavior as the hosted agent | `bash` step, `$( )` macro, `task.setvariable` |
| `equivalent` | Same outcome via equivalent local commands | `AzureCLI@2` with ambient `az login` |
| `degraded` | Meaningful local approximation, documented deltas | test-publishing → copy + console summary |
| `stub` | Logs inputs, does nothing; configurable skip/fail/prompt | unknown marketplace tasks |
| `unsupported` | Convert-time error or explicit runtime failure with a remediation note | pipeline decorators |

These labels appear in the generated README and step headers. They are **informational** — the
original per-pipeline coverage percentage (old D10) is dropped.

## 7. Roadmap summary

Sizes: S ≈ 1–2 weeks, M ≈ 3–4 (single developer). Details & exit criteria: docs/06 §4.

| Phase | Size | Deliverable |
|---|---|---|
| **P1 Thin expansion** | S | Expansion client (preview) as the `convert` path + provenance/cache; template bundler for local `@self` files; YAML front end for the expanded schema; cleanup of the v1 reimplementation scope |
| **P2 Script-native runner (MVP)** | M | Semantic model + emitter + bash runtime lib: script/bash/pwsh/powershell/checkout natively; `$( )`/`$[ ]`/`##vso[]`; variables/outputs/artifacts; `.env.example`; README warnings list; `--only-step`/`--resume` — **a real single-repo pipeline runs locally, no commit required** |
| **P3 Task breadth** | M | Real-task mode + stub policy; priority deployment tasks (AzureCLI/Docker/Helm/kubectl/ARM-Bicep/Key Vault/storage) via `INPUT_*` + service-connection `.env`; auth/fetchers + lockfile; CLI `auth`/`doctor`; nightly drift harness |

The first genuinely useful milestone — edit `azure-pipelines.yml`, run it locally, re-run one step,
never commit — lands at the end of **P2**, not after a multi-phase compiler clone.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Convert-time dependency on the `preview` endpoint (network + auth on every re-expansion) | `pipeline.expanded.yml` is emitted into the output, so *execution* is offline; only re-expansion needs the network; `--frozen` reuses the cache |
| `preview` API stability (it is the editor's surface, not a headline REST contract) | pin the api-version (already done, `7.1`); freeze the expanded YAML; retain the offline fallback (D3/D4) |
| Editing *templates* (not just the root) resolves `@self` against the committed repo | the bundler inlines local template files into the override (P1); root-file edits are fully uncommitted from day one |
| Real-task mode still needs an emulated `azure-pipelines-task-lib` (`INPUT_*`) | one emulation host serves all tasks, instead of N hand-written transpilers; unknown tasks stub cleanly |
| Service connections / secrets unobtainable by design | `.env` contract with per-entry provenance; ambient `az`/`docker`/`kubectl` auth mode |
| Marketplace long tail | stub + inputs dump + user handler drop-in |
| The retained offline fallback drifts from the service | it is off the critical path and cross-checked against the preview result when both are available |

## 9. Grounding in official references

Unchanged in spirit, but re-scoped: **expansion behavior is grounded by the service itself** (the
`preview` endpoint is the source of truth, not a thing we reimplement), while **runtime behavior** is
grounded in official docs and the agent/task sources as before.

- Expansion: the Pipelines `preview` endpoint (grounded live, claims C-E00-017…027); template and
  expression docs remain references only.
- Runtime expressions (`$[ ]`, `$( )`): learn.microsoft.com …/process/expressions, …/process/variables.
- Logging commands (`##vso`): …/scripts/logging-commands.
- Agent behavior (step lifecycle, folder layout, handlers): `microsoft/azure-pipelines-agent`,
  `microsoft/azure-pipelines-task-lib`.
- Tasks: `microsoft/azure-pipelines-tasks` (each task's `task.json` for inputs/defaults/aliases).
- REST: learn.microsoft.com/rest/api/azure/devops/ (Pipelines preview, DistributedTask tasks).

Exact `api-version`s and numeric limits are re-verified against live docs at implementation time.

## 10. Document index

1. [docs/01-pipeline-model-and-schema.md](docs/01-pipeline-model-and-schema.md) — schema coverage, variables, predefined variables
2. [docs/02-template-and-expression-engine.md](docs/02-template-and-expression-engine.md) — runtime-expression subset, bundler, the (fallback-only) compile-time engine
3. [docs/03-task-catalog.md](docs/03-task-catalog.md) — real-task mode, stub policy, deployment-set strategy
4. [docs/04-generated-project-and-runtime.md](docs/04-generated-project-and-runtime.md) — output layout, runtime spec, logging commands, artifacts, `.env`
5. [docs/05-fetching-and-auth.md](docs/05-fetching-and-auth.md) — sign-in, the preview expansion, caching & lockfile
6. [docs/06-cli-testing-roadmap.md](docs/06-cli-testing-roadmap.md) — CLI/config, testing, phased roadmap, decisions record
7. [docs/07-simplification-review.md](docs/07-simplification-review.md) — **the review this plan is based on** (what was cut and why)
