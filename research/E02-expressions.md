# E02 — expression language: claims

Claim format per BACKLOG.md §3. IDs never reused — and, because E02's tasks run on parallel
branches, allocated **per task from the block table below** rather than by taking the next free
number in whatever copy of this file your branch happens to see (research/README.md, "Allocating IDs
across parallel branches"). E02-S01-T02 originally took 018–027 and was renumbered to 101–110 during
the 2026-08-12 integration merge, because E02-S02-T01/T02/T03 had taken the same ten numbers on
`codex/e02-s02-*` at the same time; the 018–027 claims below are the codex chain's, unchanged.

| Block | Task |
|---|---|
| 001–017 | E02-S01-T01 tokenizer + parser |
| 018–019 | E02-S02-T01 value model |
| 020–023 | E02-S02-T02 coercion & equality |
| 024–027 | E02-S02-T03 member access |
| 028–039 | E02-S03-T01 logical & membership (028–032 used) |
| 040–059 | E02-S03-T02/T04 general string & utility functions (040 used) |
| 060–079 | E02-S03-T03 status functions (060–072 used) |
| 080–099 | *free — next S04 task takes a block here* |
| 101–110 | E02-S01-T02 error rendering |
| 111–199 | *free — reserve in this table before use* |

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

[C-E02-020] **Conversions are directional, and comparisons convert the right operand to the
left operand's kind.** The documented primitive matrix, transcribed cell-for-cell, is:
Boolean→Number/String; Null→Boolean/Number/String; Number→Boolean/String and partially Version;
String→Boolean, partially Null/Number/Version; Version→Boolean/String; same-kind cells need no
conversion; every other primitive cell is unsupported. Boolean→Number is 0/1 and →String is
`False`/`True`; Null→Boolean/Number/String is false/0/empty; Number→Boolean is zero false, otherwise
true; String→Boolean is empty false, otherwise true; only empty String→Null; Version is always true
as Boolean and stringifies by its components. `eq`/`ne` return false/true when conversion fails;
ordered comparisons error. Strings compare ordinal-ignore-case.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#type-casting
    (conversion table and per-type rules, checked 2026-08-12)
  — table cells: `Boolean: - - Yes Yes -`; `Null: Yes - Yes Yes -`;
    `Number: Yes - - Yes Partial`; `String: Yes Partial Partial - Partial`;
    `Version: Yes - - Yes -`
  — comparison entries say "Converts right parameter to match type of left parameter"; `eq`
    false, `ne` true, and ordered comparisons error on failure.

[C-E02-021] **The live service's String→Number behavior contradicts the current Learn wording:**
it accepts invariant decimal and grouped strings, not only Int32. `eq(.5, '0.5')` and
`eq(1000, '1,000')` are True; reverse-direction controls prove Number→String yields `0.5` and
`1000`. Failed conversion makes `eq(1,'x')` False and `ne(1,'x')` True, while `lt(1,'x')` rejects
with `Unable to convert from String to Number`. Empty String and Null compare equal in both
directions, and Null compares equal to Number zero.
  — research/experiments/E02-coercion/ (`string-to-number-half`,
    `string-to-number-thousands`, `number-to-string-half`, `number-to-string-thousands`,
    `string-number-failure-{eq,ne,lt}`, `empty-string-left-null`,
    `null-left-empty-string`, `null-to-number`; live preview, checked 2026-08-12)
  — contradicts https://learn.microsoft.com/azure/devops/pipelines/process/expressions#string
    saying String→Number runs `Int32.TryParse`; decimal `.5` cannot be an Int32.

[C-E02-022] **Version literals and converted Versions have different minimum arities.** A literal
requires 3–4 segments (C-E02-005), but String→Version and Number→Version can produce a 2-segment
Version: `lt(1.2.0, '1.3')` and `lt(1.2.0, 1.3)` are True. Missing components remain significant:
`eq(1.2.0, '1.2')` and `eq(1.2.0, 1.2)` are False, while the three-component string control is
True. Versions order component-wise (`1.2.3 < 1.10.0`). Whole Number `2` cannot convert because it
has no nonzero decimal.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#number and #string
    (partial Number→Version constraint and `Version.TryParse`; checked 2026-08-12)
  — research/experiments/E02-coercion/ (`number-to-version{,-ordered,-invalid}`,
    `string-to-version-{two,ordered,three}`, `version-order`, `version-to-number`; live preview,
    checked 2026-08-12)

[C-E02-023] **Object and Array equality is reference identity, not structural equality.** Comparing
the same parameter object/array with itself is True; comparing two separately declared values with
the same shape is False. Every ordered collection comparison — even a reference against itself —
is rejected as an Object/Array→Number conversion failure.
  — research/experiments/E02-coercion/ (`object-{same-reference,distinct-equal-shape}` and
    `array-{same-reference,distinct-equal-shape}`, plus `{object,array}-{same,distinct}-order`;
    live preview, checked 2026-08-12)
  — corroborated by https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/EvaluationResult.cs#L139-L141
    (`Object.ReferenceEquals`; checked 2026-08-12)

[C-E02-024] **Property and index syntax are the same lookup operation after parsing; object indices
convert primitive keys to String, and every dictionary miss returns Null.** Exact-case property and
index reads both return `CamelKey`; index syntax reaches `dotted.name`; numeric index `1` reaches
the object key `'1'`; and both missing spellings make `coalesce` select its fallback.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions (index/property syntax,
    Null from a dictionary miss; checked 2026-08-12)
  — research/experiments/E02-members/ (`property-exact`, `index-exact`, `dotted-index`,
    `numeric-object-index`, `missing-property`, `missing-index`; live preview, checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Sdk/Operators/Index.cs#L148-L180
    (primitive String index + `TryGetValue`, otherwise null; checked 2026-08-12)

[C-E02-025] **Member access is null-propagating for both Null and every other non-collection.** A
missing property followed by `.deeper` or `['deeper']` remains Null, and property access on a String
also returns Null; no chain throws.
  — research/experiments/E02-members/ (`missing-chain-property`, `missing-chain-index`,
    `primitive-chain`; live preview, checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Sdk/Operators/Index.cs#L51-L64
    (a non-collection returns null; checked 2026-08-12)

[C-E02-026] **Array indices convert to Number, reject negative/non-numeric/out-of-range values,
floor non-negative fractions, and start at zero.** `[0]` is the first item; `['1']` and `[1.9]` are
the second; `[-1]`, `[2]`, and `['x']` miss; a Null index converts to zero.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "When an expression
    returns an array, normal indexing rules apply and the index starts with `0`." (checked
    2026-08-12)
  — research/experiments/E02-members/ (`array-zero`, `array-one-string`, `array-fraction`,
    `array-negative`, `array-out-of-range`, `array-nonnumeric`, `array-null-index`; live preview,
    checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTExpressions2/Expressions2/Sdk/Operators/Index.cs#L183-L215
    and #L247-L267 (Number conversion, floor, bounds; checked 2026-08-12)

[C-E02-027] **Object key casing is a property of the context, not a language-wide rule.** Nested
parameter-object keys are ordinal case-sensitive (`CamelKey` succeeds; `camelkey` and `CAMELKEY`
miss in both property/index syntax), while the variables context is ordinal-ignore-case
(`variables.myvar` and `variables['MYVAR']` both resolve `MyVar`). The value model must therefore
carry the comparer policy with each Object.
  — research/experiments/E02-members/ (`property-{exact,lower,upper}`, `index-{exact,lower}`,
    `variable-property-lower`, `variable-index-upper`; live preview, checked 2026-08-12)
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTPipelines/Pipelines/ContextData/DictionaryContextData.cs#L71-L89
    (`StringComparer.OrdinalIgnoreCase`) and
    https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTPipelines/Pipelines/ContextData/CaseSensitiveDictionaryContextData.cs#L71-L89
    (`StringComparer.Ordinal`; checked 2026-08-12)

[C-E02-028] **`and`, `or`, and `not` operate on Boolean conversions with fixed documented
arities.** `and` and `or` each take 2..N parameters; `not` takes exactly one. `and` is true only
when every converted parameter is true and stops at the first false; `or` is true when any
converted parameter is true and stops at the first true; `not` returns the inverse of its converted
parameter. Live controls prove the short circuit is evaluation-lazy: the otherwise-failing
`lt(1, 'not-a-number')` is not evaluated after `and(false, ...)` or `or(true, ...)`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#and (the `and`, `not`,
    and `or` function entries; checked 2026-08-12)
  — research/experiments/E02-logical/ (`and-short-circuit`, `or-short-circuit`; live preview,
    checked 2026-08-12)

[C-E02-029] **The six comparison functions all take exactly two parameters and use directional,
ordinal-ignore-case comparison.** `eq`/`ne` test equality/inequality, convert the right parameter
to the left parameter's type, and return false/true on failed conversion. `lt`/`le`/`gt`/`ge`
test the named ordering relation, perform the same right-to-left conversion, and error on failed
conversion. Every String comparison is ordinal-ignore-case. These entries are the function-level
contract implemented by C-E02-020..023's conversion and comparison primitives.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#eq (the `eq`, `ne`,
    `lt`, `le`, `gt`, and `ge` entries; checked 2026-08-12)

[C-E02-030] **`in` and `notIn` require 2..N parameters in the service, despite Learn saying a
minimum of one.** They compare the left parameter to each right parameter after converting that
right parameter to the left type; failed conversions are nonmatches and String comparison is
ordinal-ignore-case. Both stop at the first match: a matching first candidate prevents evaluation
of a later failing expression. `in('Alpha')` and `notIn('Alpha')` are rejected at the closing `)`,
so the service minimum is two, not the documented one.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#in (`in` and `notIn`
    entries; documented 1..N, directional conversion, short-circuit; checked 2026-08-12)
  — research/experiments/E02-logical/ (`in-short-circuit`, `not-in-short-circuit`,
    `in-one-argument`, `not-in-one-argument`; live preview, checked 2026-08-12)

[C-E02-031] **`contains` is String-only; an Array is not a second membership mode.** The function
takes exactly two parameters, converts both to String, and performs ordinal-ignore-case substring
search. Passing an Array as the left parameter is rejected with `Unable to convert from Array to
String. Value: Array`, including when an element would otherwise match. This directly contradicts
E02-S03-T01's requested "contains string/array duality"; Array membership belongs to
`containsValue`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#contains (`contains`
    and `containsValue` entries; checked 2026-08-12)
  — research/experiments/E02-logical/ (`contains-array-hit`, `contains-array-number`; live preview,
    checked 2026-08-12)

[C-E02-032] **`containsValue` takes exactly two parameters and searches either Array items or
Object property values.** Each candidate is converted to the right parameter's type, a conversion
failure is a nonmatch, String comparison is ordinal-ignore-case, and iteration stops at the first
match. A non-collection left parameter returns false. Live probes confirm the Array path, Object
case-insensitive matching (`beta` matches `BETA`), the conversion direction (`'01'` among the
property values matches right-side Number `1`), and the primitive fallback.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#containsvalue
    (checked 2026-08-12)
  — research/experiments/E02-logical/ (`contains-value-array-hit`, `contains-value-object-hit`,
    `contains-value-conversion-direction`, `contains-value-primitive-left`; live preview, checked
    2026-08-12)

[C-E02-040] **The current documented general-function catalogue includes `startsWith`,
`endsWith`, and `xor`, so E02-S03-T02's enumerated function set is incomplete.** Learn specifies
two String-converting, ordinal-ignore-case parameters for `startsWith` and `endsWith`, and exactly
two Boolean-converting parameters for `xor`. The story acceptance requires every documented
function, but neither E02-S03-T01 nor the original T02/T03 task split owns these three functions;
the original T02 therefore cannot meet that acceptance criterion and is superseded by T04.
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#startswith (the
    `startsWith`, `endsWith`, and `xor` entries; checked 2026-08-12)

## E02-S01-T02 — error rendering (second experiment)

64 further live rejections, `research/experiments/E02-errors/` (`pnpm expr-error-survey`,
`cases.json` is the machine-readable form the parity test replays). Where the grammar survey asked
*which expressions are rejected*, these ask *what the rejection says and what its numbers point at*.

[C-E02-101] **`!` ends no token and starts none.** `!!true` comes back as a single
`Unrecognized value: '!!true'`; `!eq(1, 1)` as `Unrecognized value: '!eq'` (the scan stops at the
`(`, and the `(` still makes it a *function* name); `1 !` as `Unexpected symbol: '!'` at 3; `!=`
survives as its own two-character symbol (`1 != 2` → `Unexpected symbol: '!='`). So the lexer scans
a `!` run exactly as it scans a keyword, and the only special case is the `!=` spelling. This
**closes** the "known message-level divergence" E02-S01-T01 recorded and handed to this task: with
`!` keyword-shaped and name resolution deferred (C-E02-103), all six `!` spellings now report the
same kind, raw text and position as the service.
  — research/experiments/E02-errors/survey.md §Bang, rows `bang-alone`/`bang-after-value`/
    `bang-double`/`bang-tight`/`bang-spaced`/`bang-eq` (live preview, checked 2026-08-12)

[C-E02-102] **Two rejection classes, separated by how the token was read.** Text the lexer starts
reading as a *number* and cannot finish is rejected where it is read: `1e3 2` reports `1e3` at
position 1, not the leftover `2` at 5, and so do `0x1F 2` and `-1.2.3 2` — all three number
*starts* the docs list (a digit and a `-`; the `.` case cannot carry a competing error). Everything
else non-numeric is scanned as a keyword and
becomes a named value regardless of charset — `"double" 2` reports the **`2`** at position 9 and
`+1 2` reports the **`2`** at position 4, i.e. the quote- and sign-shaped text was accepted as a
*name* and only failed later. Consequence for the lexer: the identifier charset is not a lexical
gate (except immediately after `.`, C-E02-007), and `unrecognized` must mean "failed number scan"
and nothing else. Consequence for the tests: `+1`, `"double"` and `!true` are `needsRegistry` rows —
a syntax-only parse accepts them, exactly as it accepts `null` (C-E02-003).
  — research/experiments/E02-errors/survey.md §Ordering, rows `order-unrec-then-garbage`/
    `order-hex-then-garbage`/`order-negver-then-garbage` (eager) against
    `order-quote-then-garbage`/`order-plus-then-garbage` (deferred) (live preview, checked
    2026-08-12)

[C-E02-103] **Name resolution is deferred behind the syntax parse; syntax errors are eager.**
`nosuchcontext 2` and `nosuchfunc(1) 2` both report the leftover `2` at position 15 — never the
unresolvable name — while `eq(1) 2` reports the arity error at the `)` (position 5) and
`order-bang-bang-spaced` (`! !`) reports the second `!`. So an unresolvable name is remembered and
raised only if the parse otherwise succeeds; arity, on the other hand, is syntax and fires
immediately (C-E02-017). A second rule falls out of the same rows: a **leftover** token is always
phrased `Unexpected symbol`, whatever kind it is — `1 !` reports a symbol for text that would be an
`Unrecognized value` in operand position, and `! true` reports the boolean `true`.
  — research/experiments/E02-errors/survey.md §Ordering, all rows (live preview, checked 2026-08-12)
  — implemented as `State.pending` in `packages/engine/src/expr/parser.ts`; first name error wins
    (two unresolvable names in one expression is unprobed — the fork throws at the first)

[C-E02-104] **The service trims the delimited text before parsing.** `${{␣␣␣␣null␣}}` reports
`Located at position 1 within expression: 'null'`, and `${{␣␣␣␣1 == 1␣}}` reports position **3**,
not 7 — so both the position and the echoed expression are relative to the *trimmed* text. A folded
newline inside the delimiters behaves the same way. Every one of the 74 grammar-survey rows was
written with exactly one space each side, which is why this was indistinguishable until now; get it
wrong and every rendered position is off by the file's indentation.
  — research/experiments/E02-errors/survey.md rows `ws-baseline`/`ws-leading`/`ws-leading-inner`/
    `ws-newline` (live preview, checked 2026-08-12)

[C-E02-105] **`(Line: L, Col: C)` points at the host scalar, never at the offending token.**
`probe: prefix ${{ null }} suffix` reports Col 10 — the `p` of `prefix`, with the bad token 19
characters further on. Confirmed against four different document shapes: `condition:` → Col 14,
`displayName:` nested in a job → Line 5 Col 18, a block scalar → Line 2 Col 11 (the `|`, not the
line the expression is on), a variable at `  a:` → Col 6. The location is the *node*; the position
inside the expression is what the message body carries. **Deliberate divergence:** our `Diagnostic`
ranges cover the offending token so E01's code frame can caret it, which is a superset of the
service's information (the message body still carries the service's own position verbatim).
  — research/experiments/E02-errors/survey.md §Position, rows `embed-mid-scalar`/`condition-field`/
    `deep-indent`/`block-scalar`/`multi-bad-scalars` (live preview, checked 2026-08-12)

[C-E02-106] **Three message shapes, one per group of codes.** Positioned:
`<sentence>. Located at position N within expression: '<expr>'. For more help, refer to
https://go.microsoft.com/fwlink/?linkid=842996` — used by `Unrecognized value`, `Unexpected symbol`,
`Expected a property name…` and `Unclosed function`. Help-only: `Exceeded max expression depth 50.
For more help, refer to …` — no position, no echo. Bare: `An expression was expected` — no position,
no echo, no link, and no trailing period.
  — research/experiments/E02-errors/survey.md rows `grammar-val-depth-51`/`grammar-val-empty` and
    every positioned row (live preview, checked 2026-08-12)

[C-E02-107] **Compile-time messages are cut to 500 characters with `[...]` appended; runtime ones
are not cut at all.** The cap applies to the *assembled* string including the `<file> (Line…):`
prefix, not to the echoed expression: a 353-character expression produced a 505-character message
severed **inside the fwlink URL**. The same expression submitted as `$[ ]` — whose prefix is 16
characters longer — came back whole at 591 characters, so the cap belongs to the compile-time error
collector rather than to the expression parser. **Deliberate divergence:** we never truncate; the
parity test proves equality by truncating *our* assembled message the same way.
  — research/experiments/E02-errors/survey.md §Echo, rows `long-echo`/`echo-cap-control`/
    `echo-cap-runtime` (live preview, checked 2026-08-12)

[C-E02-108] **Runtime (`$[ ]`) errors carry no file coordinates, only a sentence.** The prefix is
`An error occurred while loading the YAML build pipeline. ` and the body is byte-identical to the
compile-time one: `$[ eq(1) ]` → `Unexpected symbol: ')'` at 5, `$[ variables. ]` → the dereference
sentence at 10, `$[ nosuchcontext.a ]` → the name at 1, and the depth message unchanged. This
narrows C-E02-015: the kind swap seen there (`$[ 1 == 1 ]` saying `Unrecognized value` where `${{ 1
== 1 }}` says `Unexpected symbol`) is confined to operator text, and is deliberately **not**
reproduced — one grammar, one kind. We render the prefix and keep our own file coordinates, which
the service has thrown away by queue time.
  — research/experiments/E02-errors/survey.md §Runtime, rows `rt-arity`/`rt-named-unknown`/
    `rt-trailing-dot`/`rt-depth` (live preview, checked 2026-08-12)

[C-E02-109] **An expression embedded in a larger scalar is reported against a synthetic
`format(…)` call.** `probe: prefix ${{ null }} suffix` → `Located at position 29 within expression:
'format('prefix {0} suffix', null)'`; two expressions in one scalar →
`'format('{0} then {1}', 'ok', null)'`; a block scalar → `'format('echo one\necho two\necho
{0}\necho three\n', null)'`, real newlines and all. So the service compiles mixed content into a
`format` call and parses *that* — which independently confirms docs/02 §3's stringify-and-
concatenate rule and names the function that does it. **Deliberate divergence:** the synthetic text
exists nowhere in the user's file, so a caret cannot be drawn on it; we report the user's own
expression positioned within itself. Evidence for E03-S01-T05, which owns interpolation.
  — research/experiments/E02-errors/survey.md §Position, rows `embed-mid-scalar`/
    `embed-second-expr`/`block-scalar` (live preview, checked 2026-08-12)

[C-E02-110] **The service reports every bad expression in the document, newline-joined.** Two
variables with bad expressions come back as two full messages in one string, each with its own
`(Line, Col)`. Our `ExprParseError` is per expression by design — collecting them belongs to the
document walk in E03-S01 — and `renderDiagnostics` already joins a list.
  — research/experiments/E02-errors/survey.md row `multi-bad-scalars` (live preview, checked
    2026-08-12)

## E02-S03-T03 — job status check functions (block 060–079)

**Two engines, not one.** The status family is the only function group in E02 whose behaviour is
split across two implementations: step conditions are evaluated by the **agent**
(`azure-pipelines-agent`, open, pinned below) and job/stage conditions by the **orchestrator**
(server-side, closed). They differ in arity, in what `canceled()` reads, and in what a status call
even means. Three evidence sources are used and they are deliberately not interchangeable:
`research/experiments/E02-status/survey.md` (54 live preview calls — legality and arity only,
because preview never *evaluates* a status function), `research/experiments/E02-status/real-run.md`
(one real agentless run — the truth tables that no document states), and the agent source.

[C-E02-060] **A step condition and a job/stage condition are validated by different code paths with
different function tables.** `condition: nosuchfunc()` on a *step* is **accepted** (HTTP 200) and so
is `nosuchfunc(1, 2, 3)` and a bare `always`; the same `nosuchfunc()` on a *job* or *stage* is
rejected with `Unrecognized value: 'nosuchfunc'`. Yet `eq(1)` is rejected in all three slots, and a
step rejection is wrapped — `Job Job: Step  specifies condition eq(1) which is not valid. Reason:
<the usual expression error>` — where job/stage rejections carry the bare message. So the step slot
checks syntax, plus arity for names it happens to know, and defers name resolution to the agent;
the job/stage slot resolves names fully. **Consequence for us: "the service accepted it in a step
condition" is not evidence that a step condition may contain it.**
  — research/experiments/E02-status/survey.md §Controls, §Controls II, rows `ctl-step-unknown-fn`,
    `ctl-step-unknown-fn-arity`, `ctl-job-unknown-fn`, `ctl-stage-unknown-fn`, `ctl-step-arity`,
    `ctl-step-eq-3args`, `step-bare-always` (live preview, checked 2026-08-12)

[C-E02-061] **At the step level all five status functions take exactly zero arguments.** The agent
registers them itself: `new FunctionInfo<AlwaysNode>(name: …, minParameters: 0, maxParameters: 0)`
and the same for `CanceledNode`, `FailedNode`, `SucceededNode`, `SucceededOrFailedNode`. Per
C-E02-060 the service cannot catch `succeeded('A')` in a step condition, so this is an agent-side
rejection at run time — the emitter must enforce it at convert time or a pipeline that fails on the
service will pass locally.
  — https://github.com/microsoft/azure-pipelines-agent/blob/9d00422e75eae78e4a7b8c75d7b46a13bd41274e/src/Agent.Worker/ExpressionManager.cs#L37-L44
    — "var functions = new IFunctionInfo[] { new FunctionInfo<AlwaysNode>(name:
    Constants.Expressions.Always, minParameters: 0, maxParameters: 0), …"
    (commit-pinned, checked 2026-08-12)

[C-E02-062] **The step-level truth table reads one variable, `Agent.JobStatus`, defaulting to
Succeeded.** Every node is `TaskResult jobStatus = executionContext.Variables.Agent_JobStatus ??
TaskResult.Succeeded;` followed by: `always` → literal `true` with no context read at all;
`canceled` → `jobStatus == TaskResult.Canceled`; `failed` → `jobStatus == TaskResult.Failed`;
`succeeded` → `Succeeded || SucceededWithIssues`; `succeededOrFailed` → `Succeeded ||
SucceededWithIssues || Failed`. This matches the doc's "equivalent to
`in(variables['Agent.JobStatus'], 'Succeeded', 'SucceededWithIssues')`" literally, and that
expansion is legal in the same slot. **Note `canceled()` at step level is the *job's* status, not
run-level cancellation** — the doc's "Evaluates to `True` if the pipeline is canceled" is the
job/stage reading, not this one. The `?? Succeeded` default is why the docs can say succeeded()
"also returns `true` if there is no previous step".
  — https://github.com/microsoft/azure-pipelines-agent/blob/9d00422e75eae78e4a7b8c75d7b46a13bd41274e/src/Agent.Worker/ExpressionManager.cs#L99-L152
    (commit-pinned, checked 2026-08-12); survey row `step-agent-jobstatus` (accepted)

[C-E02-063] **A step with no condition gets `succeeded()`.** The agent's parser returns
`parser.CreateTree(condition, …) ?? new SucceededNode()`, i.e. an absent or empty condition is the
succeeded node itself. Independently stated for all three levels by the conditions doc: "By
default, a pipeline job or stage runs if it doesn't depend on any other job or stage, or if all its
dependencies completed and succeeded." The service does **not** materialize the default into
`finalYaml` — every survey row shows only the conditions the author wrote — so the emitter must
supply it.
  — https://github.com/microsoft/azure-pipelines-agent/blob/9d00422e75eae78e4a7b8c75d7b46a13bd41274e/src/Agent.Worker/ExpressionManager.cs#L45
    (commit-pinned) · https://learn.microsoft.com/en-us/azure/devops/pipelines/process/conditions
    (checked 2026-08-12)

[C-E02-064] **At job/stage level the arity split is 2–3, not 5.** `always` and `canceled` take
exactly zero arguments — `always('A')` and `canceled('A')` are rejected with `Unexpected symbol:
')'` at the closing paren, the arity-failure position C-E02-013a established — while `succeeded`,
`failed` and `succeededOrFailed` accept 0..N. Measured up to three arguments, and identically in
the stage slot. The argument is **not** validated: `succeeded('nosuchjob')`, `succeeded('')`,
`succeeded(1)` and even `succeeded(variables['jobName'])` are all accepted, so it is an ordinary
expression evaluated to a String and not a statically-checked job name.
  — research/experiments/E02-status/survey.md §Arguments — job slot, §Arguments II, rows
    `job-always-arg`, `job-canceled-arg`, `job-always-zero`, `job-canceled-zero`,
    `job-succeeded-three-args`, `job-failed-two-args`, `job-sof-two-args`,
    `job-succeeded-unknown`, `job-succeeded-empty-string`, `job-succeeded-nonstring`,
    `job-succeeded-var-arg`, `stage-always-arg`, `stage-canceled-arg` (live preview, 2026-08-12)

[C-E02-065] **Status functions exist in neither the compile-time table nor the runtime *variable*
table — only in conditions.** `variables: probe: ${{ always() }}` → `Unrecognized value: 'always'`,
and so does `${{ if succeeded() }}` and a `condition: ${{ succeeded() }}` wrapped in compile-time
delimiters. `variables: probe: $[ always() ]` is *also* rejected, `Unrecognized value: 'always'`,
while the control `$[ eq(1, 1) ]` in the same slot is accepted — so the doc sentence "Use the
following status check functions as expressions in conditions, but not in variable definitions" is
**enforced, not advisory**, and the runtime-variable table is a third table distinct from the
condition one. The compile-time rejection is the same `Unrecognized value` class C-E02-003/004 found
for `null`/`NaN`: a name that resolves to nothing, not a lexical error. The `$[ ]` variable
rejection arrives in the positionless envelope C-E02-106 catalogued ("An error occurred while
loading the YAML build pipeline."), the compile-time one with a `(Line, Col)` prefix.
  — research/experiments/E02-status/survey.md §Phase gating, rows `compile-always`,
    `compile-succeeded`, `runtime-var-always`, `runtime-var-succeeded`, `ctl-runtime-var-eq`,
    `if-succeeded`, `step-condition-compile-wrapped` (live preview, checked 2026-08-12)

[C-E02-066] **Status function names are case-insensitive and are functions, not named values.**
`SUCCEEDED()` and `succeededorfailed()` are accepted. A bare `always` in the slot that resolves
names is rejected with a distinct third message — `Expected '(' to follow a function: 'always'` —
which proves the name is registered as a function; C-E02-012's `Unrecognized value` is what an
unknown name gets instead.
  — research/experiments/E02-status/survey.md rows `case-upper`, `case-lower-sof`,
    `job-bare-always` (live preview, checked 2026-08-12)

[C-E02-067] **`succeeded()` at job level is all-of, and arguments narrow the set.** Over
`dependsOn: [dep_ok, dep_skipped]` (Succeeded + Skipped), `succeeded()` is **False** while
`succeeded('dep_ok')` — naming only the succeeded dependency, with the skipped one still in the
graph — is **True**, and `succeeded('dep_ok', 'dep_skipped')` is False again. So the no-argument
form is "all dependencies" and the argument form replaces that set rather than filtering it. Matches
the doc: "With no arguments, evaluates to `True` if all previous jobs in the dependency graph
succeeded or partially succeeded." Over an **empty** dependency set (a job with no `dependsOn`) it
is True, which is all-of behaving normally and matches "a job or stage runs if it doesn't depend on
any other job or stage". The name lookup **folds case**: `succeeded('DEP_OK')` against a dependency
declared `dep_ok` is True.
  — research/experiments/E02-status/real-run.md rows `mixed_succeeded`,
    `mixed_succeeded_named_ok`, `mixed_succeeded_named_both`, `ok_succeeded`, `nodep_succeeded`,
    `case_named` (live run 2026-08-12)

[C-E02-068] **`succeededOrFailed()` is any-of, and is False when every dependency was skipped —
the docs' "regardless" is wrong.** Over a single Skipped dependency it is **False**; over
{Succeeded, Skipped} it is **True**; over a single Succeeded dependency True; over a single Failed
dependency True. So the rule is "at least one dependency is Succeeded, SucceededWithIssues or
Failed", which is the doc's own argument-form wording ("evaluates to `True` whether **any** of
those jobs succeeded or failed") but contradicts its no-argument wording ("evaluates to `True`
regardless of whether any jobs in the dependency graph succeeded or failed") and its summary ("like
`always()`, except it evaluates to `False` when the pipeline is canceled" — it is also False when
the dependencies were skipped). The doc's own remedy is the tell and it checks out live:
`not(canceled())` is **True** in exactly the cases `succeededOrFailed()` is False here.

**It is not pure any-of, though**: over an *empty* dependency set it is **True**, where any-of would
give False and a dependency-free job carrying this condition would never run. The measured rule,
stated so the empty case is not an inference, is: **True unless the dependency set is non-empty and
none of its members is Succeeded, SucceededWithIssues or Failed.** `succeeded()` (all-of, C-E02-067)
and `failed()` (any-of, empty → False, row `nodep_failed`) need no such carve-out — the asymmetry
belongs to this function alone.
  — research/experiments/E02-status/real-run.md rows `skipped_succeededorfailed`,
    `mixed_succeededorfailed`, `ok_succeededorfailed`, `fail_succeededorfailed`,
    `skipped_not_canceled`, `mixed_not_canceled`, `nodep_succeededorfailed` (live run 2026-08-12) ·
    https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions (checked
    2026-08-12)

[C-E02-069] **A Skipped dependency satisfies no status function except `always()`.** With the
dependency's result recorded as `Skipped` (independently confirmed by a sibling job conditioned on
`eq(dependencies.dep_skipped.result, 'Skipped')`, which ran): `succeeded()` False,
`succeeded('dep_skipped')` False, `succeededOrFailed()` False, `succeededOrFailed('dep_skipped')`
False, `failed()` False, `failed('dep_skipped')` False, `canceled()` False, `always()` True,
`not(canceled())` True. **This is the cell no document states** — the docs only ever spell `Skipped`
out explicitly in `dependencies.<x>.result` examples, which is a hint, not a rule.
  — research/experiments/E02-status/real-run.md §skipped_* rows (live run, checked 2026-08-12)

[C-E02-070] **A Failed dependency: `failed()`, `succeededOrFailed()` and `always()` are True,
`succeeded()` is False.** Measured with a dependency whose server task errored (result `Failed`,
confirmed by a sibling conditioned on `eq(dependencies.dep_fail.result, 'Failed')`), including the
named forms. Agrees with the doc's "With no arguments, evaluates to `True` if any previous job in
the dependency graph failed" and with the step-level source (C-E02-062).
  — research/experiments/E02-status/real-run.md §fail_* rows (live run, checked 2026-08-12)

[C-E02-071] **`Abandoned` is a sixth job result the docs never list, and `failed()` does not catch
it.** A job whose *condition itself* errors (`condition: gt(1, 'not-a-number')` — `gt` errors
rather than returning False on an unconvertible operand, C-E02-022) completes with result
`abandoned`, not `failed`. Over that dependency `failed()`, `failed('dep_abandon')`,
`succeededOrFailed()` and `succeeded()` are **all False**, only `always()` is True, and
`eq(dependencies.dep_abandon.result, 'Failed')` is False. The documented result set is
"Succeeded|SucceededWithIssues|Skipped|Failed|Canceled"; this is outside it. Consequence: an
errored condition is not a failure any downstream condition can catch except `always()`.
  — research/experiments/E02-status/real-run.md §abandon_* rows (live run, checked 2026-08-12)

[C-E02-072] **A job name that is not a dependency evaluates to False, not to an error.**
`succeeded('nosuchjob')` on a job depending on a succeeded job is accepted at preview (C-E02-064)
and at run time simply makes the condition False. So an unknown name behaves as "not succeeded"
rather than raising — the emitter need not validate names, but must not treat a missing entry as
vacuous truth.
  — research/experiments/E02-status/real-run.md row `unknown_named` (live run, checked 2026-08-12)
