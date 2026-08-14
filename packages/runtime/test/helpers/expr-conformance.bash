# shellcheck shell=bash
# E02-S05-T02 — run side of the dual-backend conformance harness.
#
# `expr-conformance.bats` is generated from the same row table the evaluator tests run
# (packages/engine/test/expr/conformance.table.ts); these helpers give each generated case a fresh
# variable store and a way to execute the compiled snippet.

# Fresh state store plus both runtime libraries, for one test.
azdo_emu_expr_setup() {
  load helpers/fixture-store.bash
  azdo_emu_load_runtime core.sh
  azdo_emu_load_runtime expr.sh
  AZDO_STATE_DIR="$(azdo_emu_scratch_dir state)"
  AZDO_VAR_SCOPE='job'
  export AZDO_STATE_DIR AZDO_VAR_SCOPE
  unset AZDO_OUTPUT_DIR AZDO_STEP_NAME
}

# azdo_emu_expr_run <compiled-snippet>
#
# `eval` is the point: the snippet is generated shell, and running it *as shell* is the only way
# the harness can catch a compiler that emits something bash will not accept.  The exit status is
# the datum — 0 True, 1 False, 2 evaluation error — and the generated `run -N` asserts it exactly,
# so a helper that is missing (127) or a snippet with a syntax error (2 from bash itself, on
# stderr) can never be read as False.
azdo_emu_expr_run() {
  eval "$1"
}
