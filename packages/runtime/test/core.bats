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

@test ".env loader preserves Bash quoting and multiline assignment values (C-E06-014..017)" {
  local env_file="$BATS_TEST_TMPDIR/quoting.env"
  cat >"$env_file" <<'ENV'
# A comment at the beginning of a word is ignored.
EMPTY=
PREFIX=base
SINGLE='literal $PREFIX # = value'
DOUBLE="quote:\" slash:\\ dollar:\$ prefix:${PREFIX}"
ESCAPED=one\ two
MULTI_SINGLE='first
LOOKS_LIKE=part-of-the-value
last'
MULTI_DOUBLE="alpha
beta"
CONTINUED=left\
right
HASH=inside#literal
COMMENTED=outside # ignored
EQUALS='a=b=c'
TRAILING='tail

'
COMMAND="$(printf '%s' generated)"
ENV
  AZDO_MANIFEST_ENV=('SINGLE=true' 'MULTI_SINGLE=true' 'TRAILING=true')

  azdo_env_load "$env_file"

  [ "$(azdo_var EMPTY)" = '' ]
  [ "$(azdo_var PREFIX)" = base ]
  [ "$(azdo_var SINGLE)" = 'literal $PREFIX # = value' ]
  [ "$(azdo_var DOUBLE)" = 'quote:" slash:\ dollar:$ prefix:base' ]
  [ "$(azdo_var ESCAPED)" = 'one two' ]
  [ "$(azdo_var MULTI_SINGLE)" = $'first\nLOOKS_LIKE=part-of-the-value\nlast' ]
  [ "$(azdo_var MULTI_DOUBLE)" = $'alpha\nbeta' ]
  [ "$(azdo_var CONTINUED)" = leftright ]
  [ "$(azdo_var HASH)" = 'inside#literal' ]
  [ "$(azdo_var COMMENTED)" = outside ]
  [ "$(azdo_var EQUALS)" = 'a=b=c' ]
  cmp <(azdo_var TRAILING) <(printf '%s' $'tail\n\n')
  [ "$(azdo_var COMMAND)" = generated ]
  run -0 azdo_var_meta SINGLE
  [[ "$output" == secret=true$'\n'* ]]
  run -0 azdo_var_meta PREFIX
  [[ "$output" == secret=false$'\n'* ]]
  run -0 azdo_var LOOKS_LIKE
  [ -z "$output" ]
}

@test "--env-file overlay wins case-insensitively and can expand base values (C-E06-013)" {
  local base_file="$BATS_TEST_TMPDIR/base.env" overlay_file="$BATS_TEST_TMPDIR/overlay.env"
  cat >"$base_file" <<'ENV'
SAME=base
CaseKey=base-case
BASE_ONLY=base-only
ENV
  cat >"$overlay_file" <<'ENV'
SAME=overlay
casekey=overlay-case
OVERLAY_ONLY=overlay-only
DERIVED="${SAME}-derived"
ENV
  AZDO_MANIFEST_ENV=('SAME=true' 'casekey=true' 'BASE_ONLY=false' 'OVERLAY_ONLY=false' 'DERIVED=false')

  azdo_env_load "$base_file" "$overlay_file"

  [ "$(azdo_var SAME)" = overlay ]
  [ "$(azdo_var CASEKEY)" = overlay-case ]
  [ "$(azdo_var BASE_ONLY)" = base-only ]
  [ "$(azdo_var OVERLAY_ONLY)" = overlay-only ]
  [ "$(azdo_var DERIVED)" = overlay-derived ]
  run -0 azdo_var_meta same
  [[ "$output" == secret=true$'\n'* ]]
  run -0 azdo_var_meta casekey
  [[ "$output" == secret=true$'\n'* ]]
}

@test ".env loader fails atomically on Bash syntax errors" {
  local env_file="$BATS_TEST_TMPDIR/invalid.env"
  printf '%s\n' 'BEFORE=not-written' "BROKEN='unterminated" >"$env_file"

  run ! azdo_env_load "$env_file"

  [[ "$output" == *'failed to load environment file(s) with bash'* ]]
  run -0 azdo_var BEFORE
  [ -z "$output" ]
}

@test ".env loader rejects malformed or duplicate manifest metadata before sourcing" {
  local env_file="$BATS_TEST_TMPDIR/metadata.env"
  printf '%s\n' 'VALUE=loaded' >"$env_file"
  AZDO_MANIFEST_ENV=('VALUE=false' 'value=true')

  run ! azdo_env_load "$env_file"

  [[ "$output" == *'duplicate manifest environment name: value'* ]]
  run -0 azdo_var VALUE
  [ -z "$output" ]
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
  azdo_var_set 'overlay.chain' '$(overlay.source)'
  azdo_var_set 'Hidden.Value' "$secret_value" true
  azdo_var_set 'public.chain' '$(overlay.source)'
  azdo_var_set 'derived.secret' '$(Hidden.Value)'

  azdo_env_materialize \
    OVERLAY_NAME 'explicit-$(overlay.source)' \
    CHAINED '$(overlay.chain)' \
    EXPLICIT_SECRET '$(Hidden.Value)'

  [ "$(materialized_env_value OVERLAY_NAME)" = 'automatic' ]
  [ "$(materialized_env_value CHAINED)" = 'macro' ]
  [ "$(materialized_env_value PUBLIC_CHAIN)" = 'macro' ]
  local mapped_secret
  azdo__env_value EXPLICIT_SECRET mapped_secret
  [ "$mapped_secret" = "$secret_value" ]
  [ "$(materialized_env_count HIDDEN_VALUE)" -eq 0 ]
  [ "$(materialized_env_count DERIVED_SECRET)" -eq 0 ]
}

@test "macro expansion performs step-time variable recalculation then a one-pass file scan (C-E06-018..024)" {
  local agent_temp="$BATS_TEST_TMPDIR/agent-temp" source_file="$BATS_TEST_TMPDIR/step.sh"
  local secret_value=$'top secret\nsecond line' expanded_file
  azdo_var_set 'Agent.TempDirectory' "$agent_temp"
  azdo_var_set b inner
  azdo_var_set a '$(b)'
  azdo_var_set ainner outer
  azdo_var_set short short-value
  azdo_var_set shorter longer-name-value
  azdo_var_set 'Hidden.Value' "$secret_value" true
  printf '%s' $'CHAIN=$(a)\nNESTED=$(a$(b))\nUNMATCHED=$(missing)\nEXACT=$(short)|$(shorter)\nSECRET=[$(HIDDEN.VALUE)]\n' >"$source_file"

  run -0 azdo_expand_macros "$source_file"
  expanded_file="$output"

  [[ "$expanded_file" = "$agent_temp/steps/"* ]]
  [ -f "$expanded_file" ]
  cmp <(cat "$expanded_file") \
    <(printf '%s' $'CHAIN=inner\nNESTED=$(ainner)\nUNMATCHED=$(missing)\nEXACT=short-value|longer-name-value\nSECRET=[top secret\nsecond line]\n')
}

@test "macro variable recalculation preserves the raw top-level value on cycles and depth overflow (C-E06-023)" {
  local expanded warning_file="$BATS_TEST_TMPDIR/macro-warning.log" index next_value
  azdo_var_set cycle_a '$(cycle_b)'
  azdo_var_set cycle_b '$(cycle_a)'

  azdo__expand_value '$(cycle_a)' expanded 2>"$warning_file"

  [ "$expanded" = '$(cycle_b)' ]
  [ "$(cat "$warning_file")" = \
    "##[warning]Unable to expand variable 'cycle_a'. A cyclical reference was detected." ]

  for ((index = 0; index < 50; index++)); do
    printf -v next_value '$(depth_%s)' "$((index + 1))"
    azdo_var_set "depth_$index" "$next_value"
  done
  azdo_var_set depth_50 final

  azdo__expand_value '$(depth_0)' expanded 2>"$warning_file"

  [ "$expanded" = '$(depth_1)' ]
  [ "$(cat "$warning_file")" = \
    "##[warning]Unable to expand variable 'depth_0'. The max expansion depth (50) was exceeded." ]
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
