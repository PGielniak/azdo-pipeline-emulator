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
