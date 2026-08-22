# docs/07 — Simplification review & revised architecture (proposal)

Status: **Proposal for owner review** · Date: 2026-08-22 · Author: architecture review on `main`

This document answers a direct question asked of the current `main` branch: *"isn't this project
already too complicated? — think of ways to simplify it in order to achieve the goal: debug Azure
pipelines without committing to the repo every time."* It is a **review + proposal**, not a decided
change. Nothing in PLAN.md, docs/01–06, or the backlog has been altered until the owner approves the
reorientation in §6.

---

## 1. Verdict

**Yes — the project is too complicated *relative to its goal*.** It is not complicated for its own
sake (the rigor is real and the decisions are each individually defensible), but the current plan
solves a **much larger problem than the user's goal requires**, and it solves the hardest part of
that larger problem **first**, by hand.

The goal is one sentence: *let a developer debug a pipeline without committing + pushing + waiting
on every edit.* The current plan is effectively *reimplement Azure Pipelines end-to-end — the
closed-source template/expression compiler, the agent contract, and 60+ task behaviors — as a
dependency-free bash transpiler, measured by a coverage report, sandboxed in a container.* That is a
multi-month, 160-task, 16-epic product. The gap between those two sentences is the entire problem.

The single most important finding: **the hardest ~60% of the planned work — reimplementing the
server-side template engine and compile-time expression language (E02, E03) — is work the Azure
DevOps service will already do for free.** The project has already built the client for it and uses
it every day as a *testing oracle*. The simplification is to promote that oracle from test-only to
the **product's expansion step**, and delete the reimplementation from the critical path.

---

## 2. What the goal actually requires

"Debug without committing to the repo every time" decomposes into four concrete capabilities, and
**nothing else**:

1. **Get the pipeline's final, fully-expanded form** (templates resolved, `${{ }}` compile-time
   expressions evaluated, parameters bound) without committing.
2. **Run the steps locally**, with the same variable/condition/output semantics the agent gives —
   at minimum the `script`/`bash`/`pwsh`/`powershell` steps, which are where the overwhelming
   majority of debugging pain actually lives.
3. **Feed secrets in without hard-coding them** (service connections, variable-group secrets) — the
   `.env` contract.
4. **Re-run a single step in isolation** quickly, since that is the whole point of local debugging.

Every capability beyond these — offline byte-parity of expression coercion, transpiling 60+ tasks to
readable bash, deployment strategies, coverage metrics, sandbox orchestration, Windows emission — is
a **nice-to-have that has been promoted into the critical path** by the current plan.

---

## 3. Where the complexity comes from (evidence on `main`)

Measured against the repo as it stands at commit `b187501`:

| Signal | Number | Why it matters |
|---|---|---|
| Total backlog tasks | **160** across 16 epics (E00–E15) | 7 phases + "Future", estimated ≈ 20+ solo developer-weeks |
| Tasks done | **39** (`[x]`) | ~24% of the backlog after weeks of work |
| Done tasks that are *expression/template engine* | **20** (E02 = 16, E03 = 4) | half of all completed work is the "reimplement the closed compiler" mountain |
| Largest untouched epics | E04–E11 (semantic model, emitter, coverage, fetchers, task catalogs) | a *second*, largely-untouched mountain after the first |
| Code written | ~17k lines TS/shell; `packages/engine` ≈ 47k lines incl. tests + vendored `service-schema.json` (119 definitions) | the engine dwarfs every other package |
| Oracle experiments run | hundreds (65 context probes, 33 template-walk probes, real hosted-agent runs for status functions & readonly vars) | each one correct, each one *only needed because we reimplement the server* |

The changelog (`CHANGELOG-BACKLOG.md`) tells the story in its own words: whole tasks devoted to
coercion tables, three *different* function tables per expression slot, case-folding that differs
between .NET and bash 3.2 on macOS CI, status-function truth tables that required standing up real
hosted-agent runs because "the job-level engine is closed." This is excellent, careful work — but it
is the work of **cloning a closed, evolving compiler byte-for-byte**, and it will never end: the
project's own §8 risk "parity drift with server-side expansion" is *inherent* to that approach.

PLAN.md §8 already names the disease and its palliative:

> "Scope explosion toward 'reimplement the whole agent'" — mitigation: "Fidelity tiers make partial
> support explicit; non-goals list; phased roadmap."

Fidelity tiers and phasing **label** the scope; they do not **remove** it. This review proposes
removing it.

---

## 4. The one lever: let the server expand

Azure DevOps already exposes, for free, the exact thing E02+E03 are reimplementing. The **Pipelines
preview endpoint** returns the service's **final expanded YAML** without running anything:

```
POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1
body:     { "previewRun": true, "yamlOverride": "<local yaml>" }
response: { "finalYaml": "<fully expanded yaml>" }
```

The repo has **already grounded and built this client** — `packages/fetch/src/oracle.ts` (claims
C-E00-017…027, runbook `research/oracle-setup.md`). PLAN D6 declares it "the parity oracle: returns
the service's final YAML." `previewRun: true` is documented to mean "don't actually create a new
run," so it costs no agents, no parallelism, no minutes.

The change is one sentence: **make the oracle the product path.** Send the user's *local* YAML as
`yamlOverride`; take back `finalYaml`; emit `pipeline.expanded.yml`; build the local runner from
*that*. Expansion parity becomes **true by construction** — you are running the server's own output
— and the two largest epics (E02's compile-time half, E03 entirely) disappear from the critical path:

| Deleted from critical path | Because the server already did it |
|---|---|
| Template expansion: `extends`, `each`, `insert`, `if/elseif/else`, typed parameters | folded by preview |
| Compile-time `${{ }}` evaluation, coercion, the three per-slot function tables | folded by preview |
| Directive recognition, insert-collision rules, the DOM walker's semantics | folded by preview |
| Server-limit enforcement, duplicate-key acceptance, parameter binding | folded by preview |

What is **genuinely not** delegable, and must still be built, is the *runtime* half — the part the
*agent* (not the compiler) performs at run time:

- `$[ ]` runtime **conditions** and `dependencies.*.outputs` (evaluated by the agent, not preview);
- `$( )` macro expansion (textual, done by the agent just before each step);
- the `##vso[ ]` logging-command contract, variable store, outputs, artifacts, `dependsOn` ordering;
- `.env` secret materialization and masking.

That is a **small fraction** of what E02 covers today, and it is exactly E06 + a slice of E02 + a
slice of E05.

---

## 5. Revised architecture ("script-native, server-expanded")

```
 ┌───────────── convert time ─────────────┐        ┌───────────── run time ─────────────┐
 azure-pipelines.yml (local, uncommitted) │        │ run.sh ─► jobs in dependsOn order   │
   │  (optional) inline local @self       │        │   run_step(): $( ) macros,          │
   │  templates via a mechanical inliner  │        │   $[ ] conditions, ##vso[ ] parsing,│
   ▼                                      │        │   var store / outputs / artifacts   │
 POST preview  ──►  finalYaml (expanded)  │        └─────────────────────────────────────┘
   │                                      │
   ▼                                      │
 YAML front end (runtime subset only)     │
   │                                      │
   ▼                                      │
 Emitter ─► out/ = run.sh + stages/**/jobs/**/steps/*.sh
           + lib/runtime.sh + pipeline.expanded.yml
           + .env.example + README (warnings list)
```

### Phase 1 — Thin expansion (S)

- Reuse `packages/fetch/oracle.ts` as the expansion client; add a `bundle` mode that mechanically
  inlines local `@self` template files into the override (a *textual* inliner — no `each`/`insert`/
  `if`/expression semantics; those stay with the server).
- YAML front end for the **expanded** schema only: no directives, no `${{ }}` — validation gets
  dramatically simpler (E01's guided walk shrinks to the runtime subset).
- Keep `pipeline.expanded.yml` in the output so execution is **offline and reproducible** even if the
  preview API later changes (this preserves the value of D5/offline execution without reimplementing
  expansion).

### Phase 2 — Script-native runner (the MVP that actually serves the goal) (M)

- Emitter + `lib/runtime.sh` that runs `script`/`bash`/`pwsh`/`powershell`/`checkout self` natively.
- Runtime expressions: `$( )` macros, `$[ ]` job/step conditions, `dependencies.*.outputs`,
  `##vso[ ]` commands, variable store (E06-S01-T04 already exists), artifacts via local dirs,
  `.env` + masking. `--only-step` / `--resume` for isolated re-runs.
- **No per-task transpiler.** Unknown tasks become either (a) *real-task mode* — download the actual
  task package and run it against an emulated `azure-pipelines-task-lib` (`INPUT_*` contract, PLAN
  D3's deferred "phase 6" mode, promoted to the default for non-script tasks) — or (b) a stub that
  dumps resolved inputs. Script steps are readable bash; complex tasks run Microsoft's own code.

### Phase 3 — Task breadth via real-task mode + stubs (M, incremental)

- Grow real-task-mode coverage on demand, prioritized by what a real pipeline actually hits — the
  deployment set stays first (it is already the agreed priority). Nothing in E09/E10/E11's
  *transpilation* ambition is required for v1.

---

## 6. Reorientation — what to cut, defer, keep

This deliberately revisits recorded decisions. Per the repo's own convention (AGENTS.md rule 5), the
revisits are listed explicitly and would each get a dated docs/06 §5 entry **if and when** approved —
nothing is being relitigated silently, and nothing is changed in the backlog yet.

| Today (PLAN decision / epic) | Proposal | Rationale |
|---|---|---|
| **D4 + D6** — reimplement expressions; oracle = test-only | **Keep the oracle client; make it the expansion step.** Delete compile-time expression reimplementation from the critical path | Parity by construction instead of by clone; E02/E03 stop being a mountain |
| **D3** — "transpile-first" (readable bash per task) | **Invert**: script steps native; everything else via real-task mode or stub | The readable-bash value is real *only for script steps*, which is what users debug |
| **D10** — coverage report every conversion + `--min-coverage` gate | **Downgrade** to a plain warnings/unsupported list in the README | Measurement is a product feature, not a debugging capability |
| **D11** — sandbox container by default | **Defer**; host execution default, container opt-in later | Real but secondary; orthogonal to "debug without committing" |
| **D9** — faithful per-job workspace + tool cache | **Simplify** to a shared workspace first | Faithful isolation is a bug-surfacing luxury, not a prerequisite |
| **D7** fidelity tiers | **Keep the labels**, drop the weighted coverage metric | Labels still tell the user what to trust; the metric is bookkeeping |
| **E02/E03 remaining tasks** | **Demote** to an optional *offline-expansion fallback* + keep the runtime-condition slice | Already ~half built; retain as fallback/validation, stop being the gating path |
| **E04 semantic model, E09/E10/E11 transpilers, E14, E15** | **Cut/defer** from v1 (E15 already deferred) | Second mountain that the simplified goal does not require |
| **E08 auth/fetchers** | **Keep**, repurposed: the preview call + template inlining need the same auth | Already on the plan; scope shrinks to what preview needs |
| **E06 runtime, E05 emitter, E12 harness, D1/D2/D5/D8** | **Keep** | These *are* the product: dependency-free bash runner, `.env` secret boundary, offline re-run |

**Net effect:** the roadmap collapses from 7 phases / 160 tasks to **3 phases** and roughly a
**P0+P2-sized slice** of the existing plan, with the two hardest epics (E02-compile-time, E03)
removed from the gating path. The first genuinely useful milestone — "edit `azure-pipelines.yml`,
run it locally, re-run one step, never commit" — lands at the end of Phase 2 instead of after five
phases of compiler cloning.

The ~39 completed tasks are **not wasted**: E06-S01-T04 (variable store), the front-end quirks
(E01), the runtime-condition slice of E02, the oracle client and harness (E12, `packages/fetch`)
all carry over directly. The compile-time E02/E03 work becomes the offline fallback and a
cross-check that keeps the tool working when a user has no preview access.

---

## 7. Honest trade-offs & risks

1. **Convert-time network + auth.** The current plan already accepts this for templates@repo,
   artifacts, and variable-group names (P3/E08), so the dependency is not new — but it now sits on
   the critical path of *every* convert, not just remote-resource pipelines. Mitigation: the output
   keeps `pipeline.expanded.yml`, so *execution* stays offline; only re-expansion needs the network.
2. **Preview API stability.** The preview endpoint is the pipeline editor's own surface, grounded
   live (C-E00-017…027), but it is not a headline public REST contract. Mitigation: freeze the
   expanded YAML into the output; keep the offline fallback; pin the api-version (already done).
3. **Editing *templates*, not just the root.** `yamlOverride` sends the root; `@self` templates
   resolve against the *committed* repo, so a user editing a template file still needs either the
   Phase-1 bundler or a commit. Mitigation: the bundler is a small, mechanical inliner — and the
   root-pipeline case (the common one) is fully uncommitted from day one.
4. **The deployment-set tasks (E10) are still real work.** Real-task mode gets complex tasks
   running *much* faster than transpiling them, but the `INPUT_*`/service-connection emulation still
   has to be built. It is, however, one emulation host serving all tasks, not N hand-written
   transpilers.
5. **We lose the purity of "fully offline, no server, byte-parity."** That purity is what has been
   costing the project its time. The proposal trades a small, already-accepted convert-time
   dependency for the elimination of the two hardest epics.

---

## 8. Recommended next step

If the owner approves §6, the concrete first move is **not** to throw code away, but to re-sequence
the backlog: promote the preview client from "oracle" to "expansion step," stand up the Phase-1
bundler, and cut a Phase-2 slice (`script`/`bash`/`pwsh` native + `$( )`/`$[ ]`/`##vso`/`.env`/
`--only-step`) as the new MVP gate. Each revisited decision then gets its dated docs/06 §5 entry,
and the epic files are re-sorted in one mechanical pass.
