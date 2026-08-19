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

prepare_run_step() {
  local workspace="$BATS_TEST_TMPDIR/workspace" agent_temp="$BATS_TEST_TMPDIR/agent-temp"
  AZDO_LOG_DIR="$BATS_TEST_TMPDIR/logs"
  AZDO_RESULT_DIR="$AZDO_STATE_DIR/results/Build/build"
  export AZDO_LOG_DIR AZDO_RESULT_DIR
  mkdir -p "$workspace" "$agent_temp" "$AZDO_LOG_DIR" "$AZDO_RESULT_DIR"
  azdo_var_set 'System.DefaultWorkingDirectory' "$workspace"
  azdo_var_set 'Build.SourcesDirectory' "$BATS_TEST_TMPDIR/different-sources"
  azdo_var_set 'Agent.TempDirectory' "$agent_temp"
  azdo_env_materialize
}

run_test_step() {
  local id="$1" file="$2" timeout_seconds="${3:-10}"
  shift 3
  run_step \
    --id "$id" \
    --file "$file" \
    --cond cond_for_later_task \
    --display "Test step $id" \
    "$@" \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout "$timeout_seconds"
}

run_result_step() {
  local id="$1" file="$2" continue_on_error="$3" fail_on_stderr="$4" retries="$5"
  local timeout_seconds="$6"
  run_step \
    --id "$id" \
    --file "$file" \
    --cond cond_for_later_task \
    --display "Result step $id" \
    --continue-on-error "$continue_on_error" \
    --fail-on-stderr "$fail_on_stderr" \
    --retries "$retries" \
    --timeout "$timeout_seconds"
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

@test "run_step executes the macro-expanded temp script with its materialized environment (C-E06-028/029)" {
  local source_file="$BATS_TEST_TMPDIR/exec-step.sh"
  azdo_var_set greeting hello
  prepare_run_step
  azdo_env_materialize EXPLICIT mapped
  printf '%s\n' 'printf "EXEC=%s:%s\\n" "$(greeting)" "$EXPLICIT"' >"$source_file"

  run -0 run_test_step 030 "$source_file" 10

  [ "$output" = 'EXEC=hello:mapped' ]
  [ "$(find "$BATS_TEST_TMPDIR/agent-temp/steps" -type f -name '.expanded.*' | wc -l)" -eq 1 ]
}

@test "run_step defaults cwd to System.DefaultWorkingDirectory and expands an explicit cwd (C-E06-026/027)" {
  local source_file="$BATS_TEST_TMPDIR/cwd-step.sh" explicit_wd="$BATS_TEST_TMPDIR/explicit-wd"
  prepare_run_step
  mkdir -p "$explicit_wd"
  azdo_var_set explicit.wd "$explicit_wd"
  printf '%s\n' 'pwd' >"$source_file"

  run -0 run_test_step 031 "$source_file" 10
  [ "$output" = "$BATS_TEST_TMPDIR/workspace" ]

  run -0 run_test_step 032 "$source_file" 10 --wd '$(explicit.wd)'
  [ "$output" = "$explicit_wd" ]
}

@test "run_step tees combined stdout and stderr to the step log (C-E06-029)" {
  local source_file="$BATS_TEST_TMPDIR/log-step.sh"
  prepare_run_step
  printf '%s\n' "printf 'OUT\\n'" "printf 'ERR\\n' >&2" >"$source_file"

  run -0 run_test_step 033 "$source_file" 10

  [ "$output" = $'OUT\nERR' ]
  cmp "$AZDO_LOG_DIR/033.log" <(printf '%s\n' OUT ERR)
}

@test "step result storage accepts exactly the five grounded states (C-E06-037)" {
  local result
  prepare_run_step

  for result in Succeeded SucceededWithIssues Failed Skipped Canceled; do
    azdo_step_result_set state-machine "$result"
    run -0 azdo_step_result state-machine
    [ "$output" = "$result" ]
  done

  run ! azdo_step_result_set state-machine Abandoned
  [ "$status" -eq 2 ]
  [[ "$output" == *'invalid step result: Abandoned'* ]]
  run -0 azdo_step_result state-machine
  [ "$output" = Canceled ]
}

@test "exit, stderr, and continueOnError combinations produce grounded results (C-E06-032/033/036)" {
  local claim_ids row_id outcome continue_on_error fail_on_stderr expected_status expected_result
  local source_file
  prepare_run_step

  while IFS='|' read -r claim_ids row_id outcome continue_on_error fail_on_stderr expected_status expected_result; do
    : "$claim_ids"
    source_file="$BATS_TEST_TMPDIR/$row_id.sh"
    case "$outcome" in
      success) printf '%s\n' "printf 'success\\n'" >"$source_file" ;;
      stderr) printf '%s\n' "printf 'stderr-without-newline' >&2" >"$source_file" ;;
      exit) printf '%s\n' 'exit 7' >"$source_file" ;;
      both) printf '%s\n' "printf 'stderr-without-newline' >&2" 'exit 7' >"$source_file" ;;
    esac

    run run_result_step \
      "$row_id" "$source_file" "$continue_on_error" "$fail_on_stderr" 0 10
    [ "$status" -eq "$expected_status" ]
    if [[ "$outcome" = stderr || "$outcome" = both ]]; then
      [[ "$output" == *stderr-without-newline* ]]
    fi
    run -0 azdo_step_result "$row_id"
    [ "$output" = "$expected_result" ]
  done <<'TABLE'
C-E06-032|success|success|false|false|0|Succeeded
C-E06-033|stderr-ignored|stderr|false|false|0|Succeeded
C-E06-033|stderr-fails|stderr|false|true|1|Failed
C-E06-032|exit-fails|exit|false|false|7|Failed
C-E06-032/036|exit-continues|exit|true|false|0|SucceededWithIssues
C-E06-033/036|stderr-continues|stderr|true|true|0|SucceededWithIssues
C-E06-032/033|exit-and-stderr|both|false|true|7|Failed
TABLE
}

@test "failed attempts retry until success in one log node (C-E06-034/035)" {
  local source_file="$BATS_TEST_TMPDIR/retry-success.sh"
  local count_file="$BATS_TEST_TMPDIR/retry-success.count"
  local line retry_warning_count=0 attempt_line_count=0
  prepare_run_step
  azdo__run_step_retry_wait() { return 0; }
  printf '%s\n' \
    'count=0' \
    "[[ ! -f '$count_file' ]] || IFS= read -r count <'$count_file'" \
    'count=$((count + 1))' \
    "printf '%s\\n' \"\$count\" >'$count_file'" \
    'printf "ATTEMPT=%s\\n" "$count"' \
    '((count >= 3)) || exit 9' >"$source_file"

  run -0 run_result_step retry-success "$source_file" false false 2 10

  [ "$(cat "$count_file")" -eq 3 ]
  run -0 azdo_step_result retry-success
  [ "$output" = Succeeded ]
  while IFS= read -r line; do
    [[ "$line" != *'RetryHelper encountered task failure'* ]] || ((retry_warning_count += 1))
    [[ "$line" != ATTEMPT=* ]] || ((attempt_line_count += 1))
  done <"$AZDO_LOG_DIR/retry-success.log"
  [ "$retry_warning_count" -eq 2 ]
  [ "$attempt_line_count" -eq 3 ]
}

@test "failOnStderr failure is retryable and a clean retry succeeds (C-E06-033/035)" {
  local source_file="$BATS_TEST_TMPDIR/retry-stderr.sh"
  local count_file="$BATS_TEST_TMPDIR/retry-stderr.count"
  prepare_run_step
  azdo__run_step_retry_wait() { return 0; }
  printf '%s\n' \
    'count=0' \
    "[[ ! -f '$count_file' ]] || IFS= read -r count <'$count_file'" \
    'count=$((count + 1))' \
    "printf '%s\\n' \"\$count\" >'$count_file'" \
    'if ((count == 1)); then printf stderr-byte >&2; else printf clean-retry; fi' >"$source_file"

  run -0 run_result_step retry-stderr "$source_file" false true 1 10

  [ "$(cat "$count_file")" -eq 2 ]
  [[ "$output" == *stderr-byte*clean-retry* ]]
  run -0 azdo_step_result retry-stderr
  [ "$output" = Succeeded ]
}

@test "exhausted retries preserve Failed before continueOnError downgrade (C-E06-035/036)" {
  local continue_on_error expected_status expected_result row_id source_file count_file
  prepare_run_step
  azdo__run_step_retry_wait() { return 0; }

  while IFS='|' read -r row_id continue_on_error expected_status expected_result; do
    source_file="$BATS_TEST_TMPDIR/$row_id.sh"
    count_file="$BATS_TEST_TMPDIR/$row_id.count"
    printf '%s\n' \
      'count=0' \
      "[[ ! -f '$count_file' ]] || IFS= read -r count <'$count_file'" \
      'count=$((count + 1))' \
      "printf '%s\\n' \"\$count\" >'$count_file'" \
      'exit 9' >"$source_file"

    run run_result_step "$row_id" "$source_file" "$continue_on_error" false 2 10
    [ "$status" -eq "$expected_status" ]
    [ "$(cat "$count_file")" -eq 3 ]
    run -0 azdo_step_result "$row_id"
    [ "$output" = "$expected_result" ]
  done <<'TABLE'
retry-failed|false|9|Failed
retry-continued|true|0|SucceededWithIssues
TABLE
}

@test "retry delay and ten-retry cap match the agent policy (C-E06-031/034)" {
  local source_file="$BATS_TEST_TMPDIR/retry-cap.sh" count_file="$BATS_TEST_TMPDIR/retry-cap.count"
  prepare_run_step

  run -0 azdo__run_step_retry_delay_seconds 0
  [ "$output" -eq 1 ]
  run -0 azdo__run_step_retry_delay_seconds 1
  [ "$output" -eq 4 ]
  run -0 azdo__run_step_retry_delay_seconds 9
  [ "$output" -eq 100 ]

  azdo__run_step_retry_wait() { return 0; }
  printf '%s\n' \
    'count=0' \
    "[[ ! -f '$count_file' ]] || IFS= read -r count <'$count_file'" \
    'count=$((count + 1))' \
    "printf '%s\\n' \"\$count\" >'$count_file'" \
    'exit 5' >"$source_file"

  run run_result_step retry-cap "$source_file" false false 12 30

  [ "$status" -eq 5 ]
  [ "$(cat "$count_file")" -eq 11 ]
  [[ "$output" == *'retryCountOnTaskFailure is limited to 10; requested 12.'* ]]
  run -0 azdo_step_result retry-cap
  [ "$output" = Failed ]
}

@test "run_step timeout kills the process group, records Failed, and does not retry (C-E06-030/035/037)" {
  local source_file="$BATS_TEST_TMPDIR/timeout-step.sh" child_pid
  local pid_file="$BATS_TEST_TMPDIR/timeout-child.pid" late_file="$BATS_TEST_TMPDIR/late"
  local count_file="$BATS_TEST_TMPDIR/timeout.count"
  prepare_run_step
  printf '%s\n' \
    "printf attempt >'$count_file'" \
    'sleep 30 &' \
    'child=$!' \
    "printf '%s' \"\$child\" >'$pid_file'" \
    'wait "$child"' \
    "printf late >'$late_file'" >"$source_file"

  run run_result_step 034 "$source_file" false false 3 1

  [ "$status" -eq 124 ]
  [ "$(cat "$count_file")" = attempt ]
  [ -f "$pid_file" ]
  child_pid="$(cat "$pid_file")"
  run ! kill -0 "$child_pid"
  [ ! -e "$late_file" ]
  [ -f "$AZDO_LOG_DIR/034.log" ]
  run -0 azdo_step_result 034
  [ "$output" = Failed ]
}
