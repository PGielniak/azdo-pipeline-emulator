#!/usr/bin/env bash
# Claim↔test coverage report (E11-S02-T01, BACKLOG.md §3).
#
# The Grounding Protocol says "tests reference the claim ID in the name or a comment". Nothing
# checked that, so a claim could be recorded, implemented, and never tested — and the register would
# still look complete. This script closes the loop: it lists every claim `research/` defines, every
# claim a test references, and the difference.
#
# **It is a ratchet, not a gate at 100%.** Many claims are legitimately untestable in-repo: a scope
# note recording why something could not be measured, a route pinned for a task that has not landed,
# a statement about the *service* rather than about our code. Demanding a test for those would push
# people to write assertions that prove nothing, which is worse than the gap. So the number must not
# go *down*: the floor lives in `.claim-coverage-floor`, and raising it is a deliberate commit.
#
#   (no args)   print the report
#   --check     also fail when coverage drops below the recorded floor  (CI)
#   --list      print the unreferenced claim IDs, one per line
#
# Works on bash 3.2 (macOS system bash): no associative arrays, no `mapfile`.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

mode="${1:-report}"
floor_file='.claim-coverage-floor'

# A claim is *defined* where it appears in brackets at the start of a line in research/:
#   [C-E09-030] **Ref listing is …
# and *referenced* anywhere in a test file. The two patterns differ on purpose — a claim mentioned
# in prose inside another claim's body is not a second definition.
defined="$(grep -rhoE '^\[C-E[0-9]{2}-[0-9]{3}\]' research/ | tr -d '[]' | sort -u)"

# Tests reference claims in a name, a comment, or an assertion message. Bats and vitest both count.
referenced="$(grep -rhoE 'C-E[0-9]{2}-[0-9]{3}' \
  packages/*/test packages/runtime/test 2>/dev/null | sort -u || true)"

# Ranges like `C-E09-085..089` in a test cover every id between the endpoints; expand them so a
# test that cites a range is not reported as covering only its first claim.
ranges="$(grep -rhoE 'C-E[0-9]{2}-[0-9]{3}\.\.[0-9]{3}' \
  packages/*/test packages/runtime/test 2>/dev/null | sort -u || true)"
expanded=''
if [[ -n "$ranges" ]]; then
  while IFS= read -r range; do
    [[ -n "$range" ]] || continue
    prefix="${range%%..*}"        # C-E09-085
    epic="${prefix%-*}"           # C-E09
    start="${prefix##*-}"         # 085
    end="${range##*..}"           # 089
    index=$((10#$start))
    while ((index <= 10#$end)); do
      expanded+="$(printf '%s-%03d\n' "$epic" "$index")"$'\n'
      index=$((index + 1))
    done
  done <<<"$ranges"
fi

referenced="$(printf '%s\n%s\n' "$referenced" "$expanded" | grep -E '^C-E[0-9]{2}-[0-9]{3}$' | sort -u || true)"

total="$(printf '%s\n' "$defined" | grep -c . || true)"
covered="$(comm -12 <(printf '%s\n' "$defined") <(printf '%s\n' "$referenced") | grep -c . || true)"
missing="$(comm -23 <(printf '%s\n' "$defined") <(printf '%s\n' "$referenced") || true)"

if [[ "$mode" == '--list' ]]; then
  printf '%s\n' "$missing"
  exit 0
fi

percent=0
((total == 0)) || percent=$((covered * 100 / total))

printf 'Claim↔test coverage: %s/%s claims referenced by a test (%s%%)\n' "$covered" "$total" "$percent"

# Per-epic breakdown: a whole epic at zero is the signal worth acting on, not a scattered handful.
printf '\n%-8s %8s %8s\n' 'epic' 'claims' 'tested'
for epic in $(printf '%s\n' "$defined" | cut -d- -f2 | sort -u); do
  epic_total="$(printf '%s\n' "$defined" | grep -c "^C-$epic-" || true)"
  epic_covered="$(comm -12 <(printf '%s\n' "$defined") <(printf '%s\n' "$referenced") |
    grep -c "^C-$epic-" || true)"
  printf '%-8s %8s %8s\n' "$epic" "$epic_total" "$epic_covered"
done

if ((percent < 100)); then
  printf '\n%s claims are not referenced by any test. Run with --list to see them.\n' \
    "$((total - covered))"
  printf '%s\n' 'Many are legitimately untestable in-repo (scope notes, service statements,'
  printf '%s\n' 'routes pinned ahead of the task that uses them) — this is a ratchet, not a gate.'
fi

if [[ "$mode" == '--check' ]]; then
  floor=0
  [[ ! -f "$floor_file" ]] || floor="$(tr -dc '0-9' <"$floor_file")"
  if ((percent < floor)); then
    printf '\nFAIL: coverage %s%% is below the recorded floor of %s%%.\n' "$percent" "$floor" >&2
    printf '%s\n' 'Either reference the new claims from tests, or lower the floor deliberately' >&2
    printf '%s\n' "in $floor_file and say why in the commit message." >&2
    exit 1
  fi
  printf '\nOK: %s%% is at or above the floor of %s%%.\n' "$percent" "$floor"
fi
