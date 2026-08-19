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

materialized_env_count() {
  local expected="$1" entry count=0
  for entry in "${AZDO_STEP_ENV[@]}"; do
    [[ "${entry%%=*}" = "$expected" ]] && ((count += 1))
  done
  printf '%s\n' "$count"
}

materialized_env_value() {
  local expected="$1" entry
  for entry in "${AZDO_STEP_ENV[@]}"; do
    if [[ "${entry%%=*}" = "$expected" ]]; then
      printf '%s' "${entry#*=}"
      return 0
    fi
  done
  return 1
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

@test "environment materialization transforms public names and excludes secrets (C-E06-007..009)" {
  azdo_var_set 'lower.dot' 'dotted'
  azdo_var_set 'Space Name' 'spaced'
  azdo_var_set 'dash-name' 'hyphenated'
  azdo_var_set 'Hidden.Value' 'not-automatic' true

  azdo_env_materialize

  [ "$(materialized_env_value LOWER_DOT)" = 'dotted' ]
  [ "$(materialized_env_value SPACE_NAME)" = 'spaced' ]
  [ "$(materialized_env_value DASH-NAME)" = 'hyphenated' ]
  [ "$(materialized_env_count HIDDEN_VALUE)" -eq 0 ]
  run -0 env -i "${AZDO_STEP_ENV[@]}" /usr/bin/printenv DASH-NAME
  [ "$output" = 'hyphenated' ]
}

@test "public variables overwrite explicit env after explicit macros map secrets (C-E06-009/010)" {
  local secret_value=$'top secret\nwith trailing newline\n'
  azdo_var_set 'OVERLAY_NAME' 'automatic'
  azdo_var_set 'overlay.source' 'macro'
  azdo_var_set 'Hidden.Value' "$secret_value" true

  azdo_env_materialize \
    OVERLAY_NAME 'explicit-$(overlay.source)' \
    EXPLICIT_SECRET '$(Hidden.Value)'

  [ "$(materialized_env_value OVERLAY_NAME)" = 'automatic' ]
  local mapped_secret
  azdo__env_value EXPLICIT_SECRET mapped_secret
  [ "$mapped_secret" = "$secret_value" ]
  [ "$(materialized_env_count HIDDEN_VALUE)" -eq 0 ]
}

@test "PATH prepends are newest-first and repeated entries move to newest (C-E06-012)" {
  mkdir -p "$AZDO_STATE_DIR/path.d"
  printf '%s' '/first-e06' >"$AZDO_STATE_DIR/path.d/001-first"
  printf '%s' '/second-e06' >"$AZDO_STATE_DIR/path.d/002-second"
  printf '%s' '/first-e06' >"$AZDO_STATE_DIR/path.d/003-first-again"

  azdo_env_materialize PATH '/explicit/base'

  [ "$(materialized_env_value PATH)" = '/first-e06:/second-e06:/explicit/base' ]
}

@test "colliding public transforms produce one key without promising its winner (C-E06-011)" {
  azdo_var_set 'A.B' 'dot-value'
  azdo_var_set 'A_B' 'underscore-value'

  azdo_env_materialize

  [ "$(materialized_env_count A_B)" -eq 1 ]
  local collision_value
  collision_value="$(materialized_env_value A_B)"
  [[ "$collision_value" = dot-value || "$collision_value" = underscore-value ]]
}
