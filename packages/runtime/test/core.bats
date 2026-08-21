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

prepare_artifact_dirs() {
  AZDO_ARTIFACT_DIR="$BATS_TEST_TMPDIR/.artifacts"
  AZDO_ATTACHMENT_DIR="$BATS_TEST_TMPDIR/logs/attachments"
  export AZDO_ARTIFACT_DIR AZDO_ATTACHMENT_DIR
  mkdir -p "$AZDO_ARTIFACT_DIR" "$AZDO_ATTACHMENT_DIR"
}

dispatch_line() {
  azdo_logging_parse_line "$1" || return
  azdo_logging_dispatch
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

@test "task.prependpath reaches subsequent steps and rejects an empty value (C-E06-057)" {
  local setter="$BATS_TEST_TMPDIR/prepend.sh" observer="$BATS_TEST_TMPDIR/observe-path.sh"
  local empty="$BATS_TEST_TMPDIR/prepend-empty.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.prependpath]/opt/first-tool'" \
    "printf '%s\\n' '##vso[task.prependpath]/opt/second-tool'" \
    'printf "CURRENT_PATH=%s\n" "$PATH"' >"$setter"

  run -0 run_test_step prepend "$setter" 10
  # The emitting task keeps the environment it started with (C-E06-012/057).
  [[ "$output" != *'/opt/first-tool'* ]]

  azdo_env_materialize
  printf '%s\n' 'printf "LATER_PATH=%s\n" "$PATH"' >"$observer"
  run -0 run_test_step observe-path "$observer" 10
  [[ "$output" == LATER_PATH=/opt/second-tool:/opt/first-tool:* ]]

  printf '%s\n' "printf '%s\\n' '##vso[task.prependpath]'" >"$empty"
  run ! run_test_step prepend-empty "$empty" 10
  run -0 azdo_step_result prepend-empty
  [ "$output" = Failed ]
}

@test "task.prependpath orders more than nine entries numerically (C-E06-012/057)" {
  local index
  prepare_run_step
  for ((index = 1; index <= 11; index++)); do
    azdo_logging_parse_line "##vso[task.prependpath]/opt/tool-$index"
    azdo_logging_dispatch
  done

  azdo_env_materialize
  run -0 materialized_env_value PATH
  [[ "$output" == /opt/tool-11:/opt/tool-10:/opt/tool-9:* ]]
}

@test "task.setsecret masks later output only (C-E06-058)" {
  local source_file="$BATS_TEST_TMPDIR/set-secret-command.sh"
  local marker='synthetic-derived-secret-value'
  prepare_run_step
  printf '%s\n' \
    "printf 'BEFORE=%s\\n' '$marker'" \
    "printf '%s\\n' '##vso[task.setsecret]$marker'" \
    "printf 'AFTER=%s\\n' '$marker'" >"$source_file"

  run -0 run_test_step set-secret-command "$source_file" 10
  [ "$output" = $'BEFORE='"$marker"$'\nAFTER=***' ]
  [ "$(cat "$AZDO_LOG_DIR/set-secret-command.log")" = "$output" ]
}

@test "task.complete result precedence follows the agent order (C-E06-059/060/061)" {
  local complete_failed="$BATS_TEST_TMPDIR/complete-failed.sh"
  local complete_succeeded="$BATS_TEST_TMPDIR/complete-succeeded.sh"
  local complete_merge="$BATS_TEST_TMPDIR/complete-merge.sh"
  local complete_invalid="$BATS_TEST_TMPDIR/complete-invalid.sh"
  prepare_run_step

  # task.complete alone fails a step that exited zero.
  printf '%s\n' "printf '%s\\n' '##vso[task.complete result=Failed;]DONE'" >"$complete_failed"
  run ! run_result_step complete-failed "$complete_failed" false false 0 10
  run -0 azdo_step_result complete-failed
  [ "$output" = Failed ]
  # The result must come from the merge, not from the command itself failing to parse.
  ! grep -qF 'Unable to process command' "$AZDO_LOG_DIR/complete-failed.log"
  ! grep -qF "valid result value" "$AZDO_LOG_DIR/complete-failed.log"
  run -0 azdo_step_issues complete-failed
  [ "$output" = $'errors=0\nwarnings=0' ]

  # A nonzero exit assigns Failed over an earlier task.complete result=Succeeded.
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.complete result=succeeded;]DONE'" \
    'exit 3' >"$complete_succeeded"
  run -3 run_result_step complete-succeeded "$complete_succeeded" false false 0 10
  run -0 azdo_step_result complete-succeeded
  [ "$output" = Failed ]

  # Worst-wins merge: a later Succeeded cannot undo an earlier Failed.
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.complete result=Failed;]first'" \
    "printf '%s\\n' '##vso[task.complete result=Succeeded;]second'" >"$complete_merge"
  run ! run_result_step complete-merge "$complete_merge" false false 0 10
  run -0 azdo_step_result complete-merge
  [ "$output" = Failed ]
  ! grep -qF 'Unable to process command' "$AZDO_LOG_DIR/complete-merge.log"

  # continueOnError downgrades the completed failure last.
  run -0 run_result_step complete-downgrade "$complete_failed" true false 0 10
  run -0 azdo_step_result complete-downgrade
  [ "$output" = SucceededWithIssues ]

  # A missing or unparseable result is a failed command.
  printf '%s\n' "printf '%s\\n' '##vso[task.complete]no result property'" >"$complete_invalid"
  run ! run_result_step complete-invalid "$complete_invalid" false false 0 10
  run -0 azdo_step_result complete-invalid
  [ "$output" = Failed ]
  [[ "$(cat "$AZDO_LOG_DIR/complete-invalid.log")" == *"Command doesn't have valid result value."* ]]
}

@test "task.complete state resets between retry attempts (C-E06-035/061)" {
  local source_file="$BATS_TEST_TMPDIR/complete-retry.sh"
  local count_file="$BATS_TEST_TMPDIR/complete-retry.count"
  prepare_run_step
  azdo__run_step_retry_wait() { return 0; }
  printf '%s\n' \
    'count=0' \
    "[[ ! -f '$count_file' ]] || IFS= read -r count <'$count_file'" \
    'count=$((count + 1))' \
    "printf '%s\\n' \"\$count\" >'$count_file'" \
    '((count >= 2)) ||' \
    "  printf '%s\\n' '##vso[task.complete result=Failed;]first attempt'" >"$source_file"

  run -0 run_result_step complete-retry "$source_file" false false 1 10
  [ "$(cat "$count_file")" -eq 2 ]
  run -0 azdo_step_result complete-retry
  [ "$output" = Succeeded ]
}

@test "task.logissue counts issues without changing the step result (C-E06-062/063)" {
  local source_file="$BATS_TEST_TMPDIR/logissue.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.logissue type=error]Something went very wrong.'" \
    "printf '%s\\n' '##vso[task.logissue type=ERROR;sourcepath=main.cs;linenumber=1;code=100;]Second error.'" \
    "printf '%s\\n' '##vso[task.logissue type=warning]Could be a problem.'" \
    "printf '%s\\n' '##vso[task.logissue]missing type'" >"$source_file"

  run -0 run_test_step logissue "$source_file" 10
  [ "$output" = $'##[error]Something went very wrong.\n##[error]Second error.\n##[warning]Could be a problem.\n##[warning]Can'"'"'t create TaskIssue from logging event.' ]

  # The doc's "exit 1 is optional" tip and AddIssue agree: issues alone leave the step successful.
  run -0 azdo_step_result logissue
  [ "$output" = Succeeded ]
  run -0 azdo_step_issues logissue
  [ "$output" = $'errors=2\nwarnings=2' ]
}

@test "task.issue is an alias dispatching to the same handler (C-E06-068)" {
  local source_file="$BATS_TEST_TMPDIR/issue-alias.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.issue type=error]Aliased error.'" \
    "printf '%s\\n' '##vso[task.issue type=warning]Aliased warning.'" >"$source_file"

  run -0 run_test_step issuealias "$source_file" 10
  # Same tagged rendering as task.logissue -- one executor behind both names.
  [ "$output" = $'##[error]Aliased error.\n##[warning]Aliased warning.' ]

  # And the same counters: the alias is not an unknown command falling through to the warning path.
  run -0 azdo_step_issues issuealias
  [ "$output" = $'errors=1\nwarnings=1' ]
  run -0 azdo_step_result issuealias
  [ "$output" = Succeeded ]
}

@test "task.logissue with an unexpected type fails the command but not the stream (C-E06-062/064)" {
  local source_file="$BATS_TEST_TMPDIR/logissue-bad-type.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.logissue type=fatal]boom'" \
    "printf '%s\\n' 'after-the-failed-command'" >"$source_file"

  run ! run_result_step logissue-bad-type "$source_file" false false 0 10
  # Output after a failing command must survive on both the console and in the log: the handler
  # status must not propagate out of the reader (C-E06-064).
  [[ "$output" == *after-the-failed-command* ]]
  [[ "$output" == *"Unable to process command"* ]]
  run -0 azdo_step_result logissue-bad-type
  [ "$output" = Failed ]
  grep -qxF 'after-the-failed-command' "$AZDO_LOG_DIR/logissue-bad-type.log"
  grep -qF 'issue type fatal is not an expected issue type.' \
    "$AZDO_LOG_DIR/logissue-bad-type.log"
  grep -qxF "##[error]Unable to process command 'task.logissue' successfully." \
    "$AZDO_LOG_DIR/logissue-bad-type.log"
}

@test "a rejected command reports the command name, never the wire line (C-E06-055/064)" {
  local source_file="$BATS_TEST_TMPDIR/rejected-secret.sh"
  local marker='synthetic-rejected-secret-value'
  prepare_run_step
  # The multiline guard rejects before registration, so the masker downstream of dispatch has
  # never seen this value: the failure message must not carry it.
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.setvariable variable=multiline;isSecret=true]$marker%0Asecond'" \
    "printf '%s\\n' 'still-running'" >"$source_file"

  run ! run_result_step rejected-secret "$source_file" false false 0 10
  [[ "$output" == *still-running* ]]
  [[ "$output" != *"$marker"* ]]
  run -0 azdo_step_result rejected-secret
  [ "$output" = Failed ]
  ! grep -qF "$marker" "$AZDO_LOG_DIR/rejected-secret.log"
  grep -qxF "##[error]Unable to process command 'task.setvariable' successfully." \
    "$AZDO_LOG_DIR/rejected-secret.log"
}

@test "command state is per step and per job scope (C-E06-063)" {
  local resolved
  AZDO_STEP_ID=step-030
  resolved="$(azdo__command_state_dir)"
  [ "$resolved" = "$AZDO_STATE_DIR/commands/step-030" ]

  # run_step scopes it further so concurrent steps cannot reset each other's counters.
  prepare_run_step
  printf '%s\n' "printf '%s\\n' '##vso[task.logissue type=warning]scoped'" \
    >"$BATS_TEST_TMPDIR/scoped.sh"
  run -0 run_test_step scoped "$BATS_TEST_TMPDIR/scoped.sh" 10
  [ -f "$AZDO_STATE_DIR/commands/pipeline/scoped/warnings" ]
  run -0 azdo_step_issues scoped
  [ "$output" = $'errors=0\nwarnings=1' ]
}

@test "the debug channel is gated on System.Debug (C-E06-065)" {
  local source_file="$BATS_TEST_TMPDIR/debug-channel.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##vso[task.debug]verbose detail'" \
    "printf '%s\\n' '##vso[task.setprogress value=40;]halfway'" \
    "printf '%s\\n' '##vso[task.setsecret]'" \
    "printf '%s\\n' 'plain output'" >"$source_file"

  run -0 run_test_step debug-off "$source_file" 10
  [ "$output" = 'plain output' ]

  azdo_var_set 'System.Debug' 'TRUE'
  azdo_env_materialize
  run -0 run_test_step debug-on "$source_file" 10
  [ "$output" = $'##[debug]verbose detail\n##[debug]task.setprogress ignored (value=40): no local timeline record.\n##[debug]Processed: ##vso[task.setprogress value=40;]halfway\n##[debug]Processed: ##vso[task.setsecret]\nplain output' ]
}

@test "raw ##[debug] lines stay in the log and are console-gated (docs/06 §5 decision 36)" {
  local source_file="$BATS_TEST_TMPDIR/debug-tag.sh"
  prepare_run_step
  printf '%s\n' \
    "printf '%s\\n' '##[debug]echoed by the script'" \
    "printf '%s\\n' 'plain output'" >"$source_file"

  run -0 run_test_step debug-tag-off "$source_file" 10
  [ "$output" = 'plain output' ]
  grep -qxF '##[debug]echoed by the script' "$AZDO_LOG_DIR/debug-tag-off.log"

  azdo_var_set 'System.Debug' 'true'
  azdo_env_materialize
  run -0 run_test_step debug-tag-on "$source_file" 10
  [ "$output" = $'##[debug]echoed by the script\nplain output' ]
}

@test "formatting commands render with ANSI only when color is enabled (C-E06-066)" {
  local plain
  plain=$'##[group]Beginning of a group\n##[warning]Warning message\n##[error]Error message\n##[section]Start of a section\n##[command]Command-line being run\n##[endgroup]\nordinary line'

  AZDO_COLOR=never
  run -0 azdo_render_stream <<<"$plain"
  [ "$output" = "$plain" ]

  AZDO_COLOR=always
  run -0 azdo_render_stream <<<"$plain"
  [ "$output" = $'\033[1;36mBeginning of a group\033[0m\n\033[33mWarning message\033[0m\n\033[31mError message\033[0m\n\033[1mStart of a section\033[0m\n\033[34mCommand-line being run\033[0m\nordinary line' ]

  # An unknown tag and a bare ##vso line are not formatting commands.
  run -0 azdo_render_stream <<<$'##[unknown]left alone\n##vso[task.setvariable variable=x]y'
  [ "$output" = $'##[unknown]left alone\n##vso[task.setvariable variable=x]y' ]
}

@test "merging task results reproduces the agent's worst-wins order (C-E06-060)" {
  run -0 azdo_merge_task_results '' Succeeded
  [ "$output" = Succeeded ]
  run -0 azdo_merge_task_results Succeeded SucceededWithIssues
  [ "$output" = SucceededWithIssues ]
  run -0 azdo_merge_task_results Failed Succeeded
  [ "$output" = Failed ]
  run -0 azdo_merge_task_results SucceededWithIssues Failed
  [ "$output" = Failed ]
  # A result worse than Failed is sticky.
  run -0 azdo_merge_task_results Canceled Failed
  [ "$output" = Canceled ]
  run -0 azdo_merge_task_results Skipped Canceled
  [ "$output" = Skipped ]
  run ! azdo_merge_task_results Succeeded Abandoned
  [ "$status" -eq 2 ]
}

@test "artifact.upload of a file lands under the artifact name and records the container folder (C-E06-069/071/072)" {
  local payload="$BATS_TEST_TMPDIR/testresult.trx"
  prepare_artifact_dirs
  printf 'RESULT\n' >"$payload"

  # The doc page's own example: the two levels deliberately differ.
  run -0 dispatch_line "##vso[artifact.upload containerfolder=testresult;artifactname=uploadedresult]$payload"

  [ "$(cat "$AZDO_ARTIFACT_DIR/uploadedresult/testresult.trx")" = RESULT ]
  # The container folder is the coordinate inside the container, never a directory level of the
  # downloaded tree (C-E06-072, docs/06 §5 decision 37).
  [ ! -e "$AZDO_ARTIFACT_DIR/uploadedresult/testresult" ]
  [ "$(cat "$AZDO_ARTIFACT_DIR/.meta/uploadedresult")" = $'type=container\ncontainerfolder=testresult' ]
}

@test "artifact.upload of a directory contributes its contents, not its own name (C-E06-071)" {
  local source="$BATS_TEST_TMPDIR/drop"
  prepare_artifact_dirs
  mkdir -p "$source/nested/deeper"
  printf 'TOP\n' >"$source/top.txt"
  printf 'DEEP\n' >"$source/nested/deeper/deep.txt"

  run -0 dispatch_line "##vso[artifact.upload artifactname=MyDrop]$source"

  [ "$(cat "$AZDO_ARTIFACT_DIR/MyDrop/top.txt")" = TOP ]
  [ "$(cat "$AZDO_ARTIFACT_DIR/MyDrop/nested/deeper/deep.txt")" = DEEP ]
  [ ! -e "$AZDO_ARTIFACT_DIR/MyDrop/drop" ]
  # An absent containerfolder defaults to the artifact name (C-E06-069).
  [ "$(cat "$AZDO_ARTIFACT_DIR/.meta/MyDrop")" = $'type=container\ncontainerfolder=MyDrop' ]
}

@test "artifact.upload requires an artifact name and an existing path (C-E06-069/070)" {
  local payload="$BATS_TEST_TMPDIR/payload.txt"
  prepare_artifact_dirs
  printf 'X\n' >"$payload"

  run ! dispatch_line "##vso[artifact.upload containerfolder=drop]$payload"
  [[ "$output" == *'Artifact Name is required.'* ]]

  run ! dispatch_line "##vso[artifact.upload artifactname=drop]"
  [[ "$output" == *'Artifact location is required.'* ]]

  run ! dispatch_line "##vso[artifact.upload artifactname=drop]$BATS_TEST_TMPDIR/absent"
  [[ "$output" == *'Path does not exist: '* ]]

  [ ! -e "$AZDO_ARTIFACT_DIR/drop" ]
}

@test "artifact.upload of an empty directory warns and succeeds without failing the step (C-E06-070)" {
  local source_file="$BATS_TEST_TMPDIR/upload-empty.sh" empty="$BATS_TEST_TMPDIR/empty-drop"
  prepare_run_step
  prepare_artifact_dirs
  mkdir -p "$empty/only-a-subdirectory"

  printf '%s\n' "printf '%s\\n' '##vso[artifact.upload artifactname=EmptyDrop]$empty'" >"$source_file"
  run -0 run_test_step upload-empty "$source_file" 10

  # context.Warning is AddIssue(Warning): a counted warning issue and a tagged line, and the
  # command still returns successfully.
  [ "$output" = "##[warning]Directory '$empty' is empty. Nothing will be added to build artifact 'EmptyDrop'." ]
  run -0 azdo_step_result upload-empty
  [ "$output" = Succeeded ]
  [ ! -e "$AZDO_ARTIFACT_DIR/EmptyDrop" ]
}

@test "artifact.associate is accepted and recorded without copying bytes (C-E06-073)" {
  prepare_artifact_dirs
  run -0 dispatch_line '##vso[artifact.associate type=filepath;artifactname=MyFileShareDrop]\\MyShare\MyDropLocation'
  [ "$(cat "$AZDO_ARTIFACT_DIR/.meta/MyFileShareDrop")" = $'type=filepath\nassociated=\\\\MyShare\\MyDropLocation' ]
  [ ! -e "$AZDO_ARTIFACT_DIR/MyFileShareDrop" ]

  run ! dispatch_line '##vso[artifact.associate artifactname=NoType]#/1/build'
  [[ "$output" == *'Artifact Type is required.'* ]]
  run ! dispatch_line '##vso[artifact.associate type=container]#/1/build'
  [[ "$output" == *'Artifact Name is required.'* ]]
}

@test "the attachment family is one implementation with three name/type derivations (C-E06-074/075/079)" {
  local summary="$BATS_TEST_TMPDIR/testsummary.md" extra="$BATS_TEST_TMPDIR/additionalfile.log"
  prepare_artifact_dirs
  printf '# Summary\n' >"$summary"
  printf 'LOGLINE\n' >"$extra"

  run -0 dispatch_line "##vso[task.uploadsummary]$summary"
  run -0 dispatch_line "##vso[task.uploadfile]$extra"
  run -0 dispatch_line "##vso[task.addattachment type=myattachmenttype;name=myattachmentname;]$extra"

  # uploadsummary is the documented shorthand for exactly this addattachment, so both spellings
  # land in the same place — the identity is locally observable (C-E06-079).
  [ "$(cat "$AZDO_ATTACHMENT_DIR/Distributedtask.Core.Summary/testsummary.md")" = '# Summary' ]
  [ "$(cat "$AZDO_ATTACHMENT_DIR/FileAttachment/additionalfile.log")" = LOGLINE ]
  [ "$(cat "$AZDO_ATTACHMENT_DIR/myattachmenttype/myattachmentname")" = LOGLINE ]

  run -0 dispatch_line "##vso[task.addattachment type=Distributedtask.Core.Summary;name=testsummary.md;]$summary"
  [ "$(cat "$AZDO_ATTACHMENT_DIR/Distributedtask.Core.Summary/testsummary.md")" = '# Summary' ]
}

@test "attachments require type, name and an existing file, and reject path segments (C-E06-074/075/076)" {
  local extra="$BATS_TEST_TMPDIR/attach.log"
  prepare_artifact_dirs
  printf 'X\n' >"$extra"

  run ! dispatch_line "##vso[task.addattachment name=n]$extra"
  [[ "$output" == *"attachment type is not provided."* ]]
  run ! dispatch_line "##vso[task.addattachment type=t]$extra"
  [[ "$output" == *"attachment name is not provided."* ]]
  run ! dispatch_line "##vso[task.addattachment type=t;name=n]$BATS_TEST_TMPDIR/absent"
  [[ "$output" == *'does not exist on disk.'* ]]
  # A directory is accepted by artifact.upload but never by an attachment (C-E06-075).
  run ! dispatch_line "##vso[task.addattachment type=t;name=n]$BATS_TEST_TMPDIR"
  [[ "$output" == *'does not exist on disk.'* ]]

  # The agent rejects Path.GetInvalidFileNameChars(); the local guard is narrower but sufficient,
  # because both values become path segments (C-E06-076).
  run ! dispatch_line "##vso[task.addattachment type=..;name=n]$extra"
  [[ "$output" == *'invalid variable-store path segment'* ]]

  # Empty message is rejected by the two upload commands with their own message, before the helper.
  run ! dispatch_line '##vso[task.uploadfile]'
  [[ "$output" == *'Cannot upload file because file location is not specified.'* ]]
  run ! dispatch_line '##vso[task.uploadsummary]'
  [[ "$output" == *'Cannot upload summary file, summary file location is not specified.'* ]]
}

@test "build.uploadlog and the deprecated build.uploadsummary attach under derived names (C-E06-077/078)" {
  local log="$BATS_TEST_TMPDIR/msbuild.log" summary="$BATS_TEST_TMPDIR/report.md"
  prepare_artifact_dirs
  printf 'BUILT\n' >"$log"
  printf 'REPORT\n' >"$summary"

  run -0 dispatch_line "##vso[build.uploadlog]$log"
  # Fixed name, not the file's own (C-E06-077).
  [ "$(cat "$AZDO_ATTACHMENT_DIR/Log/CustomToolLog")" = BUILT ]

  run -0 dispatch_line "##vso[build.uploadsummary]$summary"
  [ "$(cat "$AZDO_ATTACHMENT_DIR/Distributedtask.Core.Summary/CustomMarkDownSummary-report.md")" = REPORT ]

  run ! dispatch_line '##vso[build.uploadlog]'
  [[ "$output" == *"Log file path is not provided or file doesn't exist: ''"* ]]
  run ! dispatch_line "##vso[build.uploadsummary]$BATS_TEST_TMPDIR/absent.md"
  [[ "$output" == *"Markdown summary file path is not provided or file doesn't exist:"* ]]
}

@test "build.updatebuildnumber overwrites the read-only name and reaches later steps (C-E06-080/081)" {
  local setter="$BATS_TEST_TMPDIR/set-number.sh" observer="$BATS_TEST_TMPDIR/read-number.sh"
  # Build.BuildNumber is a member of Constants.Variables.ReadOnlyVariables, so seed it as the
  # runner would; task.setvariable must still be refused on it.
  azdo_var_set 'Build.BuildNumber' '20260821.1' false false true
  prepare_run_step

  printf '%s\n' "printf '%s\\n' '##vso[build.updatebuildnumber]  my-new-build-number  '" >"$setter"
  run -0 run_test_step set-number "$setter" 10
  run -0 azdo_step_result set-number
  [ "$output" = Succeeded ]

  # Not trimmed, unlike addbuildtag (C-E06-080/082).
  [ "$(azdo_var 'Build.BuildNumber')" = '  my-new-build-number  ' ]
  # The name stays read-only: Variables.Set propagates the flag, it does not clear it (C-E06-081).
  run -0 azdo_var_meta 'Build.BuildNumber'
  [[ "$output" == *'readonly=true'* ]]

  azdo_env_materialize
  printf '%s\n' 'printf "SEEN=[%s]\n" "$BUILD_BUILDNUMBER"' >"$observer"
  run -0 run_test_step read-number "$observer" 10
  [ "$output" = 'SEEN=[  my-new-build-number  ]' ]
}

@test "build.updatebuildnumber requires a value while task.setvariable stays refused (C-E06-004/080/081)" {
  prepare_artifact_dirs
  azdo_var_set 'Build.BuildNumber' 'original' false false true

  run ! dispatch_line '##vso[build.updatebuildnumber]'
  [[ "$output" == *'Build number is required.'* ]]
  [ "$(azdo_var 'Build.BuildNumber')" = original ]

  # The read-only rule is enforced in the setvariable handler, not in the store, which is precisely
  # why updatebuildnumber can bypass it (C-E06-081).
  run ! dispatch_line '##vso[task.setvariable variable=Build.BuildNumber]hijacked'
  [ "$(azdo_var 'Build.BuildNumber')" = original ]
}

@test "build.addbuildtag trims, de-duplicates case-insensitively and rejects blanks (C-E06-082)" {
  prepare_artifact_dirs

  run -0 dispatch_line '##vso[build.addbuildtag]  last_scanned-2026  '
  run -0 dispatch_line '##vso[build.addbuildtag]LAST_SCANNED-2026'
  run -0 dispatch_line '##vso[build.addbuildtag]release'
  # Server-side tags are a set compared OrdinalIgnoreCase (C-E06-082).
  [ "$(cat "$AZDO_STATE_DIR/tags")" = $'last_scanned-2026\nrelease' ]

  run ! dispatch_line '##vso[build.addbuildtag]'
  [[ "$output" == *'Build tag is required.'* ]]
  run ! dispatch_line '##vso[build.addbuildtag]   '
  [[ "$output" == *'Build tag is required.'* ]]
  [ "$(cat "$AZDO_STATE_DIR/tags")" = $'last_scanned-2026\nrelease' ]
}

@test "a failing artifact command is an error issue that fails the step (C-E06-064/069)" {
  local source_file="$BATS_TEST_TMPDIR/bad-upload.sh"
  prepare_run_step
  prepare_artifact_dirs
  printf '%s\n' \
    "printf '%s\\n' '##vso[artifact.upload containerfolder=drop]/tmp/whatever'" \
    "printf '%s\\n' 'still-running'" >"$source_file"

  run ! run_result_step bad-upload "$source_file" false false 0 10
  [[ "$output" == *still-running* ]]
  # The message names area.action, never the wire line - the T03 convention (C-E06-064).
  grep -qxF "##[error]Unable to process command 'artifact.upload' successfully." \
    "$AZDO_LOG_DIR/bad-upload.log"
  run -0 azdo_step_result bad-upload
  [ "$output" = Failed ]
}
