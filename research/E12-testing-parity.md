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
