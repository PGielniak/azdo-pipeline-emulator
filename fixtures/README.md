# fixtures/

Pipeline YAML fixtures for golden/parity tests. Populated from E12 (testing & parity program)
onward; oracle fixture pairs (`input.yml` + service `finalYaml`) come from the preview-API harness
(E00-S03, E12-S03).

Fixtures are test **input**: they are excluded from prettier (`.prettierignore`) because
reformatting would move the line/col positions that diagnostic snapshots assert, and some files
are deliberately malformed.

| Directory | Owner | Contents |
|---|---|---|
| `schema/invalid/` | E01-S02-T01 | 15 pipelines with one deliberate schema defect each; snapshotted diagnostics in `packages/engine/test/frontend/validate.test.ts` |
| `runtime/` | E12-S01-T01 | Filesystem (not YAML) fixtures for the bats L4 suite — see `runtime/README.md`; copied into `BATS_TEST_TMPDIR` by the fixture-store helpers before use |
| `schema/valid/` | E01-S02-T01 | Pipelines that must validate clean — the regression guard for the vendored schema's known divergences (documented `target:`, YAML scalars, expressions, task-name casing, input aliases) |
