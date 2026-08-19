#!/usr/bin/env bats

bats_require_minimum_version 1.5.0

setup() {
  load helpers/fixture-store.bash
  azdo_emu_load_runtime
  azdo_emu_load_runtime expr.sh
  AZDO_STATE_DIR="$(azdo_emu_scratch_dir state)"
  AZDO_VAR_SCOPE='pipeline'
  export AZDO_STATE_DIR AZDO_VAR_SCOPE
  unset AZDO_OUTPUT_DIR AZDO_STEP_NAME
}

cond_for_later_task() {
  azdo_status_succeeded
}

cond_always() {
  azdo_status_always
}

cond_masked_or_error() {
  azdo_expr_cmp lt num 1 str invalid || true
}

cond_substitution_error() {
  azdo_expr_cmp eq str "$(azdo_expr_format '{2}' only-one)" str expected
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
    --cond cond_always \
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

@test "logging parser finds and normalizes area, action, properties, and message (C-E06-044/046)" {
  local property missing='sentinel'

  azdo_logging_parse_line \
    'prefix ##vso[TaSk.SetVariable variable=first;VARIABLE=last;expression=a=b=c;]value'

  [ "$AZDO_LOGGING_PREFIX" = 'prefix ' ]
  [ "$AZDO_LOGGING_AREA" = task ]
  [ "$AZDO_LOGGING_ACTION" = setvariable ]
  [ "$AZDO_LOGGING_MESSAGE" = value ]
  azdo_logging_property variable property
  [ "$property" = last ]
  azdo_logging_property expression property
  [ "$property" = 'a=b=c' ]
  if azdo_logging_property absent missing; then
    false
  fi
  [ "$missing" = '' ]
}

@test "logging parser decodes task-lib escapes once and in wire order (C-E06-045/047)" {
  local property

  azdo_logging_parse_line \
    '##vso[task.echo value=semi%3Bpercent%AZP25close%5Dline%0Acarriage%0D;double=%AZP253B;]body%3B%5D%0A%AZP25'

  azdo_logging_property value property
  [ "$property" = $'semi;percent%close]line\ncarriage\r' ]
  azdo_logging_property double property
  [ "$property" = '%3B' ]
  [ "$AZDO_LOGGING_MESSAGE" = $'body;]\n%' ]
}

@test "logging stream dispatches recognized commands and suppresses their wire line (C-E06-046)" {
  azdo_logging_dispatch() {
    local variable
    [[ "$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION" = task.echo ]] || return 127
    azdo_logging_property variable variable || return
    printf 'handled:%s:%s\n' "$variable" "$AZDO_LOGGING_MESSAGE"
  }

  run -0 azdo_logging_stream <<'STREAM'
plain-before
trace ##vso[TASK.ECHO variable=name;]hello%0Aworld
plain-after
STREAM

  [ "$output" = $'plain-before\nhandled:name:hello\nworld\nplain-after' ]
}

@test "logging stream warns and preserves unknown or malformed command lines (C-E06-048/049)" {
  run -0 azdo_logging_stream <<'STREAM'
##vso[future.command key=value;]payload%0Aencoded
##vso[missing-close
ordinary
STREAM

  [ "$output" = \
    $'##[warning]Unknown Azure Pipelines logging command \'future.command\'; passing through unchanged.\n##vso[future.command key=value;]payload%0Aencoded\n##[warning]Malformed Azure Pipelines logging command; passing through unchanged.\n##vso[missing-close\nordinary' ]
}

@test "literal newlines remain streaming command boundaries (C-E06-044)" {
  run -0 azdo_logging_stream <<'STREAM'
##vso[task.setvariable variable=broken
;]value
STREAM

  [ "$output" = \
    $'##[warning]Malformed Azure Pipelines logging command; passing through unchanged.\n##vso[task.setvariable variable=broken\n;]value' ]
}

@test "task.setvariable is unavailable to its current task and visible to the next (C-E06-050/051)" {
  local setter="$BATS_TEST_TMPDIR/set-current.sh" observer="$BATS_TEST_TMPDIR/observe-later.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.setvariable variable=late]later-value'" \
    "printf 'CURRENT_MACRO=%s\\n' '\$(late)'" \
    'printf "CURRENT_ENV=%s\n" "${LATE-unset}"' >"$setter"

  run -0 run_test_step set-current "$setter" 10
  [ "$output" = $'CURRENT_MACRO=$(late)\nCURRENT_ENV=unset' ]

  # The runner rematerializes each task environment after the prior command has persisted.
  azdo_env_materialize
  printf '%s\n' 'printf "LATER=%s:%s\n" "$(late)" "$LATE"' >"$observer"
  run -0 run_test_step observe-later "$observer" 10
  [ "$output" = 'LATER=later-value:later-value' ]
}

@test "task.setvariable output writes same-job alias and cross-job store (C-E06-005/052)" {
  local setter="$BATS_TEST_TMPDIR/set-output.sh"
  prepare_run_step
  AZDO_STEP_NAME='publish'
  AZDO_OUTPUT_DIR="$AZDO_STATE_DIR/outputs/Build/build"
  export AZDO_STEP_NAME AZDO_OUTPUT_DIR
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.setvariable variable=sha;isOutput=TrUe]abc123'" >"$setter"

  run -0 run_test_step set-output "$setter" 10
  [ -z "$output" ]
  run -0 azdo_var 'publish.sha'
  [ "$output" = abc123 ]
  run -0 azdo_output Build build 'publish.sha'
  [ "$output" = abc123 ]
  run -0 azdo_var sha
  [ -z "$output" ]
  run -0 azdo_var_meta 'publish.sha'
  [ "$output" = $'secret=false\noutput=true\nreadonly=true\nname=publish.sha' ]
}

@test "task.setvariable honors isReadOnly and Boolean.TryParse defaults (C-E06-006/054)" {
  azdo_logging_parse_line \
    '##vso[task.setvariable variable=locked;isReadOnly= TRUE ;isSecret=not-a-bool;]first'
  azdo_logging_dispatch

  run -0 azdo_var_meta locked
  [ "$output" = $'secret=false\noutput=false\nreadonly=true\nname=locked' ]

  azdo_logging_parse_line '##vso[task.setvariable variable=LOCKED;]second'
  run ! azdo_logging_dispatch
  [ "$status" -eq 1 ]
  [[ "$output" == *"Overwriting readonly variable 'LOCKED' is not permitted."* ]]
  run -0 azdo_var locked
  [ "$output" = first ]
}

@test "task.setvariable secrets are masked immediately and in later step logs (C-E06-053)" {
  local setter="$BATS_TEST_TMPDIR/set-secret.sh" observer="$BATS_TEST_TMPDIR/observe-secret.sh"
  local marker='synthetic[*]?mask-value'
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.setvariable variable=masked;isSecret=true]$marker'" \
    "printf 'CURRENT_SECRET=%s\\n' '$marker'" >"$setter"

  run -0 run_test_step set-secret "$setter" 10
  [ "$output" = 'CURRENT_SECRET=***' ]
  ! grep -F "$marker" "$AZDO_LOG_DIR/set-secret.log"
  run -0 azdo_var_meta masked
  [ "$output" = $'secret=true\noutput=false\nreadonly=false\nname=masked' ]

  printf '%s\n' 'printf "LATER_SECRET=%s\n" "$(masked)"' >"$observer"
  run -0 run_test_step observe-secret "$observer" 10
  [ "$output" = 'LATER_SECRET=***' ]
  ! grep -F "$marker" "$AZDO_LOG_DIR/observe-secret.log"
}

@test "task.setvariable rejects multiline secrets and prevents secret downgrade (C-E06-055/056)" {
  local masked_line
  azdo_logging_parse_line \
    '##vso[task.setvariable variable=sticky;isSecret=true]first-synthetic-value'
  azdo_logging_dispatch
  azdo_logging_parse_line '##vso[task.setvariable variable=sticky]replacement-synthetic-value'
  azdo_logging_dispatch

  run -0 azdo_var_meta sticky
  [ "$output" = $'secret=true\noutput=false\nreadonly=false\nname=sticky' ]
  azdo__mask_line 'value=replacement-synthetic-value' masked_line
  [ "$masked_line" = 'value=***' ]

  azdo_logging_parse_line \
    '##vso[task.setvariable variable=multiline;isSecret=true]first%0Asecond'
  run ! azdo_logging_dispatch
  [ "$status" -eq 1 ]
  [ "$output" = 'Secrets cannot contain multiple lines' ]
  run ! azdo_var_meta multiline
}

@test "task.setsecret masks only later output in the job (C-E06-057)" {
  local source_file="$BATS_TEST_TMPDIR/setsecret.sh" marker='synthetic-derived-secret'
  prepare_run_step
  printf '%s\n' \
    "printf 'BEFORE=%s\\n' '$marker'" \
    "printf '%s\\n' '##vso[task.setsecret]$marker'" \
    "printf 'AFTER=%s\\n' '$marker'" >"$source_file"

  run -0 run_test_step setsecret "$source_file" 10

  [ "$output" = $'BEFORE=synthetic-derived-secret\nAFTER=***' ]
  grep -F 'BEFORE=synthetic-derived-secret' "$AZDO_LOG_DIR/setsecret.log"
  ! grep -F 'AFTER=synthetic-derived-secret' "$AZDO_LOG_DIR/setsecret.log"
}

@test "task.prependpath de-duplicates entries for subsequent tasks only (C-E06-058)" {
  local source_file="$BATS_TEST_TMPDIR/prependpath.sh"
  prepare_run_step
  printf '%s\n' \
    "printf 'CURRENT_HAS_FIRST=%s\\n' \"\${PATH//*\/first-e06*/yes}\"" \
    "printf '%s\\n' '##vso[task.prependpath]/first-e06'" \
    "printf '%s\\n' '##vso[task.prependpath]/second-e06'" \
    "printf '%s\\n' '##vso[task.prependpath]/first-e06'" >"$source_file"

  run -0 run_test_step prependpath "$source_file" 10
  [ "$output" != 'CURRENT_HAS_FIRST=yes' ]

  azdo_env_materialize PATH '/explicit/base'
  [ "$(materialized_env_value PATH)" = '/first-e06:/second-e06:/explicit/base' ]
  [ "$(find "$AZDO_STATE_DIR/path.d" -type f ! -name '.next' | wc -l)" -eq 2 ]
}

@test "task.logissue renders and persists result-neutral counters (C-E06-059/060)" {
  local source_file="$BATS_TEST_TMPDIR/logissue.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.logissue type=warning]synthetic warning'" \
    "printf '%s\\n' '##vso[task.logissue type=ERROR]synthetic error'" \
    "printf '%s\\n' 'ISSUE_STEP_CONTINUED=yes'" >"$source_file"

  run -0 run_test_step logissue "$source_file" 10

  [[ "$output" == *$'\033[1;33m##[warning]synthetic warning\033[0m'* ]]
  [[ "$output" == *$'\033[1;31m##[error]synthetic error\033[0m'* ]]
  [[ "$output" == *'ISSUE_STEP_CONTINUED=yes'* ]]
  run -0 azdo_step_issue_count logissue warning
  [ "$output" -eq 1 ]
  run -0 azdo_step_issue_count logissue error
  [ "$output" -eq 1 ]
  run -0 azdo_step_result logissue
  [ "$output" = Succeeded ]
}

@test "task.complete merges with shell status without stopping the task (C-E06-061)" {
  local row_id command_lines exit_line expected_status expected_result source_file
  prepare_run_step

  while IFS='|' read -r row_id command_lines exit_line expected_status expected_result; do
    source_file="$BATS_TEST_TMPDIR/$row_id.sh"
    printf '%b\n' "$command_lines" "printf 'AFTER_COMPLETE=%s\\n' '$row_id'" "$exit_line" \
      >"$source_file"

    run run_result_step "$row_id" "$source_file" false false 0 10
    [ "$status" -eq "$expected_status" ]
    [[ "$output" == *"AFTER_COMPLETE=$row_id"* ]]
    run -0 azdo_step_result "$row_id"
    [ "$output" = "$expected_result" ]
  done <<'TABLE'
complete-partial|printf '%s\n' '##vso[task.complete result=SucceededWithIssues;]partial'|:|0|SucceededWithIssues
complete-failed|printf '%s\n' '##vso[task.complete result=Failed;]failed'|:|1|Failed
complete-exit|printf '%s\n' '##vso[task.complete result=Succeeded;]success'|exit 7|7|Failed
complete-worst|printf '%s\n' '##vso[task.complete result=Failed;]failed' '##vso[task.complete result=Succeeded;]success'|:|1|Failed
TABLE
}

@test "raw formatting always renders while task.debug follows System.Debug (C-E06-062..065)" {
  local source_file="$BATS_TEST_TMPDIR/formatting.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##[group]group' '##[section]section' '##[command]command'" \
    "printf '%s\\n' '##[warning]warning' '##[error]error' '##[debug]raw debug' '##[endgroup]'" \
    "printf '%s\\n' '##vso[task.debug]task debug off'" >"$source_file"

  run -0 run_test_step formatting-off "$source_file" 10

  [[ "$output" == *$'\033[1;36m##[group]group\033[0m'* ]]
  [[ "$output" == *$'\033[1;35m##[section]section\033[0m'* ]]
  [[ "$output" == *$'\033[1;34m##[command]command\033[0m'* ]]
  [[ "$output" == *$'\033[1;33m##[warning]warning\033[0m'* ]]
  [[ "$output" == *$'\033[1;31m##[error]error\033[0m'* ]]
  [[ "$output" == *$'\033[2;37m##[debug]raw debug\033[0m'* ]]
  [[ "$output" == *$'\033[1;36m##[endgroup]\033[0m'* ]]
  [[ "$output" != *'task debug off'* ]]
  run -0 azdo_step_issue_count formatting-off error
  [ "$output" -eq 0 ]
  run -0 azdo_step_result formatting-off
  [ "$output" = Succeeded ]

  azdo_var_set 'System.Debug' true
  printf '%s\n' "printf '%s\\n' '##vso[task.debug]task debug on'" >"$source_file"
  run -0 run_test_step formatting-on "$source_file" 10
  [[ "$output" == *$'\033[2;37m##[debug]task debug on\033[0m'* ]]
}

@test "run_step routes live output through the logging parser (C-E06-044/049)" {
  local source_file="$BATS_TEST_TMPDIR/logging-step.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[future.command key=value;]payload' 'after-command'" >"$source_file"

  run -0 run_test_step logging-parser "$source_file" 10

  [ "$output" = \
    $'##[warning]Unknown Azure Pipelines logging command \'future.command\'; passing through unchanged.\n##vso[future.command key=value;]payload\nafter-command' ]
  [ "$(cat "$AZDO_LOG_DIR/logging-parser.log")" = "$output" ]
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

@test "failed predecessor skips the default condition while always runs (C-E06-038/039/041/043)" {
  local fail_file="$BATS_TEST_TMPDIR/hard-failure.sh"
  local skipped_file="$BATS_TEST_TMPDIR/default-after-failure.sh"
  local always_file="$BATS_TEST_TMPDIR/always-after-failure.sh"
  local forbidden="$BATS_TEST_TMPDIR/should-not-run"
  prepare_run_step
  printf '%s\n' 'exit 9' >"$fail_file"
  printf "touch '%s'\n" "$forbidden" >"$skipped_file"
  printf '%s\n' "printf 'ALWAYS_RAN\\n'" >"$always_file"

  run run_result_step hard-failure "$fail_file" false false 0 10
  [ "$status" -eq 9 ]
  run -0 azdo_step_result hard-failure
  [ "$output" = Failed ]

  run -0 run_step \
    --id default-after-failure \
    --file "$skipped_file" \
    --display 'default after failure' \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout 10
  [ "$output" = 'Skipping step due to condition evaluation.' ]
  [ ! -e "$forbidden" ]
  run -0 azdo_step_result default-after-failure
  [ "$output" = Skipped ]
  cmp "$AZDO_LOG_DIR/default-after-failure.log" \
    <(printf '%s\n' 'Skipping step due to condition evaluation.')

  run -0 run_step \
    --id always-after-failure \
    --file "$always_file" \
    --cond cond_always \
    --display 'always after failure' \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout 10
  [ "$output" = ALWAYS_RAN ]
  run -0 azdo_step_result always-after-failure
  [ "$output" = Succeeded ]
  run -0 azdo_status_failed
}

@test "SucceededWithIssues keeps implicit and explicit succeeded conditions true (C-E06-039/040/043)" {
  local continued_file="$BATS_TEST_TMPDIR/continued-failure.sh"
  local default_file="$BATS_TEST_TMPDIR/default-after-issues.sh"
  local explicit_file="$BATS_TEST_TMPDIR/explicit-after-issues.sh"
  prepare_run_step
  printf '%s\n' 'exit 7' >"$continued_file"
  printf '%s\n' "printf 'DEFAULT_AFTER_ISSUES\\n'" >"$default_file"
  printf '%s\n' "printf 'EXPLICIT_AFTER_ISSUES\\n'" >"$explicit_file"

  run -0 run_result_step continued-failure "$continued_file" true false 0 10
  run -0 azdo_step_result continued-failure
  [ "$output" = SucceededWithIssues ]
  run -0 azdo_status_succeeded

  run -0 run_step \
    --id default-after-issues \
    --file "$default_file" \
    --display 'default after issues' \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout 10
  [ "$output" = DEFAULT_AFTER_ISSUES ]

  run -0 run_step \
    --id explicit-after-issues \
    --file "$explicit_file" \
    --cond cond_for_later_task \
    --display 'explicit succeeded after issues' \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout 10
  [ "$output" = EXPLICIT_AFTER_ISSUES ]
}

@test "step status helpers read the accumulated result store (C-E06-039/043)" {
  local result always_status canceled_status failed_status succeeded_status either_status
  local result_dir
  prepare_run_step
  result_dir="$(azdo__step_result_dir)"

  while IFS='|' read -r \
    result always_status canceled_status failed_status succeeded_status either_status; do
    rm -f -- "$result_dir/prior"
    [[ "$result" = none ]] || azdo_step_result_set prior "$result"
    run "-$always_status" azdo_status_always
    run "-$canceled_status" azdo_status_canceled
    run "-$failed_status" azdo_status_failed
    run "-$succeeded_status" azdo_status_succeeded
    run "-$either_status" azdo_status_succeededorfailed
  done <<'TABLE'
none|0|1|1|0|0
Succeeded|0|1|1|0|0
SucceededWithIssues|0|1|1|0|0
Failed|0|1|0|1|0
Skipped|0|1|1|0|0
Canceled|0|0|1|1|1
TABLE
}

@test "--no-condition force-runs without resolving the compiled condition function" {
  local fail_file="$BATS_TEST_TMPDIR/fail-before-force.sh"
  local forced_file="$BATS_TEST_TMPDIR/forced.sh"
  prepare_run_step
  printf '%s\n' 'exit 4' >"$fail_file"
  printf '%s\n' "printf 'FORCED\\n'" >"$forced_file"

  run run_result_step fail-before-force "$fail_file" false false 0 10
  [ "$status" -eq 4 ]
  run -0 run_step \
    --id forced \
    --file "$forced_file" \
    --cond missing_compiled_condition \
    --no-condition \
    --display forced \
    --continue-on-error false \
    --fail-on-stderr false \
    --retries 0 \
    --timeout 10
  [ "$output" = FORCED ]
  run -0 azdo_step_result forced
  [ "$output" = Succeeded ]
}

@test "condition errors remain Failed across shell masking contexts (C-E02-143/144, C-E06-042)" {
  local source_file="$BATS_TEST_TMPDIR/condition-error.sh" condition id forbidden
  prepare_run_step

  while IFS='|' read -r id condition; do
    forbidden="$BATS_TEST_TMPDIR/$id-ran"
    printf "touch '%s'\n" "$forbidden" >"$source_file"
    run run_step \
      --id "$id" \
      --file "$source_file" \
      --cond "$condition" \
      --display "$id" \
      --continue-on-error true \
      --fail-on-stderr false \
      --retries 0 \
      --timeout 10
    [ "$status" -eq 2 ]
    [[ "$output" == *"Condition evaluation failed for '$id'"* ]]
    [ ! -e "$forbidden" ]
    run -0 azdo_step_result "$id"
    [ "$output" = Failed ]
  done <<'TABLE'
masked-or|cond_masked_or_error
substitution|cond_substitution_error
TABLE
}
