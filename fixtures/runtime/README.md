# fixtures/runtime/

Filesystem fixtures for the bats (L4) runtime suite — *not* pipeline YAML. They stand in for the
directory shapes an emitted project works on (a checked-out source tree, an artifact staging
directory), so runtime functions can be exercised against something real without a conversion.

Tests never touch these directories directly: `azdo_emu_copy_fixture` /`azdo_emu_use_fixture`
(`packages/runtime/test/helpers/fixture-store.bash`) copy a fixture into the test's own
`BATS_TEST_TMPDIR` first, so a test that mutates its workspace cannot leak into the next one or
into the committed tree.

| Directory | Owner | Contents |
|---|---|---|
| `workspace/` | E12-S01-T01 | Minimal emitted-project shape: `sources/app/` (a text file + an executable script, so file-mode preservation is observable) and an empty `artifacts/` staging directory |
