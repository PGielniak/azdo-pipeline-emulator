#!/usr/bin/env bash
# Grounding Protocol guard (E00-S01-T03, BACKLOG.md §3): unresolved research markers
# must not land in code paths. research/, docs/ and backlog/ legitimately carry them
# (pending source pins); packages/, scripts/ and fixtures/ must be clean.
#
#   --staged  (default) check staged file contents — used by .githooks/pre-commit
#   --all     check all tracked files in the working tree — used by CI
#
# Works on bash 3.2 (macOS system bash). No pipes into functions: fail state must
# not be set in a subshell.
set -euo pipefail

marker='VERIFY'':' # assembled so this file never matches itself
code_paths=(packages scripts fixtures)
mode="${1:---staged}"
fail=0

report() {
  # $1 = file label, $2 = grep -n output for that file
  printf '%s\n' "$2" | sed "s|^|$1:|"
  fail=1
}

case "$mode" in
  --all)
    while IFS= read -r f; do
      hits="$(grep -n "$marker" -- "$f" || true)"
      [[ -z "$hits" ]] || report "$f" "$hits"
    done < <(git ls-files -- "${code_paths[@]}")
    ;;
  --staged)
    while IFS= read -r f; do
      hits="$(git show ":$f" | grep -n "$marker" || true)"
      [[ -z "$hits" ]] || report "$f" "$hits"
    done < <(git diff --cached --name-only --diff-filter=ACMR -- "${code_paths[@]}")
    ;;
  *)
    echo "usage: $0 [--staged|--all]" >&2
    exit 2
    ;;
esac

if [[ "$fail" -ne 0 ]]; then
  echo "error: ${marker} markers found in code paths — resolve by pinned source or experiment first (research/README.md)" >&2
  exit 1
fi
