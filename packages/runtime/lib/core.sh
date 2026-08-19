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

# E06-S03-T01 — the caller passes the effective remaining timeout: the smaller of the step limit
# and the enclosing job deadline. The agent binds both cancellation sources to step execution
# (C-E06-025/030); keeping that calculation in the job runner makes `run_step --timeout` a simple,
# testable seconds contract.

azdo__run_step_usage() {
  printf '%s\n' \
    'usage: run_step --id <id> --file <path> --cond <function> --display <text> [--wd <path>] --continue-on-error <true|false> --fail-on-stderr <true|false> --retries <count> --timeout <seconds>' >&2
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
  # them immediately into the same live stream (C-E06-033). Secret masking and logging-command
  # parsing are later lifecycle tasks.
  tee -a -- "$log_file" <"$fifo" &
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

# run_step --id <id> --file <path> --cond <function> --display <text>
#          [--wd <path>] --continue-on-error <bool> --fail-on-stderr <bool>
#          --retries <count> --timeout <effective-remaining-seconds>
#
# `--cond` remains a parsed seam for E06-S03-T03. Exit status, failOnStderr, retries, result
# persistence, and continueOnError follow C-E06-031..037. When `--wd` is absent or empty, the
# live-probed shell default is System.DefaultWorkingDirectory (C-E06-026/027).
run_step() {
  local id='' file='' condition='' display='' working_directory=''
  local continue_on_error='' fail_on_stderr='' retries='' timeout_seconds=''
  local seen_id=false seen_file=false seen_condition=false seen_display=false seen_wd=false
  local seen_continue=false seen_fail_on_stderr=false seen_retries=false seen_timeout=false
  local expanded_file expanded_wd ignored_secret log_file status result
  local retry_index=0 effective_retries remaining_seconds elapsed_seconds delay_seconds wait_status
  local start_seconds

  while (($# > 0)); do
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

  if [[ "$seen_id" != true || "$seen_file" != true || "$seen_condition" != true ||
    "$seen_display" != true || "$seen_continue" != true ||
    "$seen_fail_on_stderr" != true || "$seen_retries" != true || "$seen_timeout" != true ]]; then
    azdo__run_step_usage
    return 2
  fi
  azdo__valid_store_segment "$id" || return
  [[ -n "$file" && -f "$file" && -r "$file" ]] || {
    printf 'step file is not readable: %s\n' "$file" >&2
    return 2
  }
  [[ -n "$condition" ]] || {
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
  mkdir -p "$AZDO_LOG_DIR" || return
  log_file="$AZDO_LOG_DIR/$id.log"
  : >"$log_file" || return

  effective_retries="$retries"
  if ((effective_retries > 10)); then
    printf '##[warning]retryCountOnTaskFailure is limited to 10; requested %s.\n' "$retries" |
      tee -a -- "$log_file"
    effective_retries=10
  fi

  start_seconds=$SECONDS
  while :; do
    elapsed_seconds=$((SECONDS - start_seconds))
    remaining_seconds=$((timeout_seconds - elapsed_seconds))
    if ((remaining_seconds <= 0)); then
      status=124
      break
    fi

    if azdo__run_step_process \
      "$expanded_file" "$expanded_wd" "$log_file" "$remaining_seconds" "${expanded_file%/*}" \
      "$fail_on_stderr"; then
      status=0
    else
      status=$?
    fi

    if [[ "$AZDO_RUN_STEP_STDERR_DETECTED" = true ]]; then
      printf '%s\n' '##[error]Bash wrote one or more lines to the standard error stream.' |
        tee -a -- "$log_file"
    fi
    ((status == 0)) && break
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

  if ((status == 0)); then
    result=Succeeded
  else
    result=Failed
  fi
  if [[ "$result" = Failed && "$continue_on_error" = true ]]; then
    result=SucceededWithIssues
  fi
  azdo_step_result_set "$id" "$result" || return

  # Condition evaluation is activated by E06-S03-T03; retaining the parsed name keeps the stable
  # call contract while this task owns only post-execution result semantics.
  : "$condition" "$display"
  case "$result" in
    Succeeded | SucceededWithIssues) return 0 ;;
    *) return "$status" ;;
  esac
}
