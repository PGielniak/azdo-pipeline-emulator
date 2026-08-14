#!/usr/bin/env bats
# GENERATED FILE — do not edit.
#
# Source of truth: packages/engine/test/expr/conformance.table.ts (E02-S05-T02).
# Regenerate with `pnpm expr-conformance-bats`; the engine suite fails while this file is
# stale, so the two backends cannot drift apart unnoticed.
#
# Exit status is the datum: 0 = True, 1 = False, 2 = evaluation error. Rows tagged
# `diverges` assert the *measured* shell answer together with the claim that explains why it
# differs from the evaluator, so the gap can neither widen nor vanish in silence.
#
# 6 row(s) are rejected by the compiler and are asserted in the engine suite
# instead (BashCompileError):
#   contains-value-array — containsValue consumes an Array/Object, which has no shell representation
#   split-returns-array — split returns an Array, which has no shell form
#   join-consumes-array — join consumes an Array, which has no shell form
#   convert-to-json-returns-text — convertToJson serialises Object/Array values the shell backend cannot hold
#   counter-needs-convert-time-state — counter reads the convert-time state provider seam, not the runtime store
#   dynamic-index-unsupported — a dynamic index needs the whole variables table, not a single azdo_var read

bats_require_minimum_version 1.5.0

setup() {
  load helpers/expr-conformance.bash
  azdo_emu_expr_setup
}

@test "C-E02-020 coercion-boolean-order-eq [agree]: eq(false, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq bool False bool True'
}
@test "C-E02-020 coercion-boolean-order-ne [agree]: ne(false, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne bool False bool True'
}
@test "C-E02-020 coercion-boolean-order-lt [agree]: lt(false, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt bool False bool True'
}
@test "C-E02-020 coercion-boolean-order-le [agree]: le(false, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le bool False bool True'
}
@test "C-E02-020 coercion-boolean-order-gt [agree]: gt(false, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt bool False bool True'
}
@test "C-E02-020 coercion-boolean-order-ge [agree]: ge(false, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge bool False bool True'
}
@test "C-E02-021 coercion-decimal-string-eq [agree]: eq(0.5, '0.5')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num 0.5 str 0.5'
}
@test "C-E02-021 coercion-decimal-string-ne [agree]: ne(0.5, '0.5')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ne num 0.5 str 0.5'
}
@test "C-E02-021 coercion-decimal-string-lt [agree]: lt(0.5, '0.5')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp lt num 0.5 str 0.5'
}
@test "C-E02-021 coercion-decimal-string-le [agree]: le(0.5, '0.5')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le num 0.5 str 0.5'
}
@test "C-E02-021 coercion-decimal-string-gt [agree]: gt(0.5, '0.5')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt num 0.5 str 0.5'
}
@test "C-E02-021 coercion-decimal-string-ge [agree]: ge(0.5, '0.5')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ge num 0.5 str 0.5'
}
@test "C-E02-021 coercion-thousands-string-eq [agree]: eq(1000, '1,000')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num 1000 str '\''1,000'\'''
}
@test "C-E02-021 coercion-thousands-string-ne [agree]: ne(1000, '1,000')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ne num 1000 str '\''1,000'\'''
}
@test "C-E02-021 coercion-thousands-string-lt [agree]: lt(1000, '1,000')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp lt num 1000 str '\''1,000'\'''
}
@test "C-E02-021 coercion-thousands-string-le [agree]: le(1000, '1,000')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le num 1000 str '\''1,000'\'''
}
@test "C-E02-021 coercion-thousands-string-gt [agree]: gt(1000, '1,000')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt num 1000 str '\''1,000'\'''
}
@test "C-E02-021 coercion-thousands-string-ge [agree]: ge(1000, '1,000')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ge num 1000 str '\''1,000'\'''
}
@test "C-E02-020 coercion-string-case-eq [agree]: eq('AbC', 'aBc')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str AbC str aBc'
}
@test "C-E02-020 coercion-string-case-ne [agree]: ne('AbC', 'aBc')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ne str AbC str aBc'
}
@test "C-E02-020 coercion-string-case-lt [agree]: lt('AbC', 'aBc')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp lt str AbC str aBc'
}
@test "C-E02-020 coercion-string-case-le [agree]: le('AbC', 'aBc')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le str AbC str aBc'
}
@test "C-E02-020 coercion-string-case-gt [agree]: gt('AbC', 'aBc')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt str AbC str aBc'
}
@test "C-E02-020 coercion-string-case-ge [agree]: ge('AbC', 'aBc')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ge str AbC str aBc'
}
@test "C-E02-020 coercion-number-order-eq [agree]: eq(-1, 2)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq num -1 num 2'
}
@test "C-E02-020 coercion-number-order-ne [agree]: ne(-1, 2)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne num -1 num 2'
}
@test "C-E02-020 coercion-number-order-lt [agree]: lt(-1, 2)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt num -1 num 2'
}
@test "C-E02-020 coercion-number-order-le [agree]: le(-1, 2)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le num -1 num 2'
}
@test "C-E02-020 coercion-number-order-gt [agree]: gt(-1, 2)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt num -1 num 2'
}
@test "C-E02-020 coercion-number-order-ge [agree]: ge(-1, 2)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge num -1 num 2'
}
@test "C-E02-022 coercion-version-order-eq [agree]: eq(1.2.3, 1.10.0)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-version-order-ne [agree]: ne(1.2.3, 1.10.0)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-version-order-lt [agree]: lt(1.2.3, 1.10.0)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-version-order-le [agree]: le(1.2.3, 1.10.0)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-version-order-gt [agree]: gt(1.2.3, 1.10.0)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-version-order-ge [agree]: ge(1.2.3, 1.10.0)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge ver 1.2.3 ver 1.10.0'
}
@test "C-E02-022 coercion-number-to-version-eq [agree]: eq(1.2.0, 1.3)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-number-to-version-ne [agree]: ne(1.2.0, 1.3)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-number-to-version-lt [agree]: lt(1.2.0, 1.3)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-number-to-version-le [agree]: le(1.2.0, 1.3)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-number-to-version-gt [agree]: gt(1.2.0, 1.3)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-number-to-version-ge [agree]: ge(1.2.0, 1.3)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge ver 1.2.0 num 1.3'
}
@test "C-E02-022 coercion-string-to-version-eq [agree]: eq(1.2.0, '1.3')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq ver 1.2.0 str 1.3'
}
@test "C-E02-022 coercion-string-to-version-ne [agree]: ne(1.2.0, '1.3')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne ver 1.2.0 str 1.3'
}
@test "C-E02-022 coercion-string-to-version-lt [agree]: lt(1.2.0, '1.3')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt ver 1.2.0 str 1.3'
}
@test "C-E02-022 coercion-string-to-version-le [agree]: le(1.2.0, '1.3')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le ver 1.2.0 str 1.3'
}
@test "C-E02-022 coercion-string-to-version-gt [agree]: gt(1.2.0, '1.3')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt ver 1.2.0 str 1.3'
}
@test "C-E02-022 coercion-string-to-version-ge [agree]: ge(1.2.0, '1.3')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge ver 1.2.0 str 1.3'
}
@test "C-E02-021 coercion-failed-number-eq [agree]: eq(1, 'x')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq num 1 str x'
}
@test "C-E02-021 coercion-failed-number-ne [agree]: ne(1, 'x')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne num 1 str x'
}
@test "C-E02-021 coercion-failed-number-lt [agree]: lt(1, 'x')" {
  run -2 azdo_emu_expr_run 'azdo_expr_cmp lt num 1 str x'
}
@test "C-E02-021 coercion-failed-number-le [agree]: le(1, 'x')" {
  run -2 azdo_emu_expr_run 'azdo_expr_cmp le num 1 str x'
}
@test "C-E02-021 coercion-failed-number-gt [agree]: gt(1, 'x')" {
  run -2 azdo_emu_expr_run 'azdo_expr_cmp gt num 1 str x'
}
@test "C-E02-021 coercion-failed-number-ge [agree]: ge(1, 'x')" {
  run -2 azdo_emu_expr_run 'azdo_expr_cmp ge num 1 str x'
}
@test "C-E02-020 coercion-boolean-to-string-eq [agree]: eq('True', true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str True bool True'
}
@test "C-E02-020 coercion-boolean-to-string-ne [agree]: ne('True', true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ne str True bool True'
}
@test "C-E02-020 coercion-boolean-to-string-lt [agree]: lt('True', true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp lt str True bool True'
}
@test "C-E02-020 coercion-boolean-to-string-le [agree]: le('True', true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le str True bool True'
}
@test "C-E02-020 coercion-boolean-to-string-gt [agree]: gt('True', true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt str True bool True'
}
@test "C-E02-020 coercion-boolean-to-string-ge [agree]: ge('True', true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ge str True bool True'
}
@test "C-E02-020 coercion-boolean-to-number-eq [agree]: eq(1, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num 1 bool True'
}
@test "C-E02-020 coercion-boolean-to-number-ne [agree]: ne(1, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ne num 1 bool True'
}
@test "C-E02-020 coercion-boolean-to-number-lt [agree]: lt(1, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp lt num 1 bool True'
}
@test "C-E02-020 coercion-boolean-to-number-le [agree]: le(1, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le num 1 bool True'
}
@test "C-E02-020 coercion-boolean-to-number-gt [agree]: gt(1, true)" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt num 1 bool True'
}
@test "C-E02-020 coercion-boolean-to-number-ge [agree]: ge(1, true)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ge num 1 bool True'
}
@test "C-E02-020 coercion-string-order-eq [agree]: eq('alpha', 'BETA')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq str alpha str BETA'
}
@test "C-E02-020 coercion-string-order-ne [agree]: ne('alpha', 'BETA')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp ne str alpha str BETA'
}
@test "C-E02-020 coercion-string-order-lt [agree]: lt('alpha', 'BETA')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt str alpha str BETA'
}
@test "C-E02-020 coercion-string-order-le [agree]: le('alpha', 'BETA')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp le str alpha str BETA'
}
@test "C-E02-020 coercion-string-order-gt [agree]: gt('alpha', 'BETA')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp gt str alpha str BETA'
}
@test "C-E02-020 coercion-string-order-ge [agree]: ge('alpha', 'BETA')" {
  run -1 azdo_emu_expr_run 'azdo_expr_cmp ge str alpha str BETA'
}
@test "C-E02-028 and-short-circuits-on-false [agree]: and(false, lt(1, 'x'))" {
  run -1 azdo_emu_expr_run 'azdo_expr_truthy bool False && azdo_expr_cmp lt num 1 str x'
}
@test "C-E02-028 and-all-true [agree]: and(eq(1, 1), eq('a', 'A'))" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num 1 num 1 && azdo_expr_cmp eq str a str A'
}
@test "C-E02-028 or-short-circuits-on-true [agree]: or(true, lt(1, 'x'))" {
  run -0 azdo_emu_expr_run 'azdo_expr_truthy bool True || azdo_expr_cmp lt num 1 str x'
}
@test "C-E02-028 or-after-conversion-error [diverges C-E02-143]: or(lt(1, 'x'), true)" {
  # an OR list runs its right operand after any non-zero status, so the status-2 conversion error of the left operand is masked as False
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt num 1 str x || azdo_expr_truthy bool True'
}
@test "C-E02-028 not-inverts [agree]: not(eq(1, 2))" {
  run -0 azdo_emu_expr_run '! azdo_expr_cmp eq num 1 num 2'
}
@test "C-E02-028 not-converts-string [agree]: not('')" {
  run -0 azdo_emu_expr_run '! azdo_expr_truthy str '\'''\'''
}
@test "C-E02-030 in-matches-later-candidate [agree]: in('b', 'a', 'B')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str b str a || azdo_expr_cmp eq str b str B'
}
@test "C-E02-030 in-converts-candidates [agree]: in(1000, 'x', '1,000')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num 1000 str x || azdo_expr_cmp eq num 1000 str '\''1,000'\'''
}
@test "C-E02-030 not-in-absent [agree]: notIn('b', 'a', 'c')" {
  run -0 azdo_emu_expr_run '! { azdo_expr_cmp eq str b str a || azdo_expr_cmp eq str b str c; }'
}
@test "C-E02-031 contains-ordinal-ignore-case [agree]: contains('ABCdef', 'cDe')" {
  run -0 azdo_emu_expr_run 'azdo_expr_contains ABCdef cDe'
}
@test "C-E02-031 contains-absent [agree]: contains('abc', 'z')" {
  run -1 azdo_emu_expr_run 'azdo_expr_contains abc z'
}
@test "C-E02-041 starts-with-ignores-case [agree]: startsWith('refs/heads/main', 'REFS/')" {
  run -0 azdo_emu_expr_run 'azdo_expr_startswith refs/heads/main REFS/'
}
@test "C-E02-041 ends-with-ignores-case [agree]: endsWith('main', 'AIN')" {
  run -0 azdo_emu_expr_run 'azdo_expr_endswith main AIN'
}
@test "C-E02-041 xor-differs [agree]: xor(true, false)" {
  run -0 azdo_emu_expr_run 'azdo_expr_xor bool True bool False'
}
@test "C-E02-041 xor-converts-number [agree]: xor(true, 0)" {
  run -0 azdo_emu_expr_run 'azdo_expr_xor bool True num 0'
}
@test "C-E02-045 format-reorders-and-reuses [agree]: eq(format('{1}/{0}/{1}', 'a', 'b'), 'b/a/b')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_format '\''{1}/{0}/{1}'\'' a b)" str b/a/b'
}
@test "C-E02-045 format-doubled-braces [agree]: eq(format('{{{0}}}', 'x'), '{x}')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_format '\''{{{0}}}'\'' x)" str '\''{x}'\'''
}
@test "C-E02-045 format-missing-index [diverges C-E02-144]: eq(format('{2}', 'a'), 'x')" {
  # a helper in value position reports its error through an exit status that command substitution discards, so the failed format yields the empty string and the comparison answers False instead of raising
  run -1 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_format '\''{2}'\'' a)" str x'
}
@test "C-E02-041 lower-folds [agree]: eq(lower('AB'), 'ab')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_lower AB)" str ab'
}
@test "C-E02-041 upper-folds [agree]: eq(upper('ab'), 'AB')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_upper ab)" str AB'
}
@test "C-E02-041 trim-strips-both-ends [agree]: eq(trim('  x  '), 'x')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_trim '\''  x  '\'')" str x'
}
@test "C-E02-046 replace-all-occurrences [agree]: eq(replace('a.b.c', '.', '-'), 'a-b-c')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_replace a.b.c . -)" str a-b-c'
}
@test "C-E02-046 replace-empty-search-is-identity [agree]: eq(replace('abc', '', '-'), 'abc')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_replace abc '\'''\'' -)" str abc'
}
@test "C-E02-047 length-counts-string [agree]: eq(length('abcd'), 4)" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq num "$(azdo_expr_length abcd)" num 4'
}
@test "C-E02-041 coalesce-skips-empty [agree]: eq(coalesce('', 'z'), 'z')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_coalesce '\'''\'' z)" str z'
}
@test "C-E02-049 iif-selects-false-branch [agree]: eq(iif(false, 'a', 'b'), 'b')" {
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_expr_iif bool False a b)" str b'
}
@test "C-E02-089 variables-dotted-name [agree]: eq(variables['Build.SourceBranch'], 'refs/heads/main')" {
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_var '\''Build.SourceBranch'\'')" str refs/heads/main'
}
@test "C-E02-089 variables-fold-case [agree]: eq(variables.buildid, 42)" {
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_var '\''buildid'\'')" num 42'
}
@test "C-E02-138 variables-missing-equals-empty [agree]: eq(variables.Absent, '')" {
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  run -0 azdo_emu_expr_run 'azdo_expr_cmp eq str "$(azdo_var '\''Absent'\'')" str '\'''\'''
}
@test "C-E02-138 variables-missing-ordered [diverges C-E02-138]: lt(variables.Absent, 'x')" {
  # the shell backend has no Null: a missing variable reads as the empty String, which orders below "x" instead of failing the String→Null conversion
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  run -0 azdo_emu_expr_run 'azdo_expr_cmp lt str "$(azdo_var '\''Absent'\'')" str x'
}
@test "C-E02-131 condition-docs-canonical [agree]: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))" {
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  azdo_status_succeeded() { return 0; }
  run -0 azdo_emu_expr_run 'azdo_status_succeeded && azdo_expr_cmp eq str "$(azdo_var '\''Build.SourceBranch'\'')" str refs/heads/main'
}
@test "C-E02-131 condition-docs-canonical-not-succeeded [agree]: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))" {
  azdo_var_set 'Build.SourceBranch' 'refs/heads/main'
  azdo_var_set 'BuildId' '42'
  azdo_status_succeeded() { return 1; }
  run -1 azdo_emu_expr_run 'azdo_status_succeeded && azdo_expr_cmp eq str "$(azdo_var '\''Build.SourceBranch'\'')" str refs/heads/main'
}
