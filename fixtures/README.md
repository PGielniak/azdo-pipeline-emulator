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
| `corpus/` | E12-S01-T02 | Corpus v1 — 10 real-shaped pipelines, each accepted by the live service; see `corpus/README.md` for the layout contract and the refresh commands |
| `oracle/` | E12-S01-T02 | The service's `finalYaml` for each corpus entry (`<entry>.final.yml`, redacted) plus `MANIFEST.json` recording which input each pair was produced from |
| `schema/valid/` | E01-S02-T01 | Pipelines that must validate clean — the regression guard for the vendored schema's known divergences (documented `target:`, YAML scalars, expressions, task-name casing, input aliases) |
