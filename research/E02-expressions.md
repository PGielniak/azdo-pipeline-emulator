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
| 060–079 | E02-S03-T03 status functions (060–072 used); 073–076 E02-S04-T01 doc-only first pass |
| 080–091 | E02-S04-T01 context interface + parameters/variables (live survey) |
| 092–095 | E02-S04-T02 dependency shapes |
| 096 | E02-S04-T01 addendum — `counter` slot restriction (allocated after 092–095 were taken) |
| 097–099 | *free* |
| 101–110 | E02-S01-T02 error rendering |
| 111–112 | E02-S04-T03 doc-only first pass — **superseded by 120–127** (see below) |
| 113–119 | *free* |
| 120–127 | E02-S04-T03 `resources` context + pipeline-resource variables (live runs) |
| 128–131 | E02-S05-T01 Bash compiler |
| 132–134 | E02-S01-T03 bare known-function error kind |
| 135–159 | E02-S05-T02 dual-backend conformance harness (135–147 used) |
| 160–199 | *free — reserve in this table before use* |

E02-S04-T02 uses claims C-E02-092–095.

[C-E02-111] ~~Pipeline resource metadata is available at runtime under `resources.pipeline.<Alias>`~~
**Superseded by C-E02-120/121 on 2026-08-12.** The doc sentence this quoted says the metadata is
available "as the following predefined **variables**"; reading `resources.pipeline.<Alias>` as a
member of the `resources` *context* is an over-read of the path spelling, and two live runs measured
it false — the context has no `pipeline` key at all. Kept for the audit trail; do not cite.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/resources-pipelines-pipeline?view=azure-pipelines (checked 2026-08-12) — "In each run, the metadata for a pipeline resource is available to all jobs ... at runtime".

[C-E02-112] `projectName` is omitted when the pipeline resource does not specify a project, while the other documented metadata fields remain string-valued. — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/resources-pipelines-pipeline?view=azure-pipelines (checked 2026-08-12) — "projectName is not present in the variables if the pipeline resource does not have a project value specified."; **the cited transcript `research/experiments/E02-context/survey.md` contains no such measurement — the claim was doc-only. Now measured: C-E02-122.**

[C-E02-092] `dependencies.<job>` exposes a dependency result and an `outputs` object whose keys are flattened `step.variable` names; a job with no same-stage dependencies sees an empty object. — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions?view=azure-devops#dependencies — "Reference the job status of a previous job ... [and] output variables in the previous job in the same stage" — checked 2026-08-12; live transcript `research/experiments/E02-dependencies/real-run.md`.

[C-E02-093] `stageDependencies.<stage>.<job>` exposes the previous stage's job record and its flattened output variables. — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions?view=azure-devops#dependencies — "If you refer to an output variable from a job in another stage, the context is called `stageDependencies`." — checked 2026-08-12; live transcript `research/experiments/E02-dependencies/real-run.md`.

[C-E02-094] Dependency context member names are case-insensitive at the job/stage lookup boundary and missing members null-propagate under the expression access rules. — research/experiments/E02-dependencies/real-run.md + C-E02-024..027 — checked 2026-08-12.

[C-E02-095] Runtime dependency records may carry service metadata (`name`, `attempt`, `state`, `result`, timestamps) in addition to the stable `result` and `outputs` contract; the engine keeps the expression-facing contract deliberately narrow. — research/experiments/E02-dependencies/real-run.md — checked 2026-08-12.

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

## E02-S03-T04 — remaining general functions (block 040–059)

[C-E02-041] **The current non-status catalogue adds `startsWith`, `endsWith`, and `xor` to the
functions the original task split listed.** Their documented arities are 2, 2, and 2; the other
remainder signatures are `format` 1..N, `join` 2, `split` 2, `replace` 3, `lower`/`upper`/`trim` 1,
`length` 1, `coalesce` 2..N, `convertToJson` 1, while `iif` and `counter` require corrections below.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#functions
    (checked 2026-08-12)

[C-E02-042] **`startsWith` and `endsWith` convert both inputs to String and compare ordinal
ignore-case; `lower`, `upper`, and `trim` return transformed strings; `replace` is ordinal
case-sensitive and an empty search leaves the input unchanged.** Live controls produce True for
`startsWith(12345,'123')` + `endsWith('AbCdE','DE')`, `äbc|ÄBC` for non-ASCII casing, `AxA` for
`replace('AaA','a','x')`, and `abc` for an empty search.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#startswith
    (checked 2026-08-12) · research/experiments/E02-general/{starts-ends-coercion,
    case-conversion,trim-whitespace,replace-casing,replace-empty-old}.md (live preview 2026-08-12)

[C-E02-043] **`xor` converts exactly two operands to Boolean and is True exactly when one is
True.** The four live cells are `True|True|False|False` for TF, FT, TT, FF.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#xor
    (checked 2026-08-12) · research/experiments/E02-general/xor-values.md

[C-E02-044] **`format` supports out-of-order/reused numeric placeholders and doubled braces, and
errors on malformed braces or an index with no supplied argument.** `{1}-{0}-{1}` → `B-A-B` and
`{{{0}}} {{ and }}` → `{x} { and }`; the two errors use the service's dedicated format-string
messages. Date formatting is deliberately excluded here and remains E05-S04.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#format
    (checked 2026-08-12) · research/experiments/E02-general/format-*.md (live preview 2026-08-12)

[C-E02-045] **`join(separator,array)` String-converts primitive elements, turns complex elements
into empty strings, and when the right operand is not an Array returns its String conversion.**
The live array `[Alpha,'',2]` → `Alpha;;2`; `join('-',12)` → `12`.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#join
    (checked 2026-08-12) · research/experiments/E02-general/join-{array,non-array}.md

[C-E02-046] **`split` uses the second parameter as one exact delimiter string, preserves empty
fields, and an empty delimiter leaves the input unsplit.** Therefore `split('a,b;c,,', ',;')`
returns one element (the input unchanged), not a split on comma-or-semicolon.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#split
    (checked 2026-08-12) · research/experiments/E02-general/split-*.md

[C-E02-047] **`length` returns String length, Array length, and Object property count.** The live
Object result is 2 even though Learn only names String and Array, a documentation omission.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#length
    (checked 2026-08-12) · research/experiments/E02-general/length-{values,object}.md

[C-E02-048] **`coalesce` evaluates left-to-right, skips only Null and empty String, short-circuits
at the first other value, and returns Null when none qualifies.** False and zero are returned, not
skipped; a failing expression after `'hit'` is not evaluated.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#coalesce
    (checked 2026-08-12) · research/experiments/E02-general/coalesce-*.md

[C-E02-049] **`iif` takes exactly three arguments and evaluates both value branches eagerly.**
One and two arguments are rejected at the closing parenthesis despite Learn saying minimum 1;
`iif(true,'yes',lt(1,'bad'))` still raises the conversion error from the unselected branch.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#iif
    (checked 2026-08-12; contradicted) · research/experiments/E02-general/iif-*.md

[C-E02-050] **`convertToJson` accepts any expression value and emits indented JSON.** Objects and
Arrays preserve nesting and scalar types; a String becomes the JSON string text `"text"` including
quotes. The local evaluator uses the same two-space JSON layout.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#converttojson
    (checked 2026-08-12) · research/experiments/E02-general/json-{object,primitive}.md

[C-E02-051] **`counter` exists only in runtime variable definitions, is scoped by pipeline and
prefix, and the live parser accepts one or two arguments (not exactly two as documented).** Three
arguments, compile-time use, and condition use are rejected. Because this converter has no service
pipeline identity, its state-provider seam deliberately scopes counters to the local run/project;
the accepted one-argument form passes an absent seed through to that provider instead of inventing
an undocumented default in E02.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions#counter
    (checked 2026-08-12; arity contradicted) · research/experiments/E02-general/counter-*.md
[C-E02-073] Template expressions expose the `parameters` context and the YAML-defined/predefined `variables` context during template expansion.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/template-expressions?view=azure-devops (checked 2026-08-12)
  — "Within a template expression, you have access to the `parameters` context ... Additionally, you have access to the `variables` context"

[C-E02-074] Azure Pipelines variables are strings, while runtime parameters are typed and available during template parsing.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables?view=azure-devops (checked 2026-08-12)
  — "All variables are strings"; "Runtime parameters are typed and available during template parsing."

[C-E02-075] Expression contexts support both index syntax and restricted property dereference syntax, and missing variable values resolve to no value in template/runtime variable expansion.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions?view=azure-devops-2022 (checked 2026-08-12)
  — "Index syntax: `variables['MyVar']`" and "property dereference syntax"; variable lookup returns no value when absent.

[C-E02-076] A compile-time context-availability rejection must be verified against the Azure DevOps preview oracle before implementing phase gating.
  — Required experiment: `research/experiments/E02-contexts/` (blocked 2026-08-12: AZDO_ORG_URL, AZDO_PROJECT, AZDO_ORACLE_PIPELINE_ID, and AZDO_PAT are absent)

[C-E02-080] **Context availability is a per-slot name table, and there are three of them — not the
doc's two.** The expressions doc says compile-time expressions get `parameters` + statically
defined `variables` and runtime expressions get "more `variables` but no parameters", which implies
a compile/runtime binary. Measured across seven contexts and five slots, the grid is:

| context | `${{ }}` value + `${{ if }}` | `$[ ]` root variable | job/stage `condition:` |
|---|:---:|:---:|:---:|
| `parameters` | yes | no | no |
| `variables` | yes | yes | yes |
| `dependencies` | no | no | yes |
| `stageDependencies` | no | no | yes |
| `resources` | no | yes | no |
| `pipeline` | no | yes | yes |
| `environment` | no | no | no |

  — research/experiments/E02-context/survey.md, 61 live preview calls, rows `<context>-compile-var`
    / `-runtime-var` / `-job-condition` / `-stage-condition` / `-if-directive`, each with a
    matching `ctl-unknown-*` negative control in the same slot (checked 2026-08-12)
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "The difference
    between runtime and compile time expression syntaxes is primarily what context is available. In
    a compile-time expression (`${{ <expression> }}`), you have access to `parameters` and
    statically defined `variables`. In a runtime expression (`$[ <expression> ]`), you have access
    to more `variables` but no parameters." (checked 2026-08-12)

[C-E02-081] **A context that exists but is wrong for the slot is rejected byte-identically to one
that exists nowhere.** `${{ dependencies.A.result }}` returns `Unrecognized value: 'dependencies'.
Located at position 1 within expression: 'dependencies.A.result'. For more help, refer to
<fwlink>` — the same sentence, position rule and help link as `${{ nosuchcontext.probe }}`.
Implementation consequence: phase gating needs **no new error kind**; it is `makeRegistry` with a
per-slot `namedValues` set, and `errors.ts` renders the result unchanged.
  — research/experiments/E02-context/survey.md rows `dependencies-compile-var` vs
    `ctl-unknown-compile-var` (checked 2026-08-12)

[C-E02-082] **The two runtime slots are different tables — a double dissociation.** `resources` is
accepted in a root `$[ ]` variable and rejected in both job and stage conditions; `dependencies` is
rejected in a root `$[ ]` variable and accepted in both conditions. Neither table contains the
other, so no compile-time/run-time split describes the gate: the slot does. This also settles why
the root `$[ ]` rejection of `dependencies` is a *name* rule rather than an empty dependency graph
— an in-table name over an empty collection yields Null (`variables.noSuchVariable` does exactly
that in the same slot), whereas this is `Unrecognized value`, which is name resolution failing.
  — research/experiments/E02-context/survey.md rows `resources-runtime-var`,
    `resources-job-condition`, `resources-stage-condition`, `dependencies-runtime-var`,
    `dependencies-job-condition`, `dependencies-stage-condition` (checked 2026-08-12)

[C-E02-083] **The two compile-time slots share one table.** `${{ }}` in a variable value and the
`${{ if }}` directive accept and reject the same seven contexts, `parameters` and `variables` in
and the other five out.
  — research/experiments/E02-context/survey.md rows `*-if-directive` vs `*-compile-var`
    (checked 2026-08-12)

[C-E02-084] **Job and stage conditions share one table.** Every context probed in both slots agreed,
including the two that discriminate (`pipeline` accepted, `resources` rejected).
  — research/experiments/E02-context/survey.md rows `pipeline-stage-condition`,
    `resources-stage-condition`, `dependencies-stage-condition`,
    `stagedependencies-stage-condition` (checked 2026-08-12)

[C-E02-085] **A job-scoped `variables:` value is a second permissive slot that validates nothing —
no probe placed there is evidence.** Inside a job's own `variables:` block the service accepts
`$[ nosuchcontext.probe ]` *and* the known-bad arity `$[ eq(1) ]`, while both are rejected at the
root. This was caught only because those two negative controls were run: an earlier read of the
same rows had concluded that `dependencies` and `parameters` "become available inside a job", which
is an artifact of the slot never being checked. It is the same failure mode as the step-condition
slot (C-E02-060, docs/06 §5 decision 17), now known to have a second instance.
  — research/experiments/E02-context/survey.md rows `ctl-unknown-job-scoped-runtime-var`,
    `ctl-arity-job-scoped-runtime-var` vs `ctl-unknown-runtime-var` (checked 2026-08-12)

[C-E02-086] **A legal context the run has no data for behaves as empty, not as an error.**
`variables.noSuchVariable` expands to the empty string at compile time rather than being rejected,
which is the doc's "Null is … returned from a dictionary miss" sentence holding for `variables`.
  — research/experiments/E02-context/survey.md row `variables-missing` (checked 2026-08-12)
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — "Null is a special
    literal expression that's returned from a dictionary miss, for example (`variables['noSuch']`)"

[C-E02-087] **The `parameters` context folds key case and raises on a miss — on both counts the
opposite of what the rest of the value model does.** `parameters.MYPARAM` resolves a parameter
declared `myParam`, and `parameters.noSuchParameter` is **rejected** `Key not found
'noSuchParameter'` instead of null-propagating. Both were measured against `variables` in the same
slot and syntax, where the same miss returns Null (C-E02-086). The rejection also appears when the
pipeline declares no `parameters:` block at all, so the context always exists and it is the lookup
that fails. Note the scope: this is the **top-level context object only** — an object nested inside
a parameter value stays ordinal case-sensitive and null-propagating per C-E02-024/027.
  — research/experiments/E02-context/survey.md rows `parameters-property-case`,
    `parameters-index-syntax`, `parameters-missing`, `parameters-undeclared-block`,
    `variables-missing` (checked 2026-08-12)

[C-E02-088] **`Key not found 'x'` is an evaluation error with a shape no parse error uses.** It
carries file coordinates and nothing else — no `Located at position N within expression`, no help
link — and it appears in none of the 66 rejections E02-S01-T02 collected, because it is not a parse
failure: the expression parsed and the context resolved. It therefore lives in the evaluator
(`ExprKeyNotFoundError` in `access.ts`), not in `ExprErrorCode`/`errors.ts`.
  — research/experiments/E02-context/survey.md row `parameters-missing`:
    `/azure-pipelines.yml (Line: 6, Col: 10): Key not found 'noSuchParameter'` (checked 2026-08-12)
  — absent from research/experiments/E02-errors/ (E02-S01-T02 corpus)

[C-E02-089] **The `variables` context is flat: a dotted variable name is one key, not structure.**
`variables['My.Var']` returns the value of a variable named `My.Var`, while the property chain
`variables.My.Var` returns empty — it reads a variable named `My`, misses, and null-propagates.
Keys fold case (`variables.MYVAR` resolves `myVar`).
  — research/experiments/E02-context/survey.md rows `variables-index-dotted`,
    `variables-property-dotted`, `variables-property-case` (checked 2026-08-12)

[C-E02-090] **"Statically defined variables" includes the predefined system variables.**
`${{ variables['Build.SourceBranch'] }}` expands at compile time to the run's branch ref, and a
probe that named the bare `variables` context leaked the compile-time table, which the service
listed as containing `system`, `system.hostType`, `system.collectionUri`,
`system.pipelineStartTime` and siblings. (The branch value itself is run-specific and is recorded
as presence, not as a fixture.)
  — research/experiments/E02-context/survey.md rows `variables-predefined-compile`, `variables-bare`
    (checked 2026-08-12)

[C-E02-091] **`environment` is rejected in every slot measured, including inside a deployment job's
own condition.** The rejection is the ordinary `Unrecognized value: 'environment'`, and it arrives
*before* the service resolves the environment itself. The deployment-scoped **variable** slot could
not be measured: both the probe and its control failed earlier on `Environment probe-env could not
be found`, so that one cell is open and belongs to E02-S04-T03 / E10 rather than here.
  — research/experiments/E02-context/survey.md rows `environment-compile-var`,
    `environment-runtime-var`, `environment-job-condition`, `environment-if-directive`,
    `environment-deployment-condition`, `environment-deployment-runtime-var` (checked 2026-08-12)

*Resolution of [C-E02-076]:* the oracle probe that claim required **has now run** — the credentials
it reported missing are not in the ambient environment but in `.env.oracle`, which every
`scripts/expr-*-survey.ts` loads via `loadEnvFile`. C-E02-080..091 above are its result, and the
task's `[!]` is lifted. C-E02-073/074/075 stand as doc grounding; C-E02-075's "missing values
resolve to no value" is correct for `variables` and is **corrected for `parameters` by C-E02-087**,
where a miss is an error.

[C-E02-096] **The function table is slot-keyed in both directions: `counter` is legal in exactly one
slot, the runtime variable.** C-E02-065 established that status functions exist only in conditions;
`counter` is the mirror image and is *narrower than the doc sentence*. Learn says "Use this function
only in an expression that defines a variable. Don't use it as part of a condition for a step, job,
or stage" — and the service does reject it in job and stage conditions, but it also rejects it in a
**compile-time** `${{ }}` variable definition, which is a variable definition by any reading of that
sentence. Only `$[ counter('probe', 1) ]` is accepted. All three rejections are the ordinary
`Unrecognized value: 'counter'`, i.e. the name is simply absent from those tables. Implementation:
`SLOT_RESTRICTED_FUNCTIONS` in `packages/engine/src/expr/context.ts`, so `registryForSlot` cannot
hand every slot the full non-status set.
  — research/experiments/E02-context/survey.md rows `counter-runtime-var` (accepted),
    `counter-job-condition`, `counter-stage-condition`, `counter-compile-var` (all rejected)
    (checked 2026-08-12)
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions — counter entry: "Use
    this function only in an expression that defines a variable. Don't use it as part of a
    condition for a step, job, or stage." (checked 2026-08-12)

## E02-S04-T03 — `resources` context and pipeline-resource variables (claims 120–127)

Evidence: `research/experiments/E02-resources/real-run.md` — two real runs in the test org
(probe 1 declares a pipeline resource, probe 2 declares a repository and a container resource),
sources `resources-pipeline.yml` / `resources-repository.yml` in the same directory, reproducible
with `pnpm expr-resources-realrun`.

[C-E02-120] **The twelve `resources.pipeline.<Alias>.*` names are predefined *variables*, not members
of the `resources` context, and they are runtime-only.** The documented list is `projectName`,
`projectID`, `pipelineName`, `pipelineID`, `runName`, `runID`, `runURI`, `sourceBranch`,
`sourceCommit`, `sourceProvider`, `requestedFor`, `requestedForID`.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/resources-pipelines-pipeline?view=azure-pipelines
    — "In each run, the metadata for a pipeline resource is available to all jobs as the following
    predefined variables. These variables are available to your pipeline at runtime, and therefore
    can't be used in template expressions, which are evaluated at pipeline compile time."
    (checked 2026-08-12; page `git_commit_id` d089fd2dbb54483ec611eeb478e3eff14be74393)
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/resources?view=azure-devops
    — same list under "Pipeline resource variables" (page `git_commit_id`
    1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32, checked 2026-08-12)

[C-E02-121] **Measured: the `resources` context has no `pipeline` key, so the three access paths for
the same metadata disagree.** In a run where the metadata was demonstrably present (`printenv` shows
all eleven applicable `RESOURCES_PIPELINE_PROBE_*` variables), probe 1 read `runID` three ways:
`resources.pipeline.probe.runID` → **empty**, `variables['resources.pipeline.probe.runID']` → `531`,
`$(resources.pipeline.probe.runID)` → `531`. `convertToJson(resources.pipeline)` → `null`, and
`convertToJson(resources)` dumps exactly `{"repositories": {…}, "containers": {}}`. Every one of the
twelve documented fields read through the chain came back empty. This is not missing data — it is a
name that does not exist in the context. It also means a *job or stage condition*, where the
`resources` context itself is rejected (C-E02-082), can still read resource metadata through
`variables[…]`: job `CondFlat` (`condition: ne(variables['resources.pipeline.probe.runID'], '')`)
ran, while the false-comparison control `CondFlatControl` did not.
  — research/experiments/E02-resources/real-run.md probe 1 rows `chain*`, `flatVar`, `macro`,
    `resJson`, `bareResourcesPipeline`, `env`, job results (checked 2026-08-12)

[C-E02-122] **`projectName` is absent, not empty, when the resource declares no `project:`.** Through
an expression the two are indistinguishable (both yield empty), so the measurement is the environment
dump: eleven `RESOURCES_PIPELINE_PROBE_*` variables are set and `…_PROJECTNAME` is not among them.
The distinction is observable at the emitter's env export, which is why it is modelled as key
absence rather than an empty string.
  — research/experiments/E02-resources/real-run.md probe 1 `env` rows + `projName`,
    `flatVarProjectName` (checked 2026-08-12)
  — doc corroboration: "projectName is not present in the variables if the pipeline resource does
    not have a project value specified."

[C-E02-123] **What the `resources` context does carry: `repositories.<alias>` with six fields, and
its lookup policies.** `convertToJson(resources.repositories)` returns `id`, `name`, `ref`, `type`,
`url`, `version` per alias — the doc's `azure-devops` moniker list, `version` included. `self` is
present in every run whether or not a repository resource is declared. Alias **and** field names fold
case (`resources.repositories.SELF.REF` resolves), property and index syntax agree, and a miss —
unknown alias or unknown field — **null-propagates** rather than raising the way `parameters` does
(C-E02-087).
  — research/experiments/E02-resources/real-run.md probe 2 rows `reposJson`, `selfRef`, `selfIndex`,
    `aliasUpper`, `fieldUpper`, `declaredAsWritten`, `declaredLowered`, `repoMissAlias`,
    `repoMissField` (checked 2026-08-12)
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/resources?view=azure-devops
    — "Repository resource variables": `resources.repositories.<alias>.{name,ref,type,id,url,version}`

[C-E02-124] **Keys fold case in the `resources` context; values never do.** The implicit `self`
repository reports `"type": "Git"` while a repository declared `type: git` reports `"git"` — the YAML
verbatim. `eq(resources.repositories.X.type, 'git')` therefore behaves differently for `self` than
for a declared alias, and the builder passes `type` through unnormalised.
  — research/experiments/E02-resources/real-run.md probe 2 `reposJson` (checked 2026-08-12)

[C-E02-125] **Repository/container metadata is the mirror image of pipeline metadata: context-only.**
`variables['resources.repositories.self.ref']` is **empty** while
`resources.repositories.self.ref` resolves — the exact opposite of the pipeline family (C-E02-121).
No `RESOURCES_REPOSITORIES_*` or `RESOURCES_CONTAINER_*` environment variables appeared in the same
run's `printenv`. Container objects live under `containers.<alias>` and carry
`{environment, mapDockerSocket, image, options, volumes, ports}`; only `image` was exercised, and no
job used the container, so the container shape is recorded but not modelled (E11/E14).
  — research/experiments/E02-resources/real-run.md probe 2 rows `flatRepoVar`, `containersJson`,
    `containerImage`, `env` (checked 2026-08-12)

[C-E02-126] **Singular vs plural is not cosmetic.** The variable/context path uses singular
`resources.pipeline.<alias>`, while the YAML block is `resources.pipelines:`; containers invert it —
the context key is plural `containers` while the documented *macro* is singular
`$(resources.container.<name>.type)`. Measured: `resources.pipelines.probe.runID` → empty and
`convertToJson(resources.container)` → `null`, so mirroring the YAML key name produces a name that
resolves to nothing.
  — research/experiments/E02-resources/real-run.md probe 1 `pluralPath`, probe 2 `containerSingular`
    (checked 2026-08-12)

[C-E02-127] **The environment name is upper-case with `.` → `_` and hyphens preserved.** Measured
`RESOURCES_PIPELINE_PROBE_RUNID`; the doc's own two-resource sample shows
`RESOURCES_PIPELINE_OTHER-PROJECT-PIPELINE_PROJECTNAME`, and the alias charset is `[-_A-Za-z0-9]*`,
so a blanket non-alphanumeric replacement would emit a name the agent never sets. Also observed:
`RESOURCES_TRIGGERINGALIAS` and `RESOURCES_TRIGGERINGCATEGORY` are set but **empty** in a run not
started by a resource trigger, matching "These variables are empty unless the `Build.Reason` variable
is set to `ResourceTrigger`".
  — research/experiments/E02-resources/real-run.md probe 1 `env` rows (checked 2026-08-12)
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/resources-pipelines-pipeline?view=azure-pipelines
    — printenv sample + "variable names become uppercase, and periods turn into underscores"
# E02 — Expression language claims

[C-E02-128] Azure Pipelines runtime expressions are used in variables and conditions, and an expression may be a literal, context reference, function, or nested combination — https://learn.microsoft.com/azure/devops/pipelines/process/expressions (checked 2026-08-12) — "Use runtime expressions in variables and conditions".

[C-E02-129] Bash quoting removes the special meaning of shell metacharacters and prevents parameter expansion — https://www.gnu.org/software/bash/manual/html_node/Quoting.html (checked 2026-08-12) — "Quoting is used to remove the special meaning of certain characters or words to the shell."

[C-E02-130] Bash conditional and list constructs use command exit status, with zero meaning success and non-zero meaning failure — https://www.gnu.org/s/bash/manual/html_node/Exit-Status.html (checked 2026-08-12) — "a command which exits with a zero exit status has succeeded".

[C-E02-131] The shell backend must read runtime variable and dependency-output state through the generated runtime API and use helper functions for awkward string operations — docs/02-template-and-expression-engine.md §6 (checked 2026-08-12) — "azdo_var" / "azdo_output" and "small generated helper functions in lib/expr.sh".

[C-E02-132] A bare non-status function registered in the current slot is rejected as a missing call in both a compile-time variable and a job condition: `Expected '(' to follow a function: 'eq'`; it is a positioned error with the standard help link. — research/experiments/E02-bare-functions/bare-nonstatus-compile.md and research/experiments/E02-bare-functions/bare-nonstatus-job-condition.md (live preview, checked 2026-08-12) — "Expected '(' to follow a function: 'eq'".

[C-E02-133] A status-function spelling is not classified as a function outside its allowed slot: a bare `always` in a compile-time variable is `Unrecognized value: 'always'`, not a missing-parenthesis error. — research/experiments/E02-bare-functions/bare-status-outside-slot.md (live preview, checked 2026-08-12) — "Unrecognized value: 'always'".

[C-E02-134] A legal bare context name remains a named value rather than being mistaken for a function: `${{ variables }}` is evaluated to a mapping, then rejected by variable-schema validation (`A mapping was not expected`) rather than by expression parsing. — research/experiments/E02-bare-functions/bare-context-compile.md (live preview, checked 2026-08-12) — "A mapping was not expected".

## E02-S05-T02 — dual-backend conformance harness (C-E02-135..147)

Two kinds of claim live here. **135–137 and 140 are shell-language facts** with primary sources —
the compiled backend is real bash, so bash/POSIX are its specification exactly as Learn is the
specification for the expression language. **138, 139 and 141–146 are properties of the compiled
backend itself**, settled by running it (BACKLOG §3.3): the transcript is
`research/experiments/E02-conformance/shell-semantics.md`, regenerate with `pnpm expr-shell-survey`,
and the row-by-row measurement is `packages/runtime/test/expr-conformance.bats`, generated from
`packages/engine/test/expr/conformance.table.ts` by `pnpm expr-conformance-bats`.

[C-E02-135] A conditional expression exits 0 when true, 1 when false, and **greater than 1 on an error** — so "non-zero" does not mean False. — https://pubs.opengroup.org/onlinepubs/9799919799/utilities/test.html (checked 2026-08-13) — "0 — expression evaluated to true. 1 — expression evaluated to false or expression was missing. >1 — An error occurred."; measured locally as status 2 for `[ 1 -lt x ]` (shell-semantics.md, probe `test-error`).

[C-E02-136] A command that is not found exits **127** and one that is not executable exits 126, and every non-zero status means failure. A harness that mapped "non-zero" to False would therefore read a missing helper as a legitimate answer. — https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html (checked 2026-08-13) — "If a command is not found, the child process created to execute it returns a status of 127. If a command is found but is not executable, the return status is 126."; probe `command-not-found`.

[C-E02-137] `&&` runs its right operand if and only if the left exited zero, `||` if and only if the left exited **non-zero**, and the list's status is that of the last command executed. This is what makes the compiled `and`/`or` lazy in the same places the evaluator is (C-E02-028) — and, at the same time, what makes `||` unable to distinguish False from an error. — https://www.gnu.org/software/bash/manual/html_node/Lists.html (checked 2026-08-13) — "command2 is executed if, and only if, command1 returns an exit status of zero (success)" / "command2 is executed if, and only if, command1 returns a non-zero exit status."

[C-E02-138] **The shell backend has no Null.** docs/02 §6 specifies a missing store read as the empty String ("Null→empty fallback"), and `azdo_var` implements it (C-E06-003). Equality is unaffected because Null and `''` are already equal (C-E02-021), but an **ordered** comparison diverges: the evaluator raises on `lt(variables.Absent, 'x')` because String→Null conversion fails, while the compiled form compares `''` with `'x'` and answers True. Measured, and pinned as a `diverges` row rather than hidden — `variables-missing-ordered` in expr-conformance.bats. — packages/engine/test/expr/conformance.table.ts + docs/02 §6 — checked 2026-08-13.

[C-E02-139] **The shell backend has no Object or Array.** `split`/`convertToJson` produce one, `join`/`containsValue` consume one, a dynamic index (`variables[variables.x]`) needs the whole table rather than a single `azdo_var` read, and `counter` reads the convert-time state provider. All five are rejected with `BashCompileError` at convert time, which docs/02 §6 already prescribes for constructs the shell cannot express. — packages/engine/src/expr/compile-bash.ts + docs/02 §6 — checked 2026-08-13.

[C-E02-140] Command substitution deletes trailing newlines, so a variable value ending in a newline cannot round-trip through `"$(azdo_var …)"` even though the store holds it byte-for-byte (C-E06-003). — https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html §2.6.3 (checked 2026-08-13) — "if the output ends with one or more bytes that have the encoded value of a <newline> character, they shall not be included in the replacement."; probe `command-substitution-newline`.

[C-E02-141] `${v^^}` folds ASCII only under `LC_ALL=C`, where .NET's OrdinalIgnoreCase folds the full character set: `é` is returned unchanged. Declared divergence — the conformance table has no non-ASCII row, and gaining one requires deciding this rather than discovering it. — shell-semantics.md probe `upper-non-ascii-c` — checked 2026-08-13.

[C-E02-142] **`[[ < ]]` is locale-collated, not ordinal**, which is the single reason `lib/expr.sh` pins `LC_ALL=C` in every string operation: `[[ alpha < BETA ]]` is **false** under `LC_ALL=C` (byte order) and **true** under `en_US.UTF-8`. Azure Pipelines compares strings OrdinalIgnoreCase, so the C locale plus an explicit upper-case fold is the faithful pair; a compiler emitting a bare `[[ < ]]` would give locale-dependent answers on a developer machine. — shell-semantics.md probes `collate-c` / `collate-utf8` — checked 2026-08-13.

[C-E02-143] **An evaluation error is masked by `||`.** `or(lt(1, 'x'), true)` raises in the evaluator but answers True in the compiled form, because the OR list runs its right operand after *any* non-zero status (C-E02-137) and cannot tell status 2 from status 1. The mirror case is safe: `and(false, …)` short-circuits identically in both backends. Recorded as a `diverges` row (`or-after-conversion-error`) rather than fixed here — a status-preserving condition protocol is E06-S03-T03's subject. — shell-semantics.md probe `or-masks-error`; expr-conformance.bats — checked 2026-08-13.

[C-E02-144] **An evaluation error in *value* position is discarded outright.** A helper such as `azdo_expr_format` reports a bad format string with status 2, but it is invoked inside `"$( … )"`, and command substitution keeps only the output — so `eq(format('{2}', 'a'), 'x')` raises in the evaluator and answers False in the compiled form. Same root cause as C-E02-143 and the same owner (E06-S03-T03); pinned as the `format-missing-index` row. — expr-conformance.bats — checked 2026-08-13.

[C-E02-145] **E02-S05-T01's compiled output could not have executed.** Building the bats runner is what exposed it: status functions compiled to `[ azdo_status_succeeded = True ]` — a bare *word* compared against a string, so the function was never invoked and the condition was False for every run; `not(x)` nested `[ [ … ] != True ]`; comparisons double-wrapped an already-quoted literal (`[ "'a'\''b'" = 'x' ]`, comparing quoting syntax rather than value); dependency reads passed `azdo_output` two arguments where it takes three; and the emitted `azdo_expr_*` helpers had no definitions anywhere, because `packages/runtime/lib/expr.sh` — named in T01's own **Do** — was never written. Every one of these is invisible to a test that asserts the emitted *string*, and every one turns red the moment a row is executed. — packages/engine/test/expr/compile-bash.test.ts (rewritten) — checked 2026-08-13.

[C-E02-146] A Boolean-valued call in value position compiles to `"$(<predicate>; azdo_expr_bool $?)"`, which is the same rendering docs/02 §6 uses to materialize a `$[ ]` variable into the store. This is what lets a predicate nest inside a comparison (`eq(eq(1,1), true)`) without a second compilation mode. — docs/02 §6 + packages/engine/src/expr/compile-bash.ts — checked 2026-08-13.

[C-E02-147] **The runtime library must not use bash 4 case-modification expansions, and the reason is that their failure is *silent agreement*.** macOS runners execute bats under the system bash 3.2, where `${v^^}` / `${v,,}` do not exist; the bad substitution yields the empty string, and because it does so on **both** sides of a comparison, the two empties compare **equal**. On the first CI run that meant `lt('alpha','BETA')` answered "equal" (four of its six operators red) while `eq(lower('AB'), 'ab')` passed — *for the wrong reason*, the helper having returned nothing at all. Fixed by folding case through `LC_ALL=C tr`, which is what `core.sh` already does (C-E06-003), and guarded by `packages/runtime/test/expr.bats`, which asserts the returned **text**: a comparison-only suite cannot distinguish "both correct" from "both empty". — GitHub Actions run 31776027219 (macos-latest, node 22/24); packages/runtime/lib/expr.sh; packages/runtime/test/expr.bats — checked 2026-08-14.

## E02-S05-T03 — AST evaluator composition map (2026-08-14)

This task introduces no service behavior and therefore allocates no new claim ID. It composes the
already-grounded evaluator primitives through the parser's `ExprNode`; each dispatch branch carries
the following existing evidence:

| AST/evaluator branch | Existing claims |
|---|---|
| literal → `ExprValue` | C-E02-018..022 |
| named context resolution | C-E02-080..091 |
| property/index access and miss policy | C-E02-024..027, C-E02-087/088 |
| logical/comparison/membership calls | C-E02-020..032 |
| general calls, including lazy `coalesce` and eager `iif` | C-E02-041..051 |
| status calls by step/job/stage scope | C-E02-060..072 |

Wildcard filtering is deliberately not inferred here: C-E02-009 proves the accepted syntax and
one array result, but the task's conformance table and Ground set do not define the complete
Object/Array filter contract. The evaluator reports that node as unsupported until a dedicated
behavior task grounds the remaining cells (filed as E02-S05-T04).
