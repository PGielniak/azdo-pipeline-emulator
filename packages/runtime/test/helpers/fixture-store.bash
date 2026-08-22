# shellcheck shell=bash
# E12-S01-T01 — fixture store for the bats (L4) suite.
#
# Loaded with `load helpers/fixture-store.bash` from a *.bats file: `load` sources relative to
# the test file's directory (C-E12-001), which is why helpers live beside the tests and are
# never `bats_load_library`'d — that would need a BATS_LIB_PATH set per environment.
#
# Every scratch directory these functions hand out lives under one of bats' own temporary
# directories, so bats removes them (C-E12-003):
#   BATS_TEST_TMPDIR   unique per test        — the default here
#   BATS_FILE_TMPDIR   shared by one file     — for setup_file
#   BATS_SUITE_TMPDIR  shared by the run      — for setup_suite
# Pass `--no-tempdir-cleanup` to bats to keep them for inspection after a failure.

# Absolute path of the repository root (…/packages/runtime/test/helpers → up 4).
# The `cd` runs in a subshell: these are ordinary functions, so an unguarded `cd` would move the
# *test's* working directory as a side effect of asking for a path.
azdo_emu_repo_root() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)
}

# Absolute path of the runtime package (the thing under test).
azdo_emu_runtime_dir() {
  (cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
}

# Absolute path of the shared runtime fixture tree.
azdo_emu_fixture_root() {
  printf '%s/fixtures/runtime\n' "$(azdo_emu_repo_root)"
}

# azdo_emu_fixture <name> — absolute path of a fixture directory; fails the test if absent, so a
# renamed fixture surfaces as an error rather than as an empty copy.
azdo_emu_fixture() {
  local name="$1" root path
  root="$(azdo_emu_fixture_root)"
  path="$root/$name"
  if [[ ! -d "$path" ]]; then
    printf 'fixture not found: %s (looked in %s)\n' "$name" "$root" >&2
    return 1
  fi
  printf '%s\n' "$path"
}

# azdo_emu_scratch_dir [name] — a fresh empty directory under the current test's tmpdir.
azdo_emu_scratch_dir() {
  local name="${1:-scratch}"
  # Narrowest scope in play wins: per test, else per file (setup_file), else per suite
  # (setup_suite), else the run directory.
  local base="${BATS_TEST_TMPDIR:-${BATS_FILE_TMPDIR:-${BATS_SUITE_TMPDIR:-${BATS_RUN_TMPDIR:-}}}}"
  if [[ -z "$base" ]]; then
    printf 'no bats temporary directory in scope — call this from a test, setup or setup_file\n' >&2
    return 1
  fi
  local dir="$base/$name"
  local suffix=1
  while [[ -e "$dir" ]]; do
    dir="$base/$name.$((suffix++))"
  done
  mkdir -p "$dir"
  # Hand back the *physical* path: the runtime resolves with `pwd -P`, and on macOS the bats tmpdir
  # lives under `/var/folders/…` where `/var` is a symlink to `/private/var`, so an unresolved path
  # here makes every equality check against runtime output fail for a spelling difference rather
  # than a defect. No-op wherever the tmpdir is already physical. (E11-S01-T04)
  (cd "$dir" && pwd -P)
}

# azdo_emu_copy_fixture <name> [dest] — copy a fixture into a writable scratch directory and echo
# the copy's path. Tests mutate the copy; the committed fixture stays pristine.
azdo_emu_copy_fixture() {
  local name="$1" dest="${2:-}" src
  src="$(azdo_emu_fixture "$name")" || return 1
  if [[ -z "$dest" ]]; then
    dest="$(azdo_emu_scratch_dir "$name")" || return 1
  else
    mkdir -p "$dest"
  fi
  # `/.` copies the *contents* so dest is the fixture root, not its parent.
  cp -R "$src/." "$dest/"
  printf '%s\n' "$dest"
}

# azdo_emu_use_fixture <name> — copy a fixture and cd into the copy. Sets AZDO_EMU_FIXTURE_DIR.
azdo_emu_use_fixture() {
  AZDO_EMU_FIXTURE_DIR="$(azdo_emu_copy_fixture "$1")" || return 1
  cd "$AZDO_EMU_FIXTURE_DIR" || return 1
}

# azdo_emu_load_runtime [file] — source a runtime library file (default lib/core.sh) from the
# package under test, never from an installed copy.
azdo_emu_load_runtime() {
  local file="${1:-core.sh}" dir
  dir="$(azdo_emu_runtime_dir)"
  # shellcheck source=/dev/null
  source "$dir/lib/$file"
}
