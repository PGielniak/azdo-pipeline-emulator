#!/usr/bin/env bash
# @azdo-emu/runtime — core library. This file is sourced, never executed.

azdo_emu_runtime_version() {
  printf '%s\n' '0.0.0'
}

# E06-S01-T04 — variable state is deliberately file-backed.  Values never travel through shell
# quoting or command substitution on write, so newline, quote and Unicode data remain byte-for-byte
# intact (C-E06-003).  The generated runner sets AZDO_STATE_DIR and AZDO_VAR_SCOPE for each job.

azdo__state_dir() {
  if [[ -z "${AZDO_STATE_DIR:-}" ]]; then
    printf '%s\n' 'AZDO_STATE_DIR must be set before using the variable store' >&2
    return 2
  fi
  printf '%s\n' "$AZDO_STATE_DIR"
}

azdo__valid_store_segment() {
  case "$1" in
    '' | '.' | '..' | *'/'* | *$'\n'* | *$'\r'*)
      printf 'invalid variable-store path segment: %s\n' "$1" >&2
      return 2
      ;;
  esac
}

azdo__canonical_var_name() {
  azdo__valid_store_segment "$1" || return
  # Azure Pipelines' variable dictionary uses OrdinalIgnoreCase (C-E06-003), while filesystem
  # names are normally case-sensitive. Preserve the value bytes separately from the folded key.
  LC_ALL=C printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

azdo__scope_dir() {
  local state_dir scope
  state_dir="$(azdo__state_dir)" || return
  scope="${1:-${AZDO_VAR_SCOPE:-pipeline}}"
  azdo__valid_store_segment "$scope" || return
  printf '%s/vars/%s\n' "$state_dir" "$scope"
}

azdo__var_path() {
  local scope_dir key
  scope_dir="$(azdo__scope_dir "${2:-}")" || return
  key="$(azdo__canonical_var_name "$1")" || return
  printf '%s/%s\n' "$scope_dir" "$key"
}

azdo__meta_flag_is_true() {
  local meta_path="$1" flag="$2" line
  [[ -f "$meta_path" ]] || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" = "$flag=true" ]] && return 0
  done <"$meta_path"
  return 1
}

azdo__validate_bool() {
  case "$2" in
    true | false) ;;
    *)
      printf '%s must be true or false, got: %s\n' "$1" "$2" >&2
      return 2
      ;;
  esac
}

azdo__write_var() {
  local name="$1" value="$2" secret="$3" output="$4" readonly="$5" scope="$6"
  local var_path meta_path var_dir value_tmp meta_tmp
  var_path="$(azdo__var_path "$name" "$scope")" || return
  meta_path="$var_path.meta"
  var_dir="${var_path%/*}"

  mkdir -p "$var_dir" || return

  if azdo__meta_flag_is_true "$meta_path" readonly; then
    # Run 539 showed that hosted agents reject the second command before it changes the first
    # value, rather than issuing the legacy warning and overwriting it (C-E06-004, C-E06-006).
    printf "##[error]Overwriting readonly variable '%s' is not permitted.\n" "$name" >&2
    return 1
  fi

  # A secret variable cannot be downgraded by a later non-secret write; the replacement value must
  # remain out of automatic environments and be registered with the masker (C-E06-056).
  if azdo__meta_flag_is_true "$meta_path" secret; then
    secret=true
  fi

  value_tmp="$(mktemp "$var_dir/.value.XXXXXX")" || return
  meta_tmp="$(mktemp "$var_dir/.meta.XXXXXX")" || {
    rm -f -- "$value_tmp"
    return
  }
  printf '%s' "$value" >"$value_tmp" || {
    rm -f -- "$value_tmp" "$meta_tmp"
    return
  }
  printf 'secret=%s\noutput=%s\nreadonly=%s\nname=%s\n' "$secret" "$output" "$readonly" "$name" >"$meta_tmp" || {
    rm -f -- "$value_tmp" "$meta_tmp"
    return
  }
  mv -f -- "$value_tmp" "$var_path" || {
    rm -f -- "$value_tmp" "$meta_tmp"
    return
  }
  mv -f -- "$meta_tmp" "$meta_path"
}

# azdo_var <name> [scope]
#
# Prints a variable verbatim.  A missing variable is the shell-backend Null-to-empty fallback, so
# it has successful status and no output.  The optional scope is for runner internals and tests;
# emitted expressions use the current AZDO_VAR_SCOPE.
azdo_var() {
  local var_path
  (($# >= 1 && $# <= 2)) || {
    printf '%s\n' 'usage: azdo_var <name> [scope]' >&2
    return 2
  }
  var_path="$(azdo__var_path "$1" "${2:-}")" || return
  if [[ -f "$var_path" ]]; then
    cat -- "$var_path"
  fi
}

# azdo_var_meta <name> [scope]
#
# Prints the sidecar metadata (secret/output/readonly/name) for a present variable.
azdo_var_meta() {
  local var_path
  (($# >= 1 && $# <= 2)) || {
    printf '%s\n' 'usage: azdo_var_meta <name> [scope]' >&2
    return 2
  }
  var_path="$(azdo__var_path "$1" "${2:-}")" || return
  cat -- "$var_path.meta"
}

# azdo_var_set <name> <value> [secret] [output] [readonly] [scope]
#
# The normal call shape is the two-argument form used by emitted runtime expressions.  Flag values
# are explicit true/false strings to keep the on-disk metadata inspectable. Output variables are
# stored under the agent-faithful same-job <step>.<name> alias and additionally in AZDO_OUTPUT_DIR
# for cross-job reads (C-E06-002, C-E06-005).
azdo_var_set() {
  (($# >= 2 && $# <= 6)) || {
    printf '%s\n' 'usage: azdo_var_set <name> <value> [secret] [output] [readonly] [scope]' >&2
    return 2
  }

  local name="$1" value="$2" secret="${3:-false}" output="${4:-false}" readonly="${5:-false}"
  local scope="${6:-${AZDO_VAR_SCOPE:-pipeline}}" step output_dir output_path
  azdo__validate_bool secret "$secret" || return
  azdo__validate_bool output "$output" || return
  azdo__validate_bool readonly "$readonly" || return

  if [[ "$output" = true ]]; then
    step="${AZDO_STEP_NAME:-}"
    output_dir="${AZDO_OUTPUT_DIR:-}"
    if [[ -z "$step" || -z "$output_dir" ]]; then
      printf '%s\n' 'AZDO_STEP_NAME and AZDO_OUTPUT_DIR must be set for an output variable' >&2
      return 2
    fi
    azdo__valid_store_segment "$step" || return
    azdo__valid_store_segment "$name" || return
    azdo__write_var "$step.$name" "$value" "$secret" true true "$scope" || return
    mkdir -p "$output_dir" || return
    output_path="$output_dir/$step.$name"
    printf '%s' "$value" >"$output_path"
    return
  fi

  azdo__write_var "$name" "$value" "$secret" false "$readonly" "$scope"
}

# azdo_var_scope_copy <source-scope> <target-scope>
#
# A job starts with a fresh copy of its parent scope.  Refusing a non-empty target prevents an
# accidental carry-over from a previous job/run from being mistaken for a pipeline variable.
azdo_var_scope_copy() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_var_scope_copy <source-scope> <target-scope>' >&2
    return 2
  }

  local source_dir target_dir
  source_dir="$(azdo__scope_dir "$1")" || return
  target_dir="$(azdo__scope_dir "$2")" || return
  [[ "$source_dir" != "$target_dir" ]] || {
    printf '%s\n' 'source and target variable scopes must differ' >&2
    return 2
  }
  if [[ -e "$target_dir" && ! -d "$target_dir" ]]; then
    printf 'variable scope is not a directory: %s\n' "$2" >&2
    return 2
  fi
  if [[ -d "$target_dir" && -n "$(ls -A "$target_dir")" ]]; then
    printf 'target variable scope is not empty: %s\n' "$2" >&2
    return 2
  fi
  mkdir -p "$target_dir" || return
  [[ -d "$source_dir" ]] || return 0
  local source_file
  for source_file in "$source_dir"/*; do
    [[ -e "$source_file" ]] || continue
    cp -p -- "$source_file" "$target_dir/" || return
  done
}

# azdo_output <stage> <job> <step.variable>
#
# Reads an output value verbatim.  A missing output maps to an empty shell value, matching the
# compiled expression backend's Null-to-empty fallback (docs/02 §6).
azdo_output() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo_output <stage> <job> <step.variable>' >&2
    return 2
  }
  azdo__valid_store_segment "$1" || return
  azdo__valid_store_segment "$2" || return
  azdo__valid_store_segment "$3" || return

  local state_dir output_path
  state_dir="$(azdo__state_dir)" || return
  output_path="$state_dir/outputs/$1/$2/$3"
  if [[ -f "$output_path" ]]; then
    cat -- "$output_path"
  fi
}

# azdo_step_result_set <step-id> <result>
# azdo_step_result <step-id>
#
# Result files use the five-state Azure task vocabulary. The job runner may point
# AZDO_RESULT_DIR at state/results/<stage>/<job>; the scope-based fallback keeps the API usable by
# standalone generated step scripts and tests (C-E06-037).
azdo__valid_step_result() {
  case "$1" in
    Succeeded | SucceededWithIssues | Failed | Skipped | Canceled) ;;
    *)
      printf 'invalid step result: %s\n' "$1" >&2
      return 2
      ;;
  esac
}

azdo__step_result_dir() {
  local state_dir scope
  if [[ -n "${AZDO_RESULT_DIR:-}" ]]; then
    printf '%s\n' "$AZDO_RESULT_DIR"
    return 0
  fi
  state_dir="$(azdo__state_dir)" || return
  scope="${AZDO_VAR_SCOPE:-pipeline}"
  azdo__valid_store_segment "$scope" || return
  printf '%s/results/%s\n' "$state_dir" "$scope"
}

azdo_step_result_set() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_step_result_set <step-id> <result>' >&2
    return 2
  }
  azdo__valid_store_segment "$1" || return
  azdo__valid_step_result "$2" || return

  local result_dir result_path result_tmp old_umask
  result_dir="$(azdo__step_result_dir)" || return
  mkdir -p "$result_dir" || return
  result_path="$result_dir/$1"
  old_umask="$(umask)"
  umask 077
  result_tmp="$(mktemp "$result_dir/.result.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s\n' "$2" >"$result_tmp" || {
    rm -f -- "$result_tmp"
    return
  }
  mv -f -- "$result_tmp" "$result_path"
}

azdo_step_result() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_step_result <step-id>' >&2
    return 2
  }
  azdo__valid_store_segment "$1" || return

  local result_dir result_path
  result_dir="$(azdo__step_result_dir)" || return
  result_path="$result_dir/$1"
  if [[ -f "$result_path" ]]; then
    cat -- "$result_path"
  fi
}

# azdo_step_issue_count <step-id> <error|warning>
#
# Issue counts are timeline metadata rather than result inputs (C-E06-059/060). Keeping them beside
# the job's result files makes them available to the later run-summary task without letting the
# status-context glob mistake a counter for a step result.
azdo_step_issue_count() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_step_issue_count <step-id> <error|warning>' >&2
    return 2
  }
  azdo__valid_store_segment "$1" || return
  case "$2" in
    error | warning) ;;
    *)
      printf 'invalid step issue type: %s\n' "$2" >&2
      return 2
      ;;
  esac

  local result_dir count_path count=0
  result_dir="$(azdo__step_result_dir)" || return
  count_path="$result_dir/.issues/$1/$2"
  if [[ -f "$count_path" ]]; then
    IFS= read -r count <"$count_path" || [[ -n "$count" ]] || return
    [[ "$count" =~ ^[0-9]+$ ]] || {
      printf 'invalid step issue count: %s\n' "$count_path" >&2
      return 2
    }
  fi
  printf '%s\n' "$count"
}

# Step-scoped StatusContext for compiled condition functions. The hosted agent initializes
# Agent.JobStatus to Succeeded, then changes it only when a prior step is Failed or
# SucceededWithIssues; a false-condition Skipped result leaves it unchanged (C-E06-039/043).
# Canceled is accepted for the job-runner cancellation seam even though ordinary step completion
# does not merge that result into Agent.JobStatus.
azdo__job_status_from_results() {
  local result_dir result_path result_name result status=Succeeded
  result_dir="$(azdo__step_result_dir)" || return
  [[ -d "$result_dir" ]] || {
    printf '%s\n' "$status"
    return 0
  }

  for result_path in "$result_dir"/*; do
    [[ -f "$result_path" ]] || continue
    result_name="${result_path##*/}"
    # A resumed force-run must not use this step's stale result as its own predecessor status.
    [[ "$result_name" != "${AZDO_CONDITION_STEP_ID:-}" ]] || continue
    IFS= read -r result <"$result_path" || [[ -n "$result" ]] || {
      printf 'empty step result file: %s\n' "$result_path" >&2
      return 2
    }
    azdo__valid_step_result "$result" || return
    case "$result" in
      Canceled)
        status=Canceled
        break
        ;;
      Failed) status=Failed ;;
      SucceededWithIssues)
        [[ "$status" = Succeeded ]] && status=SucceededWithIssues
        ;;
      Succeeded | Skipped) ;;
    esac
  done
  printf '%s\n' "$status"
}

azdo_status_always() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_status_always' >&2
    return 2
  }
  return 0
}

azdo_status_canceled() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_status_canceled' >&2
    return 2
  }
  local status
  status="$(azdo__job_status_from_results)" || return
  [[ "$status" = Canceled ]]
}

azdo_status_failed() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_status_failed' >&2
    return 2
  }
  local status
  status="$(azdo__job_status_from_results)" || return
  [[ "$status" = Failed ]]
}

azdo_status_succeeded() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_status_succeeded' >&2
    return 2
  }
  local status
  status="$(azdo__job_status_from_results)" || return
  [[ "$status" = Succeeded || "$status" = SucceededWithIssues ]]
}

azdo_status_succeededorfailed() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_status_succeededorfailed' >&2
    return 2
  }
  local status
  status="$(azdo__job_status_from_results)" || return
  [[ "$status" = Succeeded || "$status" = SucceededWithIssues || "$status" = Failed ]]
}

# E06-S01-T03 — the generated runner translates manifest.json's env array into shell metadata
# before loading user values:
#
#   AZDO_MANIFEST_ENV=('PUBLIC_NAME=false' 'SECRET_NAME=true')
#
# Keeping that tiny, generated projection beside the runner avoids requiring jq (or any other JSON
# parser) in the dependency-free output project. Unknown names are public by default; every
# generated `.env.example` name has a manifest entry, so this applies only to user-added values.

azdo__manifest_env_validate() {
  local declaration entry entry_name entry_flag canonical seen_index
  local -a seen_names=()

  if ! declaration="$(declare -p AZDO_MANIFEST_ENV 2>/dev/null)"; then
    return 0
  fi
  if [[ "$declaration" != declare\ -*a*\ AZDO_MANIFEST_ENV=* ]]; then
    printf '%s\n' 'AZDO_MANIFEST_ENV must be an indexed array of NAME=true|false entries' >&2
    return 2
  fi

  for entry in "${AZDO_MANIFEST_ENV[@]}"; do
    entry_name="${entry%=*}"
    entry_flag="${entry##*=}"
    if [[ ! "$entry_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] ||
      [[ "$entry_flag" != true && "$entry_flag" != false ]]; then
      printf 'invalid AZDO_MANIFEST_ENV entry: %s\n' "$entry" >&2
      return 2
    fi
    canonical="$(azdo__canonical_var_name "$entry_name")" || return
    for ((seen_index = 0; seen_index < ${#seen_names[@]}; seen_index++)); do
      if [[ "${seen_names[$seen_index]}" = "$canonical" ]]; then
        printf 'duplicate manifest environment name: %s\n' "$entry_name" >&2
        return 2
      fi
    done
    seen_names+=("$canonical")
  done
}

azdo__manifest_env_secret() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__manifest_env_secret <name> <destination-variable>' >&2
    return 2
  }

  local wanted entry entry_name entry_flag canonical
  wanted="$(azdo__canonical_var_name "$1")" || return
  printf -v "$2" '%s' false
  declare -p AZDO_MANIFEST_ENV >/dev/null 2>&1 || return 0

  for entry in "${AZDO_MANIFEST_ENV[@]}"; do
    entry_name="${entry%=*}"
    entry_flag="${entry##*=}"
    canonical="$(azdo__canonical_var_name "$entry_name")" || return
    if [[ "$canonical" = "$wanted" ]]; then
      printf -v "$2" '%s' "$entry_flag"
      return 0
    fi
  done
}

azdo__absolute_env_path() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__absolute_env_path <path> <destination-variable>' >&2
    return 2
  }
  [[ -f "$1" && -r "$1" ]] || {
    printf 'environment file is not readable: %s\n' "$1" >&2
    return 2
  }

  if [[ "$1" = /* ]]; then
    printf -v "$2" '%s' "$1"
  else
    printf -v "$2" '%s/%s' "$PWD" "$1"
  fi
}

# azdo_env_load <base-env-file> [overlay-env-file] [scope]
#
# Loads direct Bash NAME=value assignments from the base file and then the optional overlay into
# the variable store. Both files are sourced by one non-interactive child Bash, so normal assignment
# quoting/expansion applies and overlay expressions can see base values (C-E06-013..017). The child
# protects the runner's own shell state; `.env` is still trusted shell input because command and
# process substitutions can have external side effects. `export NAME=value` is deliberately outside
# the documented contract and is not registered.
azdo_env_load() {
  (($# >= 1 && $# <= 3)) || {
    printf '%s\n' 'usage: azdo_env_load <base-env-file> [overlay-env-file] [scope]' >&2
    return 2
  }

  local base_path overlay_path='' scope="${3:-${AZDO_VAR_SCOPE:-pipeline}}"
  local state_dir temp_dir trace_file old_umask declarations declaration attributes
  local declaration_name declaration_rhs parsed_value captured_name secret index status load_status=0
  local -a declaration_names=() declaration_values=()

  azdo__manifest_env_validate || return
  azdo__absolute_env_path "$1" base_path || return
  if [[ -n "${2:-}" ]]; then
    azdo__absolute_env_path "$2" overlay_path || return
  fi
  azdo__valid_store_segment "$scope" || return

  state_dir="$(azdo__state_dir)" || return
  temp_dir="$state_dir/env-loader"
  mkdir -p "$temp_dir" || return
  old_umask="$(umask)"
  umask 077
  trace_file="$(mktemp "$temp_dir/.assignments.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"

  # DEBUG fires once per parsed simple assignment, after Bash has assembled multiline quoted
  # input but before it executes. It therefore records real assignment keys without mistaking a
  # `LOOKS_LIKE=value` line inside a multiline string for another variable. `declare -p` is Bash's
  # own lossless shell quoting of the final values; fd 3 keeps it separate from command-substitution
  # output, and the parent evaluates only that Bash-generated quoting (C-E06-014..016).
  if declarations="$({
    BASH_ENV=/dev/null "$BASH" --noprofile --norc -s -- "$base_path" "$overlay_path" \
      4>"$trace_file" 3>&1 1>&2 <<'AZDO_ENV_LOADER'
set -aT
trap 'if [[ $BASH_COMMAND =~ ^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*)= ]]; then printf "%s\0" "${BASH_REMATCH[1]}" >&4; fi' DEBUG
. "$1" || exit $?
if [[ -n "$2" ]]; then
  . "$2" || exit $?
fi
trap - DEBUG
set +T
declare -p >&3
AZDO_ENV_LOADER
  })"; then
    status=0
  else
    status=$?
  fi
  if ((status != 0)); then
    rm -f -- "$trace_file"
    printf 'failed to load environment file(s) with bash (status %s)\n' "$status" >&2
    return "$status"
  fi

  while IFS= read -r declaration || [[ -n "$declaration" ]]; do
    [[ "$declaration" == declare\ -*\ *=* ]] || continue
    attributes="${declaration#declare -}"
    attributes="${attributes%% *}"
    declaration_name="${declaration%%=*}"
    declaration_name="${declaration_name##* }"
    [[ "$declaration_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || continue
    if [[ "$attributes" = *a* || "$attributes" = *A* ]]; then
      continue
    fi
    declaration_rhs="${declaration#*=}"
    # shellcheck disable=SC2294 # RHS is emitted by this same Bash's `declare -p`, not user text.
    eval "parsed_value=$declaration_rhs"
    declaration_names+=("$declaration_name")
    declaration_values+=("$parsed_value")
  done <<<"$declarations"

  while IFS= read -r -d '' captured_name; do
    for ((index = 0; index < ${#declaration_names[@]}; index++)); do
      if [[ "${declaration_names[$index]}" = "$captured_name" ]]; then
        if azdo__manifest_env_secret "$captured_name" secret; then
          :
        else
          load_status=$?
          break 2
        fi
        if azdo_var_set \
          "$captured_name" "${declaration_values[$index]}" "$secret" false false "$scope"; then
          :
        else
          load_status=$?
          break 2
        fi
        break
      fi
    done
  done <"$trace_file"
  rm -f -- "$trace_file"
  return "$load_status"
}

# E06-S01-T05 — step environments are assembled into AZDO_STEP_ENV as KEY=value arguments for
# `env`. This avoids eval/sourcing and lets values contain whitespace, quotes, equals signs, and
# newlines. A future run_step passes the array directly: env -- "${AZDO_STEP_ENV[@]}" <command>.
#
# The order is significant. Explicit task entries are expanded first, then public variables are
# assigned into the same key set, and PATH prepends are applied last (C-E06-007..012).

azdo__read_file_exact() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__read_file_exact <path> <destination-variable>' >&2
    return 2
  }

  local content
  # A non-newline sentinel prevents command substitution from stripping trailing newlines. Remove
  # exactly the sentinel afterwards; any identical byte already in the value remains untouched.
  content="$(
    cat -- "$1" || exit
    printf '\034'
  )" || return
  content="${content%$'\034'}"
  printf -v "$2" '%s' "$content"
}

azdo__env_assign() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__env_assign <name> <value>' >&2
    return 2
  }
  case "$1" in
    '' | *'='*)
      printf 'invalid environment-variable name: %s\n' "$1" >&2
      return 2
      ;;
  esac

  local index
  for ((index = 0; index < ${#AZDO_STEP_ENV_KEYS[@]}; index++)); do
    if [[ "${AZDO_STEP_ENV_KEYS[$index]}" = "$1" ]]; then
      AZDO_STEP_ENV_VALUES[index]="$2"
      return 0
    fi
  done
  AZDO_STEP_ENV_KEYS+=("$1")
  AZDO_STEP_ENV_VALUES+=("$2")
}

azdo__env_value() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__env_value <name> <destination-variable>' >&2
    return 2
  }

  local index
  for ((index = 0; index < ${#AZDO_STEP_ENV_KEYS[@]}; index++)); do
    if [[ "${AZDO_STEP_ENV_KEYS[$index]}" = "$1" ]]; then
      printf -v "$2" '%s' "${AZDO_STEP_ENV_VALUES[$index]}"
      return 0
    fi
  done
  return 1
}

# E06-S02-T01 has two deliberately separate expansion phases. Before each step the agent
# recursively recalculates the variable dictionary; it then applies VarUtil's non-recursive scan to
# each task value (C-E06-022..024). The recursive helpers below model the first phase lazily for a
# matched variable. The scanner skips inserted bytes, but after an unmatched opener it advances only
# past the '$', which allows an inner opener in text such as $(a$(b)) to be found.

azdo__macro_variable_recursive() {
  (($# == 6)) || {
    printf '%s\n' \
      'usage: azdo__macro_variable_recursive <name> <value-variable> <secret-variable> <scope> <stack> <depth>' >&2
    return 2
  }

  local name="$1" value_destination="$2" secret_destination="$3" scope="$4" stack="$5" depth="$6"
  local canonical var_path raw_value next_stack nested_text nested_has_secret own_secret=false
  if ! canonical="$(azdo__canonical_var_name "$name" 2>/dev/null)"; then
    return 1
  fi
  if ! var_path="$(azdo__var_path "$name" "$scope" 2>/dev/null)" || [[ ! -f "$var_path" ]]; then
    return 1
  fi

  # Variables.RecalculateExpanded keeps the original top-level value when a graph contains a cycle
  # or exceeds the agent's 50-level limit. Status 3/4 lets the top-level lookup make that choice.
  [[ "$stack" != *$'\n'"$canonical"$'\n'* ]] || return 3
  ((depth < 50)) || return 4

  azdo__read_file_exact "$var_path" raw_value || return
  if azdo__meta_flag_is_true "$var_path.meta" secret; then
    own_secret=true
  fi
  next_stack="$stack$canonical"$'\n'
  azdo__macro_scan \
    "$raw_value" nested_text nested_has_secret "$scope" "$next_stack" "$((depth + 1))" recursive || return
  if [[ "$nested_has_secret" = true ]]; then
    own_secret=true
  fi
  printf -v "$value_destination" '%s' "$nested_text"
  printf -v "$secret_destination" '%s' "$own_secret"
}

azdo__macro_preexpanded_value() {
  (($# == 4)) || {
    printf '%s\n' \
      'usage: azdo__macro_preexpanded_value <name> <value-variable> <secret-variable> <scope>' >&2
    return 2
  }

  local name="$1" value_destination="$2" secret_destination="$3" scope="$4"
  local var_path raw_value resolved_text resolved_has_secret status raw_is_secret=false
  if ! var_path="$(azdo__var_path "$name" "$scope" 2>/dev/null)" || [[ ! -f "$var_path" ]]; then
    return 1
  fi
  azdo__read_file_exact "$var_path" raw_value || return
  if azdo__meta_flag_is_true "$var_path.meta" secret; then
    raw_is_secret=true
  fi

  if azdo__macro_variable_recursive \
    "$name" resolved_text resolved_has_secret "$scope" $'\n' 0; then
    printf -v "$value_destination" '%s' "$resolved_text"
    printf -v "$secret_destination" '%s' "$resolved_has_secret"
    return 0
  else
    status=$?
  fi

  case "$status" in
    3)
      printf "##[warning]Unable to expand variable '%s'. A cyclical reference was detected.\n" "$name" >&2
      ;;
    4)
      printf "##[warning]Unable to expand variable '%s'. The max expansion depth (50) was exceeded.\n" \
        "$name" >&2
      ;;
    *) return "$status" ;;
  esac
  printf -v "$value_destination" '%s' "$raw_value"
  printf -v "$secret_destination" '%s' "$raw_is_secret"
}

azdo__macro_scan() {
  (($# >= 6 && $# <= 7)) || {
    printf '%s\n' \
      'usage: azdo__macro_scan <value> <value-variable> <secret-variable> <scope> <stack> <depth> [lookup-mode]' >&2
    return 2
  }

  local remaining="$1" value_destination="$2" secret_destination="$3" scope="$4" stack="$5" depth="$6"
  local lookup_mode="${7:-recursive}" assembled='' aggregate_secret=false
  local before after_open macro_name after_close replacement replacement_has_secret status
  # shellcheck disable=SC2016 # This is the literal Azure macro opener, not shell substitution.
  local macro_open='$('

  while [[ "$remaining" == *"$macro_open"*')'* ]]; do
    before="${remaining%%"$macro_open"*}"
    after_open="${remaining#*"$macro_open"}"
    macro_name="${after_open%%)*}"
    after_close="${after_open#*)}"

    if [[ "$lookup_mode" = preexpanded ]]; then
      if azdo__macro_preexpanded_value \
        "$macro_name" replacement replacement_has_secret "$scope"; then
        status=0
      else
        status=$?
      fi
    else
      if azdo__macro_variable_recursive \
        "$macro_name" replacement replacement_has_secret "$scope" "$stack" "$depth"; then
        status=0
      else
        status=$?
      fi
    fi
    if ((status == 0)); then
      assembled+="$before$replacement"
      if [[ "$replacement_has_secret" = true ]]; then
        aggregate_secret=true
      fi
      remaining="$after_close"
      continue
    fi
    if ((status != 1)); then
      return "$status"
    fi

    # Preserve the unmatched candidate, but advance by one character from the opener exactly as
    # VarUtil does. Keeping the '(' in `remaining` lets a later nested '$(' still be discovered.
    assembled+="$before\$"
    remaining="($after_open"
  done

  assembled+="$remaining"
  printf -v "$value_destination" '%s' "$assembled"
  printf -v "$secret_destination" '%s' "$aggregate_secret"
}

azdo__expand_value() {
  (($# >= 2 && $# <= 3)) || {
    printf '%s\n' 'usage: azdo__expand_value <value> <destination-variable> [scope]' >&2
    return 2
  }

  local input="$1" destination="$2" scope="${3:-${AZDO_VAR_SCOPE:-pipeline}}"
  local expanded_result ignored_secret
  azdo__valid_store_segment "$scope" || return

  # The target scan uses the already-expanded variable view but does not recurse into bytes inserted
  # into the target itself (C-E06-019/022). Each successful lookup below supplies that expanded view.
  azdo__macro_scan "$input" expanded_result ignored_secret "$scope" $'\n' 0 preexpanded || return
  [[ "$ignored_secret" = true || "$ignored_secret" = false ]] || return 2
  printf -v "$destination" '%s' "$expanded_result"
}

azdo__expand_env_value() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__expand_env_value <value> <destination-variable>' >&2
    return 2
  }
  azdo__expand_value "$1" "$2"
}

# azdo_expand_macros <file>
#
# Expands a step file just before execution and prints the private temporary file path. Secret
# variables participate in replacement, so mktemp's mode and a restrictive umask are intentional.
azdo_expand_macros() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_expand_macros <file>' >&2
    return 2
  }
  [[ -f "$1" && -r "$1" ]] || {
    printf 'step file is not readable: %s\n' "$1" >&2
    return 2
  }

  local scope="${AZDO_VAR_SCOPE:-pipeline}" source_value expanded_value agent_temp agent_temp_secret steps_dir
  local expanded_file old_umask
  azdo__read_file_exact "$1" source_value || return
  azdo__expand_value "$source_value" expanded_value "$scope" || return
  if ! azdo__macro_preexpanded_value \
    'Agent.TempDirectory' agent_temp agent_temp_secret "$scope" || [[ -z "$agent_temp" ]]; then
    printf '%s\n' 'Agent.TempDirectory must be present and non-empty before expanding a step file' >&2
    return 2
  fi
  [[ "$agent_temp_secret" = true || "$agent_temp_secret" = false ]] || return 2

  steps_dir="$agent_temp/steps"
  mkdir -p "$steps_dir" || return
  old_umask="$(umask)"
  umask 077
  expanded_file="$(mktemp "$steps_dir/.expanded.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  if ! printf '%s' "$expanded_value" >"$expanded_file"; then
    rm -f -- "$expanded_file"
    return 1
  fi
  printf '%s\n' "$expanded_file"
}

azdo__var_environment_metadata() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__var_environment_metadata <meta-path> <name-variable> <secret-variable>' >&2
    return 2
  }

  local line metadata_name='' metadata_secret=''
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      name=*) metadata_name="${line#name=}" ;;
      secret=*) metadata_secret="${line#secret=}" ;;
    esac
  done <"$1"
  if [[ -z "$metadata_name" || ("$metadata_secret" != true && "$metadata_secret" != false) ]]; then
    printf 'invalid variable metadata: %s\n' "$1" >&2
    return 2
  fi
  printf -v "$2" '%s' "$metadata_name"
  printf -v "$3" '%s' "$metadata_secret"
}

azdo__env_name() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__env_name <variable-name> <destination-variable>' >&2
    return 2
  }

  local formatted="${1//./_}"
  formatted="${formatted// /_}"
  formatted="$(LC_ALL=C printf '%s' "$formatted" | LC_ALL=C tr '[:lower:]' '[:upper:]')"
  printf -v "$2" '%s' "$formatted"
}

azdo__add_public_vars_to_environment() {
  local scope_dir var_path meta_path stored_name stored_secret env_name value recalculated_secret
  scope_dir="$(azdo__scope_dir)" || return
  [[ -d "$scope_dir" ]] || return 0

  # The agent enumerates a ConcurrentDictionary and specifies no winner when two public names
  # collapse to one key. This loop deliberately promises only last assignment, not which source
  # name is last (C-E06-011).
  for var_path in "$scope_dir"/*; do
    [[ -f "$var_path" && "$var_path" != *.meta ]] || continue
    meta_path="$var_path.meta"
    [[ -f "$meta_path" ]] || {
      printf 'missing variable metadata: %s\n' "$meta_path" >&2
      return 2
    }
    azdo__var_environment_metadata "$meta_path" stored_name stored_secret || return
    [[ "$stored_secret" = false ]] || continue
    azdo__env_name "$stored_name" env_name || return
    azdo__macro_preexpanded_value \
      "$stored_name" value recalculated_secret "${AZDO_VAR_SCOPE:-pipeline}" || return
    # RecalculateExpanded propagates secrecy through a matched variable reference. This prevents a
    # nominally public `derived=$(secret)` variable from leaking the secret into the automatic task
    # environment while still permitting an explicit env mapping (C-E06-009/023).
    [[ "$recalculated_secret" = false ]] || continue
    azdo__env_assign "$env_name" "$value" || return
  done
}

azdo__add_prepend_path_to_environment() {
  local state_dir path_dir path_file path_entry existing base_path new_path
  local -a entries=() retained=()
  state_dir="$(azdo__state_dir)" || return
  path_dir="$state_dir/path.d"
  [[ -d "$path_dir" ]] || return 0

  # path.d names carry an increasing prefix. Processing oldest to newest and prepending each one
  # produces the agent's reversed/newest-first order (C-E06-012). A repeated entry replaces its
  # older occurrence, matching TaskPrepandPathCommand's RemoveAll-then-Add behavior.
  local LC_ALL=C
  for path_file in "$path_dir"/*; do
    [[ -f "$path_file" ]] || continue
    azdo__read_file_exact "$path_file" path_entry || return
    [[ -n "$path_entry" ]] || {
      printf 'empty PATH prepend entry: %s\n' "$path_file" >&2
      return 2
    }
    retained=()
    for existing in "${entries[@]}"; do
      [[ "$existing" = "$path_entry" ]] || retained+=("$existing")
    done
    entries=("${retained[@]}" "$path_entry")
  done
  ((${#entries[@]} > 0)) || return 0

  if ! azdo__env_value PATH base_path; then
    base_path="${PATH:-}"
  fi
  new_path="$base_path"
  for path_entry in "${entries[@]}"; do
    if [[ -n "$new_path" ]]; then
      new_path="$path_entry:$new_path"
    else
      new_path="$path_entry"
    fi
  done
  azdo__env_assign PATH "$new_path"
}

azdo__refresh_step_env() {
  AZDO_STEP_ENV=()
  local index
  for ((index = 0; index < ${#AZDO_STEP_ENV_KEYS[@]}; index++)); do
    AZDO_STEP_ENV+=("${AZDO_STEP_ENV_KEYS[$index]}=${AZDO_STEP_ENV_VALUES[$index]}")
  done
}

# azdo_env_materialize [<explicit-name> <explicit-value> ...]
#
# Populates AZDO_STEP_ENV. Explicit values support the task's normal macro mapping form, including
# secrets; secrets are never added by the automatic public-variable pass (C-E06-009). Public
# variables intentionally run second and overwrite an explicit key on collision (C-E06-010).
# shellcheck disable=SC2120 # Most callers pass explicit pairs; run_step also needs the empty form.
azdo_env_materialize() {
  (($# % 2 == 0)) || {
    printf '%s\n' 'usage: azdo_env_materialize [<explicit-name> <explicit-value> ...]' >&2
    return 2
  }

  AZDO_STEP_ENV_KEYS=()
  AZDO_STEP_ENV_VALUES=()
  AZDO_STEP_ENV=()
  local env_name expanded_value
  while (($# > 0)); do
    env_name="$1"
    azdo__expand_env_value "$2" expanded_value || return
    azdo__env_assign "$env_name" "$expanded_value" || return
    shift 2
  done
  azdo__add_public_vars_to_environment || return
  azdo__add_prepend_path_to_environment || return
  azdo__refresh_step_env
}

# E06-S04-T01/T02/T05 — logging commands are parsed from physical output lines. The globals below form
# the dispatch seam for command handlers. Indexed key/value arrays keep the generated runtime
# compatible with the same Bash versions as the rest of this file.

azdo__logging_fold() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__logging_fold <value> <destination-variable>' >&2
    return 2
  }
  local folded
  folded="$(LC_ALL=C printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')" || return
  printf -v "$2" '%s' "$folded"
}

azdo__logging_unescape() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__logging_unescape <value> <destination-variable>' >&2
    return 2
  }

  local decoded="$1"
  # Decode the structural tokens before percent. This is deliberately one pass: decoding percent
  # first would turn `%AZP253B` into `%3B` and then incorrectly decode it a second time (C-E06-047).
  decoded="${decoded//%3B/;}"
  decoded="${decoded//%0D/$'\r'}"
  decoded="${decoded//%0A/$'\n'}"
  decoded="${decoded//%5D/]}"
  decoded="${decoded//%AZP25/%}"
  printf -v "$2" '%s' "$decoded"
}

# azdo_logging_parse_line <line>
#
# Returns 0 for a parsed command, 1 for an ordinary line, and 2 for malformed text containing the
# logging-command prefix. On success it populates AZDO_LOGGING_{RAW_LINE,PREFIX,AREA,ACTION,MESSAGE}
# plus parallel AZDO_LOGGING_PROPERTY_KEYS/VALUES arrays. Area/action and property lookup are
# case-insensitive, matching the agent dictionaries (C-E06-046).
azdo_logging_parse_line() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_logging_parse_line <line>' >&2
    return 2
  }

  # shellcheck disable=SC2034 # Public parse result consumed by generated/future command handlers.
  AZDO_LOGGING_RAW_LINE="$1"
  # shellcheck disable=SC2034 # Public parse result consumed by generated/future command handlers.
  AZDO_LOGGING_PREFIX=''
  AZDO_LOGGING_AREA=''
  AZDO_LOGGING_ACTION=''
  # shellcheck disable=SC2034 # Public parse result consumed by generated/future command handlers.
  AZDO_LOGGING_MESSAGE=''
  AZDO_LOGGING_PROPERTY_KEYS=()
  AZDO_LOGGING_PROPERTY_VALUES=()

  local marker='##vso[' remainder command_info command_name properties area action
  local property_fragment property_key property_value decoded_value more_properties
  [[ "$1" = *"$marker"* ]] || return 1

  # shellcheck disable=SC2034 # Public parse result consumed by generated/future command handlers.
  AZDO_LOGGING_PREFIX="${1%%"$marker"*}"
  remainder="${1#*"$marker"}"
  [[ "$remainder" = *']'* ]] || return 2
  command_info="${remainder%%]*}"
  remainder="${remainder#*]}"

  if [[ "$command_info" = *' '* ]]; then
    command_name="${command_info%% *}"
    properties="${command_info#* }"
  else
    command_name="$command_info"
    properties=''
  fi
  [[ "$command_name" = *.* ]] || return 2
  area="${command_name%%.*}"
  action="${command_name#*.}"
  [[ -n "$area" && -n "$action" && "$action" != *.* ]] || return 2
  azdo__logging_fold "$area" AZDO_LOGGING_AREA || return
  azdo__logging_fold "$action" AZDO_LOGGING_ACTION || return
  azdo__logging_unescape "$remainder" AZDO_LOGGING_MESSAGE || return

  while [[ -n "$properties" ]]; do
    if [[ "$properties" = *';'* ]]; then
      property_fragment="${properties%%;*}"
      properties="${properties#*;}"
      more_properties=true
    else
      property_fragment="$properties"
      properties=''
      more_properties=false
    fi

    # The agent ignores empty/malformed property fragments instead of rejecting the whole command.
    # A valid task-lib producer always writes non-empty `key=value;` fragments (C-E06-045/046).
    if [[ -n "$property_fragment" && "$property_fragment" = *'='* ]]; then
      property_key="${property_fragment%%=*}"
      property_value="${property_fragment#*=}"
      if [[ -n "$property_key" && -n "$property_value" ]]; then
        azdo__logging_unescape "$property_value" decoded_value || return
        AZDO_LOGGING_PROPERTY_KEYS+=("$property_key")
        AZDO_LOGGING_PROPERTY_VALUES+=("$decoded_value")
      fi
    fi
    [[ "$more_properties" = true ]] || break
  done
}

# azdo_logging_property <name> <destination-variable>
#
# Returns the last property with this case-insensitive name. Last-write lookup reproduces the
# agent dictionary when a producer repeats a property under the same or different casing.
azdo_logging_property() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_logging_property <name> <destination-variable>' >&2
    return 2
  }

  local wanted candidate index
  azdo__logging_fold "$1" wanted || return
  for ((index = ${#AZDO_LOGGING_PROPERTY_KEYS[@]} - 1; index >= 0; index--)); do
    azdo__logging_fold "${AZDO_LOGGING_PROPERTY_KEYS[$index]}" candidate || return
    if [[ "$candidate" = "$wanted" ]]; then
      printf -v "$2" '%s' "${AZDO_LOGGING_PROPERTY_VALUES[$index]}"
      return 0
    fi
  done
  printf -v "$2" '%s' ''
  return 1
}

# azdo_mask_register <value>
#
# Store masker inputs outside shell variables so registration in the logging-parser subprocess is
# visible to the downstream mask filter and to later steps. Empty values are ignored exactly as in
# TaskCommandHelper.AddSecret (C-E06-053). E06-S06-T01 owns the broader initial-secret and
# cross-line hardening pass; this seam provides the immediate task.setvariable behavior required
# here.
azdo_mask_register() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_mask_register <value>' >&2
    return 2
  }
  [[ -n "$1" ]] || return 0

  local state_dir mask_dir mask_tmp mask_path old_umask
  state_dir="$(azdo__state_dir)" || return
  mask_dir="$state_dir/masks"
  mkdir -p "$mask_dir" || return
  old_umask="$(umask)"
  umask 077
  mask_tmp="$(mktemp "$mask_dir/.mask.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s' "$1" >"$mask_tmp" || {
    rm -f -- "$mask_tmp"
    return
  }
  mask_path="$mask_dir/mask.${mask_tmp##*.}"
  mv -- "$mask_tmp" "$mask_path"
}

azdo__mask_line() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__mask_line <line> <destination-variable>' >&2
    return 2
  }

  local state_dir mask_dir mask_file secret mask_result="$1" index other swap
  local -a mask_files=() secrets=()
  state_dir="$(azdo__state_dir)" || return
  mask_dir="$state_dir/masks"
  if [[ -d "$mask_dir" ]]; then
    shopt -s nullglob
    mask_files=("$mask_dir"/mask.*)
    shopt -u nullglob
  fi
  for mask_file in "${mask_files[@]}"; do
    secret=''
    IFS= read -r secret <"$mask_file" || [[ -n "$secret" ]] || continue
    [[ -n "$secret" ]] && secrets+=("$secret")
  done

  # Mask longer registered values first so an overlapping shorter value cannot expose the suffix
  # of a longer secret. Each replacement still matches only the complete registered value.
  for ((index = 0; index < ${#secrets[@]}; index++)); do
    for ((other = index + 1; other < ${#secrets[@]}; other++)); do
      if ((${#secrets[$other]} > ${#secrets[$index]})); then
        swap="${secrets[$index]}"
        secrets[index]="${secrets[$other]}"
        secrets[other]="$swap"
      fi
    done
    mask_result="${mask_result//"${secrets[$index]}"/***}"
  done
  printf -v "$2" '%s' "$mask_result"
}

# shellcheck disable=SC2120 # This stream filter intentionally accepts no arguments.
azdo_mask_stream() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_mask_stream' >&2
    return 2
  }

  local line masked
  while IFS= read -r line || [[ -n "$line" ]]; do
    azdo__mask_line "$line" masked || return
    printf '%s\n' "$masked"
  done
}

azdo__logging_bool_property() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__logging_bool_property <name> <destination-variable>' >&2
    return 2
  }

  local value
  if ! azdo_logging_property "$1" value; then
    printf -v "$2" '%s' false
    return 0
  fi
  if [[ "$value" =~ ^[[:space:]]*[Tt][Rr][Uu][Ee][[:space:]]*$ ]]; then
    printf -v "$2" '%s' true
  else
    # Boolean.TryParse also leaves the flag false for `false` and unparseable input (C-E06-054).
    printf -v "$2" '%s' false
  fi
}

# Raw formatting messages are a separate protocol from ##vso worker commands (C-E06-062). The
# hosted UI owns collapsibility; a plain terminal keeps the complete marker visible and adds ANSI
# styling so group boundaries and severities remain inspectable (C-E06-065).
azdo__logging_format_line() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__logging_format_line <line>' >&2
    return 2
  }
  [[ "$1" = '##['*']'* ]] || return 1

  local tag="${1#'##['}" color
  tag="${tag%%]*}"
  case "$tag" in
    group | endgroup) color=$'\033[1;36m' ;;
    section) color=$'\033[1;35m' ;;
    command) color=$'\033[1;34m' ;;
    warning) color=$'\033[1;33m' ;;
    error) color=$'\033[1;31m' ;;
    debug) color=$'\033[2;37m' ;;
    *) return 1 ;;
  esac
  printf '%s%s%s\n' "$color" "$1" $'\033[0m'
}

azdo__logging_task_setsecret() {
  # The helper ignores empty values, matching the agent handler (C-E06-057).
  azdo_mask_register "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_task_prependpath() {
  [[ -n "$AZDO_LOGGING_MESSAGE" ]] || {
    printf '%s\n' 'task.prependpath requires a nonempty path' >&2
    return 1
  }

  local state_dir path_dir path_file path_value base prefix sequence=0 next_sequence
  local next_tmp entry_tmp entry_path old_umask
  state_dir="$(azdo__state_dir)" || return
  path_dir="$state_dir/path.d"
  mkdir -p "$path_dir" || return

  if [[ -f "$path_dir/.next" ]]; then
    IFS= read -r sequence <"$path_dir/.next" || [[ -n "$sequence" ]] || return
    [[ "$sequence" =~ ^[0-9]+$ ]] || {
      printf 'invalid PATH sequence file: %s\n' "$path_dir/.next" >&2
      return 2
    }
  fi
  for path_file in "$path_dir"/*; do
    [[ -f "$path_file" ]] || continue
    base="${path_file##*/}"
    prefix="${base%%-*}"
    if [[ "$prefix" =~ ^[0-9]+$ ]] && ((10#$prefix > sequence)); then
      sequence=$((10#$prefix))
    fi
    azdo__read_file_exact "$path_file" path_value || return
    # A repeated entry moves to newest rather than appearing twice (C-E06-058).
    [[ "$path_value" != "$AZDO_LOGGING_MESSAGE" ]] || rm -f -- "$path_file"
  done
  next_sequence=$((sequence + 1))

  old_umask="$(umask)"
  umask 077
  next_tmp="$(mktemp "$path_dir/.next.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  entry_tmp="$(mktemp "$path_dir/.path.XXXXXX")" || {
    rm -f -- "$next_tmp"
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s\n' "$next_sequence" >"$next_tmp" || {
    rm -f -- "$next_tmp" "$entry_tmp"
    return
  }
  printf '%s' "$AZDO_LOGGING_MESSAGE" >"$entry_tmp" || {
    rm -f -- "$next_tmp" "$entry_tmp"
    return
  }
  printf -v entry_path '%s/%020d-command' "$path_dir" "$next_sequence"
  mv -f -- "$next_tmp" "$path_dir/.next" || {
    rm -f -- "$next_tmp" "$entry_tmp"
    return
  }
  mv -f -- "$entry_tmp" "$entry_path"
}

azdo__logging_issue_increment() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__logging_issue_increment <error|warning>' >&2
    return 2
  }
  [[ -n "${AZDO_LOGGING_ISSUE_DIR:-}" ]] || {
    printf '%s\n' 'AZDO_LOGGING_ISSUE_DIR must be set while processing task.logissue' >&2
    return 2
  }

  local count_path="$AZDO_LOGGING_ISSUE_DIR/$1" count=0 count_tmp old_umask
  mkdir -p "$AZDO_LOGGING_ISSUE_DIR" || return
  if [[ -f "$count_path" ]]; then
    IFS= read -r count <"$count_path" || [[ -n "$count" ]] || return
  fi
  [[ "$count" =~ ^[0-9]+$ ]] || return 2
  count=$((count + 1))
  old_umask="$(umask)"
  umask 077
  count_tmp="$(mktemp "$AZDO_LOGGING_ISSUE_DIR/.count.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s\n' "$count" >"$count_tmp" || {
    rm -f -- "$count_tmp"
    return
  }
  mv -f -- "$count_tmp" "$count_path"
}

azdo__logging_task_logissue() {
  local issue_type
  if ! azdo_logging_property type issue_type; then
    printf '%s\n' 'task.logissue requires type=error or type=warning' >&2
    return 1
  fi
  azdo__logging_fold "$issue_type" issue_type || return
  case "$issue_type" in
    error | warning) ;;
    *)
      printf 'invalid task.logissue type: %s\n' "$issue_type" >&2
      return 1
      ;;
  esac
  azdo__logging_issue_increment "$issue_type" || return
  azdo__logging_format_line "##[$issue_type]$AZDO_LOGGING_MESSAGE"
}

azdo__logging_merge_result() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__logging_merge_result <current> <incoming> <destination-variable>' >&2
    return 2
  }
  local current="$1" incoming="$2" current_rank incoming_rank
  case "$current" in
    '') current_rank=-1 ;;
    Succeeded) current_rank=0 ;;
    SucceededWithIssues) current_rank=1 ;;
    Failed) current_rank=2 ;;
    *)
      printf 'invalid current task.complete result: %s\n' "$current" >&2
      return 2
      ;;
  esac
  case "$incoming" in
    Succeeded) incoming_rank=0 ;;
    SucceededWithIssues) incoming_rank=1 ;;
    Failed) incoming_rank=2 ;;
    *)
      printf 'invalid task.complete result: %s\n' "$incoming" >&2
      return 1
      ;;
  esac
  if ((incoming_rank >= current_rank)); then
    printf -v "$3" '%s' "$incoming"
  else
    printf -v "$3" '%s' "$current"
  fi
}

azdo__logging_task_complete() {
  local incoming current='' merged result_tmp result_dir old_umask
  if ! azdo_logging_property result incoming || [[ -z "$incoming" ]]; then
    printf '%s\n' 'task.complete requires a result property' >&2
    return 1
  fi
  [[ -n "${AZDO_LOGGING_COMPLETION_FILE:-}" ]] || {
    printf '%s\n' 'AZDO_LOGGING_COMPLETION_FILE must be set while processing task.complete' >&2
    return 2
  }
  if [[ -f "$AZDO_LOGGING_COMPLETION_FILE" ]]; then
    IFS= read -r current <"$AZDO_LOGGING_COMPLETION_FILE" || [[ -n "$current" ]] || return
  fi
  azdo__logging_merge_result "$current" "$incoming" merged || return

  result_dir="${AZDO_LOGGING_COMPLETION_FILE%/*}"
  mkdir -p "$result_dir" || return
  old_umask="$(umask)"
  umask 077
  result_tmp="$(mktemp "$result_dir/.complete.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s\n' "$merged" >"$result_tmp" || {
    rm -f -- "$result_tmp"
    return
  }
  mv -f -- "$result_tmp" "$AZDO_LOGGING_COMPLETION_FILE"
}

azdo__logging_task_debug() {
  local enabled
  enabled="$(azdo_var 'System.Debug' "${AZDO_VAR_SCOPE:-pipeline}")" || return
  [[ "$enabled" =~ ^[[:space:]]*[Tt][Rr][Uu][Ee][[:space:]]*$ ]] || return 0
  azdo__logging_format_line "##[debug]$AZDO_LOGGING_MESSAGE"
}

azdo__logging_task_setvariable() {
  local name secret output readonly_flag stored_name var_path
  if ! azdo_logging_property variable name || [[ -z "$name" ]]; then
    printf "%s\n" "Required field 'variable' is missing in ##vso[task.setvariable] command." >&2
    return 1
  fi
  azdo__logging_bool_property issecret secret || return
  azdo__logging_bool_property isoutput output || return
  azdo__logging_bool_property isreadonly readonly_flag || return

  if [[ "$secret" = true && "$AZDO_LOGGING_MESSAGE" = *$'\n'* ]]; then
    printf '%s\n' 'Secrets cannot contain multiple lines' >&2
    return 1
  fi

  # The file-backed write becomes visible only after macro/env materialization for the current
  # process, reproducing the current-versus-following-task boundary (C-E06-050/051). Output writes
  # reuse the step-qualified same-job and cross-job paths from C-E06-005/052; the store enforces
  # the strict read-only policy established by C-E06-006.
  azdo_var_set \
    "$name" "$AZDO_LOGGING_MESSAGE" "$secret" "$output" "$readonly_flag" \
    "${AZDO_VAR_SCOPE:-pipeline}" || return
  stored_name="$name"
  if [[ "$output" = true ]]; then
    stored_name="${AZDO_STEP_NAME:-}.$name"
  fi
  var_path="$(azdo__var_path "$stored_name" "${AZDO_VAR_SCOPE:-pipeline}")" || return
  if azdo__meta_flag_is_true "$var_path.meta" secret; then
    azdo_mask_register "$AZDO_LOGGING_MESSAGE" || return
  fi
}

# Status 127 means the command is unknown to the local runtime; other non-zero statuses are handler
# failures. E06-S04-T04 extends this case statement with the artifact command family.
azdo_logging_dispatch() {
  case "$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION" in
    task.complete) azdo__logging_task_complete ;;
    task.debug) azdo__logging_task_debug ;;
    task.logissue | task.issue) azdo__logging_task_logissue ;;
    task.prependpath) azdo__logging_task_prependpath ;;
    task.setsecret) azdo__logging_task_setsecret ;;
    task.setvariable) azdo__logging_task_setvariable ;;
    *) return 127 ;;
  esac
}

azdo__logging_process_line() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__logging_process_line <line>' >&2
    return 2
  }

  local parse_status dispatch_status
  if azdo__logging_format_line "$1"; then
    return 0
  fi
  if azdo_logging_parse_line "$1"; then
    parse_status=0
  else
    parse_status=$?
  fi

  case "$parse_status" in
    0)
      if azdo_logging_dispatch; then
        return 0
      else
        dispatch_status=$?
      fi
      if ((dispatch_status == 127)); then
        # The local-debug passthrough is intentional even though the hosted agent consumes a parsed
        # unknown-area line after warning (C-E06-048/049).
        printf "##[warning]Unknown Azure Pipelines logging command '%s.%s'; passing through unchanged.\n" \
          "$AZDO_LOGGING_AREA" "$AZDO_LOGGING_ACTION"
        printf '%s\n' "$1"
        return 0
      fi
      printf "##[error]Azure Pipelines logging command '%s.%s' failed with status %s.\n" \
        "$AZDO_LOGGING_AREA" "$AZDO_LOGGING_ACTION" "$dispatch_status"
      return "$dispatch_status"
      ;;
    1)
      printf '%s\n' "$1"
      ;;
    2)
      printf '%s\n' \
        '##[warning]Malformed Azure Pipelines logging command; passing through unchanged.'
      printf '%s\n' "$1"
      ;;
    *) return "$parse_status" ;;
  esac
}

# azdo_logging_stream
#
# Reads physical lines without trimming whitespace or interpreting backslashes. Decoded `%0A` data
# stays inside the parsed command value; a literal newline remains a command boundary (C-E06-044).
# shellcheck disable=SC2120 # This stream filter intentionally accepts no arguments.
azdo_logging_stream() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_logging_stream' >&2
    return 2
  }

  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    azdo__logging_process_line "$line" || return
  done
}

# E06-S03-T01 — the caller passes the effective remaining timeout: the smaller of the step limit
# and the enclosing job deadline. The agent binds both cancellation sources to step execution
# (C-E06-025/030); keeping that calculation in the job runner makes `run_step --timeout` a simple,
# testable seconds contract.

azdo__run_step_usage() {
  printf '%s\n' \
    'usage: run_step --id <id> --file <path> [--cond <function>] [--no-condition] --display <text> [--wd <path>] --continue-on-error <true|false> --fail-on-stderr <true|false> --retries <count> --timeout <seconds>' >&2
}

azdo__run_step_kill_group() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__run_step_kill_group <signal> <process-group-id>' >&2
    return 2
  }

  # `run_step` creates a distinct process group for the script, so shell children are stopped with
  # their parent. Fall back to the leader only on a platform whose kill rejects a negative id.
  kill "-$1" -- "-$2" 2>/dev/null || kill "-$1" "$2" 2>/dev/null
}

azdo__run_step_process() {
  (($# == 6)) || {
    printf '%s\n' \
      'usage: azdo__run_step_process <script> <working-directory> <log-file> <timeout-seconds> <temp-directory> <fail-on-stderr>' >&2
    return 2
  }

  local script_file="$1" working_directory="$2" log_file="$3" timeout_seconds="$4" temp_dir="$5"
  local fail_on_stderr="$6" fifo timeout_marker stderr_fifo='' stderr_capture='' old_umask
  local child_pid tee_pid stderr_tee_pid='' watchdog_pid child_status tee_status stderr_tee_status=0
  local monitor_was_enabled=false
  AZDO_RUN_STEP_STDERR_DETECTED=false
  AZDO_RUN_STEP_TIMED_OUT=false

  old_umask="$(umask)"
  umask 077
  fifo="$(mktemp "$temp_dir/.step-output.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  timeout_marker="$(mktemp "$temp_dir/.step-timeout.XXXXXX")" || {
    rm -f -- "$fifo"
    umask "$old_umask"
    return
  }
  rm -f -- "$fifo" "$timeout_marker"
  if ! mkfifo "$fifo"; then
    umask "$old_umask"
    return 1
  fi
  if [[ "$fail_on_stderr" = true ]]; then
    stderr_fifo="$(mktemp "$temp_dir/.step-stderr-fifo.XXXXXX")" || {
      rm -f -- "$fifo"
      umask "$old_umask"
      return
    }
    stderr_capture="$(mktemp "$temp_dir/.step-stderr.XXXXXX")" || {
      rm -f -- "$fifo" "$stderr_fifo"
      umask "$old_umask"
      return
    }
    rm -f -- "$stderr_fifo"
    if ! mkfifo "$stderr_fifo"; then
      rm -f -- "$fifo" "$stderr_capture"
      umask "$old_umask"
      return 1
    fi
  fi
  umask "$old_umask"

  # Start the reader before the writer so opening the FIFO cannot deadlock. Both streams enter the
  # same pipe and are teed live, matching the task implementations' ordered output wiring
  # (C-E06-029). With failOnStderr enabled, a second tee records any stderr bytes while forwarding
  # them immediately into the same live stream (C-E06-033). The logging-command parser consumes
  # that stream before it is teed to the console and log (C-E06-044).
  (
    set -o pipefail
    # shellcheck disable=SC2119 # The stream filter intentionally accepts no arguments.
    azdo_logging_stream <"$fifo" 2>&1 | azdo_mask_stream | tee -a -- "$log_file"
  ) &
  tee_pid=$!
  if [[ "$fail_on_stderr" = true ]]; then
    tee -- "$stderr_capture" <"$stderr_fifo" >"$fifo" &
    stderr_tee_pid=$!
  fi

  [[ "$-" == *m* ]] && monitor_was_enabled=true
  set -m
  if [[ "$fail_on_stderr" = true ]]; then
    (
      cd "$working_directory" || exit
      exec env -- "${AZDO_STEP_ENV[@]}" "$BASH" "$script_file"
    ) >"$fifo" 2>"$stderr_fifo" &
  else
    (
      cd "$working_directory" || exit
      exec env -- "${AZDO_STEP_ENV[@]}" "$BASH" "$script_file"
    ) >"$fifo" 2>&1 &
  fi
  child_pid=$!

  (
    sleep "$timeout_seconds"
    if kill -0 "$child_pid" 2>/dev/null; then
      : >"$timeout_marker"
      azdo__run_step_kill_group TERM "$child_pid" || :
      sleep 1
      if kill -0 "$child_pid" 2>/dev/null; then
        azdo__run_step_kill_group KILL "$child_pid" || :
      fi
    fi
  ) &
  watchdog_pid=$!
  [[ "$monitor_was_enabled" = true ]] || set +m

  if wait "$child_pid"; then
    child_status=0
  else
    child_status=$?
  fi
  azdo__run_step_kill_group TERM "$watchdog_pid" || :
  if wait "$watchdog_pid" 2>/dev/null; then
    :
  fi
  if [[ -n "$stderr_tee_pid" ]]; then
    if wait "$stderr_tee_pid"; then
      stderr_tee_status=0
    else
      stderr_tee_status=$?
    fi
  fi
  if wait "$tee_pid"; then
    tee_status=0
  else
    tee_status=$?
  fi

  if [[ -n "$stderr_capture" && -s "$stderr_capture" ]]; then
    AZDO_RUN_STEP_STDERR_DETECTED=true
  fi
  rm -f -- "$fifo"
  [[ -z "$stderr_fifo" ]] || rm -f -- "$stderr_fifo"
  [[ -z "$stderr_capture" ]] || rm -f -- "$stderr_capture"
  if [[ -f "$timeout_marker" ]]; then
    AZDO_RUN_STEP_TIMED_OUT=true
    rm -f -- "$timeout_marker"
    return 124
  fi
  rm -f -- "$timeout_marker"
  ((child_status != 0)) && return "$child_status"
  ((stderr_tee_status != 0)) && return "$stderr_tee_status"
  [[ "$AZDO_RUN_STEP_STDERR_DETECTED" = true ]] && return 1
  return "$tee_status"
}

azdo__run_step_retry_delay_seconds() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__run_step_retry_delay_seconds <zero-based-retry-index>' >&2
    return 2
  }
  [[ "$1" =~ ^[0-9]+$ ]] || {
    printf 'retry index must be a non-negative integer, got: %s\n' "$1" >&2
    return 2
  }
  printf '%s\n' "$((($1 + 1) * ($1 + 1)))"
}

# Kept as a function so bats can replace only the wall-clock wait while still exercising the
# production retry state machine. The enclosing step timeout also covers retry backoff.
azdo__run_step_retry_wait() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__run_step_retry_wait <zero-based-retry-index> <remaining-seconds>' >&2
    return 2
  }
  local delay_seconds remaining_seconds="$2"
  delay_seconds="$(azdo__run_step_retry_delay_seconds "$1")" || return
  if ((delay_seconds >= remaining_seconds)); then
    sleep "$remaining_seconds"
    return 124
  fi
  sleep "$delay_seconds"
}

# run_step --id <id> --file <path> [--cond <function>] [--no-condition] --display <text>
#          [--wd <path>] --continue-on-error <bool> --fail-on-stderr <bool>
#          --retries <count> --timeout <effective-remaining-seconds>
#
# An omitted `--cond` is the agent's implicit succeeded(); `--no-condition` is the local force-run
# override. False, error, and status-context behavior follow C-E06-038..043. Exit status,
# failOnStderr, retries, result persistence, and continueOnError follow C-E06-031..037. When `--wd`
# is absent or empty, the live-probed shell default is System.DefaultWorkingDirectory
# (C-E06-026/027).
run_step() {
  local id='' file='' condition='azdo_status_succeeded' display='' working_directory=''
  local continue_on_error='' fail_on_stderr='' retries='' timeout_seconds=''
  local seen_id=false seen_file=false seen_condition=false seen_display=false seen_wd=false
  local seen_continue=false seen_fail_on_stderr=false seen_retries=false seen_timeout=false
  local no_condition=false seen_no_condition=false condition_status=0 condition_error=''
  local expanded_file expanded_wd ignored_secret log_file status result attempt_result=Failed
  local completion_result result_dir command_state_dir issue_dir completion_file
  local retry_index=0 effective_retries remaining_seconds elapsed_seconds delay_seconds wait_status
  local start_seconds state_dir condition_error_dir condition_error_file old_umask

  while (($# > 0)); do
    if [[ "$1" = --no-condition ]]; then
      [[ "$seen_no_condition" = false ]] || {
        printf '%s\n' 'duplicate run_step option: --no-condition' >&2
        return 2
      }
      seen_no_condition=true
      no_condition=true
      shift
      continue
    fi
    (($# >= 2)) || {
      azdo__run_step_usage
      return 2
    }
    case "$1" in
      --id)
        [[ "$seen_id" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --id' >&2
          return 2
        }
        seen_id=true
        id="$2"
        ;;
      --file)
        [[ "$seen_file" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --file' >&2
          return 2
        }
        seen_file=true
        file="$2"
        ;;
      --cond)
        [[ "$seen_condition" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --cond' >&2
          return 2
        }
        seen_condition=true
        condition="$2"
        ;;
      --display)
        [[ "$seen_display" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --display' >&2
          return 2
        }
        seen_display=true
        display="$2"
        ;;
      --wd)
        [[ "$seen_wd" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --wd' >&2
          return 2
        }
        seen_wd=true
        working_directory="$2"
        ;;
      --continue-on-error)
        [[ "$seen_continue" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --continue-on-error' >&2
          return 2
        }
        seen_continue=true
        continue_on_error="$2"
        ;;
      --fail-on-stderr)
        [[ "$seen_fail_on_stderr" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --fail-on-stderr' >&2
          return 2
        }
        seen_fail_on_stderr=true
        fail_on_stderr="$2"
        ;;
      --retries)
        [[ "$seen_retries" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --retries' >&2
          return 2
        }
        seen_retries=true
        retries="$2"
        ;;
      --timeout)
        [[ "$seen_timeout" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --timeout' >&2
          return 2
        }
        seen_timeout=true
        timeout_seconds="$2"
        ;;
      *)
        printf 'unknown run_step option: %s\n' "$1" >&2
        azdo__run_step_usage
        return 2
        ;;
    esac
    shift 2
  done

  if [[ "$seen_id" != true || "$seen_file" != true || "$seen_display" != true ||
    "$seen_continue" != true ||
    "$seen_fail_on_stderr" != true || "$seen_retries" != true || "$seen_timeout" != true ]]; then
    azdo__run_step_usage
    return 2
  fi
  azdo__valid_store_segment "$id" || return
  [[ -n "$file" && -f "$file" && -r "$file" ]] || {
    printf 'step file is not readable: %s\n' "$file" >&2
    return 2
  }
  [[ "$seen_condition" = false || -n "$condition" ]] || {
    printf '%s\n' 'run_step --cond must not be empty' >&2
    return 2
  }
  [[ -n "$display" ]] || {
    printf '%s\n' 'run_step --display must not be empty' >&2
    return 2
  }
  azdo__validate_bool continue-on-error "$continue_on_error" || return
  azdo__validate_bool fail-on-stderr "$fail_on_stderr" || return
  [[ "$retries" =~ ^[0-9]+$ ]] || {
    printf 'run_step --retries must be a non-negative integer, got: %s\n' "$retries" >&2
    return 2
  }
  [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]] || {
    printf 'run_step --timeout must be a positive integer, got: %s\n' "$timeout_seconds" >&2
    return 2
  }
  [[ -n "${AZDO_LOG_DIR:-}" ]] || {
    printf '%s\n' 'AZDO_LOG_DIR must be set before running a step' >&2
    return 2
  }

  mkdir -p "$AZDO_LOG_DIR" || return
  log_file="$AZDO_LOG_DIR/$id.log"
  : >"$log_file" || return

  if [[ "$no_condition" = false ]]; then
    declare -F "$condition" >/dev/null || {
      printf 'run_step condition is not a function: %s\n' "$condition" >&2
      return 2
    }
    state_dir="$(azdo__state_dir)" || return
    condition_error_dir="$state_dir/condition-errors"
    mkdir -p "$condition_error_dir" || return
    old_umask="$(umask)"
    umask 077
    condition_error_file="$(mktemp "$condition_error_dir/.condition.XXXXXX")" || {
      umask "$old_umask"
      return
    }
    umask "$old_umask"

    # The marker survives command substitutions and shell `||` lists that discard a helper's
    # status 2. It closes the E02 shell-backend handoff without changing standalone expression
    # execution: helpers write it only while this private path is exported for a condition.
    local AZDO_EXPR_ERROR_FILE="$condition_error_file"
    local AZDO_CONDITION_STEP_ID="$id"
    export AZDO_EXPR_ERROR_FILE AZDO_CONDITION_STEP_ID
    if "$condition"; then
      condition_status=0
    else
      condition_status=$?
    fi
    if [[ -s "$condition_error_file" ]]; then
      IFS= read -r condition_error <"$condition_error_file" || :
      condition_status=2
    fi
    rm -f -- "$condition_error_file"

    if ((condition_status == 1)); then
      printf '%s\n' 'Skipping step due to condition evaluation.' | tee -a -- "$log_file"
      azdo_step_result_set "$id" Skipped || return
      return 0
    fi
    if ((condition_status != 0)); then
      if [[ -n "$condition_error" ]]; then
        printf "##[error]Condition evaluation failed for '%s': %s\n" \
          "$display" "$condition_error" | tee -a -- "$log_file" >&2
      else
        printf "##[error]Condition evaluation failed for '%s' with status %s.\n" \
          "$display" "$condition_status" | tee -a -- "$log_file" >&2
      fi
      azdo_step_result_set "$id" Failed || return
      return "$condition_status"
    fi
  fi

  if [[ -n "$working_directory" ]]; then
    azdo__expand_value "$working_directory" expanded_wd || return
  else
    if ! azdo__macro_preexpanded_value \
      'System.DefaultWorkingDirectory' expanded_wd ignored_secret "${AZDO_VAR_SCOPE:-pipeline}" ||
      [[ -z "$expanded_wd" ]]; then
      printf '%s\n' \
        'System.DefaultWorkingDirectory must be present and non-empty before running a step' >&2
      return 2
    fi
  fi
  [[ -d "$expanded_wd" ]] || {
    printf 'step working directory is not a directory: %s\n' "$expanded_wd" >&2
    return 2
  }

  if ! declare -p AZDO_STEP_ENV >/dev/null 2>&1; then
    # shellcheck disable=SC2119 # The empty form means no explicit step env entries.
    azdo_env_materialize || return
  elif [[ "$(declare -p AZDO_STEP_ENV)" != declare\ -*a*\ AZDO_STEP_ENV=* ]]; then
    printf '%s\n' 'AZDO_STEP_ENV must be an indexed array of NAME=value entries' >&2
    return 2
  fi

  expanded_file="$(azdo_expand_macros "$file")" || return

  result_dir="$(azdo__step_result_dir)" || return
  command_state_dir="$result_dir/.commands/$id"
  issue_dir="$result_dir/.issues/$id"
  completion_file="$command_state_dir/result"
  mkdir -p "$command_state_dir" "$issue_dir" || return
  printf '%s\n' 0 >"$issue_dir/error" || return
  printf '%s\n' 0 >"$issue_dir/warning" || return
  local AZDO_LOGGING_COMPLETION_FILE="$completion_file"
  local AZDO_LOGGING_ISSUE_DIR="$issue_dir"
  export AZDO_LOGGING_COMPLETION_FILE AZDO_LOGGING_ISSUE_DIR

  effective_retries="$retries"
  if ((effective_retries > 10)); then
    printf '##[warning]retryCountOnTaskFailure is limited to 10; requested %s.\n' "$retries" |
      tee -a -- "$log_file"
    effective_retries=10
  fi

  start_seconds=$SECONDS
  while :; do
    # RetryHelper clears the Failed attempt result before invoking the task again. A completion
    # command from one attempt therefore cannot leak into the next (C-E06-061).
    rm -f -- "$completion_file"
    elapsed_seconds=$((SECONDS - start_seconds))
    remaining_seconds=$((timeout_seconds - elapsed_seconds))
    if ((remaining_seconds <= 0)); then
      status=124
      attempt_result=Failed
      break
    fi

    if azdo__run_step_process \
      "$expanded_file" "$expanded_wd" "$log_file" "$remaining_seconds" "${expanded_file%/*}" \
      "$fail_on_stderr"; then
      status=0
    else
      status=$?
    fi

    if ((status == 0)); then
      attempt_result=Succeeded
    else
      attempt_result=Failed
    fi
    if [[ -f "$completion_file" ]]; then
      IFS= read -r completion_result <"$completion_file" || [[ -n "$completion_result" ]] || return
      azdo__logging_merge_result "$attempt_result" "$completion_result" attempt_result || return
      # A task.complete failure is retryable even when the shell itself exits zero. Preserve a
      # real process status when present; otherwise use the generic failure status.
      if [[ "$attempt_result" = Failed ]] && ((status == 0)); then
        status=1
      fi
    fi

    if [[ "$AZDO_RUN_STEP_STDERR_DETECTED" = true ]]; then
      printf '%s\n' '##[error]Bash wrote one or more lines to the standard error stream.' |
        tee -a -- "$log_file"
    fi
    [[ "$attempt_result" != Failed ]] && break
    [[ "$AZDO_RUN_STEP_TIMED_OUT" = true ]] && break
    ((retry_index >= effective_retries)) && break

    delay_seconds="$(azdo__run_step_retry_delay_seconds "$retry_index")" || return
    printf \
      '##[warning]RetryHelper encountered task failure, will retry (attempt #: %s out of %s) after %s000 ms\n' \
      "$((retry_index + 1))" "$effective_retries" "$delay_seconds" | tee -a -- "$log_file"

    elapsed_seconds=$((SECONDS - start_seconds))
    remaining_seconds=$((timeout_seconds - elapsed_seconds))
    if ((remaining_seconds <= 0)); then
      status=124
      break
    fi
    if azdo__run_step_retry_wait "$retry_index" "$remaining_seconds"; then
      :
    else
      wait_status=$?
      if ((wait_status == 124)); then
        status=124
        break
      fi
      return "$wait_status"
    fi
    ((retry_index += 1))
  done

  result="$attempt_result"
  if [[ "$result" = Failed && "$continue_on_error" = true ]]; then
    result=SucceededWithIssues
  fi
  azdo_step_result_set "$id" "$result" || return

  case "$result" in
    Succeeded | SucceededWithIssues) return 0 ;;
    *) return "$status" ;;
  esac
}
