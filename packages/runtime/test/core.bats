#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

setup() {
  load helpers/fixture-store.bash
  azdo_emu_load_runtime
}

@test "core.sh exposes the runtime version" {
  run -0 azdo_emu_runtime_version
  [ "$output" = "0.0.0" ]
}
