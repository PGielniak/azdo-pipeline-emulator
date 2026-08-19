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

azdo__expand_env_value() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__expand_env_value <value> <destination-variable>' >&2
    return 2
  }

  local remaining="$1" expanded='' before after_open macro_name macro_value var_path
  # shellcheck disable=SC2016 # This is the literal Azure macro opener, not shell substitution.
  local macro_open='$('
  while [[ "$remaining" == *"$macro_open"*')'* ]]; do
    before="${remaining%%"$macro_open"*}"
    after_open="${remaining#*"$macro_open"}"
    macro_name="${after_open%%)*}"
    remaining="${after_open#*)}"
    expanded+="$before"

    # The variable-store lookup is case-insensitive. Run 540 grounds direct task-environment
    # replacement (C-E06-010); E06-S02 owns the remaining macro-parser edge cases.
    if var_path="$(azdo__var_path "$macro_name" 2>/dev/null)" && [[ -f "$var_path" ]]; then
      azdo__read_file_exact "$var_path" macro_value || return
      expanded+="$macro_value"
    else
      expanded+="$macro_open$macro_name)"
    fi
  done
  expanded+="$remaining"
  printf -v "$2" '%s' "$expanded"
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
  local scope_dir var_path meta_path stored_name stored_secret env_name value
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
    azdo__read_file_exact "$var_path" value || return
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
