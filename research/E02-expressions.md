# E02 — expression language: claims

Claim format per BACKLOG.md §3. IDs sequential, never reused.

**Why this file leans on the oracle rather than the fork.** E02's primary grounding set names
`actions/runner` `src/Sdk/DTExpressions2` as the open reference for the DistributedTask expression
engine (C-E00-012/013). Reading it first thing revealed that it is the **GitHub Actions** dialect
of that engine, not the Azure Pipelines one: it registers Actions' function set (`case`, `toJson`,
`fromJson`), compares `true`/`false`/`null` with `StringComparison.Ordinal`, and its lexer has a
full infix operator set (`==`, `!=`, `<`, `>`, `&&`, `||`, `!`). Azure Pipelines documents none of
that. So the fork is used here only for **shape** — token kinds, the legality-by-previous-token
table, the `''` escape loop — and every accept/reject rule is decided against the live service,
which outranks the fork on divergence (D6). Evidence:
`research/experiments/E02-grammar/survey.md`, 74 live preview calls, regenerate with
`pnpm expr-grammar-survey`.

## Claims

[C-E02-001] **Azure Pipelines expressions have no operators — function-call form only.** Every
infix and prefix operator the fork accepts is rejected by the service: `1 == 1`, `1 != 2`,
`1 > 0`, `1 < 2`, `true && false`, `true || false`, `true & false`, `true | false` and `!true`,
and `(true)` — parenthesised *grouping* — is rejected too, while `eq(1, 1)` in the identical
position is accepted. Structural consequence: the parser is a primary + postfix-chain parser with
no precedence climbing at all, and `(` is legal only immediately after a function name.
  — research/experiments/E02-grammar/survey.md §Operators, rows `op-eq`/`op-ne`/`op-and`/`op-or`/
    `op-not`/`op-gt`/`op-lt`/`op-amp-single`/`op-pipe-single`/`op-group`/`op-func-control`
    (live preview, checked 2026-08-11)
  — contradicts https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/ExpressionConstants.cs#L50-L59
    ("// Operators … internal const String Equal = \"==\";")

[C-E02-002] **Boolean literals are case-insensitive.** `true`, `True` and `TRUE` are all accepted
as booleans. This is the documented rule ("case insensitive, so True or TRUE also works") and it
contradicts the fork, which compares against the lowercase constants with `StringComparison.Ordinal`
— under fork rules `True` would lex as a named value and fail to resolve.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "`True` and `False`
    are boolean literal expressions"; the literals example comments `# case insensitive, so True or
    TRUE also works` (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `bool-lower`/`bool-title`/`bool-upper`
  — cf. https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Tokens/LexicalAnalyzer.cs#L163-L175

[C-E02-003] **`null` cannot be written as a literal.** Both `null` and `NULL` are rejected:
`"Unrecognized value: 'null'"`. Null exists only as a *result* (a dictionary miss). The lexer must
therefore have no null keyword — a Null literal in our AST would accept text the service rejects.
The message is *identical* to the one an unknown context gets (`nosuchcontext` → "Unrecognized
value: 'nosuchcontext'"), which places the rejection: `null` is not a keyword the lexer knows and
fails to allow, it is an ordinary keyword that resolves to no named value. Same for `NaN` and
`Infinity`, which the fork does lex as Number literals. Consequence for the implementation: those
four are rejected by *name resolution*, so a syntax-only parse (no registry supplied) accepts them
— which is correct, and is asserted as such.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "Null can be the
    output of an expression but can't be called directly within an expression" (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `null-lower`/`null-upper`

[C-E02-004] **Number literals start with `-`, `.` or a digit and are plain decimal.** Accepted:
`42`, `-1.2`, `.5` (→ `0.5`), `1.` (→ `1`). Rejected as unrecognized values: `+1`, `1e3`, `0x1F`,
`NaN`, `Infinity`, `1..2`. The `+`/`NaN`/`Infinity` rejections are all fork divergences — the fork
lexes a leading `+` into its number branch and maps the `NaN`/`Infinity` keywords to Doubles.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — Number: "Starts with
    '-', '.', or '0' through '9'" (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `num-int`/`num-neg`/`num-lead-dot`/
    `num-trail-dot`/`num-plus`/`num-exp`/`num-hex`/`nan`/`infinity`/`num-double-dot`
  — cf. https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Tokens/LexicalAnalyzer.cs#L104-L107
    and #L176-L185

[C-E02-005] **A Version literal has three or four segments; two segments is a Number.** `1.2.3` and
`1.2.3.4` are accepted, `1.2.3.4.5` and `-1.2.3` are not. The two-segment case is settled by
comparison rather than by acceptance, since `1.2` is accepted either way: `gt(1.10, 1.9)` returns
**False**, which is numeric ordering (1.1 < 1.9); version ordering would make it True. The control
`gt(1.10.0, 1.9.0)` returns **True**, i.e. version ordering, confirming the discriminator works.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — Version: "A version
    number with up to four segments. Must start with a number and contain two or three period (`.`)
    characters" (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `ver-two`/`ver-three`/`ver-four`/`ver-five`/
    `neg-version`/`ver-vs-num`/`ver-vs-num-control`
  — **docs correction (rule 5)**: docs/02 §6 said "Version 2–4 part comparisons" and E02-S02-T01
    says "Version parsing (2–4 numeric parts)". Two-part versions do not exist; a 2-part literal is
    a Number. docs/02 §6 corrected, decisions record entry added.

[C-E02-006] **Strings are single-quoted, with `''` as the escape.** `'a b c'` → `a b c`;
`'It''s OK'` → `It's OK`. `"double"` is rejected as an unrecognized value — double quotes are not a
string form and not even a token boundary, so the whole run lexes as one bad token. An
*unterminated* string is not reported by the expression lexer at all: `${{ 'unclosed }}` is
rejected by the template scanner with `"The expression is not closed. An unescaped ${{ sequence was
found, but the closing }} sequence was not found."` — the `}}` was consumed as string content.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — String: "Must be
    single-quoted… To express a literal single-quote, escape it with a single quote" (checked
    2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `str-plain`/`str-escape`/`str-double`/
    `str-unclosed`
  — escape loop mirrored from https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Tokens/LexicalAnalyzer.cs#L212-L246

[C-E02-007] **Property names after `.` must start with a letter or `_`, then letters, digits or
`_`.** `parameters.obj.b_c` and `parameters.obj._lead` resolve; `parameters.obj.9num` is rejected
(`"Unexpected symbol: '9num'"`) even though the object really has a `9num` key — i.e. the
restriction is lexical, not a lookup failure, and such keys are reachable only through index
syntax.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "To use property
    dereference syntax, the property name must: Start with `a-Z` or `_`; Be followed by `a-Z`,
    `0-9`, or `_`" (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `acc-property`/`acc-underscore`/
    `acc-lead-underscore`/`acc-lead-digit`/`acc-index-string`

[C-E02-008] **Index `[ ]` takes an arbitrary expression, and postfix chains apply to any operand.**
`parameters.obj.list[0].id` → 7, `parameters.obj['dotted.name']` → five,
`parameters.obj.list[parameters.obj.a].id` → 8 (a nested access used as the index),
`parameters['obj'].a` → 1 (index directly off a named value) and `split('a,b', ',')[1]` → b (index
off a function result). So `[ ]` is not restricted to literals, and the postfix loop is uniform.
  — research/experiments/E02-grammar/survey.md rows `acc-index-number`/`acc-index-string`/
    `acc-index-expr`/`acc-index-named`/`acc-func-index` (live preview, checked 2026-08-11)

[C-E02-009] **Filtered arrays exist in both spellings.** `parameters.obj.list.*.id` and
`parameters.obj.list[*].id` both yield `[7, 8]`, so `*` is a distinct AST node reachable after `.`
and inside `[ ]`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "use the `*` syntax to
    apply a filtered array… `foo.*.id`" (checked 2026-08-11)
  — research/experiments/E02-grammar/survey.md rows `acc-wildcard-dot`/`acc-wildcard-index`

[C-E02-010] **A missing member is a runtime Null, never a parse error, and chains safely.**
`parameters.obj.nosuch` and `parameters.obj.nosuch.deeper` both expand successfully to an empty
value. The parser must not attempt any member validation.
  — research/experiments/E02-grammar/survey.md rows `acc-missing`/`acc-missing-chain` (live
    preview, checked 2026-08-11)

[C-E02-011] **Function names are case-insensitive and both the name and its arity are validated at
parse time.** `EQ(1, 1)` is accepted; `nosuchfunc(1)` is rejected with `"Unrecognized value:
'nosuchfunc'"` (positioned at the *name*, not the call); `eq(1)` is rejected with `"Unexpected
symbol: ')'"` — the arity check fires while the call is still being read. Whitespace between the
name and `(` is allowed (`eq (1, 1)` is accepted), so the function/named-value decision needs
lookahead past whitespace.
  — research/experiments/E02-grammar/survey.md rows `val-func-case`/`val-func-unknown`/
    `val-func-arity`/`val-func-space` (live preview, checked 2026-08-11)
  — parse-time arity validation mirrored from https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/ExpressionParser.cs#L344-L354
    (`TooFewParameters`/`TooManyParameters`)

[C-E02-012] **Named values (contexts) are case-insensitive, are validated at parse time, and stand
alone.** `PARAMETERS.obj.a` resolves; `nosuchcontext.a` is rejected with `"Unrecognized value:
'nosuchcontext'"` before any member access is attempted; `convertToJson(parameters)` shows a bare
named value is a complete expression.
  — research/experiments/E02-grammar/survey.md rows `acc-named-case`/`val-named-unknown`/
    `acc-named-bare` (live preview, checked 2026-08-11)
  — cf. https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/ExpressionParser.cs#L126-L146
    (`UnrecognizedFunction`/`UnrecognizedNamedValue` thrown from the parser)

[C-E02-013] **Two parse-error kinds, with a 1-based position inside the expression.** The service
renders `"<file> (Line: L, Col: C): <kind>: '<raw>'. Located at position N within expression:
'<expression>'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996"`, where
`N` is 1-based over the expression text (`1 == 1` → 3; `parameters.obj.9num` → 16). The kinds
separate cleanly across all 74 rows:
  * **`Unrecognized value: '<raw>'`** — a value-shaped token that resolves to nothing: `null`,
    `+1`, `1e3`, `0x1F`, `NaN`, `Infinity`, `"double"`, `1.2.3.4.5`, `-1.2.3`, `1..2`, `!true`, an
    unknown function name, an unknown named value.
  * **`Unexpected symbol: '<raw>'`** — punctuation legal to the lexer but illegal in that position:
    `==`, `!=`, `<`, `&`, `|`, `(` as grouping, `)` closing a call too early, `2` in `1 2`, `9num`
    after `.`.
  Two further kinds are their own sentences rather than the `<kind>: '<raw>'` shape:
  * `"Expected a property name to follow the dereference operator '.': '.'"` — `parameters.obj.`,
    positioned at the trailing `.` (15, 1-based).
  * `"Unclosed function: 'eq'"` — `eq(1,`, positioned at the **function name** (1), not at the end
    of the text. So an unterminated call is reported from where it opened.
  An empty expression is its own message, with no position: `"An expression was expected"`.
  — research/experiments/E02-grammar/survey.md, all groups; rows `val-trailing-dot`/
    `val-unclosed-call`/`val-empty` (live preview, checked 2026-08-11)
  — the `(Line: N, Col: M)` prefix is the same one E01-S01-T03 renders (C-E01-007)

[C-E02-017] **Arity errors are positioned at the token that breaks the count, on both sides.**
`eq(1)` → `Unexpected symbol: ')'` at 5 (the closing paren, i.e. the check fires when the call
closes short); `eq(1, 2, 3)` → `Unexpected symbol: ','` at 8 (the separator that would open the
extra argument, i.e. the check fires *before* reading it). An empty index behaves the same way:
`parameters.obj.list[]` → `Unexpected symbol: ']'` at 21.
  — research/experiments/E02-grammar/survey.md rows `val-func-arity`/`val-func-too-many`/
    `val-empty-index` (live preview, checked 2026-08-11)

[C-E02-014] **Maximum expression nesting depth is 50, counting the leaf, and the boundary is
exact.** 49 nested `not(…)` around a `false` — depth 50 — is accepted; 50 nested calls (depth 51)
is rejected with `"Exceeded max expression depth 50"`, as are 51 and 60. **Only function arguments
deepen the count**: a 60-link property chain (`parameters.obj.a.a.…`) and a 60-link index chain
(`parameters.obj['a']['a']…`) are both accepted. So the rule is: the root node is depth 1, every
function argument is its parent's depth + 1, member access is free, and the parse fails when any
node exceeds 50. Counting member access as well — the obvious reading of the fork, where `Index` is
itself a `Function` subclass — would have rejected pipelines the service runs. The number matches
the fork's
`MaxDepth` constant exactly, which also carries a `MaxLength = 21000` — **that one is not verified
against Azure Pipelines** and is deliberately not implemented (an unverified length ceiling would
reject pipelines the service accepts). Open for E03's server-limit work.
  — research/experiments/E02-grammar/survey.md rows `val-depth-49`/`val-depth-50`/`val-depth-51`/
    `val-depth`/`val-depth-control`/`val-depth-property`/`val-depth-index` (live preview, checked
    2026-08-11)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/ExpressionConstants.cs#L30-L31
    ("MaxDepth = 50", "MaxLength = 21000")

[C-E02-015] **Runtime `$[ ]` expressions are parsed at queue/preview time by the same grammar, but
reported differently.** `$[ eq(1, 1) ]` survives expansion verbatim in `finalYaml` (it is not
evaluated at compile time), yet `$[ 1 == 1 ]` and `$[ 'unclosed ]` are *rejected* by the same
preview call — so the runtime expression is parsed even though it is not evaluated. Its errors
carry no file/line/col: the prefix is `"An error occurred while loading the YAML build pipeline."`
and, for the operator case, the kind is `Unrecognized value` where the compile-time parser said
`Unexpected symbol`. One grammar, two error renderings.
  — research/experiments/E02-grammar/survey.md §Runtime, rows `rt-func`/`rt-op`/`rt-garbage`
    (live preview, checked 2026-08-11)

[C-E02-016] **Lexer shape borrowed from the fork** (used only where the service agrees): whitespace
is skipped between tokens; a token's legality is decided by the *previous* token's kind, which is
what turns `1 2`, `(true)` and `eq(1)` into position-carrying errors instead of silent acceptance;
`(` lexes as "start parameters" only when the last token was a function name; `*` is legal only
after `[` or `.`; a keyword token becomes a function when the next non-whitespace character is `(`,
otherwise a named value.
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Tokens/LexicalAnalyzer.cs#L317-L467
    (`CreateToken` legality table) and #L186-L203 (function/named-value lookahead), checked
    2026-08-11
  — every rule above re-verified against the service in survey.md before being encoded

[C-E02-018] **The Azure Pipelines evaluator has seven observable value kinds: Null, Boolean,
Number, String, Version, Object, and Array.** Boolean, Number, String, and Version have literal
syntax; Null is produced by a dictionary miss but cannot be written directly; Object and Array
arrive through contexts such as parameters, and the language has no array literal syntax. This is
why the evaluator value type must tag all seven even though the parser can construct only four.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions (Literals, Null,
    Version, and `containsValue`; checked 2026-08-12)
  — "Null can be the output of an expression but can't be called directly within an expression."
  — "There is no literal syntax in a YAML pipeline for specifying an array."

[C-E02-019] **The open fork corroborates distinct tagged primitive/Object/Array values and a
read-only array boundary, but it does not contain Azure Pipelines' Version kind.** Its `ValueKind`
enum is exactly Array, Boolean, Null, Number, Object, String; `EvaluationResult.GetKind` maps the
canonical CLR value into those tags; and `IReadOnlyArray` exposes only `Count`, a getter, and an
enumerator. The missing Version is another measured dialect boundary, so Azure's official docs
and C-E02-005 outrank the fork for that seventh kind.
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/ValueKind.cs#L7-L15
    (checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/EvaluationResult.cs#L379-L408
    (checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Sdk/IReadOnlyArray.cs#L7-L15
    (checked 2026-08-12)

## Known message-level divergence (deliberate)

`! true` (bang, space, operand) is rejected by both sides but at different places: the service
reports `Unexpected symbol: 'true'` at position 3, ours reports the `!` at position 1. The service's
lexer evidently consumes a lone `!` as a token and fails on the operand, while `!true` (no space)
comes back as `Unrecognized value: '!true'` — one scan-to-boundary token. Reproducing both required
guessing at the closed v1 lexer's fall-through, so the tokenizer implements the `!true` case (which
is the one a human writes) and accepts the position difference on `! true`. Both spellings are
rejected, which is what matters here; E02-S01-T02 owns message parity and can revisit with more
probes.
  — research/experiments/E02-grammar/survey.md rows `op-not`/`op-bang-alone`
