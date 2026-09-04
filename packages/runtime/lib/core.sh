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
  local name="$1" meta_path
  meta_path="$(azdo__var_path "$name" "$6").meta" || return

  if azdo__meta_flag_is_true "$meta_path" readonly; then
    # Run 539 showed that hosted agents reject the second command before it changes the first
    # value, rather than issuing the legacy warning and overwriting it (C-E06-004, C-E06-006).
    printf "##[error]Overwriting readonly variable '%s' is not permitted.\n" "$name" >&2
    return 1
  fi
  azdo__write_var_unchecked "$@"
}

# azdo__write_var_unchecked <name> <value> <secret> <output> <readonly> <scope>
#
# The read-only rule is enforced by callers, not by the store, because the agent enforces it in
# `TaskSetVariableCommand` rather than in `Variables.Set` — which is exactly why
# `build.updatebuildnumber` can overwrite `Build.BuildNumber` even though that name is a member of
# `Constants.Variables.ReadOnlyVariables` (C-E06-081). A read-only variable stays read-only across
# such a write, so the flag is preserved below rather than reset by the caller.
azdo__write_var_unchecked() {
  local name="$1" value="$2" secret="$3" output="$4" readonly="$5" scope="$6"
  local var_path meta_path var_dir value_tmp meta_tmp
  var_path="$(azdo__var_path "$name" "$scope")" || return
  meta_path="$var_path.meta"
  var_dir="${var_path%/*}"

  mkdir -p "$var_dir" || return

  # A secret variable cannot be downgraded by a later non-secret write; the replacement value must
  # remain out of automatic environments and be registered with the masker (C-E06-056).
  if azdo__meta_flag_is_true "$meta_path" secret; then
    secret=true
  fi
  if azdo__meta_flag_is_true "$meta_path" readonly; then
    readonly=true
  fi

  # Registration keys off the *merged* flag, not the caller's argument: the agent registers inside
  # Variables.Set, after the same sticky-secret merge, so a plain write onto a secret variable
  # registers its replacement value too (C-E06-123). Every writer — the store API, `.env` load,
  # scope copies, the logging handlers — therefore registers exactly once, here.
  if [[ "$secret" = true && -n "$value" ]]; then
    azdo_mask_register "$value" || return
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

# Dependency-result reads use the same state/results/<stage>/<job>/<step> tree as step status.
# Executed jobs are folded from those existing files; an orchestrator skip needs a private marker
# because an absent directory must remain Null for an unknown dependency (C-E02-092..094). Dotfile
# markers stay outside azdo_run_result's `find ... ! -name '.*'` aggregate (decision 70).
azdo__result_segment() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__result_segment <name>' >&2
    return 2
  }
  if [[ -z "$1" ]]; then
    # The service preserves an authored empty job identifier (C-E04-004). `@empty` cannot collide
    # with a valid Azure stage/job identifier and keeps that node distinct from its parent path.
    printf '%s\n' '@empty'
    return 0
  fi
  azdo__valid_store_segment "$1" || return
  printf '%s\n' "$1"
}

# azdo_result_dir <stage> <job> — physical directory for an expression-facing result record.
azdo_result_dir() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_result_dir <stage> <job>' >&2
    return 2
  }
  local state_dir stage_segment job_segment
  state_dir="$(azdo__state_dir)" || return
  stage_segment="$(azdo__result_segment "$1")" || return
  job_segment="$(azdo__result_segment "$2")" || return
  printf '%s/results/%s/%s\n' "$state_dir" "$stage_segment" "$job_segment"
}

azdo__result_marker_set() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__result_marker_set <path> <result>' >&2
    return 2
  }
  azdo__valid_step_result "$2" || return

  local marker_dir marker_tmp old_umask
  marker_dir="${1%/*}"
  mkdir -p "$marker_dir" || return
  old_umask="$(umask)"
  umask 077
  marker_tmp="$(mktemp "$marker_dir/.result.XXXXXX")" || {
    umask "$old_umask"
    return
  }
  umask "$old_umask"
  printf '%s\n' "$2" >"$marker_tmp" || {
    rm -f -- "$marker_tmp"
    return 1
  }
  mv -f -- "$marker_tmp" "$1"
}

# Resolve a result-store child directory case-insensitively (C-E02-094). Azure identifiers cannot
# differ only by case, so the first match is unambiguous; missing children return status 1.
azdo__result_child_dir() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__result_child_dir <parent> <name> <destination-variable>' >&2
    return 2
  }
  local wanted wanted_segment child child_name canonical
  wanted_segment="$(azdo__result_segment "$2")" || return
  printf -v "$3" '%s' ''
  [[ -d "$1" ]] || return 1
  if [[ -z "$2" ]]; then
    child="$1/$wanted_segment"
    [[ -d "$child" ]] || return 1
    printf -v "$3" '%s' "$child"
    return 0
  fi
  wanted="$(azdo__canonical_var_name "$2")" || return
  for child in "$1"/*; do
    [[ -d "$child" ]] || continue
    child_name="${child##*/}"
    canonical="$(azdo__canonical_var_name "$child_name")" || return
    if [[ "$canonical" = "$wanted" ]]; then
      printf -v "$3" '%s' "$child"
      return 0
    fi
  done
  return 1
}

azdo_job_result_set() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo_job_result_set <stage> <job> <result>' >&2
    return 2
  }
  local result_dir
  result_dir="$(azdo_result_dir "$1" "$2")" || return
  azdo__result_marker_set "$result_dir/.job-result" "$3"
}

azdo_stage_result_set() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_stage_result_set <stage> <result>' >&2
    return 2
  }
  local state_dir stage_segment
  state_dir="$(azdo__state_dir)" || return
  stage_segment="$(azdo__result_segment "$1")" || return
  azdo__result_marker_set "$state_dir/results/$stage_segment/.stage-result" "$2"
}

# azdo_job_result <stage> <job>
#
# Prints the five-state dependency result, or nothing for a missing stage/job (shell Null→empty).
azdo_job_result() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_job_result <stage> <job>' >&2
    return 2
  }
  local state_dir results_dir stage_dir job_dir marker result_path result status=Succeeded
  state_dir="$(azdo__state_dir)" || return
  results_dir="$state_dir/results"
  if ! azdo__result_child_dir "$results_dir" "$1" stage_dir; then
    return 0
  fi
  if ! azdo__result_child_dir "$stage_dir" "$2" job_dir; then
    return 0
  fi

  marker="$job_dir/.job-result"
  if [[ -f "$marker" ]]; then
    IFS= read -r result <"$marker" || [[ -n "$result" ]] || return 0
    azdo__valid_step_result "$result" || return
    printf '%s\n' "$result"
    return 0
  fi

  for result_path in "$job_dir"/*; do
    [[ -f "$result_path" ]] || continue
    IFS= read -r result <"$result_path" || [[ -n "$result" ]] || continue
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

# azdo_stage_result <stage>
#
# A skipped stage has an explicit marker. Otherwise fold its job results, treating Skipped as the
# stage result only when every recorded job was skipped.
azdo_stage_result() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_stage_result <stage>' >&2
    return 2
  }
  local state_dir results_dir stage_dir marker result job_dir job_name status='' saw_skipped=false
  state_dir="$(azdo__state_dir)" || return
  results_dir="$state_dir/results"
  if ! azdo__result_child_dir "$results_dir" "$1" stage_dir; then
    return 0
  fi
  marker="$stage_dir/.stage-result"
  if [[ -f "$marker" ]]; then
    IFS= read -r result <"$marker" || [[ -n "$result" ]] || return 0
    azdo__valid_step_result "$result" || return
    printf '%s\n' "$result"
    return 0
  fi

  for job_dir in "$stage_dir"/*; do
    [[ -d "$job_dir" ]] || continue
    job_name="${job_dir##*/}"
    result="$(azdo_job_result "$1" "$job_name")" || return
    case "$result" in
      Canceled)
        status=Canceled
        break
        ;;
      Failed) status=Failed ;;
      SucceededWithIssues)
        [[ -n "$status" && "$status" != Succeeded ]] || status=SucceededWithIssues
        ;;
      Succeeded)
        [[ -n "$status" ]] || status=Succeeded
        ;;
      Skipped) saw_skipped=true ;;
      '') ;;
      *)
        printf 'invalid job result: %s\n' "$result" >&2
        return 2
        ;;
    esac
  done
  if [[ -n "$status" ]]; then
    printf '%s\n' "$status"
  elif [[ "$saw_skipped" = true ]]; then
    printf '%s\n' Skipped
  else
    printf '%s\n' Succeeded
  fi
}

# azdo_step_issues <step-id>
#
# Prints `errors=<n>` and `warnings=<n>` recorded for a completed step. The counts live in an
# `issues/` subdirectory of the result store so the job-status scan, which reads every *file* in
# that directory as a step result, never sees them (C-E06-063).
azdo_step_issues() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_step_issues <step-id>' >&2
    return 2
  }
  azdo__valid_store_segment "$1" || return

  local issues_path
  issues_path="$(azdo__step_result_dir)/issues/$1" || return
  if [[ -f "$issues_path" ]]; then
    cat -- "$issues_path"
  else
    printf 'errors=0\nwarnings=0\n'
  fi
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

# E05-S01-T04 — `.env` names are shell identifiers, while the variable names they represent may
# contain punctuation or spaces. The transform is not reversible (`A.B`, `A_B`, `A-B`, and `A B`
# share the same safe base), so the generated runner supplies the exact mapping instead of guessing
# `_` → `.` or writing several keys:
#
#   AZDO_ENV_ALIASES=('BUILD_SOURCEBRANCH=Build.SourceBranch')
#
# Names absent from the generated `.env.example` are not in the table and retain their literal
# shell spelling, preserving the pre-task behavior for user-added entries (decision 67).
azdo__env_alias_validate() {
  local declaration entry env_name variable_name canonical seen_index
  local -a seen_names=()

  if ! declaration="$(declare -p AZDO_ENV_ALIASES 2>/dev/null)"; then
    return 0
  fi
  if [[ "$declaration" != declare\ -*a*\ AZDO_ENV_ALIASES=* ]]; then
    printf '%s\n' 'AZDO_ENV_ALIASES must be an indexed array of ENV_NAME=Variable.Name entries' >&2
    return 2
  fi

  for entry in "${AZDO_ENV_ALIASES[@]}"; do
    env_name="${entry%%=*}"
    variable_name="${entry#*=}"
    if [[ "$entry" != *=* ]] || [[ ! "$env_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] ||
      ! azdo__valid_store_segment "$variable_name"; then
      printf 'invalid AZDO_ENV_ALIASES entry: %s\n' "$entry" >&2
      return 2
    fi
    canonical="$(azdo__canonical_var_name "$env_name")" || return
    for ((seen_index = 0; seen_index < ${#seen_names[@]}; seen_index++)); do
      if [[ "${seen_names[$seen_index]}" = "$canonical" ]]; then
        printf 'duplicate environment alias name: %s\n' "$env_name" >&2
        return 2
      fi
    done
    seen_names+=("$canonical")
  done
}

azdo__env_alias_variable() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__env_alias_variable <env-name> <destination-variable>' >&2
    return 2
  }

  local wanted entry env_name variable_name canonical
  wanted="$(azdo__canonical_var_name "$1")" || return
  printf -v "$2" '%s' "$1"
  declare -p AZDO_ENV_ALIASES >/dev/null 2>&1 || return 0

  for entry in "${AZDO_ENV_ALIASES[@]}"; do
    env_name="${entry%%=*}"
    variable_name="${entry#*=}"
    canonical="$(azdo__canonical_var_name "$env_name")" || return
    if [[ "$canonical" = "$wanted" ]]; then
      printf -v "$2" '%s' "$variable_name"
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
  local declaration_name declaration_rhs parsed_value captured_name store_name secret index status load_status=0
  local -a declaration_names=() declaration_values=()

  azdo__manifest_env_validate || return
  azdo__env_alias_validate || return
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
        if azdo__env_alias_variable "$captured_name" store_name; then
          :
        else
          load_status=$?
          break 2
        fi
        if azdo_var_set \
          "$store_name" "${declaration_values[$index]}" "$secret" false false "$scope"; then
          :
        else
          load_status=$?
          break 2
        fi
        # `.env` secrets are this runtime's job-message variables (C-E06-013), so they also get the
        # six transformed registrations the worker adds before the job starts (C-E06-124). The store
        # already registered the raw value; a whitespace-only value stops here, exactly as the
        # agent's IsNullOrWhiteSpace guard does.
        if [[ "$secret" = true ]]; then
          if azdo__mask_register_job_variable "${declaration_values[$index]}"; then
            :
          else
            load_status=$?
            break 2
          fi
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

  # path.d names carry an increasing numeric prefix. Processing oldest to newest and prepending each
  # one produces the agent's reversed/newest-first order (C-E06-012). A repeated entry replaces its
  # older occurrence, matching TaskPrepandPathCommand's RemoveAll-then-Add behavior. Ordering is by
  # the parsed number rather than the file name, so a run mixing zero-padding widths still applies
  # the tenth prepend after the second.
  local LC_ALL=C
  local -a ordered=()
  local candidate candidate_index other_index position index
  for path_file in "$path_dir"/*; do
    [[ -f "$path_file" ]] || continue
    candidate="${path_file##*/}"
    candidate="${candidate%%-*}"
    if [[ "$candidate" =~ ^[0-9]+$ ]]; then
      candidate_index="$((10#$candidate))"
    else
      candidate_index=0
    fi
    position=${#ordered[@]}
    for ((index = 0; index < ${#ordered[@]}; index++)); do
      other_index="${ordered[$index]%% *}"
      if ((candidate_index < other_index)); then
        position=$index
        break
      fi
    done
    ordered=("${ordered[@]:0:position}" "$candidate_index $path_file" "${ordered[@]:position}")
  done
  for path_file in "${ordered[@]}"; do
    path_file="${path_file#* }"
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

# E06-S04-T01/T02 — logging commands are parsed from physical output lines. The globals below form
# the dispatch seam for command handlers. Indexed key/value arrays keep the generated runtime
# compatible with the same Bash versions as the rest of this file.

azdo__logging_fold() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__logging_fold <value> <destination-variable>' >&2
    return 2
  }
  # The scratch name is deliberately unlikely: a caller destination variable of the same name would
  # be shadowed by this local and silently receive nothing.
  local azdo__logging_folded_scratch
  azdo__logging_folded_scratch="$(LC_ALL=C printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]')" ||
    return
  printf -v "$2" '%s' "$azdo__logging_folded_scratch"
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
# TaskCommandHelper.AddSecret (C-E06-053), and a value shorter than the effective minimum is not
# stored at all (C-E06-127) — the agent's add-then-RemoveShortSecretsFromDictionary order is
# observably the same here because the minimum is fixed for the whole run (C-E06-128).
azdo_mask_register() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_mask_register <value>' >&2
    return 2
  }
  [[ -n "$1" ]] || return 0

  local state_dir mask_dir mask_tmp mask_path old_umask minimum
  azdo__mask_min_length minimum || return
  ((${#1} >= minimum)) || return 0
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

# azdo__mask_min_length <destination-variable>
#
# Effective minimum length of a registered value. `AZP_IGNORE_SECRETS_SHORTER_THAN` is the agent's
# knob (built-in default 0) and LoggedSecretMasker caps whatever it is handed at 6, warning once
# when the request was higher (C-E06-128). The knob is read with Int32.Parse rather than TryParse,
# so a non-numeric value is a hard failure on the agent; refusing to register is the local
# equivalent, and it fails loud instead of silently masking nothing.
azdo__mask_min_length() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__mask_min_length <destination-variable>' >&2
    return 2
  }

  local requested="${AZP_IGNORE_SECRETS_SHORTER_THAN:-0}" state_dir warning_marker
  [[ "$requested" =~ ^-?[0-9]+$ ]] || {
    printf 'AZP_IGNORE_SECRETS_SHORTER_THAN must be an integer, got: %s\n' "$requested" >&2
    return 2
  }
  if ((requested > 6)); then
    state_dir="$(azdo__state_dir)" || return
    warning_marker="$state_dir/masks/.min-length-warning"
    if [[ ! -e "$warning_marker" ]]; then
      mkdir -p "$state_dir/masks" || return
      : >"$warning_marker" || return
      printf '##[warning]The value of the minimum length of the secrets is too high. Maximum value is set: %s\n' 6
    fi
    requested=6
  fi
  printf -v "$1" '%s' "$requested"
}

# azdo__mask_register_user_supplied <value>
#
# AddUserSuppliedSecret: the value, the same value stripped of surrounding quote characters, and the
# same value stripped of leading/trailing CR, LF and spaces (C-E06-125). `String.Trim(char)` removes
# every leading and trailing occurrence, which is why both loops run to exhaustion.
azdo__mask_register_user_supplied() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__mask_register_user_supplied <value>' >&2
    return 2
  }

  local value="$1" quote trimmed
  azdo_mask_register "$value" || return
  for quote in "'" '"'; do
    if [[ "$value" == "$quote"*"$quote" ]]; then
      trimmed="$value"
      while [[ "$trimmed" == "$quote"* ]]; do trimmed="${trimmed#"$quote"}"; done
      while [[ "$trimmed" == *"$quote" ]]; do trimmed="${trimmed%"$quote"}"; done
      azdo_mask_register "$trimmed" || return
    fi
  done
  trimmed="$value"
  while [[ "$trimmed" == [$'\r\n ']* ]]; do trimmed="${trimmed#?}"; done
  while [[ "$trimmed" == *[$'\r\n '] ]]; do trimmed="${trimmed%?}"; done
  azdo_mask_register "$trimmed"
}

# azdo__mask_register_job_variable <value>
#
# InitializeSecretMasker's treatment of a secret job variable: the raw value, the value with `%`,
# CR and LF escaped the way the agent renders variables in debug output, the CR/LF-only escaping for
# runs with `%` escaping disabled, the UTF-8 base64 of the value, and that base64 through both
# escape passes — each of the six through AddUserSuppliedSecret (C-E06-124). A whitespace-only value
# is skipped entirely here, while the store still registers it raw (C-E06-123): the two guards are
# IsNullOrWhiteSpace and IsNullOrEmpty respectively.
azdo__mask_register_job_variable() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__mask_register_job_variable <value>' >&2
    return 2
  }

  local value="$1" escaped base64_value
  [[ -n "${value//[[:space:]]/}" ]] || return 0

  azdo__mask_register_user_supplied "$value" || return
  escaped="${value//%/%AZP25}"
  escaped="${escaped//$'\r'/%0D}"
  escaped="${escaped//$'\n'/%0A}"
  azdo__mask_register_user_supplied "$escaped" || return
  escaped="${value//$'\r'/%0D}"
  escaped="${escaped//$'\n'/%0A}"
  azdo__mask_register_user_supplied "$escaped" || return

  base64_value="$(printf '%s' "$value" | base64 | tr -d '\n')" || return
  azdo__mask_register_user_supplied "$base64_value" || return
  escaped="${base64_value//%/%AZP25}"
  escaped="${escaped//$'\r'/%0D}"
  escaped="${escaped//$'\n'/%0A}"
  azdo__mask_register_user_supplied "$escaped" || return
  escaped="${base64_value//$'\r'/%0D}"
  escaped="${escaped//$'\n'/%0A}"
  azdo__mask_register_user_supplied "$escaped"
}

# Registered values, cached per process against the state directory they were read from. Mask files
# are immutable once renamed into place, so a file already read never has to be read again; only the
# directory listing is repeated, which is what lets `task.setsecret` in the parser subprocess reach
# the mask filter on the very next line (C-E06-058).
AZDO__MASK_CACHE_STATE_DIR=''
AZDO__MASK_CACHE_FILES=()
AZDO__MASK_VALUES=()

# shellcheck disable=SC2120 # Internal loader; it intentionally accepts no arguments.
azdo__mask_load_values() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo__mask_load_values' >&2
    return 2
  }

  local state_dir mask_dir file known value index seen
  local -a mask_files=()
  state_dir="$(azdo__state_dir)" || return
  if [[ "$state_dir" != "$AZDO__MASK_CACHE_STATE_DIR" ]]; then
    AZDO__MASK_CACHE_STATE_DIR="$state_dir"
    AZDO__MASK_CACHE_FILES=()
    AZDO__MASK_VALUES=()
  fi
  mask_dir="$state_dir/masks"
  [[ -d "$mask_dir" ]] || return 0

  shopt -s nullglob
  mask_files=("$mask_dir"/mask.*)
  shopt -u nullglob

  for file in "${mask_files[@]}"; do
    seen=false
    for known in "${AZDO__MASK_CACHE_FILES[@]}"; do
      if [[ "$known" = "$file" ]]; then
        seen=true
        break
      fi
    done
    [[ "$seen" = false ]] || continue
    AZDO__MASK_CACHE_FILES+=("$file")
    # The registered value is read byte-exactly: reading only its first line would mask that line on
    # its own, which the agent never does for a multiline secret (C-E06-131).
    azdo__read_file_exact "$file" value || return
    [[ -n "$value" ]] || continue
    seen=false
    for ((index = 0; index < ${#AZDO__MASK_VALUES[@]}; index++)); do
      if [[ "${AZDO__MASK_VALUES[$index]}" = "$value" ]]; then
        seen=true
        break
      fi
    done
    [[ "$seen" = false ]] || continue
    AZDO__MASK_VALUES+=("$value")
  done
}

# azdo__mask_line <line> <destination-variable>
#
# Every occurrence of every registered value becomes a character range; ranges that overlap *or*
# touch merge into one, and each merged range is replaced by a single `***` (C-E06-126). Replacing
# value by value instead would emit `a******h` where the agent emits `a***h`, and would let the
# first replacement hide a second value that straddles it.
azdo__mask_line() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__mask_line <line> <destination-variable>' >&2
    return 2
  }

  # Locals are named apart from the plausible destination names a caller might pass: `printf -v`
  # into a name this function also declares `local` would write to the local and leave the caller's
  # variable unset.
  local mask_line="$1" mask_value mask_rest mask_prefix mask_at mask_from mask_i mask_j
  local -a mask_starts=() mask_ends=()
  # shellcheck disable=SC2119 # The loader intentionally accepts no arguments.
  azdo__mask_load_values || return

  for mask_value in "${AZDO__MASK_VALUES[@]}"; do
    mask_at=0
    while ((mask_at <= ${#mask_line})); do
      mask_rest="${mask_line:mask_at}"
      [[ "$mask_rest" == *"$mask_value"* ]] || break
      mask_prefix="${mask_rest%%"$mask_value"*}"
      mask_from=$((mask_at + ${#mask_prefix}))
      mask_starts+=("$mask_from")
      mask_ends+=("$((mask_from + ${#mask_value}))")
      mask_at=$((mask_from + ${#mask_value}))
    done
  done

  if ((${#mask_starts[@]} == 0)); then
    printf -v "$2" '%s' "$mask_line"
    return 0
  fi

  for ((mask_i = 0; mask_i < ${#mask_starts[@]}; mask_i++)); do
    for ((mask_j = mask_i + 1; mask_j < ${#mask_starts[@]}; mask_j++)); do
      if ((mask_starts[mask_j] < mask_starts[mask_i])); then
        mask_from="${mask_starts[$mask_i]}"
        mask_starts[mask_i]="${mask_starts[$mask_j]}"
        mask_starts[mask_j]="$mask_from"
        mask_from="${mask_ends[$mask_i]}"
        mask_ends[mask_i]="${mask_ends[$mask_j]}"
        mask_ends[mask_j]="$mask_from"
      fi
    done
  done

  local mask_result='' mask_done=0
  local mask_open="${mask_starts[0]}" mask_close="${mask_ends[0]}"
  for ((mask_i = 1; mask_i <= ${#mask_starts[@]}; mask_i++)); do
    if ((mask_i < ${#mask_starts[@]} && mask_starts[mask_i] <= mask_close)); then
      ((mask_ends[mask_i] > mask_close)) && mask_close="${mask_ends[$mask_i]}"
      continue
    fi
    mask_result+="${mask_line:mask_done:mask_open-mask_done}***"
    mask_done="$mask_close"
    if ((mask_i < ${#mask_starts[@]})); then
      mask_open="${mask_starts[$mask_i]}"
      mask_close="${mask_ends[$mask_i]}"
    fi
  done
  mask_result+="${mask_line:mask_done}"
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

azdo__logging_task_setvariable() {
  local name secret output readonly_flag
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
  # Secret registration is the store's job (C-E06-123), including the sticky case where this
  # command omits `isSecret` over an already-secret variable.
  azdo_var_set \
    "$name" "$AZDO_LOGGING_MESSAGE" "$secret" "$output" "$readonly_flag" \
    "${AZDO_VAR_SCOPE:-pipeline}"
}

# E06-S04-T03 — command-scoped state. Handlers run inside the logging-stream subshell, so every
# effect a later phase needs (issue counts, a `task.complete` override, a failed command) has to be
# file-backed exactly like the masker. `run_step` points AZDO_COMMAND_STATE_DIR at a fresh
# per-attempt directory, mirroring the agent's reset of the record's issue counts before a retry.

azdo__command_state_dir() {
  local state_dir step_id
  if [[ -n "${AZDO_COMMAND_STATE_DIR:-}" ]]; then
    printf '%s\n' "$AZDO_COMMAND_STATE_DIR"
    return 0
  fi
  state_dir="$(azdo__state_dir)" || return
  step_id="${AZDO_STEP_ID:-current}"
  azdo__valid_store_segment "$step_id" || return
  printf '%s/commands/%s\n' "$state_dir" "$step_id"
}

# shellcheck disable=SC2120 # This reset intentionally accepts no arguments.
azdo_command_state_reset() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_command_state_reset' >&2
    return 2
  }
  local command_dir
  command_dir="$(azdo__command_state_dir)" || return
  rm -rf -- "$command_dir" || return
  mkdir -p "$command_dir"
}

azdo__command_state_read() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__command_state_read <name> <destination-variable>' >&2
    return 2
  }
  local command_dir value=''
  command_dir="$(azdo__command_state_dir)" || return
  if [[ -f "$command_dir/$1" ]]; then
    IFS= read -r value <"$command_dir/$1" || :
  fi
  printf -v "$2" '%s' "$value"
}

# Only counters, markers, and result names are persisted here. Handler messages are not, because
# the masker runs downstream of dispatch and could not scrub a secret already written to disk.
azdo__command_state_write() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__command_state_write <name> <value>' >&2
    return 2
  }
  local command_dir
  command_dir="$(azdo__command_state_dir)" || return
  mkdir -p "$command_dir" || return
  printf '%s\n' "$2" >"$command_dir/$1"
}

azdo__command_state_bump() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__command_state_bump <name>' >&2
    return 2
  }
  local current
  azdo__command_state_read "$1" current || return
  [[ "$current" =~ ^[0-9]+$ ]] || current=0
  azdo__command_state_write "$1" "$((current + 1))"
}

# azdo_step_issue_count <error|warning>
#
# Issues are counted, not tallied into the result: `AddIssue` only increments the record's counters
# and writes the tagged line, so a `task.logissue type=error` on its own leaves the step successful
# (C-E06-063). The result changes through a failed command (C-E06-064) or the step's exit status.
azdo_step_issue_count() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_step_issue_count <error|warning>' >&2
    return 2
  }
  local count
  case "$1" in
    error) azdo__command_state_read errors count || return ;;
    warning) azdo__command_state_read warnings count || return ;;
    *)
      printf 'unknown issue kind: %s\n' "$1" >&2
      return 2
      ;;
  esac
  [[ "$count" =~ ^[0-9]+$ ]] || count=0
  printf '%s\n' "$count"
}

# Prints the result accumulated from `task.complete` commands, or nothing when none ran.
# shellcheck disable=SC2120 # This reader intentionally accepts no arguments.
azdo_command_result() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_command_result' >&2
    return 2
  }
  local result
  azdo__command_state_read result result || return
  [[ -z "$result" ]] || printf '%s\n' "$result"
}

# Status 0 when at least one logging command failed during the current step attempt.
# shellcheck disable=SC2120 # This reader intentionally accepts no arguments.
azdo_command_failed() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_command_failed' >&2
    return 2
  }
  local marker
  azdo__command_state_read command-failed marker || return
  [[ "$marker" = true ]]
}

azdo__task_result_rank() {
  case "$1" in
    Succeeded) printf '%s\n' 0 ;;
    SucceededWithIssues) printf '%s\n' 1 ;;
    Failed) printf '%s\n' 2 ;;
    Canceled) printf '%s\n' 3 ;;
    Skipped) printf '%s\n' 4 ;;
    *)
      printf 'invalid task result: %s\n' "$1" >&2
      return 2
      ;;
  esac
}

# azdo_merge_task_results <current-or-empty> <coming>
#
# TaskResultUtil's worst-wins merge: an empty current result takes the incoming one, a current
# result worse than Failed is sticky, and otherwise the worse of the two wins (C-E06-060). The
# agent's `Abandoned` state has no local meaning and is deliberately outside this vocabulary.
azdo_merge_task_results() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_merge_task_results <current-or-empty> <coming>' >&2
    return 2
  }
  local current_rank coming_rank failed_rank
  azdo__valid_step_result "$2" || return
  if [[ -z "$1" ]]; then
    printf '%s\n' "$2"
    return 0
  fi
  azdo__valid_step_result "$1" || return
  current_rank="$(azdo__task_result_rank "$1")" || return
  coming_rank="$(azdo__task_result_rank "$2")" || return
  failed_rank="$(azdo__task_result_rank Failed)" || return
  if ((current_rank > failed_rank)) || ((coming_rank < current_rank)); then
    printf '%s\n' "$1"
  else
    printf '%s\n' "$2"
  fi
}

# The agent initializes WriteDebug from System.Debug and writes every `context.Debug` message only
# while it is true; `##vso[task.debug]` and the per-command `Processed:` note both travel that
# channel (C-E06-065).
azdo__system_debug_enabled() {
  local value
  value="$(azdo_var 'System.Debug')" || return 1
  [[ "$value" =~ ^[[:space:]]*[Tt][Rr][Uu][Ee][[:space:]]*$ ]]
}

azdo__debug_note() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__debug_note <message>' >&2
    return 2
  }
  azdo__system_debug_enabled || return 0
  printf '##[debug]%s\n' "$1"
}

# azdo__logging_record_issue <error|warning> <message>
#
# Reproduces AddIssue: the message is written back as a tagged line and the matching counter is
# incremented. Sourcepath/linenumber/columnnumber/code are parsed and validated but have no local
# timeline record to carry them, so they do not alter the emitted line (C-E06-062/063).
azdo__logging_record_issue() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__logging_record_issue <error|warning> <message>' >&2
    return 2
  }
  case "$1" in
    error) azdo__command_state_bump errors || return ;;
    warning) azdo__command_state_bump warnings || return ;;
    *)
      printf 'unknown issue kind: %s\n' "$1" >&2
      return 2
      ;;
  esac
  printf '##[%s]%s\n' "$1" "$2"
}

azdo__logging_task_prependpath() {
  local value="$AZDO_LOGGING_MESSAGE" path_dir entry index next=1
  [[ -n "$value" ]] || {
    printf '%s\n' 'Value of prependpath command must not be empty.' >&2
    return 1
  }

  # An entry repeated later in the job moves to the newest position; the environment pass already
  # implements that as newest-wins de-duplication, so a plain append is enough (C-E06-012/057).
  path_dir="$(azdo__state_dir)/path.d" || return
  mkdir -p "$path_dir" || return
  for entry in "$path_dir"/*; do
    [[ -f "$entry" ]] || continue
    index="${entry##*/}"
    index="${index%%-*}"
    [[ "$index" =~ ^[0-9]+$ ]] || continue
    ((10#$index >= next)) && next=$((10#$index + 1))
  done
  printf '%s' "$value" >"$(printf '%s/%09d-prependpath' "$path_dir" "$next")"
}

azdo__logging_task_setsecret() {
  # Registration is job-scoped and forward-only: output already written keeps the clear value
  # (C-E06-058). An empty value is ignored by AddSecret, and no multiline guard applies here —
  # that check lives in the setvariable handler alone (C-E06-055).
  azdo_mask_register "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_task_complete() {
  local result_text folded_result canonical current merged done_text
  if ! azdo_logging_property result result_text || [[ -z "$result_text" ]]; then
    printf '%s\n' "Command doesn't have valid result value." >&2
    return 1
  fi
  azdo__logging_fold "$result_text" folded_result || return
  case "$folded_result" in
    succeeded) canonical=Succeeded ;;
    succeededwithissues) canonical=SucceededWithIssues ;;
    failed) canonical=Failed ;;
    canceled) canonical=Canceled ;;
    skipped) canonical=Skipped ;;
    *)
      # The agent would also parse `Abandoned`, a server-assigned state the local five-state store
      # has no room for; every other unparseable value fails the command there too (C-E06-059).
      printf '%s\n' "Command doesn't have valid result value." >&2
      return 1
      ;;
  esac

  # shellcheck disable=SC2119 # The reader takes no arguments.
  current="$(azdo_command_result)" || return
  merged="$(azdo_merge_task_results "$current" "$canonical")" || return
  azdo__command_state_write result "$merged" || return

  azdo__logging_bool_property 'done' done_text || return
  [[ "$done_text" = true ]] &&
    azdo__debug_note 'task.complete done=true has no local force-complete seam; ignored.'
  return 0
}

azdo__logging_task_logissue() {
  local type_text folded_type
  if ! azdo_logging_property type type_text || [[ -z "$type_text" ]]; then
    # The agent reports this through context.Warning, which is itself a warning issue.
    azdo__logging_record_issue warning "Can't create TaskIssue from logging event."
    return 0
  fi
  azdo__logging_fold "$type_text" folded_type || return
  case "$folded_type" in
    error | warning) azdo__logging_record_issue "$folded_type" "$AZDO_LOGGING_MESSAGE" ;;
    *)
      printf 'issue type %s is not an expected issue type.\n' "$type_text" >&2
      return 1
      ;;
  esac
}

azdo__logging_task_setprogress() {
  # Percent-complete and current operation belong to a timeline record the local runtime does not
  # have; the command is accepted and noted on the debug channel only (C-E06-067).
  local value
  azdo_logging_property value value || :
  azdo__debug_note "task.setprogress ignored (value=${value:-0}): no local timeline record."
}

azdo__logging_task_debug() {
  azdo__debug_note "$AZDO_LOGGING_MESSAGE"
}

# --- E06-S04-T04: artifact, attachment and build commands ---------------------------------------
#
# These four families all move bytes the hosted agent moves to the server. Locally the destinations
# are directories in the generated project: published artifacts under `.artifacts/<artifactname>/`
# (docs/04 §1/§7, the download source E06-S05-T01 reads), attachments under
# `<logs>/attachments/<type>/<name>`, and build tags under `state/tags`. The hosted transfers run on
# the agent's async command queue *after* the handler returns, so a hosted transfer failure surfaces
# at job end; here the copy is synchronous and a copy failure is a command failure (C-E06-083).

azdo__artifact_dir() {
  if [[ -z "${AZDO_ARTIFACT_DIR:-}" ]]; then
    printf '%s\n' 'AZDO_ARTIFACT_DIR must be set before using the artifact logging commands' >&2
    return 2
  fi
  printf '%s\n' "$AZDO_ARTIFACT_DIR"
}

azdo__attachment_dir() {
  if [[ -z "${AZDO_ATTACHMENT_DIR:-}" ]]; then
    printf '%s\n' 'AZDO_ATTACHMENT_DIR must be set before using the attachment logging commands' >&2
    return 2
  fi
  printf '%s\n' "$AZDO_ATTACHMENT_DIR"
}

# azdo__logging_attach_file <type> <name> <path>
#
# The one implementation behind `task.addattachment`, `task.uploadfile`, `task.uploadsummary`,
# `build.uploadlog` and `build.uploadsummary` — the agent has exactly one too, and the two task
# upload commands are literally calls into it with a derived type and `Path.GetFileName(data)` as
# the name (C-E06-074/075). Both `type` and `name` must be nonempty and the message must name an
# existing *file*; a directory is not accepted here, unlike `artifact.upload`.
#
# The agent additionally rejects `Path.GetInvalidFileNameChars()` in either value. That set is
# platform-dependent in .NET, so the strictly narrower `azdo__valid_store_segment` guard is reused
# instead of importing the Windows set — both values become local path segments, which is the
# reason the guard exists (C-E06-076).
azdo__logging_attach_file() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__logging_attach_file <type> <name> <path>' >&2
    return 2
  }
  local type="$1" name="$2" path="$3" attachment_dir target_dir

  if [[ -z "$type" ]]; then
    printf '%s\n' "Can't add task attachment, attachment type is not provided." >&2
    return 1
  fi
  if [[ -z "$name" ]]; then
    printf '%s\n' "Can't add task attachment, attachment name is not provided." >&2
    return 1
  fi
  if [[ -z "$path" || ! -f "$path" ]]; then
    printf '%s\n' 'Cannot upload task attachment file, attachment file location is not specified or attachment file does not exist on disk.' >&2
    return 1
  fi
  azdo__valid_store_segment "$type" || return 1
  azdo__valid_store_segment "$name" || return 1

  attachment_dir="$(azdo__attachment_dir)" || return
  target_dir="$attachment_dir/$type"
  mkdir -p "$target_dir" || return
  cp -f -- "$path" "$target_dir/$name"
}

azdo__logging_task_addattachment() {
  local type name
  azdo_logging_property type type || :
  azdo_logging_property name name || :
  azdo__logging_attach_file "$type" "$name" "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_task_uploadfile() {
  if [[ -z "$AZDO_LOGGING_MESSAGE" ]]; then
    printf '%s\n' 'Cannot upload file because file location is not specified.' >&2
    return 1
  fi
  # `FileAttachment` is the C# member name, used because the constant's wire value lives in the
  # closed WebApi assembly and is not citable (C-E06-079).
  azdo__logging_attach_file FileAttachment "${AZDO_LOGGING_MESSAGE##*/}" "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_task_uploadsummary() {
  if [[ -z "$AZDO_LOGGING_MESSAGE" ]]; then
    printf '%s\n' 'Cannot upload summary file, summary file location is not specified.' >&2
    return 1
  fi
  # The one attachment type whose wire value the doc page states, so the documented shorthand
  # identity with `task.addattachment type=Distributedtask.Core.Summary` is observable locally
  # (C-E06-079). The name is the file name, not the doc example's custom name (C-E06-074).
  azdo__logging_attach_file Distributedtask.Core.Summary "${AZDO_LOGGING_MESSAGE##*/}" "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_build_uploadlog() {
  if [[ -z "$AZDO_LOGGING_MESSAGE" || ! -f "$AZDO_LOGGING_MESSAGE" ]]; then
    printf "Log file path is not provided or file doesn't exist: '%s'\n" "$AZDO_LOGGING_MESSAGE" >&2
    return 1
  fi
  # Fixed attachment name, not the file's own (C-E06-077).
  azdo__logging_attach_file Log CustomToolLog "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_build_uploadsummary() {
  if [[ -z "$AZDO_LOGGING_MESSAGE" || ! -f "$AZDO_LOGGING_MESSAGE" ]]; then
    printf "Markdown summary file path is not provided or file doesn't exist: '%s'\n" "$AZDO_LOGGING_MESSAGE" >&2
    return 1
  fi
  # Deprecated on the agent but still installed, and distinct from `task.uploadsummary`: same type,
  # a prefixed name (C-E06-078). The doc page does not list it.
  azdo__logging_attach_file Distributedtask.Core.Summary \
    "CustomMarkDownSummary-${AZDO_LOGGING_MESSAGE##*/}" "$AZDO_LOGGING_MESSAGE"
}

azdo__logging_build_updatebuildnumber() {
  if [[ -z "$AZDO_LOGGING_MESSAGE" ]]; then
    printf '%s\n' 'Build number is required.' >&2
    return 1
  fi
  # Not trimmed, unlike addbuildtag (C-E06-080/082), and written through the unchecked path because
  # `Build.BuildNumber` is a read-only name that this command is specifically allowed to overwrite
  # (C-E06-081). Subsequent steps see the new value through the ordinary environment pass.
  azdo__write_var_unchecked 'Build.BuildNumber' "$AZDO_LOGGING_MESSAGE" false false false \
    "${AZDO_VAR_SCOPE:-pipeline}"
}

azdo__logging_build_addbuildtag() {
  local tag="$AZDO_LOGGING_MESSAGE" tags_path existing folded_tag folded_existing
  # The agent trims before the emptiness check; a whitespace-only tag is therefore rejected
  # (C-E06-082).
  tag="${tag#"${tag%%[![:space:]]*}"}"
  tag="${tag%"${tag##*[![:space:]]}"}"
  if [[ -z "$tag" ]]; then
    printf '%s\n' 'Build tag is required.' >&2
    return 1
  fi
  # Server-side tags are a set compared OrdinalIgnoreCase, so a repeat is a no-op rather than a
  # second line (C-E06-082). The doc's "no colon" restriction is enforced by the server, not the
  # agent, and is deliberately not reproduced here.
  azdo__logging_fold "$tag" folded_tag || return
  tags_path="$(azdo__state_dir)/tags" || return
  if [[ -f "$tags_path" ]]; then
    while IFS= read -r existing || [[ -n "$existing" ]]; do
      azdo__logging_fold "$existing" folded_existing || return
      [[ "$folded_existing" = "$folded_tag" ]] && return 0
    done <"$tags_path"
  fi
  printf '%s\n' "$tag" >>"$tags_path"
}

# azdo__logging_artifact_copy <source> <destination-root>
#
# Reproduces the container item paths of C-E06-071 as a local tree: a file source contributes its
# basename, a directory source contributes its *contents* — its own name never appears.
azdo__logging_artifact_copy() {
  local source="$1" destination="$2" entry relative target
  mkdir -p "$destination" || return
  if [[ -f "$source" ]]; then
    cp -f -- "$source" "$destination/${source##*/}"
    return
  fi
  # `TrimEnd(Path.DirectorySeparatorChar, ...)`, and only on the directory branch — the file branch
  # takes `Path.GetDirectoryName` instead, and trimming before the `-f` test above would accept
  # `file.txt/`, where `File.Exists` is false (C-E06-071). Without it a trailing slash leaves the
  # prefix strip below unmatched and the whole absolute path lands inside the artifact.
  source="${source%"${source##*[!/]}"}"
  while IFS= read -r -d '' entry; do
    relative="${entry#"$source"/}"
    target="$destination/$relative"
    mkdir -p "${target%/*}" || return
    cp -f -- "$entry" "$target" || return
  done < <(find "$source" -type f -print0)
}

azdo__logging_artifact_upload() {
  local artifact_name container_folder source artifact_dir destination meta_dir

  if ! azdo_logging_property artifactname artifact_name || [[ -z "$artifact_name" ]]; then
    printf '%s\n' 'Artifact Name is required.' >&2
    return 1
  fi
  # Absent or empty containerfolder defaults to the artifact name (C-E06-069).
  azdo_logging_property containerfolder container_folder || :
  [[ -n "$container_folder" ]] || container_folder="$artifact_name"

  source="$AZDO_LOGGING_MESSAGE"
  if [[ -z "$source" ]]; then
    printf '%s\n' 'Artifact location is required.' >&2
    return 1
  fi
  if [[ ! -e "$source" ]]; then
    printf 'Path does not exist: %s\n' "$source" >&2
    return 1
  fi
  if [[ -d "$source" ]] && [[ -z "$(find "$source" -type f -print -quit)" ]]; then
    # A successful no-op with a counted warning issue, not a failure — the one case where the
    # obvious implementation gets the agent backwards (C-E06-070).
    azdo__logging_record_issue warning \
      "Directory '$source' is empty. Nothing will be added to build artifact '$artifact_name'."
    return
  fi

  azdo__valid_store_segment "$artifact_name" || return 1
  artifact_dir="$(azdo__artifact_dir)" || return
  # `.artifacts/` is keyed by **artifact name**, because that is what a later download asks for and
  # what E06-S05-T01 resolves against `$(Pipeline.Workspace)/<name>`; the container folder is the
  # coordinate of the bytes *inside* the container and does not appear in a downloaded tree
  # (C-E06-072, docs/06 §5 decision 37). It is recorded beside the artifact so the second level the
  # service would see is not silently lost.
  destination="$artifact_dir/$artifact_name"
  azdo__logging_artifact_copy "$source" "$destination" || return
  meta_dir="$artifact_dir/.meta"
  mkdir -p "$meta_dir" || return
  printf 'type=container\ncontainerfolder=%s\n' "$container_folder" >"$meta_dir/$artifact_name"
}

azdo__logging_artifact_associate() {
  local artifact_name artifact_type location artifact_dir meta_dir
  if ! azdo_logging_property artifactname artifact_name || [[ -z "$artifact_name" ]]; then
    printf '%s\n' 'Artifact Name is required.' >&2
    return 1
  fi
  if ! azdo_logging_property type artifact_type || [[ -z "$artifact_type" ]]; then
    printf '%s\n' 'Artifact Type is required.' >&2
    return 1
  fi
  location="$AZDO_LOGGING_MESSAGE"
  if [[ -z "$location" ]]; then
    printf '%s\n' 'Artifact location is required.' >&2
    return 1
  fi
  azdo__valid_store_segment "$artifact_name" || return 1

  # The location is a *server-side* coordinate — file container, UNC share, TFVC path or git ref —
  # so there is nothing to materialize. The command is accepted, validated and recorded, following
  # the `task.setprogress` pattern rather than the unknown-command path, because the hosted agent
  # accepts it and a passthrough warning would be the wrong parity signal (C-E06-073).
  artifact_dir="$(azdo__artifact_dir)" || return
  meta_dir="$artifact_dir/.meta"
  mkdir -p "$meta_dir" || return
  printf 'type=%s\nassociated=%s\n' "$artifact_type" "$location" >"$meta_dir/$artifact_name"
  azdo__debug_note "artifact.associate recorded '$artifact_name' ($artifact_type): no local bytes to copy."
}

# Status 127 means the command is unknown to the local runtime; other non-zero statuses are handler
# failures. `release.*` and the remaining `task.*` timeline commands (`logdetail`, `setendpoint`,
# `settaskvariable`) are deliberately still unknown here: they act on server-side state the local
# runtime has no counterpart for, so they take the warning-and-passthrough path (C-E06-048/049).
azdo_logging_dispatch() {
  case "$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION" in
    task.setvariable) azdo__logging_task_setvariable ;;
    task.prependpath) azdo__logging_task_prependpath ;;
    task.setsecret) azdo__logging_task_setsecret ;;
    task.complete) azdo__logging_task_complete ;;
    task.logissue | task.issue) azdo__logging_task_logissue ;;
    task.setprogress) azdo__logging_task_setprogress ;;
    task.debug) azdo__logging_task_debug ;;
    task.addattachment) azdo__logging_task_addattachment ;;
    task.uploadfile) azdo__logging_task_uploadfile ;;
    task.uploadsummary) azdo__logging_task_uploadsummary ;;
    artifact.upload) azdo__logging_artifact_upload ;;
    artifact.associate) azdo__logging_artifact_associate ;;
    build.uploadlog) azdo__logging_build_uploadlog ;;
    build.uploadsummary) azdo__logging_build_uploadsummary ;;
    build.updatebuildnumber) azdo__logging_build_updatebuildnumber ;;
    build.addbuildtag) azdo__logging_build_addbuildtag ;;
    *) return 127 ;;
  esac
}

azdo__logging_process_line() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo__logging_process_line <line>' >&2
    return 2
  }

  local parse_status dispatch_status
  if azdo_logging_parse_line "$1"; then
    parse_status=0
  else
    parse_status=$?
  fi

  local unescaped
  case "$parse_status" in
    0)
      if azdo_logging_dispatch; then
        # Every processed command except task.debug itself is traced on the gated debug channel,
        # in the agent's decoded wire form (C-E06-065).
        if [[ "$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION" != task.debug ]]; then
          azdo__logging_unescape "$1" unescaped || return
          azdo__debug_note "Processed: $unescaped" || return
        fi
        return 0
      else
        dispatch_status=$?
      fi
      if ((dispatch_status == 127)); then
        # The local-debug passthrough is intentional even though the hosted agent consumes a parsed
        # unknown-area line after warning (C-E06-048/049). The agent reports the unknown command
        # through context.Warning, so it is also a counted warning issue (C-E06-063).
        azdo__logging_record_issue warning \
          "Unknown Azure Pipelines logging command '$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION'; passing through unchanged." ||
          return
        printf '%s\n' "$1"
        return 0
      fi
      # A failing handler is an error issue plus CommandResult=Failed, and output processing
      # continues with the next line — aborting the stream would drop the rest of the step's
      # console and log output (C-E06-064). The agent's message interpolates the whole wire line;
      # this one names only the command, deliberately, because a handler that rejects a value
      # (multiline secret, read-only overwrite) fails *before* registering it with the masker,
      # which runs downstream of dispatch and could not scrub it from the console or the log.
      azdo__logging_record_issue error \
        "Unable to process command '$AZDO_LOGGING_AREA.$AZDO_LOGGING_ACTION' successfully." || return
      azdo__command_state_write command-failed true || return
      return 0
      ;;
    1)
      printf '%s\n' "$1"
      ;;
    2)
      azdo__logging_record_issue warning \
        'Malformed Azure Pipelines logging command; passing through unchanged.' || return
      printf '%s\n' "$1"
      ;;
    *) return "$parse_status" ;;
  esac
}

# azdo_render_stream
#
# Console rendering of the formatting commands (C-E06-066). It runs after the log tee, so ANSI
# escapes never reach `logs/<stage>/<job>/<step>.log` and a rendering decision cannot corrupt the
# recorded output. `##[debug]` lines are console-hidden unless System.Debug is true — a deliberate
# local decision (docs/06 §5 decision 36), since the agent gates its own debug channel rather than
# filtering echoed formatter tags. The filter never fails: it sits in run_step's pipefail pipeline.
# shellcheck disable=SC2120 # This stream filter intentionally accepts no arguments.
azdo_render_stream() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_render_stream' >&2
    return 2
  }

  local color=false debug=false line tag body
  azdo__render_color_enabled && color=true
  azdo__system_debug_enabled && debug=true

  while IFS= read -r line || [[ -n "$line" ]]; do
    tag=''
    body="$line"
    if [[ "$line" = '##['*']'* ]]; then
      tag="${line#\#\#[}"
      tag="${tag%%]*}"
      body="${line#*]}"
    fi
    case "$tag" in
      debug) [[ "$debug" = true ]] || continue ;;
      group | endgroup | section | command | warning | error) ;;
      *) tag='' ;;
    esac
    if [[ -z "$tag" || "$color" != true ]]; then
      printf '%s\n' "$line"
      continue
    fi
    case "$tag" in
      group) printf '\033[1;36m%s\033[0m\n' "$body" ;;
      endgroup) : ;;
      section) printf '\033[1m%s\033[0m\n' "$body" ;;
      command) printf '\033[34m%s\033[0m\n' "$body" ;;
      warning) printf '\033[33m%s\033[0m\n' "$body" ;;
      error) printf '\033[31m%s\033[0m\n' "$body" ;;
      debug) printf '\033[2m%s\033[0m\n' "$body" ;;
    esac
  done
  return 0
}

# NO_COLOR (https://no-color.org) and an explicit AZDO_COLOR override the terminal probe. The probe
# is meaningful because the renderer's stdout is the real console, not the log pipe.
azdo__render_color_enabled() {
  case "${AZDO_COLOR:-auto}" in
    always) return 0 ;;
    never) return 1 ;;
    *) [[ -z "${NO_COLOR+set}" && -t 1 ]] ;;
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
  # that stream before it is teed to the console and log (C-E06-044); ANSI rendering runs after the
  # tee so the log file keeps the raw agent-shaped lines (C-E06-066, docs/06 §5 decision 36).
  (
    set -o pipefail
    # shellcheck disable=SC2119 # The stream filters intentionally accept no arguments.
    azdo_logging_stream <"$fifo" 2>&1 | azdo_mask_stream | tee -a -- "$log_file" |
      azdo_render_stream
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
  local continue_on_error='' fail_on_stderr='' retries='' timeout_seconds='' step_name=''
  local seen_id=false seen_file=false seen_condition=false seen_display=false seen_wd=false
  local seen_name=false
  local seen_continue=false seen_fail_on_stderr=false seen_retries=false seen_timeout=false
  local no_condition=false seen_no_condition=false condition_status=0 condition_error=''
  local expanded_file expanded_wd ignored_secret log_file status result attempt_result
  local error_count warning_count issues_dir issues_path
  # Dynamically scoped for the logging-stream subshell, exactly like AZDO_EXPR_ERROR_FILE below:
  # per step *and* per job scope, so concurrent steps cannot reset each other's command state.
  # shellcheck disable=SC2034 # Read by azdo__command_state_dir in the stream subshell.
  local AZDO_COMMAND_STATE_DIR
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
      # E11-S04-T01: the authored `name:`, which output variables reference (C-E12-032). Optional,
      # because most steps have none — but without it `azdo_var_set … output=true` refuses, so
      # *every* `##vso[task.setvariable isOutput=true]` in a generated project failed.
      --name)
        [[ "$seen_name" = false ]] || {
          printf '%s\n' 'duplicate run_step option: --name' >&2
          return 2
        }
        seen_name=true
        step_name="$2"
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
  azdo__valid_store_segment "${AZDO_VAR_SCOPE:-pipeline}" || return
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

  AZDO_COMMAND_STATE_DIR="$(azdo__state_dir)/commands/${AZDO_VAR_SCOPE:-pipeline}/$id" || return

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
      # Duration 0: a skipped step never ran, and reporting the condition-evaluation time as the
      # step's duration would misattribute it.
      azdo_summary_record "$id" "$display" Skipped 0 "$log_file" || return
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
      azdo_summary_record "$id" "$display" Failed 0 "$log_file" || return
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

  # C-E12-032: `azdo_var_set … output=true` refuses without this, so a step that declares `name:`
  # and writes `##vso[task.setvariable isOutput=true]` needs it exported for the whole attempt —
  # including the logging-command subshell, which is where the write actually happens.
  #
  # Set **only when the flag was given**, never cleared otherwise: an unconditional assignment
  # would overwrite a value the caller exported itself, which is how the runtime was driven before
  # this flag existed and is still how `run_test_step` drives it. The flag is the source of truth
  # when present; absence means "the caller decides", not "there is no name".
  if [[ "$seen_name" = true ]]; then
    export AZDO_STEP_NAME="$step_name"
  fi

  expanded_file="$(azdo_expand_macros "$file")" || return

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

    # Issue counters and any task.complete override belong to this attempt alone: the agent clears
    # the record's counts before re-running a failed task (C-E06-035, C-E06-063).
    # shellcheck disable=SC2119 # The reset takes no arguments.
    azdo_command_state_reset || return

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

    # Result precedence per C-E06-061: task.complete has already merged its own commands, a failed
    # attempt then *assigns* Failed over that value, and command failures merge afterwards.
    # shellcheck disable=SC2119 # The reader takes no arguments.
    attempt_result="$(azdo_command_result)" || return
    ((status == 0)) || attempt_result=Failed
    # shellcheck disable=SC2119 # The reader takes no arguments.
    if azdo_command_failed; then
      attempt_result="$(azdo_merge_task_results "$attempt_result" Failed)" || return
    fi
    [[ -n "$attempt_result" ]] || attempt_result=Succeeded

    # The agent retries only while the attempt result is exactly Failed (C-E06-035), which now
    # includes an exit-zero attempt failed by task.complete or by a failing logging command.
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

  # Independent of which loop exit ran: a nonzero status is Failed regardless (C-E06-061).
  ((status == 0)) || attempt_result=Failed
  result="${attempt_result:-Succeeded}"
  if [[ "$result" = Failed && "$continue_on_error" = true ]]; then
    result=SucceededWithIssues
  fi
  azdo_step_result_set "$id" "$result" || return
  azdo_summary_record "$id" "$display" "$result" "$((SECONDS - start_seconds))" "$log_file" || return

  # Counts are recorded next to the result for the run summary. They never move the result on their
  # own — only a failing command or the step's exit status does (C-E06-063/064).
  error_count="$(azdo_step_issue_count error)" || return
  warning_count="$(azdo_step_issue_count warning)" || return
  issues_dir="$(azdo__step_result_dir)/issues" || return
  mkdir -p "$issues_dir" || return
  issues_path="$issues_dir/$id"
  printf 'errors=%s\nwarnings=%s\n' "$error_count" "$warning_count" >"$issues_path" || return

  case "$result" in
    Succeeded | SucceededWithIssues) return 0 ;;
    *)
      ((status != 0)) && return "$status"
      # A task.complete or command failure with a zero exit status still fails the step.
      return 1
      ;;
  esac
}

# ── E06-S05-T01 · pipeline artifact publish & download ────────────────────────
#
# `PublishPipelineArtifact@1` and `DownloadPipelineArtifact@2` are *agent plugin* tasks, so the
# behavior reproduced below is read from `src/Agent.Plugins/PipelineArtifact/PipelineArtifactPlugin{V1,V2}.cs`
# rather than from a task `main.ts` (C-E06-085/091). The local store is the same `.artifacts/<name>/`
# tree that `artifact.upload` writes (C-E06-072), which is why a download resolves an artifact by
# name and never by container folder.

# Two independent name rules, both applied: the agent's forbidden-character set is the parity rule,
# and the store-segment guard on top rejects "", "." and ".." — names the agent accepts but which
# cannot be a directory under `.artifacts/` (C-E06-093).
azdo__valid_artifact_name() {
  local name="$1"
  if [[ "$name" == *[[:cntrl:]]* ]] || [[ -n "${name//[^\":<>|*?\/\\]/}" ]]; then
    printf 'Artifact name is not valid: %s\n' "$name" >&2
    return 1
  fi
  azdo__valid_store_segment "$name" || return 1
}

# Translate the minimatch subset the artifact tasks actually use into an anchored ERE: `**` crosses
# directory separators, `*` and `?` do not. Brace expansion and bracket classes are *not* part of the
# subset — they are matched literally and announced, because silently treating `{a,b}` as one
# directory name would be a wrong answer rather than a missing one (C-E06-090).
azdo__artifact_pattern_regex() {
  local rest="$1" out='' char
  case "$rest" in
    *'{'* | *'['*)
      printf 'azdo-emu: artifact pattern %s uses brace/bracket syntax; matched literally (degraded)\n' \
        "$rest" >&2
      ;;
  esac
  while [[ -n "$rest" ]]; do
    case "$rest" in
      '**/'*)
        out+='(.*/)?'
        rest="${rest#\*\*/}"
        ;;
      '**'*)
        out+='.*'
        rest="${rest#\*\*}"
        ;;
      '*'*)
        out+='[^/]*'
        rest="${rest#\*}"
        ;;
      '?'*)
        out+='[^/]'
        rest="${rest#\?}"
        ;;
      *)
        char="${rest:0:1}"
        case "$char" in
          '.' | '^' | '$' | '+' | '(' | ')' | '{' | '}' | '[' | ']' | '|' | \\) out+="\\$char" ;;
          *) out+="$char" ;;
        esac
        rest="${rest:1}"
        ;;
    esac
  done
  printf '%s\n' "^$out\$"
}

# azdo__artifact_filter <patterns>   —   candidate paths on stdin, selected paths on stdout
#
# The agent applies the patterns **in order to an accumulating map**: an include adds its matches,
# an exclude removes them. Order is load-bearing — `!*.md` followed by `**` selects everything —
# so this cannot be simplified into "match all includes, then subtract all excludes" (C-E06-090).
# Patterns are newline-delimited only; `;` is the `azdo_match` convention, not this one (C-E06-088).
azdo__artifact_filter() {
  local patterns="$1" raw pattern regex negate idx path
  local -a candidates=()
  local -A keep=()
  mapfile -t candidates
  while IFS= read -r raw; do
    pattern="${raw#"${raw%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [[ -n "$pattern" ]] || continue
    # Comments are skipped before the negation prefix is read, matching the agent's order.
    [[ "$pattern" != '#'* ]] || continue
    negate=0
    while [[ "$pattern" == '!'* ]]; do
      pattern="${pattern#!}"
      negate=$((negate ^ 1))
    done
    pattern="${pattern#"${pattern%%[![:space:]]*}"}"
    pattern="${pattern%"${pattern##*[![:space:]]}"}"
    [[ -n "$pattern" ]] || continue
    regex="$(azdo__artifact_pattern_regex "$pattern")" || return
    for idx in "${!candidates[@]}"; do
      path="${candidates[idx]}"
      [[ "$path" =~ $regex ]] || continue
      if ((negate == 0)); then keep["$path"]=1; else keep["$path"]=0; fi
    done
  done <<<"$patterns"
  for idx in "${!candidates[@]}"; do
    path="${candidates[idx]}"
    [[ "${keep[$path]:-0}" == 1 ]] && printf '%s\n' "$path"
  done
  return 0
}

# A relative `path`/`targetPath` resolves against System.DefaultWorkingDirectory, **not** against the
# pipeline workspace: the plugin source and the task.json help text disagree and the source wins
# (C-E06-089).
azdo__artifact_resolve_path() {
  local path="$1" base
  if [[ "$path" == /* ]]; then
    printf '%s\n' "$path"
    return 0
  fi
  base="$(azdo_var 'System.DefaultWorkingDirectory')" || return
  if [[ -z "$base" ]]; then
    printf 'System.DefaultWorkingDirectory must be set to resolve the relative path: %s\n' "$path" >&2
    return 1
  fi
  printf '%s\n' "${base%/}/$path"
}

azdo__artifact_workspace() {
  local workspace
  workspace="$(azdo_var 'Pipeline.Workspace')" || return
  if [[ -z "$workspace" ]]; then
    printf '%s\n' 'Pipeline.Workspace must be set before downloading artifacts' >&2
    return 1
  fi
  printf '%s\n' "$workspace"
}

# `[^a-zA-Z0-9 - .]` is deleted, then the literal `.default` is removed (C-E06-091). The `-` in that
# .NET class is consumed as a range operator between the two spaces, so the surviving characters are
# alphanumerics, space and `.` — which is exactly why `Build.Job1.__default` normalizes to
# `Build.Job1`: the underscores are stripped first, leaving `.default` to be removed.
azdo__artifact_default_name() {
  local identifier name
  identifier="$(azdo_var 'System.JobIdentifier')" || return
  name="${identifier//[^A-Za-z0-9 .]/}"
  name="${name//.default/}"
  if [[ -z "$name" ]]; then
    printf '%s\n' 'Artifact name is required: System.JobIdentifier is empty, so no default name can be derived' >&2
    return 1
  fi
  printf '%s\n' "$name"
}

azdo__artifact_meta_field() {
  local name="$1" field="$2" artifact_dir meta_path line
  artifact_dir="$(azdo__artifact_dir)" || return
  meta_path="$artifact_dir/.meta/$name"
  [[ -f "$meta_path" ]] || return 0
  while IFS= read -r line; do
    if [[ "$line" == "$field="* ]]; then
      printf '%s\n' "${line#"$field="}"
      return 0
    fi
  done <"$meta_path"
}

# Relative paths of every file under an artifact root, sorted so a download is reproducible. The
# optional prefix is the artifact name the multi-download branch matches patterns against.
azdo__artifact_entries() {
  local root="$1" prefix="${2-}" entry
  [[ -d "$root" ]] || return 0
  while IFS= read -r -d '' entry; do
    printf '%s%s\n' "$prefix" "${entry#"$root"/}"
  done < <(find "$root" -type f -print0 | LC_ALL=C sort -z)
}

# azdo_artifact_publish --path <file-or-directory> [--artifact <name>]
#
# The pipeline-artifact counterpart of `artifact.upload`. A directory contributes its *contents* at
# the artifact root and a file contributes its basename, so the copy rule is shared with the file
# container (C-E06-094/071). Unlike `artifact.upload` there is no empty-directory special case:
# publishing an empty directory is a plain success (C-E06-092).
azdo_artifact_publish() {
  local path='' artifact_name='' resolved artifact_dir destination meta_dir
  while (($# > 0)); do
    case "$1" in
      --path)
        path="${2-}"
        shift 2 || return 2
        ;;
      --artifact)
        artifact_name="${2-}"
        shift 2 || return 2
        ;;
      *)
        printf 'usage: azdo_artifact_publish --path <file-or-directory> [--artifact <name>]\n' >&2
        return 2
        ;;
    esac
  done
  if [[ -z "$path" ]]; then
    printf '%s\n' 'azdo_artifact_publish: --path is required' >&2
    return 2
  fi

  resolved="$(azdo__artifact_resolve_path "$path")" || return
  [[ -n "$artifact_name" ]] || artifact_name="$(azdo__artifact_default_name)" || return
  azdo__valid_artifact_name "$artifact_name" || return 1

  if [[ ! -f "$resolved" ]] && [[ ! -d "$resolved" ]]; then
    printf 'Path does not exist: %s\n' "$path" >&2
    return 1
  fi

  artifact_dir="$(azdo__artifact_dir)" || return
  destination="$artifact_dir/$artifact_name"
  azdo__logging_artifact_copy "$resolved" "$destination" || return
  meta_dir="$artifact_dir/.meta"
  mkdir -p "$meta_dir" || return
  printf 'type=pipeline\n' >"$meta_dir/$artifact_name" || return
  printf 'Uploading pipeline artifact from %s for artifact %s\n' "$resolved" "$artifact_name"
}

# Selected paths on stdin; the optional prefix is stripped back off before they are resolved
# against the artifact root. Prefixing is done with parameter expansion rather than `sed` because an
# artifact name may legally contain `.`, `[`, `(` and `$` (C-E06-093), which a regex would eat.
azdo__artifact_copy_selected() {
  local root="$1" target="$2" prefix="${3-}" relative source destination
  while IFS= read -r relative; do
    [[ -n "$relative" ]] || continue
    relative="${relative#"$prefix"}"
    source="$root/$relative"
    destination="$target/$relative"
    mkdir -p "${destination%/*}" || return
    cp -f -- "$source" "$destination" || return
  done
}

# azdo_artifact_download [--artifact <name>] [--patterns <patterns>] [--path <dir>] [--source current]
#
# Task semantics, not `download:`-keyword semantics: `--path` defaults to `$(Pipeline.Workspace)` and
# a named artifact lands *at* that path, while an unnamed download creates one subdirectory per
# artifact (C-E06-085/086/087). The keyword's `$(Pipeline.Workspace)/<name>` layout (C-E06-084) is
# the emitter's job to pass through `--path`; see docs/06 §5 decision 39.
azdo_artifact_download() {
  local artifact_name='' patterns='' target='' source='current'
  local artifact_dir root resolved selected entry meta_type associated
  while (($# > 0)); do
    case "$1" in
      --artifact)
        artifact_name="${2-}"
        shift 2 || return 2
        ;;
      --patterns)
        patterns="${2-}"
        shift 2 || return 2
        ;;
      --path)
        target="${2-}"
        shift 2 || return 2
        ;;
      --source)
        source="${2-}"
        shift 2 || return 2
        ;;
      *)
        printf 'usage: azdo_artifact_download [--artifact <name>] [--patterns <p>] [--path <dir>] [--source current]\n' >&2
        return 2
        ;;
    esac
  done

  # `specific` needs a run id, a REST fetch and the lockfile-pinned `.cache/artifacts/` tree (E08).
  if [[ "$source" != current ]]; then
    printf 'azdo_artifact_download: --source %s is not supported yet (only "current"; see E08)\n' \
      "$source" >&2
    return 1
  fi
  # Empty means `**`, and the value splits on newline only (C-E06-088).
  [[ -n "$patterns" ]] || patterns='**'
  [[ -n "$target" ]] || target="$(azdo__artifact_workspace)" || return
  resolved="$(azdo__artifact_resolve_path "$target")" || return
  mkdir -p "$resolved" || return
  artifact_dir="$(azdo__artifact_dir)" || return
  printf 'Downloading artifacts to %s\n' "$resolved"

  if [[ -n "$artifact_name" ]]; then
    azdo__valid_artifact_name "$artifact_name" || return 1
    root="$artifact_dir/$artifact_name"
    associated="$(azdo__artifact_meta_field "$artifact_name" associated)" || return
    if [[ -n "$associated" ]]; then
      printf 'Artifact %s is an associated artifact at %s: it has no local content to download.\n' \
        "$artifact_name" "$associated" >&2
      return 1
    fi
    if [[ ! -d "$root" ]]; then
      printf 'Artifact not found: %s\n' "$artifact_name" >&2
      return 1
    fi
    # Patterns are relative to the artifact root and the files land directly in the target
    # directory — no per-artifact subdirectory on this branch (C-E06-086).
    selected="$(azdo__artifact_entries "$root" | azdo__artifact_filter "$patterns")" || return
    printf '%s\n' "$selected" | azdo__artifact_copy_selected "$root" "$resolved" || return
    return 0
  fi

  # No name: every artifact of the run, one subdirectory each, patterns matched against
  # `<artifact>/<relative path>`, and no failure when nothing matches (C-E06-087).
  for root in "$artifact_dir"/*/; do
    root="${root%/}"
    entry="${root##*/}"
    [[ "$entry" != .meta ]] || continue
    [[ -d "$root" ]] || continue
    meta_type="$(azdo__artifact_meta_field "$entry" type)" || return
    associated="$(azdo__artifact_meta_field "$entry" associated)" || return
    if [[ -n "$associated" ]]; then
      azdo__debug_note "Skipping associated artifact '$entry' ($meta_type): no local bytes to copy."
      continue
    fi
    selected="$(azdo__artifact_entries "$root" "$entry/" | azdo__artifact_filter "$patterns")" || return
    printf '%s\n' "$selected" | azdo__artifact_copy_selected "$root" "$resolved/$entry" "$entry/" || return
  done
  return 0
}

# The injection point for deployment jobs: "All available artifacts ... are automatically downloaded
# in deployment jobs", to `$(Pipeline.Workspace)`, only for the `deploy` lifecycle hook, and only
# when no `download: none` step is present (C-E06-096). That is exactly the no-name branch above, so
# this is a passthrough the emitter can name rather than a second implementation.
azdo_artifact_auto_download() {
  azdo_artifact_download "$@"
}

# E06-S05-T02 — checkout emulation for the `self` repository (docs/04 §8).
#
# The hosted implementation is not a task with a `main.ts`: `checkout` compiles to the `Get sources`
# job step, so the option → git-flag mapping below is read from the agent's `GitCliManager`
# (C-E06-097..104). Three of the six options have a *hosted* default that no YAML file records — the
# clean/shallow-fetch/sync-tags pipeline settings — so this library uses the agent's own
# empty-input defaults, which are `clean=false`, `fetchDepth=0` and `fetchTags=true`
# (C-E06-099/100, docs/06 §5 decision 40).

# Reproduces `StringUtil.ConvertToBoolean`: `1/true/$true` and `0/false/$false` case-insensitively,
# and *every other value* — `yes`, `no`, `on` — silently becomes the caller's default rather than an
# error (C-E06-100). That is why `clean: yes` does not clean while `fetchTags: yes` does sync tags.
azdo__checkout_bool() {
  local value="$1" fallback="$2"
  # shellcheck disable=SC2016 # `$true`/`$false` are literal PowerShell-shaped inputs the agent accepts.
  case "${value,,}" in
    1 | true | '$true') printf 'true\n' ;;
    0 | false | '$false') printf 'false\n' ;;
    *) printf '%s\n' "$fallback" ;;
  esac
}

# `int.TryParse` semantics: anything that is not a non-negative integer — including `abc` and `-1` —
# is the same as `0`, which means "no --depth flag" (C-E06-098).
azdo__checkout_fetch_depth() {
  local value="$1"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$((10#$value))"
  else
    printf '0\n'
  fi
}

# `''`/`false` → none, `recursive` → nested, any other truthy value → top level (C-E06-103).
azdo__checkout_submodules() {
  local value="$1"
  if [[ -z "$value" ]]; then
    printf 'none\n'
    return 0
  fi
  if [[ "${value,,}" == recursive ]]; then
    printf 'recursive\n'
    return 0
  fi
  if [[ "$(azdo__checkout_bool "$value" false)" == true ]]; then
    printf 'top\n'
  else
    printf 'none\n'
  fi
}

# Every git command runs with `GIT_LFS_SKIP_SMUDGE=1` unless `lfs: true` was requested, because a
# user- or system-level LFS config would otherwise pull assets down behind the pipeline's back
# (C-E06-104). The flag is read from `azdo_checkout`'s `local` through bash's dynamic scoping so it
# does not have to be threaded through every call site.
azdo__checkout_git() {
  if [[ "${azdo__checkout_lfs_enabled:-false}" == true ]]; then
    git "$@"
  else
    GIT_LFS_SKIP_SMUDGE=1 git "$@"
  fi
}

azdo__checkout_git_version_ge() {
  local want_major="$1" want_minor="$2" version major minor
  version="$(git --version 2>/dev/null)" || return 1
  version="${version##* }"
  major="${version%%.*}"
  minor="${version#*.}"
  minor="${minor%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] && [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  ((major > want_major)) && return 0
  ((major == want_major)) && ((minor >= want_minor))
}

azdo__checkout_note() {
  printf 'azdo-emu: %s (degraded)\n' "$1"
}

# The source repository a checkout is emulated from: for `self`, the local clone the project was
# converted in. `--source` wins, then AZDO_SELF_REPO, which the generated runner exports beside
# AZDO_STATE_DIR. E08 replaces the "current state of this repo" pin with the lockfile's origin+commit.
# AZDO_SELF_REPO is *only* a fallback for `self`: a non-`self` alias that silently checked out the
# self repository would produce a green run with the wrong files in it.
azdo__checkout_source() {
  local source="$1" repository="${2:-self}" resolved
  if [[ -z "$source" ]] && [[ "$repository" == self ]]; then
    source="${AZDO_SELF_REPO-}"
  fi
  if [[ -z "$source" ]]; then
    if [[ "$repository" == self ]]; then
      printf '%s\n' 'azdo_checkout: no self repository; pass --source or set AZDO_SELF_REPO' >&2
    else
      printf 'azdo_checkout: repository %s needs --source; only self falls back to AZDO_SELF_REPO\n' "$repository" >&2
    fi
    return 1
  fi
  if [[ ! -d "$source" ]]; then
    printf 'azdo_checkout: self repository does not exist: %s\n' "$source" >&2
    return 1
  fi
  resolved="$(cd "$source" && pwd -P)" || return 1
  if ! git -C "$resolved" rev-parse --git-dir >/dev/null 2>&1; then
    printf 'azdo_checkout: not a git repository: %s\n' "$resolved" >&2
    return 1
  fi
  if ! git -C "$resolved" rev-parse --verify -q HEAD >/dev/null 2>&1; then
    printf 'azdo_checkout: self repository has no commits: %s\n' "$resolved" >&2
    return 1
  fi
  printf '%s\n' "$resolved"
}

# E06-S05-T03 — the folder name a repository gets under multi-checkout is its `name` property run
# through git's own clone-directory algorithm, not the `checkout:` alias and not `basename`
# (C-E06-118). Ported from `RepositoryUtil.GetCloneDirectory`: strip a scheme, skip past the *last*
# `@` (so `ssh://user:passw@rd@host/` keeps `host`), trim trailing slashes and one `.git`, take the
# last `/`- then `:`-separated segment, and trim a trailing `:<digits>` port **only** when no slash
# was found at all (so `.../test:1234` keeps `1234`). The agent's own L0 table is the conformance
# fixture in `test/core.bats`.

# Last index of `ch` within the inclusive range, or -1 — `RepositoryUtil.FinalIndexOf`, including
# its out-of-range guard.
azdo__checkout_final_index_of() {
  local buffer="$1" ch="$2" start="$3" end="$4" len=${#1} i
  if ((start < 0 || end < 0 || start >= len || end >= len)); then
    printf '%s\n' -1
    return 0
  fi
  for ((i = end; i >= start; i--)); do
    if [[ "${buffer:i:1}" == "$ch" ]]; then
      printf '%s\n' "$i"
      return 0
    fi
  done
  printf '%s\n' -1
}

# `RepositoryUtil.SkipLastIndexOf`: the new start is one past the match, and a match sitting **on**
# `end` counts as not found — that is what keeps `host:/` and `ssh://host/` resolving to `host`.
# Prints "<index> <found>" because the `/` caller needs the flag and the others do not.
azdo__checkout_skip_last_index_of() {
  local buffer="$1" ch="$2" start="$3" end="$4" index
  index="$(azdo__checkout_final_index_of "$buffer" "$ch" "$start" "$end")"
  if ((index >= 0 && index < end)); then
    printf '%s true\n' "$((index + 1))"
  else
    printf '%s false\n' "$start"
  fi
}

# `RepositoryUtil.TrimSlashesAndExtension`: trailing slashes/whitespace, then at most one `.git`
# (case-insensitively), then trailing slashes/whitespace again — the second pass is what makes
# `ssh://host/foo///.git/` and `ssh://host/foo/.git///` both reduce to `foo`.
azdo__checkout_trim_slashes_and_extension() {
  local buffer="$1" end="$2" len=${#1} char
  if ((end < 0 || end >= len)); then
    printf '%s\n' "$end"
    return 0
  fi
  while ((end > 0)); do
    char="${buffer:end:1}"
    [[ "$char" == / || "$char" == [[:space:]] ]] || break
    end=$((end - 1))
  done
  if ((end - 3 >= 0)) && [[ "${buffer:end-3:4}" == [.][Gg][Ii][Tt] ]]; then
    end=$((end - 4))
  fi
  while ((end > 0)); do
    char="${buffer:end:1}"
    [[ "$char" == / || "$char" == [[:space:]] ]] || break
    end=$((end - 1))
  done
  printf '%s\n' "$end"
}

# `RepositoryUtil.TrimPortNumber`: only reached when the name had no `/`, and only trims when what
# follows the last colon is empty or all digits.
azdo__checkout_trim_port_number() {
  local buffer="$1" end="$2" start="$3" last_colon rest
  last_colon="$(azdo__checkout_final_index_of "$buffer" ':' "$start" "$end")"
  if ((last_colon >= 0)); then
    rest="${buffer:last_colon+1:end-last_colon}"
    if ((last_colon == end)) || { [[ -n "$rest" ]] && [[ "$rest" =~ ^[0-9]+$ ]]; }; then
      printf '%s\n' "$((last_colon - 1))"
      return 0
    fi
  fi
  printf '%s\n' "$end"
}

azdo__checkout_clone_directory() {
  local name="$1" start end found prefix directory
  if [[ -z "$name" ]]; then
    printf 'azdo_checkout: repository name must not be empty\n' >&2
    return 1
  fi
  end=$((${#name} - 1))
  if [[ "$name" == *'://'* ]]; then
    prefix="${name%%://*}"
    start=$((${#prefix} + 3))
  else
    start=0
  fi
  read -r start found < <(azdo__checkout_skip_last_index_of "$name" '@' "$start" "$end")
  end="$(azdo__checkout_trim_slashes_and_extension "$name" "$end")"
  read -r start found < <(azdo__checkout_skip_last_index_of "$name" '/' "$start" "$end")
  if [[ "$found" == false ]]; then
    end="$(azdo__checkout_trim_port_number "$name" "$end" "$start")"
  fi
  read -r start found < <(azdo__checkout_skip_last_index_of "$name" ':' "$start" "$end")
  # C# throws `ArgumentOutOfRangeException` out of `Substring` here — `x://` is the shortest input
  # that reaches it. Refused with the message below rather than with a bash arithmetic error.
  if ((end < start)); then
    directory=''
  else
    directory="${name:start:end-start+1}"
  fi
  # No agent counterpart: the agent's repository names come from the service, this one can come from
  # a directory basename or a `--repo-name` the emitter passed through. A `.`/`..`/`/` segment would
  # resolve `s/<name>` back out of `s` — and `clean` deletes inside whatever it resolves to.
  case "$directory" in
    '' | . | .. | */*)
      printf 'azdo_checkout: repository name does not yield a usable directory: %s\n' "$name" >&2
      return 1
      ;;
  esac
  printf '%s\n' "$directory"
}

# The agent computes `HasMultipleCheckouts` **once, at job preparation**, from the job's step list,
# and the plugin that places the repository, the extension that seeds the variables and the
# directory manager all read that one setting (C-E06-115). The emitter knows the same step list
# statically, so it exports the answer per job beside AZDO_STATE_DIR rather than having the runtime
# count anything (docs/06 §5 decision 41).
azdo__checkout_has_multiple() {
  azdo__checkout_bool "${AZDO_HAS_MULTIPLE_CHECKOUTS-}" false
}

# `path` is resolved under `$(Pipeline.Workspace)` and escaping that root needs an explicit opt-in
# on the agent (C-E06-105); here it is simply refused. The guard is load-bearing beyond parity:
# `clean` runs `git clean -ffdx` and `copy` empties its target, so a path that escaped the workspace
# would let a pipeline delete the user's own files.
#
# The default the caller passes in is `s` for a single checkout and `s/<repoName>` when the job has
# more than one (C-E06-114); an explicit `path` wins over both and, like the default, is resolved
# against `$(Pipeline.Workspace)` — **not** against `s` (C-E06-114).
# `Path.GetFullPath(Path.Combine(base, path))`: purely lexical, no filesystem access. It has to be,
# for two reasons — `mkdir -p` first would leave an empty directory outside the workspace on its way
# to refusing the path, and the agent's own default-vs-custom `path` comparison (C-E06-117) compares
# two path *strings*, one of which may name a directory that will never exist.
azdo__checkout_normalize() {
  local base="$1" path="$2" resolved segment depth=0
  local -a parts=() stack=()
  if [[ "$path" == /* ]]; then
    resolved="$path"
  else
    resolved="$base/$path"
  fi
  IFS='/' read -r -a parts <<<"$resolved"
  for segment in "${parts[@]}"; do
    case "$segment" in
      '' | .) ;;
      ..)
        if ((depth > 0)); then
          depth=$((depth - 1))
          stack=("${stack[@]:0:depth}")
        fi
        ;;
      *)
        stack+=("$segment")
        depth=$((depth + 1))
        ;;
    esac
  done
  printf '/%s\n' "$(
    IFS=/
    printf '%s' "${stack[*]}"
  )"
}

azdo__checkout_target() {
  local path="${1-}" fallback="${2-s}" workspace resolved
  workspace="$(azdo__artifact_workspace)" || return 1
  workspace="$(cd "${workspace%/}" 2>/dev/null && pwd -P)" || {
    printf 'azdo_checkout: Pipeline.Workspace does not exist\n' >&2
    return 1
  }
  [[ -n "$path" ]] || path="$fallback"
  resolved="$(azdo__checkout_normalize "$workspace" "$path")" || return 1
  azdo__checkout_inside "$resolved" "$workspace" "$path" || return 1
  mkdir -p "$resolved" || return 1
  resolved="$(cd "$resolved" && pwd -P)" || return 1
  # Re-checked after the physical resolve, because a symlinked segment can point out of the
  # workspace even when every lexical segment stayed inside it.
  azdo__checkout_inside "$resolved" "$workspace" "$path" || return 1
  printf '%s\n' "$resolved"
}

azdo__checkout_inside() {
  local candidate="$1" workspace="$2" reported="$3"
  if [[ "$candidate" != "$workspace" ]] && [[ "$candidate" != "$workspace"/* ]]; then
    printf 'azdo_checkout: checkout path escapes Pipeline.Workspace: %s\n' "$reported" >&2
    return 1
  fi
}

# `git clean -ffdx` **and then** `git reset --hard HEAD`, in that order, plus the submodule pair when
# submodules are enabled (C-E06-101). `-fdx` below git 2.4.
azdo__checkout_clean() {
  local target="$1" submodules="$2" flags='-ffdx'
  azdo__checkout_git_version_ge 2 4 || flags='-fdx'
  azdo__checkout_git -C "$target" clean "$flags" || return 1
  azdo__checkout_git -C "$target" reset --hard HEAD || return 1
  if [[ "$submodules" != none ]]; then
    azdo__checkout_git -C "$target" submodule foreach --recursive "git clean $flags" || return 1
    azdo__checkout_git -C "$target" submodule foreach --recursive 'git reset --hard HEAD' || return 1
  fi
}

# `git submodule sync [--recursive]` then `git submodule update --init --force [--depth=N]
# [--recursive]`, reusing the checkout's own fetch depth (C-E06-103).
azdo__checkout_submodule_update() {
  local target="$1" submodules="$2" depth="$3"
  # `-c protocol.file.allow=always` is a **local relaxation with no agent counterpart** (C-E06-112,
  # docs/06 §5 decision 40f). Since CVE-2022-39253 git refuses the `file` transport for submodule
  # clones, and the emulated origin is `file://<source>` by construction (C-E06-109) — so without
  # it every `submodules: true` fails with "transport 'file' not allowed". The hosted agent never
  # meets this because its remotes are https. Scoped to the submodule commands, over repositories
  # the user already has on disk.
  local -a sync=(-c protocol.file.allow=always submodule sync)
  local -a update=(-c protocol.file.allow=always submodule update --init --force)
  if [[ "$submodules" == recursive ]]; then
    sync+=(--recursive)
  fi
  if ((depth > 0)); then
    update+=("--depth=$depth")
  fi
  if [[ "$submodules" == recursive ]]; then
    update+=(--recursive)
  fi
  azdo__checkout_git -C "$target" "${sync[@]}" || return 1
  azdo__checkout_git -C "$target" "${update[@]}" || return 1
}

# The agent's fetch line (C-E06-097). `--force` from git 2.20, `--prune-tags` from 2.17; `--depth=N`
# when a depth was asked for, `--unshallow` when it was not and the local repo is already shallow
# (C-E06-098).
azdo__checkout_fetch() {
  local target="$1" remote="$2" fetch_tags="$3" depth="$4"
  local -a options=()
  azdo__checkout_git_version_ge 2 20 && options+=(--force)
  if [[ "$fetch_tags" == true ]]; then
    options+=(--tags)
  else
    options+=(--no-tags)
  fi
  options+=(--prune)
  if azdo__checkout_git_version_ge 2 17; then
    # `--prune-tags` is a shorthand for the explicit `refs/tags/*:refs/tags/*` refspec, and an
    # explicit refspec beats `--no-tags`. The agent passes both, with the knob that would suppress
    # `--prune-tags` defaulting to off, so `fetchTags: false` does not in fact stop tags from being
    # synced (C-E06-111). Reproduced rather than "fixed": inventing a divergence to match the doc
    # page's prose would make the local run disagree with the hosted one.
    options+=(--prune-tags)
    [[ "$fetch_tags" == true ]] ||
      azdo__debug_note 'fetchTags: false is requested, but the agent also passes --prune-tags, which re-adds the refs/tags/* refspec — tags are still synced (C-E06-111)'
  fi
  options+=(--no-recurse-submodules "$remote")
  if ((depth > 0)); then
    options+=("--depth=$depth")
  elif [[ -f "$target/.git/shallow" ]]; then
    options+=(--unshallow)
  fi
  azdo__checkout_git -C "$target" fetch "${options[@]}"
}

# `clone` — the agent's own sequence: `git init` → `git remote add origin` → `git fetch` →
# `git checkout --progress --force <commit>`, ending at a detached HEAD (C-E06-102). The remote is
# `file://<source>` and not the bare path, because git silently ignores `--depth` for a local-path
# clone (C-E06-109) — which would make `fetchDepth` a no-op that reports success.
azdo__checkout_mode_clone() {
  local source="$1" target="$2" committish="$3" clean="$4" fetch_tags="$5" depth="$6" submodules="$7"
  local -a checkout=(checkout --force)
  mkdir -p "$target" || return 1
  if [[ -d "$target/.git" ]] && [[ "$clean" == true ]]; then
    azdo__checkout_clean "$target" "$submodules" || return 1
  fi
  if [[ ! -d "$target/.git" ]]; then
    azdo__checkout_git init -q "$target" || return 1
    azdo__checkout_git -C "$target" remote add origin "file://$source" || return 1
  else
    azdo__checkout_git -C "$target" remote set-url origin "file://$source" || return 1
  fi
  azdo__checkout_fetch "$target" origin "$fetch_tags" "$depth" || return 1
  azdo__checkout_git_version_ge 2 7 && checkout+=(--progress)
  azdo__checkout_git -C "$target" "${checkout[@]}" "$committish" || return 1
  if [[ "$submodules" != none ]]; then
    azdo__checkout_submodule_update "$target" "$submodules" "$depth" || return 1
  fi
}

# `copy` — the working tree as it is on disk, uncommitted changes included, which is the entire
# point of the mode (docs/04 §8). Copied with `tar` rather than `rsync`: rsync is not part of any
# base image this project targets and is absent from this container, while `tar` is POSIX and
# preserves modes, symlinks and hardlinks (docs/06 §5 decision 40).
azdo__checkout_mode_copy() {
  local source="$1" target="$2"
  mkdir -p "$target" || return 1
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + || return 1
  tar -cf - -C "$source" . | tar -xf - -C "$target" || return 1
}

# `worktree` — a detached worktree of the source repository. Re-running is the interesting case:
# `git worktree add` refuses a non-empty path and a branch that is already checked out elsewhere, so
# the previous worktree is removed and pruned first and `--detach` sidesteps the branch conflict.
azdo__checkout_mode_worktree() {
  local source="$1" target="$2" committish="$3"
  git -C "$source" worktree prune >/dev/null 2>&1 || :
  if [[ -e "$target" ]]; then
    git -C "$source" worktree remove --force "$target" >/dev/null 2>&1 || :
    git -C "$source" worktree prune >/dev/null 2>&1 || :
  fi
  if [[ -e "$target" ]] && [[ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    printf 'azdo_checkout: worktree target is not empty and could not be released: %s\n' "$target" >&2
    return 1
  fi
  rmdir "$target" 2>/dev/null || :
  azdo__checkout_git -C "$source" worktree add --detach "$target" "$committish" || return 1
}

# Seeded, never overwritten: docs/04 §8 makes these overridable through `.env` so a local run can
# simulate another branch or PR, and an override that the checkout then clobbered would be useless.
azdo__checkout_seed_var() {
  local name="$1" value="$2" current
  current="$(azdo_var "$name")" || return 1
  [[ -z "$current" ]] || return 0
  azdo_var_set "$name" "$value"
}

# The mode dispatch, shared by `self` and every other alias: the layout rules differ between them
# but what lands in the directory does not. `azdo__checkout_lfs_enabled` is the caller's local,
# reached through bash's dynamic scoping (C-E06-104), and is cleared here when the warning fires.
azdo__checkout_place() {
  local mode="$1" source="$2" target="$3" committish="$4" clean="$5" fetch_tags="$6" depth="$7"
  local submodules="$8" tags_input="$9"

  if [[ "$azdo__checkout_lfs_enabled" == true ]] && ! git lfs version >/dev/null 2>&1; then
    # The agent's own LFS pre-fetch failure is a warning and the checkout continues (C-E06-104);
    # a missing git-lfs binary is the local shape of the same situation.
    azdo__logging_record_issue warning \
      'lfs: true was requested but git-lfs is not installed; LFS files are left as pointers and the checkout continues.' || return 1
    azdo__checkout_lfs_enabled=false
  fi

  case "$mode" in
    clone)
      azdo__checkout_mode_clone "$source" "$target" "$committish" "$clean" "$fetch_tags" "$depth" "$submodules" || return 1
      ;;
    copy)
      # Every fetch-shaped option is meaningless for a working-tree copy, and `clean` is worse than
      # meaningless: `git clean -ffdx` would delete exactly the uncommitted work the mode exists to
      # test. Reported, not silently honored (docs/06 §5 decision 40).
      [[ "$clean" != true ]] || azdo__checkout_note 'checkout mode copy ignores clean: true; it would delete the uncommitted changes this mode exists to run'
      ((depth == 0)) || azdo__checkout_note 'checkout mode copy ignores fetchDepth; the working tree is copied, not fetched'
      [[ -z "$tags_input" ]] || azdo__checkout_note 'checkout mode copy ignores fetchTags; the working tree is copied, not fetched'
      [[ "$submodules" == none ]] || azdo__checkout_note 'checkout mode copy inherits submodule contents from the source working tree'
      azdo__checkout_mode_copy "$source" "$target" || return 1
      ;;
    worktree)
      ((depth == 0)) || azdo__checkout_note 'checkout mode worktree ignores fetchDepth; no remote is fetched'
      [[ -z "$tags_input" ]] || azdo__checkout_note 'checkout mode worktree ignores fetchTags; no remote is fetched'
      azdo__checkout_mode_worktree "$source" "$target" "$committish" || return 1
      [[ "$clean" != true ]] || azdo__checkout_clean "$target" "$submodules" || return 1
      if [[ "$submodules" != none ]]; then
        azdo__checkout_submodule_update "$target" "$submodules" "$depth" || return 1
      fi
      ;;
  esac
}

azdo_checkout() {
  local repository='self' mode='clone' source_input='' path='' target source
  local clean_input='' depth_input='' tags_input='' lfs_input='' submodules_input='' name_input=''
  local clean fetch_tags depth submodules committish ref branch_name message uri name
  local multiple clone_directory workspace_root sources_root default_path local_path
  local azdo__checkout_lfs_enabled=false
  while (($# > 0)); do
    case "$1" in
      --repository)
        repository="${2-}"
        shift 2 || return 2
        ;;
      --mode)
        mode="${2-}"
        shift 2 || return 2
        ;;
      --source)
        source_input="${2-}"
        shift 2 || return 2
        ;;
      --path)
        path="${2-}"
        shift 2 || return 2
        ;;
      --clean)
        clean_input="${2-}"
        shift 2 || return 2
        ;;
      --fetch-depth)
        depth_input="${2-}"
        shift 2 || return 2
        ;;
      --fetch-tags)
        tags_input="${2-}"
        shift 2 || return 2
        ;;
      --lfs)
        lfs_input="${2-}"
        shift 2 || return 2
        ;;
      --submodules)
        submodules_input="${2-}"
        shift 2 || return 2
        ;;
      # The repository resource's `name` property — the folder name multi-checkout uses, and the
      # value `Build.Repository.Name` reports (C-E06-118/121). The emitter passes the YAML's; the
      # fallback for `self` is the source directory's own basename.
      --repo-name)
        name_input="${2-}"
        shift 2 || return 2
        ;;
      # Grounded and deliberately not implemented (C-E06-120): `workspaceRepo` retargets
      # `System.DefaultWorkingDirectory`, and the agent picks the winner by scanning the whole job's
      # step list before any checkout runs. That is E05's knowledge, not one step's.
      --workspace-repo)
        [[ "$(azdo__checkout_bool "${2-}" false)" != true ]] ||
          azdo__checkout_note 'checkout option workspaceRepo is not emulated here; System.DefaultWorkingDirectory is set at job setup'
        shift 2 || return 2
        ;;
      # Grounded and deliberately not implemented (C-E06-110): accepted so a pipeline that sets them
      # still runs, and reported rather than silently dropped.
      --fetch-filter | --sparse-checkout-directories | --sparse-checkout-patterns | --persist-credentials)
        [[ -z "${2-}" ]] || azdo__checkout_note "checkout option ${1#--} is not emulated; ignored"
        shift 2 || return 2
        ;;
      *)
        printf 'usage: azdo_checkout [--repository self|<alias>] [--repo-name <name>] [--mode clone|copy|worktree] [--source <dir>] [--path <p>] [--clean <v>] [--fetch-depth <v>] [--fetch-tags <v>] [--lfs <v>] [--submodules <v>]\n' >&2
        return 2
        ;;
    esac
  done

  # `checkout: none` is a skip. Any other alias is a real repository the job also checks out; it
  # differs from `self` only in where its files come from and in seeding no variables (C-E06-121).
  if [[ "$repository" == none ]]; then
    return 0
  fi
  if [[ -z "$repository" ]]; then
    printf '%s\n' 'azdo_checkout: --repository must not be empty' >&2
    return 2
  fi
  # `IsPrimaryRepositoryName` is case-insensitive (C-E06-115).
  [[ "${repository,,}" != self ]] || repository='self'
  case "$mode" in
    clone | copy | worktree) ;;
    *)
      printf 'azdo_checkout: unknown checkout mode: %s\n' "$mode" >&2
      return 2
      ;;
  esac

  clean="$(azdo__checkout_bool "$clean_input" false)"
  fetch_tags="$(azdo__checkout_bool "$tags_input" true)"
  depth="$(azdo__checkout_fetch_depth "$depth_input")"
  submodules="$(azdo__checkout_submodules "$submodules_input")"
  azdo__checkout_lfs_enabled="$(azdo__checkout_bool "$lfs_input" false)"

  source="$(azdo__checkout_source "$source_input" "$repository")" || return 1

  # Layout (C-E06-114): one checkout in the job puts it in `s`; two or more put every repository —
  # `self` included — in `s/<repoName>`; an explicit `path` overrides both and is rooted at
  # `$(Pipeline.Workspace)`, not at `s`.
  name="$name_input"
  [[ -n "$name" ]] || name="${source##*/}"
  clone_directory="$(azdo__checkout_clone_directory "$name")" || return 1
  multiple="$(azdo__checkout_has_multiple)"
  workspace_root="$(azdo__artifact_workspace)" || return 1
  workspace_root="${workspace_root%/}"
  sources_root="$workspace_root/s"
  if [[ "$multiple" == true ]]; then
    default_path="s/$clone_directory"
  else
    default_path='s'
  fi
  target="$(azdo__checkout_target "$path" "$default_path")" || return 1

  # A non-`self` checkout places files and nothing else: every `Build.*` variable below describes
  # the *triggering* repository, which in a converted pipeline is always `self` (C-E06-121). Its
  # commit is its own HEAD — `Build.SourceVersion` is `self`'s, and honoring it here would check a
  # foreign repository out at a commit it has never heard of.
  if [[ "$repository" != self ]]; then
    committish="$(git -C "$source" rev-parse HEAD)" || return 1
    azdo__checkout_place "$mode" "$source" "$target" "$committish" \
      "$clean" "$fetch_tags" "$depth" "$submodules" "$tags_input" || return 1
    return 0
  fi

  # Read before the checkout so an `.env` override of Build.SourceVersion actually selects the
  # commit, and re-seeded after it so an unset one records what was checked out.
  committish="$(azdo_var 'Build.SourceVersion')" || return 1
  if [[ -z "$committish" ]]; then
    committish="$(git -C "$source" rev-parse HEAD)" || return 1
  fi
  ref="$(azdo_var 'Build.SourceBranch')" || return 1
  if [[ -z "$ref" ]]; then
    ref="$(git -C "$source" symbolic-ref -q HEAD || :)"
    if [[ -z "$ref" ]]; then
      azdo__checkout_note 'self repository is at a detached HEAD; Build.SourceBranch is unset — set it in .env to simulate a branch'
    fi
  fi

  azdo__checkout_place "$mode" "$source" "$target" "$committish" \
    "$clean" "$fetch_tags" "$depth" "$submodules" "$tags_input" || return 1

  branch_name="${ref##*/}"
  message="$(git -C "$source" log -1 --pretty=%B "$committish" 2>/dev/null | head -n 1)"
  message="${message:0:200}"
  uri="$(git -C "$source" config --get remote.origin.url 2>/dev/null || :)"
  [[ -n "$uri" ]] || uri="file://$source"

  azdo__checkout_seed_var 'Build.SourceVersion' "$committish" || return 1
  azdo__checkout_seed_var 'Build.SourceVersionMessage' "$message" || return 1
  [[ -z "$ref" ]] || azdo__checkout_seed_var 'Build.SourceBranch' "$ref" || return 1
  [[ -z "$branch_name" ]] || azdo__checkout_seed_var 'Build.SourceBranchName' "$branch_name" || return 1
  azdo__checkout_seed_var 'Build.Repository.Name' "$name" || return 1
  azdo__checkout_seed_var 'Build.Repository.Uri' "$uri" || return 1
  # `Git`, not `TfsGit`: "Git repository hosted on an external server" is the closest true statement
  # about a local source directory (C-E06-107).
  azdo__checkout_seed_var 'Build.Repository.Provider' 'Git' || return 1
  azdo__checkout_seed_var 'Build.Repository.Clean' "$clean" || return 1

  # Two variables, three rules, none of which is "wherever the files went" (C-E06-116/117).
  #
  # `Build.SourcesDirectory` is the tracking config's sources directory. That is `s`, rewritten to a
  # checkout's own path only when the job tracks exactly **one** repository — so `path:` moves it in
  # a single-checkout job and leaves it at `s` in a multi-checkout one.
  #
  # `Build.Repository.LocalPath` follows it, except for the case the agent kept for backward
  # compatibility: under multi-checkout it stays at `s` even though `self`'s files are one level
  # deeper in `s/<repoName>`, and only a `path` that *differs* from that default moves it. Writing
  # `path: s/<repoName>` explicitly is therefore not custom and changes nothing.
  if [[ "$multiple" != true ]]; then
    azdo__checkout_seed_var 'Build.Repository.LocalPath' "$target" || return 1
    azdo__checkout_seed_var 'Build.SourcesDirectory' "$target" || return 1
    return 0
  fi
  # The sources root is nobody's checkout target once every repository has a `path`, but both
  # variables still point at it, so it has to exist the way the agent's tracking directory does.
  mkdir -p "$sources_root" || return 1
  sources_root="$(cd "$sources_root" && pwd -P)" || return 1
  local_path="$sources_root"
  if [[ -n "$path" ]] &&
    [[ "$(azdo__checkout_normalize "$workspace_root" "$path")" != "$(azdo__checkout_normalize "$workspace_root" "$default_path")" ]]; then
    local_path="$target"
  fi
  azdo__checkout_seed_var 'Build.Repository.LocalPath' "$local_path" || return 1
  azdo__checkout_seed_var 'Build.SourcesDirectory' "$sources_root" || return 1
}

# ---------------------------------------------------------------------------------------------
# Run summary & exit code (E06-S06-T02)
#
# docs/04 §2 asks for an "End-of-run summary table (step, result, duration, log path), mirroring
# the ADO UI's job view", and docs/04 §3 fixes the exit code to the aggregate result. Neither is
# agent behavior — the agent reports to the service, not to a shell — so this is *our* contract,
# grounded in the design docs rather than in a pinned source, and the aggregation ranking it reuses
# is the measured one (C-E06-059..061).
#
# Records live in `state/summary/` rather than beside the per-step results, because the table spans
# every stage and job while `state/results/<stage>/<job>/` is scoped to one job. They are numbered
# in completion order, which is the order the table prints. Sequential execution is the contract
# (docs/04 §3: "sequential by default"; `--parallel` is deferred to the archived P6), so a counted
# sequence is sound here; a parallel runner would need an ordering key that does not race.
# ---------------------------------------------------------------------------------------------

azdo__summary_dir() {
  local state_dir
  state_dir="$(azdo__state_dir)" || return
  printf '%s/summary\n' "$state_dir"
}

# azdo_summary_record <step-id> <display> <result> <duration-seconds> <log-path>
#
# One file per step, one field per line — the same file-per-value choice the state store makes, and
# for the same reason: a display name may contain any character a YAML scalar may contain, and a
# delimited row would have to quote it. The trailing field is read with the rest of the line intact.
azdo_summary_record() {
  (($# == 5)) || {
    printf '%s\n' 'usage: azdo_summary_record <step-id> <display> <result> <duration> <log-path>' >&2
    return 2
  }
  azdo__valid_step_result "$3" || return
  [[ "$4" =~ ^[0-9]+$ ]] || {
    printf 'duration must be a non-negative integer, got: %s\n' "$4" >&2
    return 2
  }

  local summary_dir index record old_umask
  summary_dir="$(azdo__summary_dir)" || return
  mkdir -p "$summary_dir" || return

  # `((index++))` would be wrong here: it evaluates to the *pre*-increment value, so the first
  # increment returns 0 and, as the last command of the loop body, fails the whole function.
  index=0
  for record in "$summary_dir"/[0-9]*; do
    [[ -f "$record" ]] && index=$((index + 1))
  done

  printf -v record '%s/%04d' "$summary_dir" "$index"
  old_umask="$(umask)"
  umask 077
  printf '%s\n%s\n%s\n%s\n%s\n' \
    "${AZDO_VAR_SCOPE:-pipeline}" "$1" "$2" "$3" "$4" >"$record" || {
    umask "$old_umask"
    return 1
  }
  printf '%s\n' "$5" >>"$record" || {
    umask "$old_umask"
    return 1
  }
  umask "$old_umask"
}

# azdo_run_result
#
# Worst-wins across every recorded step result in the run, using the ranking
# `azdo__job_status_from_results` applies within a job (C-E06-059..061): `Canceled` wins outright,
# then `Failed`, then `SucceededWithIssues`; `Skipped` never moves it, and an empty run is
# `Succeeded`. Stage and job aggregation are the same fold over a wider set, which is why this
# reads the recorded step results directly rather than re-aggregating per level — a job whose
# `continueOnError` degraded a `Failed` has already had that written into its step results.
# shellcheck disable=SC2120 # This aggregate intentionally accepts no arguments.
azdo_run_result() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_run_result' >&2
    return 2
  }

  local state_dir results_dir result_path result status=Succeeded
  state_dir="$(azdo__state_dir)" || return
  results_dir="$state_dir/results"
  [[ -d "$results_dir" ]] || {
    printf '%s\n' "$status"
    return 0
  }

  while IFS= read -r result_path; do
    # `issues/` sidecars live under the same tree and are not results.
    [[ "${result_path%/*}" != */issues ]] || continue
    IFS= read -r result <"$result_path" || [[ -n "$result" ]] || continue
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
  done < <(find "$results_dir" -type f ! -name '.*' | LC_ALL=C sort)

  printf '%s\n' "$status"
}

# azdo_run_exit_code
#
# docs/04 §3: "run exit code is non-zero iff the pipeline result is `Failed`". **Canceled exits
# non-zero too**, which is a deliberate correction to that sentence rather than a reading of it:
# the sentence enumerates the three *job* results and does not consider `Canceled`, and a run the
# user interrupted must not report success to whatever invoked `run.sh`. docs/04 §3 is corrected
# and docs/06 §5 decision 56 records why.
#
# One code for both, because the contract is "non-zero" and inventing a second would be a
# convention nothing else in the project reads.
azdo_run_exit_code() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_run_exit_code' >&2
    return 2
  }

  local result
  # shellcheck disable=SC2119 # The aggregate intentionally accepts no arguments.
  result="$(azdo_run_result)" || return
  case "$result" in
    Failed | Canceled) printf '%s\n' 1 ;;
    *) printf '%s\n' 0 ;;
  esac
}

# azdo_run_summary
#
# The end-of-run table of docs/04 §2. Columns are padded to the widest cell so the result column
# lines up — the ADO job view's readability is the whole point — and the header is omitted when
# there is nothing to report, so a run that executed no steps prints one honest line instead of an
# empty frame.
azdo_run_summary() {
  (($# == 0)) || {
    printf '%s\n' 'usage: azdo_run_summary' >&2
    return 2
  }

  local summary_dir record scope id display result duration log
  local -a scopes=() ids=() displays=() results=() durations=() logs=()
  local scope_width=5 id_width=4 display_width=4 result_width=6

  summary_dir="$(azdo__summary_dir)" || return
  if [[ -d "$summary_dir" ]]; then
    for record in "$summary_dir"/[0-9]*; do
      [[ -f "$record" ]] || continue
      { IFS= read -r scope
        IFS= read -r id
        IFS= read -r display
        IFS= read -r result
        IFS= read -r duration
        IFS= read -r log || :
      } <"$record"
      scopes+=("$scope")
      ids+=("$id")
      displays+=("$display")
      results+=("$result")
      durations+=("$duration")
      logs+=("$log")
      ((${#scope} > scope_width)) && scope_width=${#scope}
      ((${#id} > id_width)) && id_width=${#id}
      ((${#display} > display_width)) && display_width=${#display}
      ((${#result} > result_width)) && result_width=${#result}
    done
  fi

  if ((${#ids[@]} == 0)); then
    printf 'No steps ran.\n'
    return 0
  fi

  local index
  printf '%-*s  %-*s  %-*s  %-*s  %8s  %s\n' \
    "$scope_width" 'SCOPE' "$id_width" 'STEP' "$display_width" 'NAME' \
    "$result_width" 'RESULT' 'DURATION' 'LOG'
  for ((index = 0; index < ${#ids[@]}; index++)); do
    printf '%-*s  %-*s  %-*s  %-*s  %7ss  %s\n' \
      "$scope_width" "${scopes[$index]}" \
      "$id_width" "${ids[$index]}" \
      "$display_width" "${displays[$index]}" \
      "$result_width" "${results[$index]}" \
      "${durations[$index]}" \
      "${logs[$index]}"
  done

  local overall
  # shellcheck disable=SC2119 # The aggregate intentionally accepts no arguments.
  overall="$(azdo_run_result)" || return
  printf '\nResult: %s\n' "$overall"
}

# ---------------------------------------------------------------------------------------------
# E05-S03-T01: run number (`name:`) support.
#
# The pipeline's `name:` is a format string that Azure DevOps renders into `Build.BuildNumber` at
# queue time (C-E05-003). The emitter compiles the format into straight-line bash (see
# `packages/emit/src/run-number.ts`); what lives here is the part that needs state — the revision
# counter and the identity seed.
# ---------------------------------------------------------------------------------------------

# azdo__join_parts <part>... — concatenate arguments with no separator.
#
# `printf '%s'` over "$@" would do it, but the run number is assembled from arrays that may be empty
# and `set -u` makes an unguarded `"${a[@]}"` fatal on bash 4.2; the callers guard the expansion and
# this stays a plain loop so an empty argument list is simply an empty string.
azdo__join_parts() {
  local part
  for part in "$@"; do
    printf '%s' "$part"
  done
  printf '\n'
}

# azdo__persist_dir — the project-level state directory, which outlives a single run.
#
# `azdo__state_dir` is per-run (`.work/run-<n>/state`), and the revision counter must survive across
# runs, so it lives beside `run.sh`'s run counter in `.work/.state` instead.
azdo__persist_dir() {
  local dir="${AZDO_PERSIST_DIR:-}"
  if [[ -z "$dir" ]]; then
    printf '%s\n' 'AZDO_PERSIST_DIR is not set' >&2
    return 2
  fi
  printf '%s\n' "$dir"
}

# azdo_rev <key> [width] — the next `$(Rev:r)` revision for this run number.
#
# The service resets `Rev` to 1 whenever any other part of the build number changes (C-E05-009) —
# including a version change, not only a date change (C-E05-010). That is implemented literally: the
# caller renders everything *except* the revision and passes it as `<key>`; the store remembers one
# key and its revision, so a different key starts a new series at 1 (Δ C-E05-021).
#
# `width` is the number of `r` characters in the token, i.e. the zero-padding (C-E05-011).
#
# Δ The increment happens at run **start**, not at build completion (C-E05-020): locally the number
# has to exist before the first step reads `Build.BuildNumber`, and there is no server to revise it.
azdo_rev() {
  (($# >= 1 && $# <= 2)) || {
    printf '%s\n' 'usage: azdo_rev <key> [width]' >&2
    return 2
  }

  local key="$1" width="${2:-1}" dir file stored_rev='' stored_key='' rev=1
  [[ "$width" =~ ^[0-9]+$ ]] || {
    printf 'azdo_rev: width must be a number, got: %s\n' "$width" >&2
    return 2
  }
  dir="$(azdo__persist_dir)" || return
  file="$dir/rev"
  mkdir -p "$dir" || return

  if [[ -f "$file" ]]; then
    # Line 1 is the revision; everything after it is the key, so a key containing anything at all
    # (including a newline) round-trips.
    IFS= read -r stored_rev <"$file" || stored_rev=''
    stored_key="$(tail -n +2 "$file")"
    if [[ "$stored_key" = "$key" && "$stored_rev" =~ ^[0-9]+$ ]]; then
      rev=$((stored_rev + 1))
    fi
  fi

  printf '%s\n%s' "$rev" "$key" >"$file" || return
  printf '%0*d\n' "$width" "$rev"
}

# azdo_seed_branch_name — derive `Build.SourceBranchName` from the run's source ref when unset.
#
# `checkout` seeds both, but the run number is rendered before any step runs and may read the short
# name (C-E05-005). The full ref is `refs/heads/main`; the short name is its last segment, the same
# derivation `azdo__checkout_finish` performs.
#
# E05-S01-T04 removed the old `BUILD_SOURCEBRANCH` fallback: the generated `.env` alias table now
# stores that assignment under its exact variable name, so consulting a second spelling here would
# hide a regression in the contract rather than provide compatibility (decision 67).
azdo_seed_branch_name() {
  local ref name
  [[ -z "$(azdo_var 'Build.SourceBranchName')" ]] || return 0
  ref="$(azdo_var 'Build.SourceBranch')" || return
  [[ -n "$ref" ]] || return 0
  name="${ref##*/}"
  [[ -n "$name" ]] || return 0
  azdo_var_set 'Build.SourceBranchName' "$name"
}

# azdo_run_identity_seed <build-number> <build-id> — publish the run's identity variables.
#
# Both names are members of the agent's read-only set, so they are written read-only here; the one
# command allowed to overwrite `Build.BuildNumber` afterwards is `build.updatebuildnumber`, which
# goes through `azdo__write_var_unchecked` for exactly that reason (C-E06-081).
#
# Idempotent, because `run.sh --resume` re-enters with the same run directory and therefore the same
# variable store: an already-seeded run keeps the number it was given rather than failing the
# read-only check or consuming a second revision.
azdo_run_identity_seed() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo_run_identity_seed <build-number> <build-id>' >&2
    return 2
  }

  [[ -z "$(azdo_var 'Build.BuildNumber')" ]] || return 0
  azdo_var_set 'Build.BuildNumber' "$1" false false true || return
  azdo_var_set 'Build.BuildId' "$2" false false true
}

# azdo_run_task — real-task mode: run a task's own implementation (E07-S01-T02/S03-T01).
#
# Reads a heredoc on stdin of the shape the emitter writes:
#
#     task: <Name>@<major>
#       <input>: <value>
#
# and executes the task's cached package with `INPUT_*` set the way task-lib reads them.
#
# The name transform is `azdo__env_name` prefixed with `INPUT_` — deliberately the *same* helper the
# variable path uses, because the agent runs one `ConvertToEnvVariableFormat` for inputs and
# variables alike (C-E07-001, C-E06-008). A second implementation here would be a divergence nobody
# would notice until a task read an input under a name the runtime had spelled differently.
#
# An input's value may contain anything, including `=` and leading spaces; only the first `: `
# separates the name, and the value is used verbatim (C-E07-004: task-lib does its own splitting,
# so trimming here would change what `getInput` returns).
azdo_run_task() {
  local reference='' name='' major='' entry='' task_json='' handler='' target=''
  local line input_name input_value env_name

  while IFS= read -r line; do
    case "$line" in
      'task: '*)
        reference="${line#task: }"
        ;;
      '  '*': '*)
        input_name="${line#  }"
        input_name="${input_name%%: *}"
        input_value="${line#*: }"
        azdo__env_name "$input_name" env_name || return
        # C-E07-002: an empty value is exported anyway — task-lib will not vault it, so `getInput`
        # returns unset, but a task reading the environment directly still sees it.
        export "INPUT_${env_name}=${input_value}"
        ;;
    esac
  done

  [[ -n "$reference" ]] || {
    printf '%s\n' 'azdo_run_task: stdin carried no "task:" line' >&2
    return 2
  }
  name="${reference%@*}"
  major="${reference##*@}"

  # docs/03 §4: the drop-in escape hatch is checked *before* stubbing, and before the package —
  # a handler the user wrote is a deliberate override, not a fallback for a failed download.
  local handler_path=''
  if azdo__user_handler "$name" "$major" handler_path; then
    exec "$handler_path"
  fi

  entry="$(azdo__task_entry "$name" "$major")" || return
  task_json="$entry/task.json"
  [[ -f "$task_json" ]] || {
    printf 'azdo_run_task: no cached task.json for %s (looked in %s)\n' "$reference" "$entry" >&2
    printf '%s\n' 'Run convert without --frozen once to fetch the task package.' >&2
    return 1
  }

  azdo__task_handler "$task_json" handler target || return
  [[ -n "$target" ]] || {
    printf 'azdo_run_task: %s declares no handler this host can run\n' "$reference" >&2
    return 1
  }

  case "$handler" in
    node) exec node "$entry/tree/$target" ;;
    powershell) exec pwsh -NoLogo -NonInteractive -File "$entry/tree/$target" ;;
    *) exec "$entry/tree/$target" ;;
  esac
}

# azdo__task_entry <name> <major> — the newest cached entry for `name@major`, or a failure.
#
# The cache is keyed by the exact `major.minor.patch` (C-E09-088) while the pipeline names only the
# major, so the entry is found by globbing and taking the highest version. Sorted with `sort -V` so
# `6.10.0` beats `6.9.0` — a lexical sort would pick the wrong package and the failure would look
# like a task bug rather than a cache one.
azdo__task_entry() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__task_entry <name> <major>' >&2
    return 2
  }
  local root candidate best=''
  root="${AZDO_EMU_CACHE:-.cache}/tasks"
  for candidate in "$root/$1@$2."*; do
    [[ -d "$candidate" ]] || continue
    if [[ -z "$best" ]]; then
      best="$candidate"
    elif [[ "$(printf '%s\n%s\n' "${best##*@}" "${candidate##*@}" | sort -V | tail -1)" == "${candidate##*@}" ]]; then
      best="$candidate"
    fi
  done
  [[ -n "$best" ]] || {
    printf 'azdo_run_task: no cached package for %s@%s under %s\n' "$1" "$2" "$root" >&2
    # Name both escape hatches: fetching the package is one fix, writing a handler is the other,
    # and a message that mentions only the first sends the reader down the longer road.
    printf '  fetch it: run convert without --frozen once\n' >&2
    printf '  or write a handler: %s/handlers/%s@%s (or ~/.azdo-emu/handlers/%s@%s)\n' \
      "${AZDO_EMU_OUT:-.}" "$1" "$2" "$1" "$2" >&2
    return 1
  }
  printf '%s\n' "$best"
}

# azdo__task_handler <task.json> <handler-var> <target-var> — pick the handler to run.
#
# Newest Node first, then PowerShell, then a process handler — the same preference order the
# emitter's `resolveHandler` uses, because a disagreement would run a different entry point than the
# one the generated script's header names.
azdo__task_handler() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__task_handler <task.json> <handler-var> <target-var>' >&2
    return 2
  }
  # Internal names are deliberately unlikely: `printf -v "$3"` writes the *caller's* variable, and a
  # local called `target` would shadow it — the value would be set and then thrown away at return.
  local __handler_key __handler_target
  for __handler_key in Node24 Node20_1 Node16 Node10 Node; do
    __handler_target="$(azdo__task_execution_target "$1" "$__handler_key")" || return
    if [[ -n "$__handler_target" ]]; then
      printf -v "$2" '%s' node
      printf -v "$3" '%s' "$__handler_target"
      return 0
    fi
  done
  for __handler_key in PowerShell3 PowerShell; do
    __handler_target="$(azdo__task_execution_target "$1" "$__handler_key")" || return
    if [[ -n "$__handler_target" ]]; then
      printf -v "$2" '%s' powershell
      printf -v "$3" '%s' "$__handler_target"
      return 0
    fi
  done
  __handler_target="$(azdo__task_execution_target "$1" Process)" || return
  printf -v "$2" '%s' process
  printf -v "$3" '%s' "$__handler_target"
}

# azdo__task_execution_target <task.json> <execution-key> — the handler target, or empty.
azdo__task_execution_target() {
  (($# == 2)) || {
    printf '%s\n' 'usage: azdo__task_execution_target <task.json> <execution-key>' >&2
    return 2
  }
  node -e '
    const fs = require("node:fs");
    const key = process.argv[2];
    let definition;
    try { definition = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { process.exit(0); }
    const block = (definition.execution ?? {})[key];
    if (block === null || typeof block !== "object") process.exit(0);
    const target = block.target ?? block.script;
    if (typeof target === "string") process.stdout.write(target);
  ' "$1" "$2"
}

# azdo__user_handler <name> <major> <destination-variable> — find a user-written drop-in handler.
#
# docs/03 §4: `<out>/handlers/<TaskName>@<major>`, then `~/.azdo-emu/handlers/<TaskName>@<major>`.
# The doc names a bare executable; the backlog's Do field writes `.sh` (or `.js`), so all three
# spellings are accepted — a user who names the file the way either document describes gets a
# working handler, and refusing one of them would be a papercut with no upside.
#
# The handler receives the environment `azdo_run_task` has already built: `INPUT_*` under the
# task-lib transform (C-E07-001), plus whatever `ENDPOINT_*` the run carries. That is the point of
# the escape hatch — a handler written for us is shaped like a real task, so the knowledge
# transfers in both directions.
#
# Returns 0 and sets the destination when one is found, 1 when none is.
azdo__user_handler() {
  (($# == 3)) || {
    printf '%s\n' 'usage: azdo__user_handler <name> <major> <destination-variable>' >&2
    return 2
  }
  local __handler_root __handler_candidate
  for __handler_root in "${AZDO_EMU_OUT:-.}/handlers" "$HOME/.azdo-emu/handlers"; do
    for __handler_candidate in \
      "$__handler_root/$1@$2" "$__handler_root/$1@$2.sh" "$__handler_root/$1@$2.js"; do
      [[ -f "$__handler_candidate" && -x "$__handler_candidate" ]] || continue
      printf -v "$3" '%s' "$__handler_candidate"
      return 0
    done
  done
  return 1
}

# azdo_sc_login <connection-name> [kind] — sign in for a service connection (E08-S01-T02).
#
# `kind` defaults to `azure`; it exists so the same entry point can grow docker/kubernetes arms
# without every handler learning a new function name (docs/03 §5).
#
# Mode comes from `AZDO_SC_<NAME>_MODE` and defaults to `ambient` — a developer converting their own
# pipeline is usually already signed in, and asking for a service principal they do not have is the
# emulator inventing work (C-E08-005). Credentials, when the mode is `sp`, are read under the
# **task-lib endpoint names** (C-E08-001), so the same `.env` serves this helper and any real task
# that reads the connection itself.
#
# Order mirrors `AzureCLIV2` (C-E08-010): authenticate, *then* select the subscription. Selecting
# first fails with a message about the subscription rather than about the login, which sends the
# reader after the wrong problem.
azdo_sc_login() {
  (($# >= 1 && $# <= 2)) || {
    printf '%s\n' 'usage: azdo_sc_login <connection-name> [kind]' >&2
    return 2
  }
  local name="$1" kind="${2:-azure}" mode_var mode
  azdo__env_name "$name" mode_var || return
  mode_var="AZDO_SC_${mode_var}_MODE"
  mode="${!mode_var:-ambient}"

  case "$kind" in
    azure) azdo__sc_login_azure "$name" "$mode" ;;
    *)
      printf 'azdo_sc_login: no login implemented for connection kind %s\n' "$kind" >&2
      printf '%s\n' '  Write a handler for the step, or sign in yourself before running.' >&2
      return 1
      ;;
  esac
}

azdo__sc_login_azure() {
  local name="$1" mode="$2"
  local subscription client tenant secret certificate auth_type

  subscription="$(azdo__sc_endpoint_data "$name" SUBSCRIPTIONID)"

  if [[ "$mode" == ambient ]]; then
    # A no-op probe, not a login: the point of ambient mode is to use the session that already
    # exists, so the only useful thing to do is check there is one and say so if not.
    if ! az account show >/dev/null 2>&1; then
      printf "azdo_sc_login: connection '%s' is in ambient mode but 'az account show' failed\\n" "$name" >&2
      printf '%s\n' "  Run 'az login', or set the connection to sp mode and fill in its .env keys." >&2
      return 1
    fi
    azdo__sc_select_subscription "$name" "$subscription" || return
    return 0
  fi

  [[ "$mode" == sp ]] || {
    printf "azdo_sc_login: connection '%s' has unknown mode '%s' (expected ambient or sp)\\n" \
      "$name" "$mode" >&2
    return 2
  }

  client="$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALID)"
  tenant="$(azdo__sc_endpoint_auth "$name" TENANTID)"
  auth_type="$(azdo__sc_endpoint_auth "$name" AUTHENTICATIONTYPE)"
  [[ -n "$client" && -n "$tenant" ]] || {
    printf "azdo_sc_login: connection '%s' is in sp mode but has no client id or tenant\\n" "$name" >&2
    printf '  Fill in ENDPOINT_AUTH_PARAMETER_%s_SERVICEPRINCIPALID and _TENANTID in .env.\n' \
      "$name" >&2
    return 1
  }

  local -a args=(login --service-principal --username "$client" --tenant "$tenant")
  [[ -n "$subscription" ]] || args+=(--allow-no-subscriptions)

  if [[ "$auth_type" == spnCertificate ]]; then
    # C-E08-007: `--password` no longer accepts a certificate, so the PEM goes to a file.
    certificate="$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALCERTIFICATE)"
    [[ -n "$certificate" ]] || {
      printf "azdo_sc_login: connection '%s' uses spnCertificate but supplied no PEM\\n" "$name" >&2
      return 1
    }
    local pem
    pem="$(mktemp)" || return
    chmod 600 "$pem"
    printf '%s\n' "$certificate" >"$pem"
    args+=(--certificate "$pem")
    az "${args[@]}" >/dev/null
    local status=$?
    rm -f -- "$pem"
    ((status == 0)) || return "$status"
  else
    secret="$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALKEY)"
    [[ -n "$secret" ]] || {
      printf "azdo_sc_login: connection '%s' uses spnKey but supplied no secret\\n" "$name" >&2
      return 1
    }
    # C-E08-008: always the `=` form. A secret beginning with `-` is otherwise parsed as a flag,
    # and `az` reports an authentication error rather than an argument one.
    args+=("--password=$secret")
    az "${args[@]}" >/dev/null || return
  fi

  azdo__sc_select_subscription "$name" "$subscription"
}

# azdo__sc_select_subscription <name> <subscription> — C-E08-010: after the login, never before.
azdo__sc_select_subscription() {
  [[ -n "$2" ]] || return 0
  az account set --subscription "$2" >/dev/null || {
    printf "azdo_sc_login: signed in, but could not select subscription '%s' for '%s'\\n" "$2" "$1" >&2
    return 1
  }
}

# azdo__sc_endpoint_auth / _data <name> <KEY> — read a connection field under the task-lib names.
#
# C-E08-001: the key is upper-cased and the connection name is used verbatim, so these two helpers
# are the single place that spelling lives.
azdo__sc_endpoint_auth() {
  local __sc_var="ENDPOINT_AUTH_PARAMETER_${1}_${2}"
  printf '%s' "${!__sc_var-}"
}

azdo__sc_endpoint_data() {
  local __sc_var="ENDPOINT_DATA_${1}_${2}"
  printf '%s' "${!__sc_var-}"
}

# azdo__sc_endpoint_url <name> — C-E08-055: the fifth family, `ENDPOINT_URL_<id>`, read by
# `getEndpointUrl` and neither vaulted nor keyed by a field name.
azdo__sc_endpoint_url() {
  local __sc_var="ENDPOINT_URL_${1}"
  printf '%s' "${!__sc_var-}"
}

# azdo_sc_preflight <connection-name> <task-ref> — check a real task can authenticate, and say
# what running it here will cost (E08-S02-T01).
#
# This exists because the Do field's "wire ambient glue" turned out to be unwriteable. `AzureCLI@2`
# reads the endpoint scheme with required=true and then logs in unconditionally — there is no arm
# that reuses an existing session (C-E08-036) — and it repoints AZURE_CONFIG_DIR at a throwaway
# directory, so an `az login` done beforehand is invisible to it anyway (C-E08-037).
# `AzurePowerShell@5` is the same story through `AzureRMEndpoint` (C-E08-039). A pre-login helper
# would therefore do nothing except hide the real failure behind a second one.
#
# What *is* useful is failing before the task does, naming the exact `.env` lines to fill: task-lib
# throws `LIB_EndpointAuthNotExist`, which says nothing about which variable is missing.
#
# The hazard notice is not decoration. Both tasks destroy a local session — `az account clear`
# (C-E08-038) and `Clear-AzContext -Scope CurrentUser -Force` (C-E08-039) — and they are run here
# for fidelity (PLAN D4), so the behavior cannot be patched out, only announced.
azdo_sc_preflight() {
  (($# >= 2 && $# <= 3)) || {
    printf '%s\n' 'usage: azdo_sc_preflight <connection-name> <task-ref> [kind]' >&2
    return 2
  }
  # C-E08-043: `kind` is the endpoint kind the consuming task declares after `connectedService:`.
  # A Docker registry connection shares none of the AzureRM fields, and checking for the AzureRM
  # ones would report a perfectly complete registry connection as broken.
  case "${3:-azurerm}" in
    dockerregistry)
      azdo__sc_preflight_dockerregistry "$1" "$2"
      return
      ;;
    # C-E08-054: a Kubernetes connection shares no field with either of the others — it is checked
    # per `authorizationType`, which is itself a `.env` value rather than anything the pipeline says.
    kubernetes)
      azdo__sc_preflight_kubernetes "$1" "$2"
      return
      ;;
    azurerm) ;;
    *)
      printf 'azdo_sc_preflight: unknown endpoint kind %s\n' "$3" >&2
      return 2
      ;;
  esac
  local name="$1" task="$2" scheme missing=()

  # C-E08-001: the key is upper-cased, the connection name verbatim — same spelling as the task's.
  local __scheme_var="ENDPOINT_AUTH_SCHEME_${name}"
  scheme="${!__scheme_var-}"

  if [[ -z "$scheme" ]]; then
    missing+=("ENDPOINT_AUTH_SCHEME_${name}")
  fi
  case "${scheme,,}" in
    workloadidentityfederation)
      # C-E08-036: the federation arm reads the id token, not a secret.
      [[ -n "$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALID)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_SERVICEPRINCIPALID")
      [[ -n "$(azdo__sc_endpoint_auth "$name" TENANTID)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_TENANTID")
      [[ -n "$(azdo__sc_endpoint_auth "$name" IDTOKEN)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_IDTOKEN")
      ;;
    managedserviceidentity) ;;
    ''|serviceprincipal)
      [[ -n "$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALID)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_SERVICEPRINCIPALID")
      [[ -n "$(azdo__sc_endpoint_auth "$name" TENANTID)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_TENANTID")
      if [[ "$(azdo__sc_endpoint_auth "$name" AUTHENTICATIONTYPE)" == spnCertificate ]]; then
        [[ -n "$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALCERTIFICATE)" ]] ||
          missing+=("ENDPOINT_AUTH_PARAMETER_${name}_SERVICEPRINCIPALCERTIFICATE")
      else
        [[ -n "$(azdo__sc_endpoint_auth "$name" SERVICEPRINCIPALKEY)" ]] ||
          missing+=("ENDPOINT_AUTH_PARAMETER_${name}_SERVICEPRINCIPALKEY")
      fi
      ;;
    *)
      # C-E08-036: anything else is `throw AuthSchemeNotSupported` inside the task.
      printf "azdo_sc_preflight: connection '%s' declares scheme '%s', which %s rejects\n" \
        "$name" "$scheme" "$task" >&2
      return 1
      ;;
  esac

  azdo__sc_hazard "$task"

  ((${#missing[@]} == 0)) && return 0
  printf "azdo_sc_preflight: %s needs service connection '%s', and .env is missing:\n" \
    "$task" "$name" >&2
  local key
  for key in "${missing[@]}"; do printf '  %s=\n' "$key" >&2; done
  printf '%s\n' '  These are the names the real task reads (C-E08-001); see .env.example.' >&2
  printf '%s\n' "  'mode: ambient' cannot serve a task run in real-task mode (C-E08-036)." >&2
  return 1
}

# azdo__sc_preflight_dockerregistry <connection-name> <task-ref> — E08-S02-T02.
#
# A Docker registry connection is read through a *fourth* variable family (C-E08-044):
# `getEndpointAuthorization` parses `ENDPOINT_AUTH_<name>` as JSON and the provider reads
# `parameters.username|password|registry|email` under **lowercase** keys. So the per-key `.env`
# lines are the user-facing surface and the blob is derived here — `.env` is documented as a plain
# `NAME=value` file and hand-written JSON has no place in one.
#
# Failing early matters more here than for the Azure tasks: a missing blob is not
# `LIB_EndpointAuthNotExist` but a TypeError inside the provider (C-E08-045), which tells the reader
# nothing about which value is absent.
azdo__sc_preflight_dockerregistry() {
  local name="$1" task="$2" missing=() field value
  local -a fields=(USERNAME PASSWORD REGISTRY)

  for field in "${fields[@]}"; do
    value="$(azdo__sc_endpoint_auth "$name" "$field")"
    [[ -n "$value" ]] || missing+=("ENDPOINT_AUTH_PARAMETER_${name}_${field}")
  done

  if ((${#missing[@]} > 0)); then
    printf "azdo_sc_preflight: %s names registry connection '%s', and .env is missing:\n" \
      "$task" "$name" >&2
    for field in "${missing[@]}"; do printf '  %s=\n' "$field" >&2; done
    printf '%s\n' '  Without them the task fails inside its own provider with a TypeError, not a' >&2
    printf '%s\n' '  message naming the connection (C-E08-045). See .env.example.' >&2
    return 1
  fi

  azdo_sc_endpoint_auth_json "$name" || return
  azdo__sc_hazard "$task"
}

# azdo__sc_preflight_kubernetes <connection-name> <task-ref> — E08-S02-T03.
#
# `generickubernetescluster.getKubeConfig` branches on `ENDPOINT_DATA_<name>_AUTHORIZATIONTYPE`
# (C-E08-054), read optionally — so an empty value takes the same arm as `Kubeconfig`, and the two
# arms want disjoint sets of `.env` lines. Checking both would report a perfectly complete
# ServiceAccount connection as missing its kubeconfig.
#
# The failure this replaces is worth stating: with no `KUBECONFIG` parameter the task hands an empty
# document to `yaml.safeLoad` and writes it out, and kubectl then reports a cluster it cannot reach —
# a connection error for what is really an unfilled `.env` line.
azdo__sc_preflight_kubernetes() {
  local name="$1" task="$2" auth_type missing=()

  auth_type="$(azdo__sc_endpoint_data "$name" AUTHORIZATIONTYPE)"
  case "$auth_type" in
    ServiceAccount|AzureSubscription)
      # C-E08-055: `createKubeconfig` puts the endpoint URL in `clusters[0].cluster.server`; without
      # it the document names a server of `null`.
      [[ -n "$(azdo__sc_endpoint_url "$name")" ]] || missing+=("ENDPOINT_URL_${name}")
      # C-E08-058: base64, because the task decodes it before writing the kubeconfig.
      [[ -n "$(azdo__sc_endpoint_auth "$name" APITOKEN)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_APITOKEN")
      ;;
    ''|Kubeconfig)
      # C-E08-057: `clusterContext` is genuinely optional — absent, the document's own
      # `current-context` is used and the kubeconfig passes through unmodified.
      [[ -n "$(azdo__sc_endpoint_auth "$name" KUBECONFIG)" ]] ||
        missing+=("ENDPOINT_AUTH_PARAMETER_${name}_KUBECONFIG")
      ;;
    *)
      printf "azdo_sc_preflight: connection '%s' declares authorizationType '%s'; %s\n" \
        "$name" "$auth_type" 'the task recognises only Kubeconfig, ServiceAccount and' >&2
      printf '%s\n' "  AzureSubscription (C-E08-054), and returns undefined for anything else." >&2
      return 1
      ;;
  esac

  azdo__sc_hazard "$task"

  ((${#missing[@]} == 0)) && return 0
  printf "azdo_sc_preflight: %s needs Kubernetes connection '%s', and .env is missing:\n" \
    "$task" "$name" >&2
  local key
  for key in "${missing[@]}"; do printf '  %s=\n' "$key" >&2; done
  printf '%s\n' "  Arm selected by ENDPOINT_DATA_${name}_AUTHORIZATIONTYPE='${auth_type:-Kubeconfig}'." >&2
  # The hint names a command substitution, which shellcheck would read as an unexpanded expression
  # if it appeared literally here; it is a `.env` line for the user to write, not one to run.
  printf '  See .env.example; a kubeconfig can be written as "%s(cat "%sHOME/.kube/config")".\n' \
    '$' '$' >&2
  return 1
}

# azdo_sc_endpoint_auth_json <connection-name> — derive and export ENDPOINT_AUTH_<name>.
#
# C-E08-044: the keys inside the blob are lowercase and verbatim. Upper-casing them the way
# `ENDPOINT_AUTH_PARAMETER_<id>_<KEY>` does produces a blob that parses cleanly and yields an
# undefined value for every field — a failure with no error message at all.
#
# The connection name is used verbatim, exactly as `azdo__sc_endpoint_auth` uses it (C-E08-001).
# That confines this to names bash can hold as a variable, which is the same set `.env` can carry
# (`NAME=value`, letters/digits/underscore — C-E06-014); a name outside it is reported rather than
# silently mangled into a variable the task will not read.
azdo_sc_endpoint_auth_json() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_sc_endpoint_auth_json <connection-name>' >&2
    return 2
  }
  local name="$1" scheme_var="ENDPOINT_AUTH_SCHEME_$1" scheme json field value pairs=()

  [[ "$name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]] || {
    printf "azdo_sc_endpoint_auth_json: connection name '%s' cannot be an environment variable\n" \
      "$name" >&2
    printf '%s\n' '  The task reads ENDPOINT_AUTH_<name> verbatim, and .env carries only' >&2
    printf '%s\n' '  letters, digits and underscores (C-E06-014). Rename the connection, or set' >&2
    printf '%s\n' '  ENDPOINT_AUTH_<name> yourself before the run.' >&2
    return 1
  }

  scheme="${!scheme_var:-UsernamePassword}"
  for field in username password registry email; do
    # The per-key variables are upper-cased (C-E08-001); the blob's keys are not (C-E08-044).
    value="$(azdo__sc_endpoint_auth "$name" "${field^^}")"
    pairs+=("\"$field\":$(azdo__json_string "$value")")
  done

  local IFS=,
  json="{\"scheme\":$(azdo__json_string "$scheme"),\"parameters\":{${pairs[*]}}}"
  unset IFS
  printf -v "ENDPOINT_AUTH_$name" '%s' "$json"
  export "ENDPOINT_AUTH_${name?}"
}

# azdo__json_string <value> — render a bash string as a JSON string literal, quotes included.
#
# Hand-rolled because the runtime is dependency-free bash (PLAN): no `jq`, no python. Escapes the
# two characters JSON requires plus the control characters a password or token can legitimately
# contain; anything else passes through as UTF-8, which JSON permits unescaped.
azdo__json_string() {
  local __js_value="$1" __js_out='' __js_char __js_i
  for ((__js_i = 0; __js_i < ${#__js_value}; __js_i++)); do
    __js_char="${__js_value:__js_i:1}"
    case "$__js_char" in
      '"') __js_out+='\"' ;;
      "\\") __js_out+="\\\\" ;;
      $'\n') __js_out+='\n' ;;
      $'\r') __js_out+='\r' ;;
      $'\t') __js_out+='\t' ;;
      *)
        if [[ "$__js_char" < ' ' ]]; then
          printf -v __js_char '\\u%04x' "'$__js_char"
        fi
        __js_out+="$__js_char"
        ;;
    esac
  done
  printf '"%s"' "$__js_out"
}

# azdo__sc_hazard <task-ref> — announce what running this task locally destroys, once per run.
#
# The marker is a **file**, not an exported variable. Every step is `exec env -- <clean env> bash
# <script>` in its own process, so an export cannot reach the next step and a variable-based guard
# would print the warning once per step instead — a warnings list nobody reads to the end is the
# same as no warnings list (PLAN D10). `AZDO_STATE_DIR` is the store every other piece of
# cross-step state already lives in, and it is per run.
azdo__sc_hazard() {
  local __hazard_dir __hazard_marker
  # Without a state dir there is nowhere to record the marker; warn every time rather than not at
  # all — a repeated warning is noise, a missing one is a lost session.
  if __hazard_dir="$(azdo__state_dir 2>/dev/null)"; then
    __hazard_marker="$__hazard_dir/sc-hazard/${1//[^a-zA-Z0-9]/_}"
    [[ -e "$__hazard_marker" ]] && return 0
    mkdir -p -- "$(dirname -- "$__hazard_marker")" && : >"$__hazard_marker"
  fi
  case "$1" in
    AzureCLI@2*)
      printf '%s\n' "##[warning]AzureCLI@2 ends with 'az account clear' (C-E08-038); a step with useGlobalConfig: true signs you out of az on this machine." >&2
      ;;
    AzurePowerShell@5*)
      printf '%s\n' "##[warning]AzurePowerShell@5 runs 'Clear-AzContext -Scope CurrentUser -Force' (C-E08-039), deleting your saved Connect-AzAccount session. No input opts out." >&2
      ;;
  esac
}

# --- E08-S03-T01: deployment strategies -------------------------------------------------------

# azdo_strategy_hooks <strategy> — the hook order, one per line (C-E08-011).
#
# One order serves all three strategies: preDeploy, deploy, routeTraffic, postRouteTraffic, then
# exactly one of the `on:` hooks. The `on:` pair is not listed here because which one runs is a
# result, not a position.
azdo_strategy_hooks() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_strategy_hooks <strategy>' >&2
    return 2
  }
  case "$1" in
    runOnce | rolling | canary) printf '%s\n' preDeploy deploy routeTraffic postRouteTraffic ;;
    *)
      printf 'azdo_strategy_hooks: unknown strategy %s\n' "$1" >&2
      return 2
      ;;
  esac
}

# azdo_strategy_iterating_hooks <strategy> — the hooks that repeat per iteration (C-E08-012).
#
# This is where canary and rolling part company, and treating them alike is the mistake the docs
# warn against by wording them differently: rolling runs **all four** hooks per batch, while canary
# runs `preDeploy` **once** and iterates only the remaining three. A canary job whose preDeploy
# re-ran per increment would re-initialize between increments.
azdo_strategy_iterating_hooks() {
  (($# == 1)) || {
    printf '%s\n' 'usage: azdo_strategy_iterating_hooks <strategy>' >&2
    return 2
  }
  case "$1" in
    runOnce) ;;
    rolling) printf '%s\n' preDeploy deploy routeTraffic postRouteTraffic ;;
    canary) printf '%s\n' deploy routeTraffic postRouteTraffic ;;
    *)
      printf 'azdo_strategy_iterating_hooks: unknown strategy %s\n' "$1" >&2
      return 2
      ;;
  esac
}

# azdo_strategy_vars <strategy> <hook> [increment] — export the `strategy.*` variables for one hook.
#
# C-E08-013: the three variables are `name`, `action` and `increment`. There is no `strategy.cycle`,
# despite the backlog's Do field naming one — implementing it would have created a variable no
# pipeline can read while omitting `action`, which the docs' own canary example passes to
# KubernetesManifest as `action: $(strategy.action)`.
#
# C-E08-014: `strategy.increment` is available **only** in deploy/routeTraffic/postRouteTraffic. It
# is deliberately absent elsewhere rather than set to an empty string, so a pipeline reading it in
# `preDeploy` sees the same nothing it would see on the service.
azdo_strategy_vars() {
  (($# >= 2 && $# <= 3)) || {
    printf '%s\n' 'usage: azdo_strategy_vars <strategy> <hook> [increment]' >&2
    return 2
  }
  local strategy="$1" hook="$2" increment="${3-}"
  azdo_var_set 'strategy.name' "$strategy" || return
  # `action` is Kubernetes-shaped; `deploy` is the only action a local run performs.
  azdo_var_set 'strategy.action' 'deploy' || return

  case "$hook" in
    deploy | routeTraffic | postRouteTraffic)
      [[ -z "$increment" ]] || azdo_var_set 'strategy.increment' "$increment" || return
      ;;
  esac
}

# azdo_strategy_output_key <strategy> <hook> <step-name> <variable> [scope] — the output-variable
# key another job reads (C-E08-016).
#
# The shape is strategy-dependent, which is exactly the naming C-E04-154 reserved for this epic:
#   runOnce                 <job>.<step>.<var>
#   runOnce + resourceType  Deploy_<resource>.<step>.<var>
#   canary                  <hook>_<increment>.<step>.<var>     (hook name lower-cased)
#   rolling                 <hook>_<resource>.<step>.<var>
azdo_strategy_output_key() {
  (($# >= 4 && $# <= 5)) || {
    printf '%s\n' 'usage: azdo_strategy_output_key <strategy> <hook> <step-name> <variable> [scope]' >&2
    return 2
  }
  local strategy="$1" hook="$2" step="$3" variable="$4" scope="${5-}"
  local prefix
  case "$strategy" in
    runOnce)
      # `scope` is the job name, or the resource name when the environment named a resourceType.
      [[ -n "$scope" ]] || {
        printf '%s\n' 'azdo_strategy_output_key: runOnce needs the job or resource name' >&2
        return 2
      }
      prefix="$scope"
      ;;
    canary | rolling)
      [[ -n "$scope" ]] || {
        printf 'azdo_strategy_output_key: %s needs the increment or resource name\n' "$strategy" >&2
        return 2
      }
      # The doc's example reads `deploy_10`, so the hook name is lower-cased.
      prefix="$(LC_ALL=C printf '%s' "$hook" | LC_ALL=C tr '[:upper:]' '[:lower:]')_$scope"
      ;;
    *)
      printf 'azdo_strategy_output_key: unknown strategy %s\n' "$strategy" >&2
      return 2
      ;;
  esac
  printf '%s.%s.%s\n' "$prefix" "$step" "$variable"
}

# azdo_strategy_deltas <strategy> [maxParallel] — the warnings this strategy earns locally.
#
# C-E08-017, PLAN D10: a converted project has no VM set and no deployment group, so rolling
# collapses to a single iteration and `maxParallel` is not honoured. Saying so is the whole point —
# a strategy that silently ran once would look like it worked.
azdo_strategy_deltas() {
  (($# >= 1 && $# <= 2)) || {
    printf '%s\n' 'usage: azdo_strategy_deltas <strategy> [maxParallel]' >&2
    return 2
  }
  case "$1" in
    runOnce) ;;
    rolling)
      printf '%s\n' \
        'rolling: the service iterates once per batch of VMs; this run has no VM set, so the hooks execute exactly once'
      [[ -z "${2-}" ]] ||
        printf 'rolling: maxParallel=%s is not honoured — batching is collapsed to sequential execution\n' "$2"
      ;;
    canary)
      printf '%s\n' \
        'canary: increments are honoured as an iteration count, but the percentages have no meaning without a cluster'
      ;;
    *)
      printf 'azdo_strategy_deltas: unknown strategy %s\n' "$1" >&2
      return 2
      ;;
  esac
}
