# E12 — Testing & parity program: grounding notes

Claim format per BACKLOG.md §3. IDs sequential, never reused.

Design rationale consumed: docs/06 §3 (layer table L1–L6) — internal spec, not an external source.
The external facts this epic's first task needs are about the two *instruments* the layers run on:
bats-core (L4) and vitest + its v8 coverage provider (L1/L2). Both are pinned: bats-core at
`ae4b94d7` (already in `research/REFERENCES.md`), vitest/`@vitest/coverage-v8` at the exact versions
installed in this repo (4.1.10). Tool behaviour that the docs do not state is measured; transcripts
under `research/experiments/E12-test-harness/`.

## E12-S01-T01 — Test layout & runners

### bats harness (L4)

[C-E12-001] `load <file>` sources a file **relative to the directory of the current test file**
(delegating to bash `source` after path resolution) — so shared bats helpers belong beside the tests
that load them, and no environment variable has to be set for them to resolve.
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/source/writing-tests.md (checked 2026-08-11)
  — "if you have a Bats test in `test/foo.bats`, the command `load test_helper.bash` will source the
    script `test/test_helper.bash` in your test file" · "`load` delegates to Bash's `source` command
    after resolving paths" · "If `argument` is a relative path or a name `load` looks for a matching
    path in the directory of the current test."

[C-E12-002] `bats_load_library` resolves against `BATS_LIB_PATH`, a colon-delimited path whose value
"is highly dependent on the environment" — a helper loaded that way works only where that variable is
set, which is why our own helpers use `load` (C-E12-001) and the suite adds no bats libraries
(bats-support/bats-assert/bats-file) at this point.
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/source/writing-tests.md (checked 2026-08-11)
  — "These should not be `load`ed, as their path depends on the installation method. Instead, one
    should use `bats_load_library` together with setting `BATS_LIB_PATH`" · "the actual
    `BATS_LIB_PATH` is highly dependent on the environment"

[C-E12-003] bats provides three nested scratch directories — `BATS_TEST_TMPDIR` (unique per test),
`BATS_FILE_TMPDIR` (shared by one file), `BATS_SUITE_TMPDIR` (shared by the run) — all inside
`BATS_RUN_TMPDIR`, and it **removes them when the run ends** unless `--no-tempdir-cleanup` is given.
The fixture store therefore hands out directories under `BATS_TEST_TMPDIR` instead of `mktemp -d`:
isolation and cleanup both come from bats.
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/source/writing-tests.md (checked 2026-08-11)
  — "`$BATS_SUITE_TMPDIR` is a temporary directory common to all tests of a suite" · "`$BATS_FILE_TMPDIR`
    is a temporary directory common to all tests of a test file" · "`$BATS_TEST_TMPDIR` is a temporary
    directory unique for each test"
  — cleanup is *not* stated in the docs (only `bats --help`: "`--no-tempdir-cleanup` Preserve test
    output temporary directory"), so it was **measured** on bats 1.13.0: all three directories are
    gone after a plain run and all three survive under `--no-tempdir-cleanup`
    (research/experiments/E12-test-harness/README.md §3)

[C-E12-004] `run`'s implicit exit-status checks (`run -N`, `run !`) and its other flags exist only
from bats **1.5.0**; on older versions the flag is silently taken as the command to execute, which is
why bats added warning BW02 and the `bats_require_minimum_version` guard (itself added in 1.7.0). Our
`.bats` files call `bats_require_minimum_version 1.5.0` before using `run -0`/`run !`, so an
old-bats environment fails loudly instead of passing for the wrong reason.
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/CHANGELOG.md (checked 2026-08-11)
  — 1.5.0 "Experimental: add return code checks to `run` via `!`/`-<N>`" · 1.7.0 "BW02: run uses flags
    without proper `bats_require_minimum_version` guard" and "`bats_require_minimum_version` to guard
    code that would not run on older versions"
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/docs/source/warnings/BW02.rst
  — "in cases like `run`'s where old version simply take all parameters as command to execute, the
    failure can be silent"

### vitest projects & coverage (L1/L2)

[C-E12-005] `test.projects` accepts either directory globs or inline project configs (vitest 4.1.10).
Measured: `projects: ['packages/*']` runs fine and finds the same 15 test files — a package with no
test files is **not** an error — but it enrolls `packages/runtime` (whose layer is bats) as a project
that can never match anything, and names projects after their `package.json` name, so filtering reads
`--project @azdo-emu/engine`. We enumerate the four TypeScript packages instead and name them `cli`,
`engine`, `emit`, `fetch` (+ `repo` for the root meta-tests).
  — research/experiments/E12-test-harness/README.md §1 (measured 2026-08-11, vitest 4.1.10)

[C-E12-006] Coverage configuration is **root-level only** in vitest 4 — `test.coverage` has no
per-project counterpart — and "per package" thresholds are expressed as glob keys inside
`coverage.thresholds`, matched with picomatch against each file's path **relative to the config
root**.
  — node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts (vitest 4.1.10, installed; checked 2026-08-11)
  — `thresholds?: Thresholds | ({ [glob: string]: Pick<Thresholds, 100 | "statements" | "functions" | "branches" | "lines">; } & Thresholds);`
  — node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js `resolveThresholds()`: `const matcher = pm(glob); const matchingFiles = files.filter((file) => matcher(relative(this.ctx.config.root, file)))`

[C-E12-007] A top-level threshold key is **not** "everything the globs did not match": the global set
is built from *all* files, including glob-matched ones. Each threshold set (global or glob) carries its
own aggregated coverage map and is checked **independently**, and any of them can set exit code 1 —
so the top-level numbers are a repo-wide floor, and a per-package number *below* that floor is still a
real, narrower gate (it fires on that package's own aggregate, which the repo-wide average can hide).
No ordering between the two levels is required or implied.
  — node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js (vitest 4.1.10; checked 2026-08-11)
  — `// Global threshold is for all files, even if they are included by glob patterns` followed by
    `for (const file of files) { … globalCoverageMap.addFileCoverage(fileCoverage); }`
  — `checkThresholds(allThresholds) { for (const { coverageMap, thresholds, name } of allThresholds) { … } }`
    — one pass per set, each comparing that set's own `getCoverageSummary()`

[C-E12-008] Threshold enforcement is real but **one-sided**: a breached threshold logs
`ERROR: Coverage for statements (91.96%) does not meet "packages/engine/src/**" threshold (99%)` and
sets exit code 1, while a glob that matches **no file at all** passes silently with exit 0 and no
diagnostic. A renamed or moved package therefore stops being gated without anything turning red —
hence the meta-test `test/test-layout.test.ts` that asserts every threshold glob still matches source.
  — measured on vitest 4.1.10 (research/experiments/E12-test-harness/README.md §2)
  — corroborating source: `checkThresholds()` only reports when `coverage < threshold`, and the empty
    coverage map produced for an unmatched glob yields nothing to compare

[C-E12-009] The v8 provider reports **only files that a test loaded** unless `coverage.include` names
the sources explicitly — without it, a source file nobody imports is invisible to the thresholds
rather than counted as 0%.
  — node_modules/vitest/dist/chunks/reporters.d.DtoKVV2s.d.ts (vitest 4.1.10; checked 2026-08-11)
  — "List of files included in coverage as glob patterns. **By default only files covered by tests are
    included.**"

[C-E12-010] `@vitest/coverage-v8@4.1.10` declares `peerDependencies: { "vitest": "4.1.10" }` — an
**exact** pin, not a range. The root `vitest` dependency is therefore pinned exactly too; a caret range
would let `pnpm update` produce a peer-mismatched pair whose only symptom is a startup error.
  — https://registry.npmjs.org/@vitest/coverage-v8 (checked 2026-08-11) — `"peerDependencies":{"vitest":"4.1.10","@vitest/browser":"4.1.10"}`

### Coverage ratchet baseline (recorded, not a claim)

Measured with `vitest run --coverage` at the commit that landed this task, before any threshold was
set (252 tests, 19 source files):

| Package | statements | branches | functions | lines | threshold set |
|---|---|---|---|---|---|
| cli | 94.44 | 85.47 | 91.84 | 96.86 | 92 / 84 / 90 / 95 |
| engine | 91.97 | 82.38 | 96.40 | 96.02 | 90 / 80 / 94 / 94 |
| emit | 100 | n/a (0 branches) | n/a (0 functions) | 100 | 100 / — / — / 100 |
| fetch | 97.87 | 78.95 | 100 | 97.78 | 96 / 76 / 100 / 96 |
| **repo floor** | 92.96 | 82.97 | 95.23 | 96.36 | 90 / 78 / 90 / 92 |

The numbers are a ratchet: raise them as real coverage rises; never lower one to make a red run green
— write the test instead. Two clarifications so the rule stays livable:

- The per-package numbers are **not** required to sit above the repo floor (C-E12-007): both sets are
  checked independently, so `fetch` at branches 76 with a repo floor of 78 means "fetch alone may not
  drop below 76" *and* "the repo as a whole may not drop below 78" — two gates, not a weakened one.
- `emit` is a placeholder package whose only source is a two-line entry point, so its measurement today
  *is* 100. When E09 fills it with real handlers, its thresholds are **re-seeded from measurement** —
  that is a re-baseline of a package that changed shape, not a lowering to hide missing tests, and it
  is the only case in which a number may go down.

## E12-S01-T02 — Fixture corpus v1

The **Ground** rule for this task is unusual: the evidence is not a doc page but a service verdict —
every corpus pipeline must be accepted by the real preview endpoint and its `finalYaml` committed
beside it. Docs are still needed for the two mechanisms the harness itself uses (the preview request
body and the Git push API), and one behaviour no doc states had to be measured: how a `template:`
reference resolves when the root document arrived as `yamlOverride` rather than as a file.
Transcripts: `research/experiments/E12-corpus/`.

[C-E12-011] A `yamlOverride` is resolved **as though it were the pipeline definition's own YAML
file**: template references inside it resolve relative to that file's repository path, and the
referenced files are read from the repository (branch + commit named in the error), not from the
request. The service says so verbatim when the target is missing — the message is prefixed with the
*definition's* path, `/azure-pipelines.yml`, even though that file's content was overridden. Both
`corpus/_probe/steps.yml` and `/corpus/_probe/steps.yml` expand (the anchor definition sits at the
repo root, so the two coincide); a bare `steps.yml` that exists only in a subdirectory is rejected.
Consequence for this repo: template-using corpus entries cannot be oracle-paired unless their
template files are pushed to the oracle repository first, and references must be spelled
**root-absolute** so the fixture means the same path locally and server-side.
  — research/experiments/E12-corpus/{template-repo-relative,template-root-absolute,template-bare-name}.md
    (live preview, checked 2026-08-11)
  — "/azure-pipelines.yml: File /steps.yml not found in repository https://dev.azure.com/{org}/oracle/_git/oracle
    branch refs/heads/main version 1d17140cc77d78d66e049efed6e0f7925f03f480."

[C-E12-012] A reference **inside a template file** resolves relative to that template's own
directory: `/corpus/_probe/nested-a.yml` referencing the bare name `nested-b.yml` expands both
files' steps, while the same bare name in the override is rejected (C-E12-011). So the two
resolution bases differ by position, and a corpus entry that nests templates exercises both.
  — research/experiments/E12-corpus/template-nested-relative.md (live preview, checked 2026-08-11)
  — expanded `finalYaml` contains `script: echo from-a` followed by `script: echo from-b`

[C-E12-013] The preview request body is `RunPipelineParameters`, which carries more than the three
fields the E00 client models: `previewRun`, `yamlOverride`, `templateParameters`, `stagesToSkip`,
`variables` (`<string, Variable>` with `isSecret`), and `resources`
(`builds`/`containers`/`packages`/`pipelines`/`repositories`). `RepositoryResourceParameters` has
`refName`, `version`, `token`, `tokenType` — i.e. a preview can be pinned to a branch other than the
definition's default, which is the escape hatch if corpus files ever need to leave `main`.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/pipelines/preview/preview?view=azure-devops-rest-7.1 (checked 2026-08-11)
  — "yamlOverride | string | If you use the preview run option, you may optionally supply different
    YAML." · "RepositoryResourceParameters … refName … tokenType | Optional. This is the type of the
    token given. If not provided, a type of \"Bearer\" is assumed. Note: Use \"Basic\" for a PAT token."

[C-E12-014] Pushing files without a working copy is one POST to
`git/repositories/{id}/pushes`: `refUpdates: [{name, oldObjectId}]` (the current tip — the push is
rejected if it moved, so the harness is safe against concurrent writes) plus `commits: [{comment,
changes: [{changeType, item: {path}, newContent: {content, contentType}}]}]`, with `rawtext` the
content type for text files. That is the whole mechanism behind the corpus sync.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pushes/create?view=azure-devops-rest-7.1 (checked 2026-08-11)
  — `"refUpdates": [{"name": "refs/heads/master", "oldObjectId": "8b67126d…"}]`, `"changes": [{"changeType": "add",
    "item": {"path": "/tasks.md"}, "newContent": {"content": "# Tasks\n\n* Item 1\n* Item 2", "contentType": "rawtext"}}]`

### Preconditions the corpus discovered (org objects)

[C-E12-015] A `- group:` reference to a variable group that does not exist **or is not authorized
for the pipeline** fails the pipeline at load time, before any expansion happens — and the message
names **no group at all**, leaving an empty slot where the name belongs. A pipeline referencing
several groups therefore tells its author nothing about which one is wrong; the converter can beat
that diagnostic trivially. Provisioning + authorizing the group (`scripts/oracle-provision.ts`,
pipelinepermissions `variablegroup`) makes the same document expand.
  — research/experiments/E12-corpus/ (live preview, checked 2026-08-11); reproduced by removing the
    group from `fixtures/corpus/04-variable-layers/pipeline.yml` and putting it back
  — "An error occurred while loading the YAML build pipeline. Variable group  was not found or is
    not authorized for use. For authorization details, refer to https://aka.ms/yamlauthz."

[C-E12-016] The expansion **never reveals variable-group contents**: `- group: <name>` survives into
`finalYaml` verbatim, exactly as authored, with no member variables inlined — even though the group
exists and the caller is authorized for it. Group values are bound at run time by the agent, not at
YAML-expansion time. This is direct confirmation of PLAN D5 (variable groups → `.env.example` names
only): a converter *cannot* learn group values from the oracle even if it wanted to.
  — fixtures/oracle/04-variable-layers.final.yml (live preview, checked 2026-08-11)

[C-E12-017] A deployment job's `environment:` has the same precondition — *"Environment
corpus-staging could not be found. The environment does not exist or has not been authorized for
use."* — and once it exists, the scalar shorthand is **normalized to a mapping**:
`environment: corpus-staging` expands to `environment:\n  name: corpus-staging`.
  — fixtures/oracle/08-deployment-runonce.final.yml (live preview, checked 2026-08-11)

### What the oracle can and cannot verify (found while authoring)

[C-E12-018] `strategy: matrix` and `strategy: parallel` are **not expanded** by the service:
`finalYaml` carries the strategy block verbatim, with one job where the run will have three. Job
multiplication happens at queue/run time, not at YAML-expansion time. Consequence for E12-S02-T02:
the golden harness can never validate matrix multiplication against the oracle — that behaviour is
owned by E04 and must be tested against a **real run** (L6) instead, and the coverage report must
not claim oracle backing for it.
  — fixtures/oracle/01-matrix-multi-config.final.yml (live preview, checked 2026-08-11)

[C-E12-019] The step shortcuts desugar to task references **by GUID**, while the same task written
by name keeps its name — so one expanded document mixes both spellings:
`publish:` → `ecdc45f6-832d-4ad9-b52b-ee49e94659be@1`, `download:` →
`30f35852-3f7e-4c0c-9a88-e127b4f97211@1`, `checkout:` → `6d15af64-176c-496d-b583-fd2ae21d4df4@1`
(with `inputs.repository`), whereas an authored `PublishPipelineArtifact@1` stays
`PublishPipelineArtifact@1`. Worse for a task registry keyed on names: only the publish GUID
resolves in the task catalogue (`GET _apis/distributedtask/tasks/{guid}` → 200
`PublishPipelineArtifact` "Publish pipeline artifact", versions 0.242/1.242) — **checkout and
download are 404**, "No task definition found matching ID", i.e. they are agent-internal and no
service lookup will ever name them. E09's registry must therefore carry a hard-coded GUID→handler
map, and E03-S05-T01's normalizer must canonicalize GUID and name spellings to one another or
every `preview-diff` over a pipeline using shortcuts will show false drift.
  — fixtures/oracle/{02-artifact-handoff,08-deployment-runonce,09-multi-checkout}.final.yml and
    live `GET {org}/_apis/distributedtask/tasks/{guid}?api-version=7.1` (checked 2026-08-11)

[C-E12-020] `checkout: none` is **not** removed: it expands to the checkout task carrying
`condition: false` — a step that exists and never runs. Conversely a job with *no* checkout step
gets **no checkout task in `finalYaml` at all**, even though the agent will check out `self` when
it runs it. So the implicit checkout is an agent-side default, invisible to expansion, and the
emitter must synthesize it from the job (not from the expanded document).
  — fixtures/oracle/{02-artifact-handoff,09-multi-checkout}.final.yml (live preview, checked 2026-08-11)

[C-E12-021] Expansion normalizes shapes that the schema allows in several forms, so a golden is a
comparison against *normalized* YAML, not against the input's shape: mapping-form `variables:`
becomes the `- name:/value:` list form at every level; a scalar `dependsOn: api` becomes a
one-element list; `trigger: none` / `pr: none` become `trigger:\n  enabled: false`; a `steps:`-only
document gains `stages: - stage: __default` / `job: Job` (C-E00-022). E03-S05-T01's normalizer must
apply the same rewrites to our output or every diff is noise.
  — fixtures/oracle/*.final.yml, all ten (live preview, checked 2026-08-11)

[C-E12-022] `finalYaml` is **byte-stable across repeated calls** for the same input: hashing all ten
goldens, re-running the whole corpus against the live service and re-hashing gives an identical
digest. Unlike the org schema response, which reorders task alternatives between calls (C-E01-035),
a preview expansion can be compared byte-for-byte — so any diff E12-S03's nightly job reports is
real drift, and the harness needs no normalization pass just to be stable.
  — measured 2026-08-11: `sha256sum fixtures/oracle/*.final.yml | sha256sum` before and after a
    full re-run of `scripts/corpus-oracle.ts` → `9d536f3964ac81c4…`, unchanged

[C-E12-023] `readonly: true` is **not enforced at expansion time**: a pipeline-level
`buildConfiguration: Release` marked `readonly` and redefined at stage level as `Debug` expands
without error, and `finalYaml` carries *both* — the pipeline variable with its `readonly: true`
intact and the stage variable overriding it. So the expanded document is not a resolved variable
table, and whatever `readonly` means it is a run-time property of the agent's variable service,
not a compile-time constraint the converter can lean on. The emulator must implement the layering
itself (E04/E06) and decide separately what to do about `readonly`.
  — fixtures/oracle/04-variable-layers.final.yml lines 18-20 vs 31-32 (live preview, checked 2026-08-11)

[C-E12-024] A compile-time `${{ variables.<name> }}` read inside a job sees the **job-level**
value, not the pipeline-level one: with `solution: '**/*.sln'` at pipeline level and
`solution: overridden-at-job` on the job, the step `echo "compile-time=${{ variables.solution }}"`
expands to `echo "compile-time=overridden-at-job"`. So the template-expression `variables` context
is layered like the runtime one rather than being a snapshot of the pipeline-level block — which
is the first data point for E03-S03's `compileTimeVariableScope()` policy, and it contradicts the
intuition that compile-time evaluation happens "before" job scoping.
  — fixtures/oracle/04-variable-layers.final.yml:55 vs fixtures/corpus/04-variable-layers/pipeline.yml
    (live preview, checked 2026-08-11)

## E11-S03-T02 — Drift triage runbook

The epic is E11 in the current backlog; this file and its claim IDs keep the pre-renumber `E12`
spelling, per the epic-ID note in `research/README.md` — IDs are never reused or rewritten.

The Ground field requires that a *service-change* verdict link the Azure DevOps release notes page
checked for the change. Pinning that page turned out to be the substance of the grounding, because
the obvious URL is the wrong page and the right one usually says nothing.

[C-E12-025] **`learn.microsoft.com/azure/devops/release-notes/` is the product *roadmap*, not a
changelog.** The URL canonicalizes to `release-notes/features-timeline`, whose title is "Azure
DevOps Roadmap" and whose own text describes it as "a peek into our roadmap … features and dates
are the current plans and are subject to change", with Timeframe columns reading `2026 Q3`, `2026
Q4`, `Future`. It is forward-looking: an entry there is a plan, not a shipped change, so it can
neither confirm nor date a drift.
  — https://learn.microsoft.com/en-us/azure/devops/release-notes/features-timeline
    (`git_commit_id` `467f8d6362cdfc5348b4a2e2846fbfeb4ba66f48`, `ms.date` 2026-08-05,
    `updated_at` 2026-08-13, verified 2026-09-03)

[C-E12-026] **The record of what shipped is the per-sprint series
`release-notes/<year>/sprint-<N>-update`, and it has an `Azure Pipelines` section.** Reachable from
the "What's New" link (`aka.ms/azuredevops/releasenotes`) at the top of the roadmap page. Sprint 275
covers `ms.date` 2026-06-17 and carries per-area sections — GitHub Advanced Security, Azure Boards,
**Azure Pipelines**, Azure Repos — each a list of the sprint's changes with anchors.
  — https://learn.microsoft.com/en-us/azure/devops/release-notes/2026/sprint-275-update
    (`git_commit_id` `598e4fec55f6de2a552fe94d6743888a6fdb16fd`, `ms.date` 2026-06-17,
    `updated_at` 2026-07-10, verified 2026-09-03)

[C-E12-027] **The Pipelines section announces features, not expansion semantics — so its silence
does not refute a service-change verdict.** Sprint 275's three Pipelines items are: a finer-grained
comment requirement for PR validation runs from GitHub repositories; a new Azure DevOps service
connection using Microsoft Entra workload identity, together with `connectionType: 'azureDevOps'`
on a new `AzureCLI@3`; and Apple Silicon (`macos-26-arm64`) agents in a pay-as-you-go preview.
Every one is a user-visible capability. **Nothing on the page describes how the preview endpoint
expands templates, orders keys, or normalizes a document** — the behaviours the corpus pins and the
nightly watches. The operational consequence, which `research/drift-runbook.md` §3 states as a
rule: a reproducing drift with no matching release note is an *unannounced* service change, and
"nothing relevant" is the expected result of the check rather than grounds for closing it. The
link's value is recording that the check was performed.
  — same page as C-E12-026, read in full 2026-09-03.

---

## E11-S04-T01 — the L5 tier: images, samples and harness (`C-E12-028..037`)

Recorded 2026-09-04. L5 is "convert & run sample apps in containers approximating hosted images"
(docs/06 §3). Its external grounding is one source — what a hosted ubuntu runner actually contains —
and everything else here is a **finding**: five defects the tier surfaced on its first three samples,
three of them fixed in this task.

[C-E12-037] **The reference for "hosted toolset" is `actions/runner-images`, and the path is
`images/ubuntu/`, not `images/linux/`.** Probed before pinning: `images/ubuntu/Ubuntu2404-Readme.md`
answers 200 and `images/linux/Ubuntu2404-Readme.md` 404. At commit
`cbb8df97e1dd32af7cb23a90590f12734ec11d0b` that readme lists **125** tool entries, including
`Bash 5.2.21(1)-release`, `Node.js 22.23.2`, `Kubectl 1.36.4`, `Helm 3.21.4`, `jq 1.7` and eight
.NET SDKs. **The gap is the deliverable, not a shortfall:** the L5 base image carries seven packages
(`bash git ca-certificates curl jq unzip tzdata`) and the node image adds Node 22 to match. L5 asks
whether a *converted project* runs, and what it needs is what the runtime shells out to — not the
other ~115 entries. Node 22 is matched deliberately: an image a major version behind the thing it
approximates would hide the failures this tier exists to catch.
  — https://github.com/actions/runner-images/blob/cbb8df97e1dd32af7cb23a90590f12734ec11d0b/images/ubuntu/Ubuntu2404-Readme.md
    (checked 2026-09-04)

**Cost, measured rather than assumed** (E11-S04-T02's precedent): the whole `e2e (L5, containers)`
job takes **58 s** on `ubuntu-latest` — checkout, install, `pnpm -r build`, both image builds from
scratch and all three samples — against the 5-minute budget that task set for bats, and cheaper than
every `test` leg on the same run (3 m 55 s – 6 m 48 s). Building in-job from official bases keeps it
there; **no image is published anywhere**, which would be an outward-facing write and is not needed
for "minimal images approximating hosted toolsets".

### How the tier is shaped, and why

[C-E12-028] **Every sample is template-free, so the suite needs no credentials.** No `${{ }}`, no
`extends`, no template references, which makes the offline expander and the service agree on the
document — so the harness converts with `--offline-expand` and never touches a PAT.
**Consequence:** a lapsed token cannot turn the E2E job red for a reason unrelated to E2E, which
matters because the PAT expires around 2026-09-10 (E11-S03-T01's operational note). A meta-test
enforces it, stripping comments first so the sentence explaining the rule does not violate it.
  — `test/e2e-harness.test.ts` (checked 2026-09-04)

[C-E12-029] **Pinned exit codes are what L5 adds over `drift.ts` Phase B.** Phase B already converts
every corpus entry and runs it, but **records** exit codes rather than pinning them, because "a
pinned per-entry code would encode the runner's toolset" (decision 75). Inside a controlled image
the toolset *is* controlled. **Consequence:** the exit code becomes a fact about the emitter and the
runtime, and sample 03 pins a **non-zero** one — which is how C-E12-035 was found. A meta-test
asserts at least one sample pins a failure, so that property cannot quietly disappear.

[C-E12-030] **The harness converts on the *host* and runs in the container, and that is a stronger
assertion than doing both inside.** The first run failed with `node: command not found`: the base
image has no Node and the converter is a Node program. Putting Node in the base image would have
defeated the image whose whole purpose is to be minimal. **Consequence:** the split proves the
generated project is the dependency-free bash PLAN promises — the base image contains no Node, no
pnpm and nothing this repository built, and `run.sh` runs there anyway.

### What running them found (`C-E12-031..036`)

[C-E12-031] **`Build.ArtifactStagingDirectory` was not seeded — nor `Build.StagingDirectory`,
`Build.BinariesDirectory` or `Common.TestResultsDirectory`.** The macro survived unexpanded into the
step body, where bash read `$(…)` as a command substitution and reported
`Build.ArtifactStagingDirectory: command not found`. **Consequence:** the single most common idiom
in real pipelines did not work, and nothing below L5 could see it. The layout was always intended —
`run.sh` already created `TestResults` beside `s`. Now seeded from the **already-pinned**
predefined-variables include: `a`, `b` and `TestResults` under `Agent.BuildDirectory`, with
`Build.StagingDirectory` as an alias because the page says the two "are interchangeable". **Fixed.**
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32/docs/pipelines/build/includes/variables-hosted.md
    — "For example: `c:\agent\_work\1\a`" / "`…\1\b`" / "`…\1\TestResults`" (checked 2026-09-04)

[C-E12-032] **`AZDO_STEP_NAME` was never set, so every `##vso[task.setvariable isOutput=true]` in
every generated project failed.** `azdo_var_set … output=true` refuses without it, and the emitter
never passed the authored `name:` to `run_step` — which had no flag for it. **Consequence:** output
variables, the mechanism `dependencies.<job>.outputs['<name>.<var>']` is built on (C-E06-002/005),
were unusable end to end while the runtime implemented them correctly. `run_step` gains `--name`,
the emitter passes it when the step declares one, and it is exported for the whole attempt because
the write happens in the logging-command subshell. **Fixed.**
  — measured 2026-09-04; `packages/runtime/lib/core.sh`, `packages/emit/src/entrypoints.ts`

[C-E12-035] **On a failing pipeline the generated `run.sh` printed no summary and exited with the
failing step's raw status instead of the runner's verdict.** `run.sh` and `run-stage.sh` both carry
`set -euo pipefail`, so a non-zero stage aborted the parent *before* `azdo_run_summary` and
`exit "$(azdo_run_exit_code)"` — the two lines docs/04 §2 makes the end of a run. Measured: a sample
whose last step exits 4 produced exit **4** and no summary; after the fix, exit **1** (the verdict
`azdo_run_exit_code` computes for `Failed`) and the table prints. **Consequence:** the summary is
absent exactly when a user needs it most, and `azdo-emu run`'s exit-code contract (E10-S02-T02)
reported a step's status rather than the pipeline's. Stopping dependent work is unaffected: that is
decided by the next stage's compiled condition reading the result store. **Fixed** with `|| :` on
the stage and job invocations. Nothing below L5 could see it, because no other tier asserts what a
*failing* run prints.
  — measured 2026-09-04; `research/experiments/E12-l5-e2e/first-run.md`

[C-E12-033] **Pipeline, stage and job `variables:` blocks are not seeded into a generated project at
all.** The expanded YAML retains them — `variables: [{name: buildConfig, value: Release}]` survives
expansion — but the generated `run.sh` contains **zero** `azdo_var_set` calls for them, the manifest
records no `pipeline.variables`, and `.env.example` asks for nothing. Confirmed against the corpus's
own `04-variable-layers` entry, which also emits zero. **Consequence:** `$(anyVariable)` is
unresolvable in every generated project, and a `$[ dependencies… ]` job variable evaluates to
nothing — which is why sample 01 reads its cross-job output through a **job condition** instead.
**Not fixed here:** seeding touches variable classification, precedence, secret marking and the
`.env` interaction, which is E05 emitter work. Filed as **E11-S04-T03**.
  — measured 2026-09-04

[C-E12-034] **`publish`/`download` steps are not native, so an artifact task needs a fetched task
package.** `disposeStep` treats only `checkout` as runtime-performed; `PublishPipelineArtifact@1`
goes to real-task mode and fails offline with "no cached package". The runtime *has*
`azdo_artifact_publish`/`azdo_artifact_download`. **Consequence:** the samples assert artifacts as
files under the staging directory rather than through a publish task. **Not fixed here** — making
them native is E05/E07 work. Filed as **E11-S04-T03**.
  — measured 2026-09-04

[C-E12-036] **Open finding: a `condition: failed()` step ran after a `continueOnError: true`
failure, when C-E06-040 says it should not.** Measured on the generated project: step results are
recorded correctly (`030 = SucceededWithIssues`), `azdo__job_status_from_results` downgrades only
from `Succeeded` and so should report `SucceededWithIssues`, and `azdo_status_failed` tests for
`Failed` — yet the step whose compiled condition is `azdo_status_failed` executed.
**The cause is not located, so nothing is asserted about it either way** and the step was removed
from sample 03 rather than pinned. Recorded here with the evidence so the next person starts from
it. Filed as **E11-S04-T03**.
  — measured 2026-09-04; `research/experiments/E12-l5-e2e/first-run.md`
  — **superseded 2026-09-21 by C-E12-038**, which located the cause: the condition was never
    evaluated, because the emitter passed `--no-condition` on every step. The step results this
    entry read were right, and so was its reasoning about them; what it could not see from the
    results alone was that nothing consulted them.

## E11-S04-T03 — closing the three gaps L5 found

[C-E12-038] **The cause of C-E12-036, and it is not in the condition machinery: every generated
`run_step` was passed `--no-condition`, so no step condition in any generated project was ever
evaluated.** `emitRunJob` ended each invocation with `${no_condition:+--no-condition}`, while the
variable it tests is a **boolean spelled as a word** — `no_condition=false`. `${name:+word}`
substitutes when `name` is set and **non-empty**, and the four-character string `false` is
non-empty, so the flag was passed unconditionally. Measured on a generated project before and after
the fix (`research/experiments/E12-l5-e2e/conditions.md`): before, a `checkout: none` step whose
compiled condition is the constant `False` ran and recorded `Succeeded`, and a `condition: failed()`
step ran after a tolerated failure; after, both record `Skipped` and the tolerated-failure step's
`succeeded()` successor still runs. **Nothing in the runtime was wrong** — `azdo__job_status_from_results`,
the `continueOnError` downgrade and `azdo_status_failed` all behaved as C-E06-036/040 describe,
which is why reading them found nothing. The flag now lives in its own variable
(`condition_flag=""`, set to `--no-condition` only when `no_condition` is `true`).
**C-E12-036 is superseded by this entry**: the symptom it recorded was real and its diagnosis
("the step results are right") was correct; what it could not see was that the condition was never
consulted at all.
  — measured 2026-09-21; `packages/emit/src/entrypoints.ts`; `packages/emit/test/entrypoints.test.ts`
    ("step conditions are actually evaluated")

[C-E12-039] **YAML `variables:` outrank queue time and the Pipeline settings UI at every level, so
the generated project must seed them *after* the `.env` load, not before.** The documented order,
highest precedence first, is: job-level YAML → stage-level YAML → pipeline-level YAML → variable set
at queue time → pipeline variable set in the Pipeline settings UI. —
https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables (git_commit_id
`9bb823ead8c926c72b8f9035e2585f5f90c48f36`, checked 2026-09-21) — "When you set a variable with the
same name in multiple scopes, the following precedence applies (highest precedence first): 1. Job
level variable set in the YAML file 2. Stage level variable set in the YAML file 3. Pipeline level
variable set in the YAML file 4. Variable set at queue time 5. Pipeline variable set in Pipeline
settings UI", corroborated on the same page by "If you define a variable in both the variables block
of a YAML and in the UI, the value in the YAML has priority." **Why this matters here:** PLAN D7
makes `.env` the stand-in for exactly those last two rows, so the intuitive ordering — load `.env`
last because the user's local file should win — is the wrong one, and a generated project that used
it would invert the documented precedence. Verified end to end against the page's own example (the
same name `a` at all three levels reads as the job value, and a sibling job with no job-level entry
reads the stage value), and against a `.env` entry that does **not** displace a root YAML variable.
  — checked 2026-09-21; `packages/emit/test/entrypoints.test.ts` ("variables are seeded")

[C-E12-040] **`PublishPipelineArtifact@1` and `DownloadPipelineArtifact@2` declare an `AgentPlugin`
handler and no other, so real-task mode can never run them — native is the only possible
disposition.** Their `execution` blocks are `{"AgentPlugin": {"target":
"Agent.Plugins.PipelineArtifact.PublishPipelineArtifactTaskV1, Agent.Plugins"}}` and
`{"AgentPlugin": {"target": "Agent.Plugins.PipelineArtifact.DownloadPipelineArtifactTaskV2_0_0,
Agent.Plugins"}}` respectively — no `Node`, `Node10`, `Node16`, `Node20` or `PowerShell3` entry
exists in either package. —
https://github.com/microsoft/azure-pipelines-tasks/blob/299572e25b6cf14b21c7b60e5228603cbb5ffb42/Tasks/PublishPipelineArtifactV1/task.json
and
https://github.com/microsoft/azure-pipelines-tasks/blob/299572e25b6cf14b21c7b60e5228603cbb5ffb42/Tasks/DownloadPipelineArtifactV2/task.json
(checked 2026-09-21). This settles C-E12-034 in the direction it guessed at: the failure was not
"the package was not fetched", it was that fetching it could never have helped. The same pages
confirm the alias sets the emitter maps (C-E06-085/091): `path`/`targetPath` and
`artifactName`/`artifact` on publish; `path`/`targetPath`/`downloadPath`, `artifact`/`artifactName`,
`patterns`/`itemPattern` and `source`/`buildType` on download.
  — checked 2026-09-21; `packages/emit/src/disposition.ts`; `packages/emit/src/step.ts`

[C-E12-041] **Step condition functions collided across jobs: `conditions.sh` is per *stage*, step
numbers restart at `010` in every job, and the function name carried only the number.** A stage with
three jobs emitted `cond_step_010` three times into one sourced file, so the **last** definition won
for all of them. Measured on L5 sample 01, where job `must_not_run` begins with `checkout: none` —
whose compiled condition is the constant `False` (C-E03-260) — and therefore skipped the *first step
of every job in the stage*, including the one that produces the artifact. The name is now
`cond_step_<job>_<NNN>`. **This was invisible until C-E12-038 was fixed**, because before that no
step condition was evaluated at all; the two defects hid each other, and the second could only be
found by running a multi-job stage.
  — measured 2026-09-21; `packages/emit/src/entrypoints.ts`; `fixtures/e2e/01-shell-artifacts`

[C-E12-042] **A failing step aborted the whole job sequencer, so later steps never ran and were
absent from the summary rather than recorded as `Skipped`.** `run-job.sh` carries `set -euo
pipefail` and `run_step` returns the step's status, so the first `Failed` step ended the script.
The agent does the opposite: it continues, evaluates each remaining step's condition, and records
`Skipped` for the ones whose condition is now false (C-E06-041/043) — which is the only reason an
`always()` or `failed()` step after a failure runs at all. Measured on L5 sample 03: before, steps
070 and 080 were missing from the summary entirely; after, `070` (default `succeeded()`) is
`Skipped` and `080` (`condition: failed()`) runs. Fixed with `|| :` on the `run_step` invocation,
the same shape and the same cause as C-E12-035 one level up. The step's result is already in the
store before `run_step` returns, so the discarded status carried nothing the run needed.
  — measured 2026-09-21; `packages/emit/src/entrypoints.ts`; `fixtures/e2e/03-failure-and-conditions`

[C-E12-043] **Open finding, pre-existing and out of E11-S04-T03's scope: `succeeded()`, `failed()`
and `canceled()` as *stage* or *job* conditions always evaluate as though everything succeeded.**
The compiler emits `azdo_status_succeeded`/`azdo_status_failed` for these slots, and those helpers
read `azdo__job_status_from_results`, which resolves a **step** result directory from
`AZDO_RESULT_DIR`. That variable is exported by `run-job.sh`, in a child process — so at the moment
`run-stage.sh` evaluates `cond_stage` and each `cond_job_*`, it is unset, and the helper finds no
step results and answers `Succeeded`. Measured on a four-stage probe: with stage `one` failing,
`condition: failed()` on stage `two` **skipped** it, a default-condition stage `four` **ran**, and
the store-backed `eq(dependencies.one.result, 'Failed')` on stage `three` was correct. The same
probe at job scope: a job with `dependsOn: failing` and the default condition ran. **Not caused by
this task and not fixed by it** — `git diff` over E11-S04-T03 touches neither the runtime, the
expression compiler, nor `emitRunStage`; it was simply never exercised, because no test or sample
combined a *failing* stage or job with a *status-function* stage/job condition. The dependency-based
form works and is what the L5 samples use, which is why sample 01 passes. **Filed as E11-S04-T04**,
not patched here: what `succeeded()` means at each scope is a behaviour question needing its own
grounding (at job scope it is about the job's dependencies, not about the steps of some other job),
and guessing it is what BACKLOG rule 1 forbids.
  — measured 2026-09-21

## E11-S04-T04 — `succeeded()`/`failed()` at stage and job scope

**Grounding composition.** The behavior question this task asks — what a status function *ranges
over* at job and stage scope — was already settled by E02 and did not need re-grounding: C-E02-064
(arity 0..N at those scopes, 0 at step scope), C-E02-067 (all-of over the dependency set, arguments
replace it, empty set True), C-E02-068 (the `succeededOrFailed` asymmetry), C-E02-069 (`Skipped`
satisfies nothing), C-E02-070 (`failed` is any-of), C-E02-071 (`Abandoned`) and C-E02-072 (an
unknown name is False, not an error) are **live-measured** in
`research/experiments/E02-status/real-run.md`, and `packages/engine/src/expr/status.ts` is their
implementation. What was missing was not knowledge but a *path*: the bash compiler emitted the
step-scope helpers into all three slots. This task ports that table to bash rather than deciding it
again. It reconciles with C-E06-039 by **not** carrying the step reading upward — the step scope
still reads `Agent.JobStatus` through the accumulated step results and is byte-identical in the
emitted output — and with C-E02-092..094 by reading the same `dependencies.*` store the
`eq(dependencies.<x>.result, …)` form already compiles to, which is why that form is the control in
both the L5 sample and the unit test.

[C-E12-044] **The dependency set a stage or job status function ranges over is the **transitive**
closure of `dependsOn`, not the direct list.** "By default, a pipeline job or stage runs if it
doesn't depend on any other job or stage, or if all its dependencies completed and succeeded. **The
dependency requirement applies to direct dependencies and to their indirect dependencies, computed
recursively.**" The expressions page says the same thing in the function's own words — "evaluates
to `True` if any previous job in the **dependency graph** failed" — where a direct-only reading
would have said "any dependency". E11-S04-T04's Ground field describes the set as "the job's own
`dependsOn` set"; per BACKLOG §3.3 the field is a starting point and the page is the authority, so
the page wins and docs/06 §5 decision 88 records the divergence.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions (`git_commit_id
    1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`, `ms.date: 2025-08-01`) §"Conditions a stage, job, or
    step runs under" ·
    https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions (same
    `git_commit_id`, `ms.date: 2026-01-09`) §"Job status check functions" — checked 2026-09-21

[C-E12-045] **`VERIFY`: the one cell where transitive and direct disagree is doc-derived, not
measured.** `succeeded()` cannot tell the two apart — an indirectly failed dependency leaves the
direct one `Skipped`, and `Skipped` satisfies no status function (C-E02-069) — so only `failed()`
and `succeededOrFailed()` discriminate, and only in a chain at least three deep: with `a` failed,
`b` dependsOn `a`, `c` dependsOn `b`, `failed()` on `c` is True under C-E02-044's reading and False
under a direct-only one. The E02 status real-run measured a *single* level of dependency only, and
settling this needs another agentless run in the test org, which is not available here (the oracle
PAT expired ~2026-09-10 per E00-S03's runbook, and a lapsed PAT reports as 302 rather than 401 —
C-E09-022). The cost of being wrong is one line: the set is emitted as literal words by
`transitiveDependencies` in `packages/emit/src/entrypoints.ts`, so narrowing it is that function
and no runtime change.
  — open 2026-09-21

[C-E12-046] **C-E12-043 is a fixed defect, and the fix's before/after was measured twice — once by
accident, which is the stronger of the two.** The emitted stage and job condition slots now compile
to `azdo_status_{stage,job}_{succeeded,failed,succeededorfailed}`, which read the stage/job result
store over the node's dependency set, and `canceled()` to `azdo_status_run_canceled`, which reads
run-level cancellation rather than folding dependency results (C-E02-062). The accidental
measurement: L5 sample 04 was first run against a **stale CLI bundle** carrying the pre-fix emitter,
and produced the defect exactly — stage `on_failure` (`condition: failed()`) was *skipped*, stage
`defaulted` (no condition) *ran*, and the `eq(dependencies.one.result, 'Failed')` control ran
correctly in the same log, proving the result store was already right and only the status functions
were wrong. Rebuilt, the same sample inverts all three and passes. The deliberate measurement is
`packages/emit/test/entrypoints.test.ts`, which generates one project from the fixed emitter and one
whose `conditions.sh` has the graph-scope helper names rewritten back to the step-scope ones, and
asserts the must-be-skipped stage runs only in the second.
  — measured 2026-09-21; `fixtures/e2e/04-status-at-every-scope`;
    `packages/runtime/lib/core.sh`; `packages/emit/src/entrypoints.ts`

[C-E12-047] **Open finding, pre-existing and out of E11-S04-T04's scope: the golden tree covers
*step scripts only*.** `emitGoldenTree` (`packages/emit/test/golden.ts`) walks the scaffold and
records `emitStepScript` output — nothing from `emitEntrypoints`, so `run.sh`, `run-stage.sh`,
`run-job.sh` and `conditions.sh` are outside every golden. That is why E11-S04-T04 changed the
compiled condition of every stage and job in the whole corpus and `node scripts/golden.ts --update`
produced **no diff at all**. Every defect the L5 tier has found in generated bash — C-E12-036/038
(`run-job.sh`), C-E12-041/043 (`conditions.sh`), C-E12-042 (`run-job.sh`) — lived in a file no
golden has ever hashed, which is why five unit-tested, snapshot-pinned, golden-covered emitter
changes shipped over them. Filed as **E11-S04-T05**; not fixed in T04, because extending the tree
changes every committed digest and is a golden-harness task rather than a rider on a runtime fix.
  — measured 2026-09-21; `packages/emit/test/golden.ts` L77-L96, L146-L152

  > **Retracted half (2026-09-21, E11-S04-T05).** As first written this claim had a second half —
  > "and its committed digest is never positively asserted", on the reading that the per-entry tests
  > only ever compare a *mutated* tree against `treeDigest`. **That half is false and is withdrawn.**
  > `packages/emit/test/golden-harness.test.ts` "match what the emitter produces today" calls
  > `verifyGoldens`, which compares `finalYamlSha256`, `stepCount` **and** `treeDigest` for every
  > entry; replacing one committed digest with zeroes fails exactly that test and nothing else.
  > **How it was got wrong is the reusable part:** the original reading came from grepping the test
  > file for `treeDigest`, and the comparison does not appear there — it happens inside `golden.ts`,
  > behind a call whose test title ("match what the emitter produces today") contains none of the
  > words the grep used. A grep over a test file cannot see an assertion made by a helper. The
  > surviving half was never in doubt and rests on different evidence: an `--update` run that
  > produced no diff. The false half is quoted in commit `0dbae2b` and was corrected in PR #108's
  > body before merge.

[C-E12-048] **Open finding: a stage or job condition that *errors* is recorded `Skipped`, which
conflates an error with a False.** `run-stage.sh` emits `if cond_job_x; then … else … Skipped; fi`,
and a compiled condition's contract is 0 True / 1 False / **2 evaluation error** (C-E02-131), so
exit 2 takes the else branch. On the service that node completes `Abandoned` — a sixth result the
docs never list, which no status function except `always()` matches (C-E02-071) — and
`azdo__valid_step_result` does not accept that state at all, so the local store has nowhere to put
it. Adjacent to this task (it is the same `if` that now evaluates a real condition) but not in its
Done list; filed as **E11-S04-T06**.
  — measured 2026-09-21; `packages/emit/src/entrypoints.ts` `emitRunStage`

## E11-S04-T05 — putting the entry points in the golden tree

[C-E12-049] **The generated entry points were never shellchecked by anything, and were carrying
four findings — two of them real.** `packages/emit/test/golden-harness.test.ts` runs shellcheck over
the golden tree, and until E11-S04-T05 that tree was the step scripts alone (C-E12-047); the L5
container runs the scripts but does not lint them, and `pnpm lint:shell` covers
`packages/runtime/lib` and its test helpers, not emitter *output*. So `run.sh`, `run-stage.sh`,
`run-job.sh` and `conditions.sh` had never been linted in any tier, despite CLAUDE.md making
shellcheck-clean a hard requirement for emitted script templates. Extending the tree surfaced all
four at once:

  - **`SC1091`, in all four entry points — a real defect, fixed.** Every entry point sources two
    runtime files, and a `# shellcheck disable=` directive applies to the **next command only**. The
    one the emitter wrote covered `source "$AZDO_EMU_LIB/runtime.sh"` and left
    `source "$AZDO_EMU_LIB/expr.sh"` reporting on the line below it, in every generated project
    since E05-S01-T03. The intent was already in the code; only its scope was wrong.
  - **`SC2034`, in a step-less job — a real defect, fixed, and larger than it first read.** A
    deployment job emits no step scripts, and its `run-job.sh` still carried `AZDO_JOB_DIR`, the
    whole `--from-step`/`--to-step`/`--only-step`/`--no-condition` parser, `condition_flag` and
    `job_status` — five unused variables and a dead directory, none of which anything in that file
    could read. The sequencer block is now emitted only for jobs that have steps. **What it must
    keep is `mkdir -p "$AZDO_RESULT_DIR"`**, and that is load-bearing rather than tidy: it is what
    makes `azdo_job_result` fold the job to `Succeeded` rather than return empty, and an empty
    result reads as "not succeeded" to a dependent node's `succeeded()` (C-E02-072, C-E12-046).
  - **`SC2071` — by construction, already sanctioned.** `run-job.sh`'s `"$id" > "$from_step"` is a
    deliberate *string* compare of zero-padded `NNN` step numbers; `-gt` would read `080` as octal.
    It has been in the generated project's shipped `.shellcheckrc` since decision 62(d) and was
    missing only from the harness's list, the same direction decision 85(b) had to correct.
  - **`SC2317`/`SC2329` — by construction, newly sanctioned, and *two codes for one finding*.**
    Every `cond_*` function in a stage's `conditions.sh` is invoked from `run-stage.sh` or
    `run-job.sh`, which source the file; "never invoked" is true only of the file read alone. Added
    to **both** the harness list and the shipped `.shellcheckrc`, so a user linting their own
    generated project sees what our gate sees (decision 89). **The pair is not redundancy — it is a
    version split measured in CI.** ShellCheck 0.11 (the npm-vendored binary used locally, and what
    `brew install shellcheck` gives the macOS job) reports `SC2329`, *the function is never invoked*;
    the older build preinstalled on the `ubuntu-latest` image reports `SC2317`, *this command appears
    to be unreachable*, pointing at the function's **body** instead. Excusing only `SC2329` made the
    suite pass on macOS and fail on Ubuntu — which is how the split was found, on this very task's
    first CI run, after a local suite that had been green on both counts.

  Neither by-construction code can arise in a step script, which is why neither appeared before.
  — measured 2026-09-21; `packages/emit/src/entrypoints.ts`; `packages/cli/src/convert/convert.ts`;
    `packages/emit/test/golden-harness.test.ts`

[C-E12-050] **The extended golden tree is shown to catch each defect the old one missed, by
replaying the bytes the pre-fix emitter produced.** "Would this golden have caught it?" is answered
per claim rather than asserted from file coverage, because coverage of a *file* is not coverage of
a *defect*: C-E12-041 is a **collision** between two `cond_step_*` definitions in one
`conditions.sh`, and a digest that merely hashed the file could in principle have been blind to the
rename that fixes it. Four replays run against every corpus entry — C-E12-041 (un-qualify the step
condition function names), C-E12-036/038 (`${condition_flag:+…}` → `${no_condition:+…}`),
C-E12-042 (drop `|| job_status=$?`) and C-E12-043 (graph-scope status helpers → step-scope) — and
each asserts the rewrite **applied** before asserting the digest moved, so a replay that silently
stopped matching would fail rather than pass forever. Each entry-point kind is also mutated
one line at a time, so a tree that contains a file but whose digest does not observe it would fail.
  — measured 2026-09-21; `packages/emit/test/golden-harness.test.ts`

## E11-S04-T06 — an errored stage or job condition

[C-E12-051] **`Abandoned` is a node result and not a task result, and the local store now says so
in two vocabularies rather than one.** Before this task `azdo__valid_step_result` gated every
result the store accepted — step results, the summary table, the worst-wins task merge, *and* both
node markers — so the sixth state had nowhere to go (C-E12-048). The split is not a local
convenience but the service's own shape: a step is a task and `TaskResult` has five members, which
is why a *step* whose condition errors is `Failed` (C-E06-042); a stage or job is a timeline node,
and one whose condition errors completes `Abandoned` (C-E02-071). `azdo__valid_node_result` is
therefore reachable from exactly two call sites — `azdo__result_marker_set`, the one write path for
both `.job-result` and `.stage-result`, and the two marker reads that must accept back what that
writer accepted. **The writer and its readers had to move together**: a value the writer accepts
and a reader rejects returns status 2 from `azdo_job_result`, which `azdo__status_graph` propagates
into the compiled condition of the *next* node, which the new emitter branch then reads as an
evaluation error — one invalid marker would silently abandon a downstream node. `azdo_run_result`
needed no change for a different reason worth recording: it scans `find … ! -name '.*'`, and both
node markers are dotfiles, so node results have never entered the run aggregate.
  — measured 2026-09-21; `packages/runtime/lib/core.sh`; `packages/runtime/test/core.bats`
    "Abandoned is a node result and not a task result"

[C-E12-052] **~~`VERIFY` — invented, not measured: an abandoned job outranks a skipped one in the
stage fold.~~ RETRACTED 2026-09-21 by E11-S04-T07: the rule was invented and is **measured wrong**
(C-E12-055), and the reason given for not measuring it was also false (C-E12-056). The original
text is kept below, struck, because the retraction is the finding.**

~~Original:~~
`azdo_stage_result` short-circuits on a `.stage-result` marker, so the fold over job results only
decides a stage that *ran* — which is exactly the job-condition-error case. An abandoned job
contributes no status of its own (it did not run, as a skipped one did not), leaving the tail to
choose between `Skipped` and `Abandoned` for a stage whose jobs were some of each. **No source
states this cell and no experiment here settles it.** The rule taken is that `Abandoned` wins,
because hiding a condition-evaluation error behind a sibling's skip is the same conflation the task
exists to remove. The probe that would settle it is one agentless run in the test org: a stage with
two jobs, one `condition: false` and one `condition: gt(1, 'not-a-number')`, reading the *stage's*
timeline result. That run is not available here: the oracle PAT expired ~2026-09-10 per E00-S03's
runbook (C-E09-022). The cost of being wrong is one `elif` in one function. Equally invented and
settled the same way: a stage whose own condition errors marks its jobs `Abandoned` rather than
`Skipped`, mirroring what the pre-existing skip path already did for `Skipped`.
  — retracted 2026-09-21; superseded by C-E12-054/055/056

  > **Outcome of the probe this claim asked for.** Both halves were run the next hour, and they
  > landed on opposite sides. The stage-fold rule is **wrong**: the service folds an abandoned job
  > into its stage as `failed`, not `abandoned` (C-E12-055). The second, smaller cell — that a
  > stage whose own condition errors marks its jobs `Abandoned` — is **right**, and is now measured
  > rather than asserted. The cost estimate held exactly: the fix was one `case` arm. What did not
  > hold was the premise that no measurement was possible (C-E12-056).

[C-E12-053] **The run summary could not distinguish the two cases even once the store could,
because it is a step table and neither node ran a step.** `azdo_run_summary` returned at
`No steps ran.` before anything else could be printed, so a stage conditioned out and a stage whose
condition errored produced byte-identical output — the discriminating case is precisely the one
where the table is empty. The node rows are therefore gathered *before* that branch and printed
after it, and the branch no longer returns. Only `Skipped` and `Abandoned` nodes are listed: a node
that ran is already represented by its steps. Asserted twice — at unit scope over synthetic markers
with no step records at all, and end-to-end against a generated project whose run produces all four
rows.
  — measured 2026-09-21; `packages/runtime/lib/core.sh` `azdo__run_summary_nodes`;
    `packages/runtime/test/core.bats` "the run summary names a node that ran no steps";
    `packages/emit/test/entrypoints.test.ts` "records Abandoned, not Skipped, at stage and job scope"

## E11-S04-T07 — does an abandoned node move the run result?

[C-E12-054] **An abandoned stage or job fails the **run**, measured in isolation.** A run whose
only non-succeeded node was an abandoned stage — one stage succeeded, one conditioned out, one
whose condition errored, and **every failed stage deliberately removed** — completed `failed`
(run 552). The isolation matters and the first probe lacked it: run 551 also returned `failed`, but
it contained two stages that were themselves `failed`, so a service that ignored abandonment
entirely would have reported the same thing. That first run could not answer its own question, and
the second probe exists because of it. Locally this means `azdo_run_result` must see the node
markers: before, a run whose author mistyped a condition aggregated to `Succeeded` and
`azdo_run_exit_code` returned 0, reporting success to whatever invoked `run.sh`. The scan is a
**separate pass** rather than a widening of the step fold's `find … ! -name '.*'`, because that
filter is what keeps the `issues/` sidecars out of the step results and is load-bearing for them.
`Canceled` still wins outright; abandonment adds a floor of `Failed`.
  — research/experiments/E12-abandoned-aggregate/real-run-stage-only.md (live run 552, checked
    2026-09-21) — `Stage bad_stage result=abandoned` with run `result=failed`

[C-E12-055] **An abandoned *child* aggregates into its parent as `Failed`, while a node's own
errored condition makes that node `Abandoned` — and that asymmetry is the shape no claim had
stated.** Measured in run 551: a stage holding one `Skipped` job and one `Abandoned` job is
`failed`; a stage whose *every* job is abandoned is also `failed` (measured rather than inferred by
subtracting the mixed case); a stage whose *own* condition errors is `abandoned`, which extends
C-E02-071 from job scope to stage scope. So `Abandoned` is not a fold-neutral "did not run" like
`Skipped` — upward it behaves exactly as `Failed`.
**This is not the same question as what a dependency lookup sees.** Over an abandoned *dependency*,
`failed()` is False and only `always()` is True (C-E02-071). Aggregation and dependency resolution
read the same recorded state and disagree about it, on the service and in our runtime; the bats
case asserts both directions in one test so a future simplification that unifies them fails.
  — research/experiments/E12-abandoned-aggregate/real-run.md (live run 551, checked 2026-09-21) —
    `Stage mixed result=failed`, `Stage all_abandoned result=failed`, `Stage bad_stage
    result=abandoned`

[C-E12-056] **The reason recorded for not measuring C-E12-052 was itself false: the oracle was
reachable the whole time.** C-E12-052 stated "that run is not available here: the oracle PAT
expired ~2026-09-10 per E00-S03's runbook". That date is an *estimate* written when the PAT was
created with a 30-day expiry, and it was never rechecked — `GET /_apis/projects` returned **200**
on 2026-09-21. One `curl` would have settled it before a behaviour cell was written down as
unmeasurable, and the cell that followed was wrong (C-E12-055). The failure mode is worth naming
because it is cheap to repeat and expensive to inherit: an unavailability that was assumed rather
than checked hardens into a citation, and the next reader has no way to tell the two apart. The
runbook's expiry line is now stated as an estimate to re-test, not a fact.
  — measured 2026-09-21; `research/oracle-setup.md`; both transcripts under
    `research/experiments/E12-abandoned-aggregate/`
