# E02-S01-T01 — expression grammar survey (live service)

Each row is one live `preview` call: the expression below submitted as
`variables:\n  probe: ${{ <expr> }}` (or `$[ <expr> ]` for the Runtime group) on top of a fixed
`parameters.obj` object. **accepted** means HTTP 200 and the value column is what the service
put in `variables.probe`; **rejected** shows the service message verbatim (redacted).

Regenerate with `pnpm expr-grammar-survey`. Source of truth for the claims in
`research/E02-expressions.md`; where a row contradicts `actions/runner`,
the service wins (D6, C-E00-013).

Context object: `{a: 1, b_c: two, _lead: three, 9num: four, 'dotted.name': five, list: [{id: 7, n: x}, {id: 8, n: y}]}`

## Literals

| id | expression | outcome | value / message | decides |
|---|---|---|---|---|
| `bool-lower` | `true` | accepted | true | baseline boolean spelling |
| `bool-title` | `True` | accepted | true | docs say boolean literals are case-insensitive; the fork compares Ordinal, i.e. `True` would be a named value there |
| `bool-upper` | `TRUE` | accepted | true | upper bound of the same rule |
| `null-lower` | `null` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'null'. Located at position 1 within expression: 'null'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | null keyword |
| `null-upper` | `NULL` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'NULL'. Located at position 1 within expression: 'NULL'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | case folding of `null` |
| `num-int` | `42` | accepted | 42 | integer literal + output formatting |
| `num-neg` | `-1.2` | accepted | -1.2 | leading `-` is part of the number |
| `num-lead-dot` | `.5` | accepted | 0.5 | docs: a number "Starts with -, ., or 0 through 9" |
| `num-plus` | `+1` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '+1'. Located at position 1 within expression: '+1'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the fork lexes a leading `+` as a number; the docs do not list it |
| `num-exp` | `1e3` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '1e3'. Located at position 1 within expression: '1e3'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | scientific notation accepted? |
| `num-hex` | `0x1F` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '0x1F'. Located at position 1 within expression: '0x1F'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | hex accepted? |
| `num-trail-dot` | `1.` | accepted | 1 | trailing separator with no fraction |
| `ver-two` | `1.2` | accepted | 1.2 | number or Version? docs say a Version has "two or three period characters", so 1.2 should be a Number |
| `ver-three` | `1.2.3` | accepted | 1.2.3 | three-segment version literal |
| `ver-four` | `1.2.3.4` | accepted | 1.2.3.4 | four-segment version literal |
| `ver-five` | `1.2.3.4.5` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '1.2.3.4.5'. Located at position 1 within expression: '1.2.3.4.5'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | segment ceiling — five segments must fail if the lexer stops at four |
| `neg-version` | `-1.2.3` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '-1.2.3'. Located at position 1 within expression: '-1.2.3'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | a Version cannot carry a sign — is the whole token rejected? |
| `num-double-dot` | `1..2` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '1..2'. Located at position 1 within expression: '1..2'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | empty segment: the scan keeps `.` inside the token, so this must fail to resolve |
| `nan` | `NaN` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'NaN'. Located at position 1 within expression: 'NaN'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the fork lexes NaN as a Number |
| `infinity` | `Infinity` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'Infinity'. Located at position 1 within expression: 'Infinity'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the fork lexes Infinity as a Number |
| `str-plain` | `'a b c'` | accepted | a b c | single-quoted string |
| `str-escape` | `'It''s OK'` | accepted | It's OK | the documented '' escape, and whether the result carries one quote |
| `str-double` | `"double"` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '"double"'. Located at position 1 within expression: '"double"'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | double quotes must be a lexer error — docs say strings "Must be single-quoted" |
| `str-unclosed` | `'unclosed` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): The expression is not closed. An unescaped ${{ sequence was found, but the closing }} sequence was not found. | unterminated string error shape |
| `ver-vs-num` | `gt(1.10, 1.9)` | accepted | false | discriminates the two-segment case: as Numbers 1.10 < 1.9 → False, as Versions 1.10 > 1.9 → True |
| `ver-vs-num-control` | `gt(1.10.0, 1.9.0)` | accepted | true | control: three segments can only be a Version, so this must be True |

## Operators

| id | expression | outcome | value / message | decides |
|---|---|---|---|---|
| `op-eq` | `1 == 1` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '=='. Located at position 3 within expression: '1 == 1'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | THE structural question: infix operators mean a precedence-climbing parser, their absence means primary + postfix chain only |
| `op-ne` | `1 != 2` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '!='. Located at position 3 within expression: '1 != 2'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, `!=` |
| `op-and` | `true && false` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '&&'. Located at position 6 within expression: 'true && false'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, `&&` |
| `op-or` | `true \|\| false` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '\|\|'. Located at position 6 within expression: 'true \|\| false'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, `\|\|` |
| `op-not` | `!true` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: '!true'. Located at position 1 within expression: '!true'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, prefix `!` |
| `op-gt` | `1 > 0` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '>'. Located at position 3 within expression: '1 > 0'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, `>` |
| `op-lt` | `1 < 2` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '<'. Located at position 3 within expression: '1 < 2'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same, `<` (symmetry with `>`) |
| `op-amp-single` | `true & false` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '&'. Located at position 6 within expression: 'true & false'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | is a lone `&` a symbol too, or does it fall into the keyword scan? |
| `op-pipe-single` | `true \| false` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '\|'. Located at position 6 within expression: 'true \| false'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | same question for `\|` |
| `op-bang-alone` | `! true` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: 'true'. Located at position 3 within expression: '! true'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | reconciles `!=` reporting "Unexpected symbol" against `!true` reporting "Unrecognized value" — i.e. whether `!` is a symbol char on its own |
| `op-group` | `(true)` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '('. Located at position 1 within expression: '(true)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | is `(` legal as logical grouping outside a function call? |
| `op-func-control` | `eq(1, 1)` | accepted | true | control: the documented function form must be accepted in the same position |

## Access

| id | expression | outcome | value / message | decides |
|---|---|---|---|---|
| `acc-property` | `parameters.obj.a` | accepted | 1 | property dereference |
| `acc-underscore` | `parameters.obj.b_c` | accepted | two | documented identifier charset (letters, digits, underscore) |
| `acc-lead-underscore` | `parameters.obj._lead` | accepted | three | leading underscore, documented as legal |
| `acc-lead-digit` | `parameters.obj.9num` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '9num'. Located at position 16 within expression: 'parameters.obj.9num'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | property name starting with a digit — must be rejected if the charset rule holds |
| `acc-index-string` | `parameters.obj['dotted.name']` | accepted | five | index syntax reaches names the property syntax cannot spell |
| `acc-index-number` | `parameters.obj.list[0].id` | accepted | 7 | numeric index into an array, then a property off the result |
| `acc-index-expr` | `parameters.obj.list[parameters.obj.a].id` | accepted | 8 | is an arbitrary expression legal inside `[ ]`, or only a literal? |
| `acc-index-named` | `parameters['obj'].a` | accepted | 1 | index directly off a named value |
| `acc-missing` | `parameters.obj.nosuch` | accepted |  | dictionary miss → Null (parse-time legal) |
| `acc-missing-chain` | `parameters.obj.nosuch.deeper` | accepted |  | chaining off Null — the documented safe-navigation behaviour |
| `acc-wildcard-dot` | `convertToJson(parameters.obj.list.*.id)` | accepted | [ ⏎ 7, ⏎ 8 ⏎ ] | filtered array via `.*.` — documented for ADO, and a distinct AST node |
| `acc-wildcard-index` | `convertToJson(parameters.obj.list[*].id)` | accepted | [ ⏎ 7, ⏎ 8 ⏎ ] | the `[*]` spelling of the same thing (the fork lexes `*` after `[` too) |
| `acc-func-index` | `split('a,b', ',')[1]` | accepted | b | postfix index applied to a function result |
| `acc-named-case` | `PARAMETERS.obj.a` | accepted | 1 | is the context (named-value) name case-insensitive like the function name? |
| `acc-named-bare` | `convertToJson(parameters)` | accepted | { ⏎ "obj": { ⏎ "a": 1, ⏎ "b_c": "two", ⏎ "_lead": "three", ⏎ "9num": "four", ⏎ "dotted.name": "five", ⏎ "list": [ ⏎ { ⏎ "id": 7, ⏎ "n": "x" ⏎ }, ⏎ { ⏎ "id": 8, ⏎ "n": "y" ⏎ } ⏎ ] ⏎ } ⏎ } | a named value with no dereference is a complete expression on its own |

## Validation

| id | expression | outcome | value / message | decides |
|---|---|---|---|---|
| `val-func-case` | `EQ(1, 1)` | accepted | true | are function names case-insensitive? (the fork uses an OrdinalIgnoreCase map) |
| `val-func-space` | `eq (1, 1)` | accepted | true | whitespace between a function name and `(` — the fork looks ahead past it |
| `val-func-unknown` | `nosuchfunc(1)` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'nosuchfunc'. Located at position 1 within expression: 'nosuchfunc(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | unrecognized function is a *parse-time* error in the fork — is it here? |
| `val-func-arity` | `eq(1)` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: ')'. Located at position 5 within expression: 'eq(1)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | arity is validated at parse time in the fork (TooFewParameters) |
| `val-func-too-many` | `eq(1, 2, 3)` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: ','. Located at position 8 within expression: 'eq(1, 2, 3)'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | where the too-many-arguments error is positioned (the arity check has two sides) |
| `val-empty-index` | `parameters.obj.list[]` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: ']'. Located at position 21 within expression: 'parameters.obj.list[]'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | an index with nothing in it |
| `val-trailing-dot` | `parameters.obj.` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Expected a property name to follow the dereference operator '.': '.'. Located at position 15 within expression: 'parameters.obj.'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | expression ending on a dereference — the unexpected-end case |
| `val-unclosed-call` | `eq(1,` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unclosed function: 'eq'. Located at position 1 within expression: 'eq(1,'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | unclosed call: does the expression parser see it, or the template scanner first? |
| `val-depth-50` | `not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(false))))))))))))))))))))))))))))))))))))))))))))))))))` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Exceeded max expression depth 50. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | exact ceiling: 50 nested calls — accepted or not? |
| `val-depth-49` | `not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(false)))))))))))))))))))))))))))))))))))))))))))))))))` | accepted | true | 49 nested calls + the leaf = depth 50 exactly; if this passes and 50 fails, the rule is "error when depth > 50, counting the leaf" |
| `val-depth-property` | `parameters.obj.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a.a` | accepted |  | does the depth ceiling count member access too, or only function arguments? (missing members are Null, so nothing else can fail here) |
| `val-depth-index` | `parameters.obj['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']['a']` | accepted |  | same question for index access |
| `val-depth-51` | `not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(false)))))))))))))))))))))))))))))))))))))))))))))))))))` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Exceeded max expression depth 50. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | the other side of the boundary, so the constant is not an off-by-one guess |
| `val-named-unknown` | `nosuchcontext.a` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unrecognized value: 'nosuchcontext'. Located at position 1 within expression: 'nosuchcontext.a'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | unrecognized named value — parse-time error, and what it is called |
| `val-trailing` | `1 2` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Unexpected symbol: '2'. Located at position 3 within expression: '1 2'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | trailing garbage after a complete expression |
| `val-empty` | `(empty)` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): An expression was expected | the empty expression |
| `val-depth` | `not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(not(false))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))` | rejected (400) | /azure-pipelines.yml (Line: 16, Col: 10): Exceeded max expression depth 50. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | nesting ceiling — the fork caps at MaxDepth = 50 |
| `val-depth-control` | `not(not(not(not(not(not(not(not(not(not(false))))))))))` | accepted | false | control for the ceiling: 10 deep must be accepted |

## Runtime

| id | expression | outcome | value / message | decides |
|---|---|---|---|---|
| `rt-func` | `eq(1, 1)` | accepted | $[ eq(1, 1) ] | is a runtime expression parsed at preview time at all, or passed through verbatim? |
| `rt-op` | `1 == 1` | rejected (400) | An error occurred while loading the YAML build pipeline. Unrecognized value: '=='. Located at position 3 within expression: '1 == 1'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | if it is parsed, the runtime parser is a second reachable grammar and must agree |
| `rt-garbage` | `'unclosed` | rejected (400) | An error occurred while loading the YAML build pipeline. Unrecognized value: ''unclosed'. Located at position 1 within expression: ''unclosed'. For more help, refer to https://go.microsoft.com/fwlink/?linkid=842996 | control: does *any* malformed runtime expression get rejected at preview time? |
