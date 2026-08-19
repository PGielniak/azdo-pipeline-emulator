#!/usr/bin/env bash
# @azdo-emu/runtime — compiled-expression helpers. This file is sourced, never executed.
#
# The shell backend of docs/02 §6: `packages/engine/src/expr/compile-bash.ts` compiles an Azure
# Pipelines expression AST into calls on these functions.  Every value crosses the boundary as its
# **String form** (`True`/`False` for Boolean, the invariant decimal for Number, dotted segments for
# Version), because that is the one representation all four scalar kinds share — so String
# conversion is the identity here and only the *typed* operations below need a kind tag.
#
# Kind tags: bool | num | str | ver.  There is deliberately no `null` tag: a missing variable reads
# as the empty string (docs/02 §6 "Null→empty fallback", C-E02-138), and there are no `obj`/`arr`
# tags because collections have no shell representation at all (C-E02-139) — the compiler raises
# BashCompileError rather than emitting a call that would silently disagree with the evaluator.
#
# Predicate status convention, measured in research/experiments/E02-conformance/shell-semantics.md:
#   0 = True, 1 = False, 2 = evaluation error (the evaluator's ExprConversionError).
# 2 rather than "any non-zero" because `[` itself already uses 0/1/>1 that way (C-E02-135) and a
# missing helper exits 127 (C-E02-136); a harness reading "non-zero = False" would pass over a
# backend that never ran at all.

# Record an evaluation error at the run_step condition boundary as well as returning status 2.
# The optional private marker is necessary because shell `||` lists and command substitutions can
# discard a helper's status while evaluating a larger compiled condition (C-E06-042). Standalone
# expression execution leaves AZDO_EXPR_ERROR_FILE unset and retains the original status contract.
azdo__expr_fail() {
  local message="$1"
  if [[ -n "${AZDO_EXPR_ERROR_FILE:-}" && -f "$AZDO_EXPR_ERROR_FILE" ]]; then
    printf '%s\n' "$message" >>"$AZDO_EXPR_ERROR_FILE"
  fi
  printf '%s\n' "$message" >&2
  return 2
}

azdo__expr_int32_max=2147483647

# ---------------------------------------------------------------------------------------------
# Conversions (C-E02-020..022 — the evaluator's table in packages/engine/src/expr/coercion.ts)
# ---------------------------------------------------------------------------------------------

# azdo__expr_upper <text> — ordinal (ASCII) upper-casing.
#
# Azure Pipelines compares strings OrdinalIgnoreCase.  `[[ < ]]` is locale-collated (measured:
# `alpha < BETA` is false under LC_ALL=C and true under en_US.UTF-8), so every string operation
# here pins LC_ALL=C to get ordinal behaviour (C-E02-142).  Non-ASCII case folding is a declared
# divergence from .NET's OrdinalIgnoreCase (C-E02-141).
#
# `tr`, not `${1^^}`: macOS ships bash 3.2, where the case-modification expansions do not exist —
# and the failure is *silent agreement*, because a bad substitution yields the empty string on both
# sides of a comparison, which then compares equal (C-E02-147).  `core.sh` folds case the same way
# for the same reason.
azdo__expr_upper() {
  LC_ALL=C printf '%s' "$1" | LC_ALL=C tr '[:lower:]' '[:upper:]'
}

# azdo__expr_to_number <text> — prints the invariant decimal, or fails (status 1).
azdo__expr_to_number() {
  local LC_ALL=C text="$1"
  text="${text#"${text%%[![:space:]]*}"}"
  text="${text%"${text##*[![:space:]]}"}"
  if [[ -z "$text" ]]; then
    printf '0'
    return 0
  fi
  [[ "$text" =~ ^[+-]?([0-9]{1,3}(,[0-9]{3})+|[0-9]+)(\.[0-9]+)?$ ]] || return 1
  printf '%s' "${text//,/}"
}

# azdo__expr_to_version <text> — prints the dotted segments, or fails (status 1).
# String→Version accepts 2..4 segments, unlike a Version *literal*, which needs 3..4 (C-E02-022).
azdo__expr_to_version() {
  local LC_ALL=C text="$1" segment
  [[ "$text" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]] || return 1
  local IFS=.
  local -a segments
  read -r -a segments <<<"$text"
  for segment in "${segments[@]}"; do
    ((10#$segment <= azdo__expr_int32_max)) || return 1
  done
  printf '%s' "$text"
}

# azdo__expr_number_to_version <decimal> — the Number→Version rule: a positive, non-integral value
# below Int32.MaxValue, re-read as dotted segments.
azdo__expr_number_to_version() {
  local LC_ALL=C text="$1"
  [[ "$text" == *.* ]] || return 1
  [[ "$text" == -* ]] && return 1
  [[ "${text#*.}" =~ [1-9] ]] || return 1
  [[ "${text%%.*}" =~ ^[0-9]+$ ]] || return 1
  ((10#${text%%.*} < azdo__expr_int32_max)) || return 1
  azdo__expr_to_version "$text"
}

# azdo__expr_convert <target-kind> <source-kind> <value> — prints the converted value, or fails.
azdo__expr_convert() {
  local target="$1" source="$2" value="$3"
  if [[ "$target" == "$source" ]]; then
    printf '%s' "$value"
    return 0
  fi
  case "$target" in
    bool)
      case "$source" in
        num)
          if [[ "$(azdo__expr_number_cmp "$value" 0)" == 0 ]]; then printf 'False'; else printf 'True'; fi
          ;;
        str)
          if [[ -z "$value" ]]; then printf 'False'; else printf 'True'; fi
          ;;
        ver) printf 'True' ;;
        *) return 1 ;;
      esac
      ;;
    num)
      case "$source" in
        bool)
          if [[ "$value" == True ]]; then printf '1'; else printf '0'; fi
          ;;
        str) azdo__expr_to_number "$value" ;;
        *) return 1 ;;
      esac
      ;;
    # Every kind already crosses the boundary in its String form, so String conversion is identity.
    str) printf '%s' "$value" ;;
    ver)
      case "$source" in
        num) azdo__expr_number_to_version "$value" ;;
        str) azdo__expr_to_version "$value" ;;
        *) return 1 ;;
      esac
      ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# Same-kind ordering — each prints -1 | 0 | 1
# ---------------------------------------------------------------------------------------------

# Decimal comparison without an external tool: Number is a double and `(( ))` is integer-only.
azdo__expr_number_cmp() {
  local LC_ALL=C left="$1" right="$2"
  local left_sign=1 right_sign=1 left_int right_int left_frac='' right_frac='' order=0
  if [[ "$left" == [+-]* ]]; then
    if [[ "$left" == -* ]]; then left_sign=-1; fi
    left="${left#[+-]}"
  fi
  if [[ "$right" == [+-]* ]]; then
    if [[ "$right" == -* ]]; then right_sign=-1; fi
    right="${right#[+-]}"
  fi
  left_int="${left%%.*}"
  right_int="${right%%.*}"
  if [[ "$left" == *.* ]]; then left_frac="${left#*.}"; fi
  if [[ "$right" == *.* ]]; then right_frac="${right#*.}"; fi
  while [[ "$left_frac" == *0 ]]; do left_frac="${left_frac%0}"; done
  while [[ "$right_frac" == *0 ]]; do right_frac="${right_frac%0}"; done
  while ((${#left_int} > 1)) && [[ "$left_int" == 0* ]]; do left_int="${left_int#0}"; done
  while ((${#right_int} > 1)) && [[ "$right_int" == 0* ]]; do right_int="${right_int#0}"; done
  # -0 and 0 are the same value, so a sign must not decide the comparison.
  if [[ "$left_int" == 0 && -z "$left_frac" ]]; then left_sign=1; fi
  if [[ "$right_int" == 0 && -z "$right_frac" ]]; then right_sign=1; fi

  if ((left_sign != right_sign)); then
    if ((left_sign < right_sign)); then printf -- '-1'; else printf '1'; fi
    return 0
  fi
  if ((${#left_int} != ${#right_int})); then
    if ((${#left_int} < ${#right_int})); then order=-1; else order=1; fi
  elif [[ "$left_int" != "$right_int" ]]; then
    if [[ "$left_int" < "$right_int" ]]; then order=-1; else order=1; fi
  else
    while ((${#left_frac} < ${#right_frac})); do left_frac="${left_frac}0"; done
    while ((${#right_frac} < ${#left_frac})); do right_frac="${right_frac}0"; done
    if [[ "$left_frac" == "$right_frac" ]]; then
      order=0
    elif [[ "$left_frac" < "$right_frac" ]]; then
      order=-1
    else
      order=1
    fi
  fi
  if ((left_sign < 0)); then ((order = -order)); fi
  printf '%s' "$order"
}

# A missing segment sorts *below* a present zero: 1.2 < 1.2.0 (C-E02-022).
azdo__expr_version_cmp() {
  local LC_ALL=C index left right
  local IFS=.
  local -a left_parts right_parts
  read -r -a left_parts <<<"$1"
  read -r -a right_parts <<<"$2"
  for index in 0 1 2 3; do
    if [[ -n "${left_parts[index]:-}" ]]; then left=$((10#${left_parts[index]})); else left=-1; fi
    if [[ -n "${right_parts[index]:-}" ]]; then right=$((10#${right_parts[index]})); else right=-1; fi
    if ((left == right)); then continue; fi
    if ((left < right)); then printf -- '-1'; else printf '1'; fi
    return 0
  done
  printf '0'
}

azdo__expr_string_cmp() {
  local LC_ALL=C left right
  left="$(azdo__expr_upper "$1")"
  right="$(azdo__expr_upper "$2")"
  if [[ "$left" == "$right" ]]; then
    printf '0'
  elif [[ "$left" < "$right" ]]; then
    printf -- '-1'
  else
    printf '1'
  fi
}

azdo__expr_same_kind_cmp() {
  case "$1" in
    bool)
      if [[ "$2" == "$3" ]]; then
        printf '0'
      elif [[ "$2" == True ]]; then
        printf '1'
      else
        printf -- '-1'
      fi
      ;;
    num) azdo__expr_number_cmp "$2" "$3" ;;
    str) azdo__expr_string_cmp "$2" "$3" ;;
    ver) azdo__expr_version_cmp "$2" "$3" ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------------------------------------
# Public API consumed by compiled expressions
# ---------------------------------------------------------------------------------------------

# azdo_expr_cmp <op> <left-kind> <left> <right-kind> <right>
#
# The comparison converts the **right** operand to the left operand's kind (C-E02-020).  A failed
# conversion is False for `eq`, True for `ne`, and an error for the four ordered operators — the
# asymmetry the evaluator implements in compareValues().
azdo_expr_cmp() {
  (($# == 5)) || {
    azdo__expr_fail 'usage: azdo_expr_cmp <op> <left-kind> <left> <right-kind> <right>'
    return
  }
  local operator="$1" left_kind="$2" left="$3" right_kind="$4" right="$5" converted order
  case "$operator" in
    eq | ne | lt | le | gt | ge) ;;
    *)
      azdo__expr_fail "unknown comparison operator: $operator"
      return
      ;;
  esac

  if ! converted="$(azdo__expr_convert "$left_kind" "$right_kind" "$right")"; then
    case "$operator" in
      eq) return 1 ;;
      ne) return 0 ;;
      *)
        azdo__expr_fail "Unable to convert from $right_kind to $left_kind."
        return
        ;;
    esac
  fi
  order="$(azdo__expr_same_kind_cmp "$left_kind" "$left" "$converted")" || {
    azdo__expr_fail "Unable to compare values of kind $left_kind."
    return
  }

  case "$operator" in
    eq) [[ "$order" == 0 ]] ;;
    ne) [[ "$order" != 0 ]] ;;
    lt) [[ "$order" == -1 ]] ;;
    le) [[ "$order" != 1 ]] ;;
    gt) [[ "$order" == 1 ]] ;;
    ge) [[ "$order" != -1 ]] ;;
  esac
}

# azdo_expr_truthy <kind> <value> — the Boolean conversion, for a non-predicate operand of
# and/or/not (e.g. `and(variables.flag, …)`).
azdo_expr_truthy() {
  (($# == 2)) || {
    azdo__expr_fail 'usage: azdo_expr_truthy <kind> <value>'
    return
  }
  local converted
  converted="$(azdo__expr_convert bool "$1" "$2")" || {
    azdo__expr_fail "Unable to convert from $1 to bool."
    return
  }
  [[ "$converted" == True ]]
}

# azdo_expr_xor <left-kind> <left> <right-kind> <right> — both operands are always converted.
azdo_expr_xor() {
  (($# == 4)) || {
    azdo__expr_fail 'usage: azdo_expr_xor <left-kind> <left> <right-kind> <right>'
    return
  }
  local left right
  left="$(azdo__expr_convert bool "$1" "$2")" || {
    azdo__expr_fail "Unable to convert from $1 to bool."
    return
  }
  right="$(azdo__expr_convert bool "$3" "$4")" || {
    azdo__expr_fail "Unable to convert from $3 to bool."
    return
  }
  [[ "$left" != "$right" ]]
}

# The substring family compares OrdinalIgnoreCase over the String form of both operands.
azdo_expr_contains() {
  local left right
  left="$(azdo__expr_upper "$1")"
  right="$(azdo__expr_upper "$2")"
  [[ "$left" == *"$right"* ]]
}

azdo_expr_startswith() {
  local left right
  left="$(azdo__expr_upper "$1")"
  right="$(azdo__expr_upper "$2")"
  [[ "$left" == "$right"* ]]
}

azdo_expr_endswith() {
  local left right
  left="$(azdo__expr_upper "$1")"
  right="$(azdo__expr_upper "$2")"
  [[ "$left" == *"$right" ]]
}

# ---------------------------------------------------------------------------------------------
# String-valued helpers (docs/02 §6: "String functions that are awkward in pure bash … compile to
# small generated helper functions in lib/expr.sh")
# ---------------------------------------------------------------------------------------------

azdo_expr_lower() {
  LC_ALL=C printf '%s' "$1" | LC_ALL=C tr '[:upper:]' '[:lower:]'
}

azdo_expr_upper() {
  azdo__expr_upper "$1"
}

azdo_expr_trim() {
  local text="$1"
  text="${text#"${text%%[![:space:]]*}"}"
  printf '%s' "${text%"${text##*[![:space:]]}"}"
}

# azdo_expr_length <text> — String length only; Array/Object lengths have no shell representation
# and are rejected at compile time (C-E02-139).
azdo_expr_length() {
  printf '%s' "${#1}"
}

# azdo_expr_replace <text> <search> <replacement> — an empty search leaves the text unchanged.
#
# Scanned by index rather than written as `${1//"$2"/"$3"}`, for two reasons that pull the same way
# (C-E02-147): bash 3.2 does not honour the quotes inside a substitution pattern, so on macOS the
# expansion searched for the literal text *including* its quote characters and replaced nothing;
# and dropping the quotes to work around that would make the needle a **glob**, where Azure
# Pipelines' `replace` takes a literal substring.  `[[ "${text:i:n}" == "$search" ]]` compares
# literally on every supported shell.
azdo_expr_replace() {
  (($# == 3)) || {
    azdo__expr_fail 'usage: azdo_expr_replace <text> <search> <replacement>'
    return
  }
  local text="$1" search="$2" replacement="$3" result='' index=0
  local length=${#1} span=${#2}
  if ((span == 0)); then
    printf '%s' "$text"
    return 0
  fi
  while ((index < length)); do
    if ((index + span <= length)) && [[ "${text:index:span}" == "$search" ]]; then
      result="$result$replacement"
      index=$((index + span))
    else
      result="$result${text:index:1}"
      index=$((index + 1))
    fi
  done
  printf '%s' "$result"
}

# azdo_expr_coalesce <value…> — first value that is neither Null nor the empty String.  Null and
# empty are the same shell value (C-E02-138), so the shell form cannot return Null and yields the
# empty String when every operand is empty.
azdo_expr_coalesce() {
  local value
  for value in "$@"; do
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi
  done
  printf ''
}

# azdo_expr_iif <condition-kind> <condition> <when-true> <when-false> — both branches are already
# evaluated by the time this is called, which matches the evaluator: iif is eager (C-E02-049).
azdo_expr_iif() {
  (($# == 4)) || {
    azdo__expr_fail 'usage: azdo_expr_iif <condition-kind> <condition> <when-true> <when-false>'
    return
  }
  local condition
  condition="$(azdo__expr_convert bool "$1" "$2")" || {
    azdo__expr_fail "Unable to convert from $1 to bool."
    return
  }
  if [[ "$condition" == True ]]; then printf '%s' "$3"; else printf '%s' "$4"; fi
}

# azdo_expr_format <pattern> [value…] — `{N}` placeholders with `{{`/`}}` escapes.  An invalid
# pattern or an out-of-range index is an evaluation error, matching the evaluator (C-E02-045).
azdo_expr_format() {
  (($# >= 1)) || {
    azdo__expr_fail 'usage: azdo_expr_format <pattern> [value…]'
    return
  }
  local pattern="$1" result='' index=0 char next rest placeholder
  shift
  local -a values=("$@")
  while ((index < ${#pattern})); do
    char="${pattern:index:1}"
    if [[ "$char" != '{' && "$char" != '}' ]]; then
      result+="$char"
      index=$((index + 1))
      continue
    fi
    next="${pattern:index+1:1}"
    if [[ "$next" == "$char" ]]; then
      result+="$char"
      index=$((index + 2))
      continue
    fi
    if [[ "$char" == '}' ]]; then
      azdo__expr_fail "The following format string is invalid: $pattern"
      return
    fi
    rest="${pattern:index+1}"
    if [[ "$rest" != *'}'* ]]; then
      azdo__expr_fail "The following format string is invalid: $pattern"
      return
    fi
    placeholder="${rest%%\}*}"
    if [[ ! "$placeholder" =~ ^[0-9]+$ ]]; then
      azdo__expr_fail "The following format string is invalid: $pattern"
      return
    fi
    if ((10#$placeholder >= ${#values[@]})); then
      azdo__expr_fail \
        "The following format string references more arguments than were supplied: {$placeholder}"
      return
    fi
    result+="${values[10#$placeholder]}"
    index=$((index + ${#placeholder} + 2))
  done
  printf '%s' "$result"
}

# azdo_expr_bool <status> — render a compiled predicate's exit status as the Azure Boolean String,
# for materializing a `$[ ]` variable into the store (docs/02 §6).
azdo_expr_bool() {
  if (($1 == 0)); then printf 'True'; else printf 'False'; fi
}
