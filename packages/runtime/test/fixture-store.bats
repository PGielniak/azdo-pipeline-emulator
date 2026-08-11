#!/usr/bin/env bats
# E12-S01-T01 — the fixture store is itself under test: every helper the L4 suite will lean on
# gets one case here, so a broken harness fails loudly instead of quietly weakening E06's tests.

# `run -N` / `run !` need bats >= 1.5.0 (C-E12-004); without this line those forms are parsed as
# a command named "-1" on older bats and the test passes for the wrong reason.
bats_require_minimum_version 1.5.0

setup() {
  load helpers/fixture-store.bash
}

@test "azdo_emu_fixture resolves a committed fixture directory" {
  run -0 azdo_emu_fixture workspace
  [ -d "$output" ]
  [ -f "$output/sources/app/hello.txt" ]
}

@test "azdo_emu_fixture fails on an unknown fixture name" {
  run ! azdo_emu_fixture no-such-fixture
  [[ "$output" == *"fixture not found: no-such-fixture"* ]]
}

@test "azdo_emu_scratch_dir hands out fresh directories inside the test tmpdir" {
  local first second
  first="$(azdo_emu_scratch_dir)"
  second="$(azdo_emu_scratch_dir)"
  [ "$first" != "$second" ]
  [ -d "$first" ]
  [ -z "$(ls -A "$first")" ]
  # Both must sit under the per-test tmpdir, which bats removes for us.
  [[ "$first" == "$BATS_TEST_TMPDIR"/* ]]
  [[ "$second" == "$BATS_TEST_TMPDIR"/* ]]
}

@test "azdo_emu_copy_fixture copies contents and preserves the executable bit" {
  local dir
  dir="$(azdo_emu_copy_fixture workspace)"
  [ -f "$dir/sources/app/hello.txt" ]
  [ -x "$dir/sources/app/build.sh" ]
  [ -d "$dir/artifacts" ]
}

@test "mutating a copied fixture leaves the committed fixture untouched" {
  local dir src
  dir="$(azdo_emu_copy_fixture workspace)"
  printf 'mutated\n' >"$dir/sources/app/hello.txt"
  rm -rf "$dir/artifacts"
  src="$(azdo_emu_fixture workspace)"
  [ "$(cat "$src/sources/app/hello.txt")" = "hello from the runtime fixture" ]
  [ -d "$src/artifacts" ]
}

@test "azdo_emu_use_fixture moves into the copy and exports its path" {
  azdo_emu_use_fixture workspace
  [ "$PWD" = "$AZDO_EMU_FIXTURE_DIR" ]
  [ -f "sources/app/hello.txt" ]
}

@test "path helpers do not change the working directory" {
  local before="$PWD"
  azdo_emu_repo_root >/dev/null
  azdo_emu_runtime_dir >/dev/null
  azdo_emu_fixture_root >/dev/null
  [ "$PWD" = "$before" ]
}

@test "azdo_emu_repo_root points at this repository" {
  local root
  root="$(azdo_emu_repo_root)"
  [ -f "$root/pnpm-workspace.yaml" ]
  [ -d "$root/fixtures/runtime" ]
}

@test "azdo_emu_load_runtime sources the package under test" {
  azdo_emu_load_runtime
  run -0 azdo_emu_runtime_version
  [ "$output" = "0.0.0" ]
}
