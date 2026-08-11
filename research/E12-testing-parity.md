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
