#!/usr/bin/env bats
# E02-S05-T02 — direct assertions on lib/expr.sh, beside the generated conformance suite.
#
# The generated suite exercises these helpers only *through* a comparison, and C-E02-147 showed why
# that is not enough: on bash 3.2 the case-modification expansions do not exist, both operands of a
# comparison became the empty string, and the two empty strings compared **equal** — so `lower()`
# and `upper()` rows passed while the helper was returning nothing at all. These cases assert the
# returned text, where an empty result cannot look like agreement.

bats_require_minimum_version 1.5.0

setup() {
  load helpers/expr-conformance.bash
  azdo_emu_expr_setup
}

@test "case folding works on the host bash, whatever its version (C-E02-147)" {
  run -0 azdo_expr_upper 'aBc'
  [ "$output" = 'ABC' ]
  run -0 azdo_expr_lower 'AbC'
  [ "$output" = 'abc' ]
}

@test "string ordering is ordinal-ignore-case, not locale-collated (C-E02-142)" {
  # Under a UTF-8 collation `alpha` sorts *before* `BETA` for the wrong reason; the fold to
  # upper-case plus LC_ALL=C is what makes ALPHA < BETA the ordinal answer the evaluator gives.
  LC_ALL=en_US.UTF-8 run -0 azdo_expr_cmp lt str 'alpha' str 'BETA'
  LC_ALL=en_US.UTF-8 run -1 azdo_expr_cmp gt str 'alpha' str 'BETA'
}

@test "the conversion table answers by kind, not by text (C-E02-020)" {
  run -0 azdo_expr_cmp eq num 1 bool True
  run -0 azdo_expr_cmp eq num 1000 str '1,000'
  run -0 azdo_expr_cmp lt ver 1.2 ver 1.2.0
  run -0 azdo_expr_cmp eq num 0.50 num 0.5
}

@test "a failed conversion is False for eq, True for ne, and an error for ordered (C-E02-135)" {
  run -1 azdo_expr_cmp eq num 1 str 'x'
  run -0 azdo_expr_cmp ne num 1 str 'x'
  run -2 azdo_expr_cmp lt num 1 str 'x'
  [[ "$output" == *'Unable to convert from str to num.'* ]]
}

@test "string helpers return text, and a bad format is an evaluation error (C-E02-045)" {
  run -0 azdo_expr_format '{1}/{0}/{1}' a b
  [ "$output" = 'b/a/b' ]
  run -0 azdo_expr_format '{{{0}}}' x
  [ "$output" = '{x}' ]
  run -2 azdo_expr_format '{2}' a
  run -0 azdo_expr_trim '  x  '
  [ "$output" = 'x' ]
  run -0 azdo_expr_replace 'a.b.c' '.' '-'
  [ "$output" = 'a-b-c' ]
  run -0 azdo_expr_coalesce '' '' 'z'
  [ "$output" = 'z' ]
  run -0 azdo_expr_iif bool False A B
  [ "$output" = 'B' ]
}

@test "azdo_expr_bool renders a predicate status as the Azure Boolean string" {
  run -0 azdo_expr_bool 0
  [ "$output" = 'True' ]
  run -0 azdo_expr_bool 1
  [ "$output" = 'False' ]
}

@test "values reach the helpers byte-for-byte through the store" {
  azdo_var_set 'Odd.Name' "a b'c\"d"
  run -0 azdo_emu_expr_run "azdo_expr_cmp eq str \"\$(azdo_var 'Odd.Name')\" str 'a b'\\''c\"d'"
}
