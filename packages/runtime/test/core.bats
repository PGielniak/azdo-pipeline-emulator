#!/usr/bin/env bats

setup() {
  RUNTIME_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  # shellcheck source=/dev/null
  source "$RUNTIME_DIR/lib/core.sh"
}

@test "core.sh exposes the runtime version" {
  run azdo_emu_runtime_version
  [ "$status" -eq 0 ]
  [ "$output" = "0.0.0" ]
}
