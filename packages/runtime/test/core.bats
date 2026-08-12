#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

setup() {
  load helpers/fixture-store.bash
  azdo_emu_load_runtime
  AZDO_STATE_DIR="$(azdo_emu_scratch_dir state)"
  AZDO_VAR_SCOPE='pipeline'
  export AZDO_STATE_DIR AZDO_VAR_SCOPE
  unset AZDO_OUTPUT_DIR AZDO_STEP_NAME
}

@test "core.sh exposes the runtime version" {
  run -0 azdo_emu_runtime_version
  [ "$output" = "0.0.0" ]
}

@test "variable values preserve newlines, quotes, unicode, and case-insensitive lookup" {
  local value=$'first line\n"quoted" café ☃\nlast line'
  azdo_var_set 'Build.Note' "$value"

  cmp <(azdo_var 'build.note') <(printf '%s' "$value")
  [ -f "$AZDO_STATE_DIR/vars/pipeline/build.note" ]
  run -0 azdo_var_meta 'BUILD.NOTE'
  [ "$output" = $'secret=false\noutput=false\nreadonly=false\nname=Build.Note' ]
}

@test "a job scope copies parent values without leaking its later writes back" {
  azdo_var_set 'release' 'pipeline-value'
  azdo_var_scope_copy pipeline build
  azdo_var_set 'release' 'job-value' false false false build

  run -0 azdo_var release pipeline
  [ "$output" = 'pipeline-value' ]
  run -0 azdo_var release build
  [ "$output" = 'job-value' ]
}

@test "a read-only overwrite errors and retains the original value" {
  azdo_var_set 'readonlyProbe' 'first' false false true

  run ! azdo_var_set 'READONLYPROBE' 'second'
  [ "$status" -eq 1 ]
  [[ "$output" == *"Overwriting readonly variable 'READONLYPROBE' is not permitted."* ]]
  cmp <(azdo_var readonlyProbe) <(printf '%s' 'first')
}

@test "output variables use the same-job step alias and the cross-job output path" {
  AZDO_VAR_SCOPE='build'
  AZDO_OUTPUT_DIR="$AZDO_STATE_DIR/outputs/Build/build"
  AZDO_STEP_NAME='setSha'
  export AZDO_VAR_SCOPE AZDO_OUTPUT_DIR AZDO_STEP_NAME

  azdo_var_set short 'abc123' false true false

  run -0 azdo_var 'setSha.short'
  [ "$output" = 'abc123' ]
  run -0 azdo_output Build build 'setSha.short'
  [ "$output" = 'abc123' ]
  run -0 azdo_var short
  [ -z "$output" ]
  run ! azdo_var_set short 'mutated' false true false
  [[ "$output" == *"Overwriting readonly variable 'setSha.short' is not permitted."* ]]
}
