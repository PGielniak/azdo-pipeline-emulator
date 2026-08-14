#!/usr/bin/env bash
# E02-S05-T02 — measure the local shell semantics the compiled expression backend depends on.
#
# The GNU bash manual answers exit-status and list-operator questions (C-E02-135..137), but not
# the two that decide how `azdo_expr_cmp` must be written: whether `[[ < ]]` and `${v^^}` are
# locale-dependent. BACKLOG §3.3 says behavior the docs do not answer is settled by experiment,
# so those are measured here rather than asserted.
#
# Run: bash scripts/expr-shell-survey.sh
# Output: research/experiments/E02-conformance/shell-semantics.md
set -uo pipefail

OUT_DIR='research/experiments/E02-conformance'
OUT="$OUT_DIR/shell-semantics.md"
mkdir -p "$OUT_DIR"

probe() { # probe <name> <description> <script>
  local name="$1" description="$2" script="$3" out status
  out="$(bash -c "$script" 2>&1)"
  status=$?
  printf '### %s\n\n%s\n\n```bash\n%s\n```\n\nstatus: `%s`  \noutput: `%s`\n\n' \
    "$name" "$description" "$script" "$status" "$out" >>"$OUT"
}

{
  printf '# E02-S05-T02 — measured shell semantics (C-E02-138..142)\n\n'
  printf 'Regenerate with `pnpm expr-shell-survey`. Host: `%s`.\n\n' "$(bash --version | head -1)"
  printf 'Locales available for the collation probes: `%s`.\n\n' \
    "$(locale -a 2>/dev/null | grep -ci 'utf-\?8' || printf '0') UTF-8 locale(s)"
} >"$OUT"

probe 'test-true' 'A true conditional expression exits 0.' '[ a = a ]'
probe 'test-false' 'A false conditional expression exits 1.' '[ a = b ]'
probe 'test-error' \
  'An invalid operand is an *error*, not False: `[` exits 2, which is why the conformance harness asserts an exact status per row instead of "nonzero = False".' \
  '[ 1 -lt x ]'
probe 'command-not-found' \
  'A missing helper exits 127 — the status a status-only harness would otherwise read as False.' \
  'azdo_expr_no_such_helper a b'
probe 'or-masks-error' \
  'An OR list runs its right operand after *any* non-zero status, so a status-2 conversion error in an earlier operand is masked as False (C-E02-143).' \
  '[ 1 -lt x ] 2>/dev/null || [ a = a ]; printf "final=%s" "$?"'
probe 'and-short-circuits' \
  'An AND list does not run its right operand after a False left operand — the compiled `and` inherits the evaluator laziness of C-E02-028.' \
  '[ a = b ] && echo ran-right; printf "final=%s" "$?"'
probe 'collate-c' \
  'Under LC_ALL=C, `[[ < ]]` compares by byte, so uppercase sorts before lowercase.' \
  'LC_ALL=C; export LC_ALL; [[ alpha < BETA ]] && printf true || printf false'
probe 'collate-utf8' \
  'Under a UTF-8 locale the same comparison flips: `[[ < ]]` is locale-collated, so azdo_expr_cmp must pin LC_ALL=C to get the ordinal comparison Azure Pipelines documents (C-E02-142).' \
  'LC_ALL=en_US.UTF-8; export LC_ALL; [[ alpha < BETA ]] && printf true || printf false'
probe 'upper-ascii' \
  'ASCII case folding is locale-independent.' \
  'LC_ALL=C; export LC_ALL; v=aBc; printf "%s" "${v^^}"'
probe 'upper-non-ascii-c' \
  'Under LC_ALL=C, `^^` leaves non-ASCII alone, where .NET OrdinalIgnoreCase folds it — the declared non-ASCII divergence of C-E02-141.' \
  'LC_ALL=C; export LC_ALL; v=$(printf "\303\251"); printf "%s" "${v^^}"'
probe 'command-substitution-newline' \
  'Command substitution deletes trailing newlines, so a variable whose value ends in a newline cannot round-trip through `$(azdo_var …)` (C-E02-140).' \
  'v=$(printf "a\n\n"); printf "[%s]" "$v"'

printf 'Wrote %s\n' "$OUT"
