# E03 — template engine: claims

Claim format per BACKLOG.md §3. IDs are **never reused** and are allocated from the block table
below rather than by "next free number" — E03's stories are worked on parallel branches, and the
E02 collision (two forks independently taking `C-E02-018..027`, discovered only at merge, by which
time the IDs were load-bearing in code comments and test names) is the reason this table exists.

## Claim-ID block allocation

| Block | Task | File | Status |
|---|---|---|---|
| `C-E03-001..099` | E03-S05-T01 normalizer | `research/E03-normalizer.md` | 001–003 used |
| `C-E03-100..119` | **E03-S01-T01 DOM walker with context stack** | this file | 100–117 used |
| `C-E03-120..139` | E03-S01-T02 conditional insertion chains | this file | 120–139 used (block full; 138/139 added by T04) |
| `C-E03-140..159` | E03-S01-T03 iterative insertion (`each`) | this file | 140–151 used |
| `C-E03-160..174` | **E03-S01-T04 `${{ insert }}` merge** | this file | 160–174 used (block full) |
| `C-E03-175..194` | **E03-S01-T05 scalar interpolation** | this file | 175–194 used (block full) |
| `C-E03-195..229` | E03-S02 template resolution & parameters | this file | free |
| `C-E03-230..249` | E03-S03 compile-time variable visibility | this file | free |
| `C-E03-250..279` | E03-S04 limits, emitter, strict validation | this file | free |
| `C-E03-280..299` | E03-S05-T02 `preview-diff` | this file | free |

Leave gaps. A branch that numbers from what it can see collides silently with every sibling.

---

## E03-S01-T01 — directive recognition (`C-E03-100..117`)

Evidence: `research/experiments/E03-walk/` — **33 live preview probes** (`pnpm template-walk-survey`).
The task's **Ground** field asks for the templates doc plus the `actions/runner` object-templating
walker as a design reference. Both were read; both turned out to be *insufficient in opposite
directions*, which is why the probe set is this large:

- The docs never state a single one of the recognition rules below. They show only well-formed
  lower-case spellings, and their one structural statement about *where* expressions are expanded
  is **wrong** (C-E03-109).
- The fork knows one directive, `insert`, and no others (C-E03-115) — it is the GitHub Actions
  dialect, as E02-S01-T01 established. It cannot be a design reference for a directive set it
  does not have.

### The recognizer

[C-E03-100] **The directive keyword set is closed and matched case-sensitively, lower-case only.**
`${{ IF eq(1, 1) }}`, `${{ If eq(1, 1) }}`, `${{ EACH item IN parameters.items }}`,
`${{ INSERT }}`, `${{ ELSEIF … }}` and `${{ ELSE }}` are all rejected, while the identical
lower-case spellings expand. This is a real divergence from the rest of the language, where
function names, context names and boolean literals all fold case (C-E02-002/011/012). Every
rejection is an *expression* error over the whole delimited text — i.e. a keyword whose case is
wrong is not a mis-spelled directive, it is **not a directive at all**, and the text falls through
to ordinary expression parsing: `IF eq(1, 1)` reports `Unexpected symbol: 'eq'. Located at
position 4 within expression: 'IF eq(1, 1)'`, which is exactly C-E02-103's leftover-token rule
applied to `IF` parsed as a name.
  — research/experiments/E03-walk/{case-if-upper,case-if-title,case-each-upper,case-insert-upper,case-elseif-else-upper}.md
    vs the ctl-\* controls (live preview, checked 2026-08-12)

[C-E03-101] **Directive parameters are top-level *expression units*, not whitespace-separated
words.** `${{ else if eq(1, 1) }}` is rejected `Exactly 0 parameter(s) were expected following the
directive 'else'. Actual parameter count: 2` — the two being `if` and `eq(1, 1)`, so a
parenthesised call with an internal space and a comma counts as **one**. `${{ each a in
parameters.items extra }}` gives `Exactly 3 parameter(s) … Actual parameter count: 4` and
`${{ insert extra }}` gives `Exactly 0 … Actual parameter count: 1`. So the delimited text is
tokenized by the expression lexer and the units read off it; it is not string-split. The expected
counts measured: `each` = 3 (`<identifier> in <value>`), `else` = 0, `insert` = 0.
  — research/experiments/E03-walk/{elseif-spelled-else-if,arity-each-four-parameters,arity-insert-one-parameter}.md
    (live preview, checked 2026-08-12)

[C-E03-102] **`if` and `elseif` never produce the parameter-count sentence; the other three do.**
A wrong parameter count after `if` falls through to ordinary expression parsing of the *whole*
delimited text instead: `${{ if }}` → `Unrecognized value: 'if'. Located at position 1 within
expression: 'if'`, and `${{ if eq(1, 1) eq(2, 2) }}` → `Unexpected symbol: 'eq'. Located at
position 4 within expression: 'if eq(1, 1) eq(2, 2)'` (position 4 is the *first* `eq`, so the
parser was handed the text including the keyword). The mechanism behind the split is **not
settled** by these probes and is deliberately left open: error parity for malformed `if`/`elseif`
is E03-S01-T02's fixture obligation, and for `each` E03-S01-T03's. T01 records the two observable
families and which one fires, nothing more.
  — research/experiments/E03-walk/{arity-if-zero-parameters,arity-if-two-parameters}.md vs
    {elseif-spelled-else-if,arity-each-four-parameters,arity-insert-one-parameter}.md
    (live preview, checked 2026-08-12)

[C-E03-103] **`each`'s separator is the literal lower-case `in` in parameter position 1**, and it
is checked as text rather than parsed: `${{ each item on parameters.items }}` and
`${{ each item IN parameters.items }}` are both rejected `The value '<x>' is unexpected. The
expected format of an 'each' expression is: ${ each <identifier> in <value> }` — note the service's
own message spells the delimiter with a single brace. The `IN` row matters on its own: the earlier
`EACH item IN …` rejection proved nothing about the separator, because `EACH` had already failed to
be a directive and the whole text fell through to the expression parser (C-E03-100).
  — research/experiments/E03-walk/{each-separator-not-in,each-separator-upper}.md
    (live preview, checked 2026-08-12)

[C-E03-104] **A collection expression may legally contain the separator text**, and the service
still splits correctly, because the split is over expression tokens (C-E03-101) rather than a text
search. `${{ each item in split('a in b', ' in ') }}` iterates `a` and `b` — the ` in ` inside the
two string literals is not a separator — and
`${{ each item in split(format('{0}', in('b', 'b')), ',') }}` iterates the single value `True`,
so an `in(` occurring *after* the real separator does not capture it either. A first-`indexOf` or
last-`indexOf` implementation passes one of these two and silently iterates the wrong collection on
the other; silence is what makes this the worst failure mode in the directive family.
  — research/experiments/E03-walk/{each-in-string-literal,each-in-function-name}.md
    (live preview, checked 2026-08-12)

### The loop variable

[C-E03-105] **The `each` loop-variable name is itself run through the expression parser**, so it
collides with the *function* namespace. `${{ each in in parameters.items }}` and
`${{ each eq in parameters.items }}` are both rejected `Expected '(' to follow a function: '<name>'.
Located at position 1 within expression: '<name>'` — position 1 over an expression text that is
just the name, which is what pins the reading: the failure is not a mis-split, it is the name being
parsed on its own.
  — research/experiments/E03-walk/{each-var-named-in,each-var-named-eq}.md
    (live preview, checked 2026-08-12)

[C-E03-106] **Loop variables and contexts share one namespace, and redefinition is a hard error —
not shadowing.** `${{ each variables in parameters.items }}` and
`${{ each parameters in parameters.items }}` are both rejected `The idenfifier '<name>' has already
been defined within the current scope` (the service's own misspelling of "identifier", preserved
here because it is the message text). This settles the frame design: a frame **adds** names to one
flat namespace and must reject a collision, rather than layering a scope that shadows an outer one.
By the same rule a nested `each` may not reuse its outer loop variable's name.
  — research/experiments/E03-walk/{each-var-named-variables,each-var-named-parameters-shadow}.md
    (live preview, checked 2026-08-12)

[C-E03-107] **Loop-variable names fold case.** Declared `${{ each ITEM in parameters.items }}` and
read back as `${{ item }}`, the body expands to the element values. So the collision check of
C-E03-106 and the lookup are both case-insensitive, consistent with every other name in the
grammar (C-E02-011/012) — the case-sensitivity of C-E03-100 is confined to the *keyword*.
  — research/experiments/E03-walk/each-var-case-fold.md (live preview, checked 2026-08-12)

### Where directives may appear

[C-E03-108] **Delimiter padding is optional and a directive is always a mapping key**, so its text
can never contain a newline. `${{if eq(1, 1)}}` and `${{each item in parameters.items}}` both
expand, as does `${{    if     eq(1, 1)    }}` — consistent with C-E02-104's trim. The multi-line
spelling could **not** be measured and the attempt is recorded as *not evidence*: the probe was
rejected by the YAML layer (`Mapping values are not allowed in this context`) before the template
engine saw it, because a plain scalar key cannot span lines. That is itself the answer the walker
needs — a directive is only ever recognized on a mapping key (C-E03-112), so the case cannot arise.
  — research/experiments/E03-walk/{ws-if-none,ws-if-wide,ws-each-none,ws-each-newline}.md
    (live preview, checked 2026-08-12)

[C-E03-109] **Docs correction.** The template-expressions doc states: "Expressions are only
expanded for `stages`, `jobs`, `steps`, and `containers` (inside `resources`). You can't, for
example, use an expression inside `trigger` or a resource like `repositories`." The first half is
**false as written**: `trigger:` `- ${{ 'main' }}` expands to `trigger.branches.include: [main]`,
and `${{ 'agent.os -equals Linux' }}` expands inside a job's `pool.demands`. Neither position is in
the doc's list and one of them is its own counter-example.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions (checked
    2026-08-12) — "Expressions are only expanded for `stages`, `jobs`, `steps`, and `containers`
    (inside `resources`)." — refuted by research/experiments/E03-walk/{pos-expr-in-trigger,pos-expr-in-pool-demands}.md

[C-E03-110] **Directive position-sensitivity is real but narrow, and has its own error sentence.**
A directive inside `resources.repositories` is rejected `A template expression is not allowed in
this context` — a fourth error family, distinct from every expression error and from the
parameter-count sentence. It is not a general "outside the documented list" gate: an `if` directive
expands normally in `pool.demands` and in a root `variables:` block, neither of which is in the
doc's list. In `trigger:` the directive is simply **not expanded** — the document is rejected
`A mapping was not expected`, i.e. the unexpanded `${{ if … }}:` mapping reached schema validation
where a string was expected. Three distinct behaviors, so the gate is a per-position attribute with
exactly **one** measured member; T01 encodes it as a seam with one member rather than a table
extrapolated from it.
  — research/experiments/E03-walk/{pos-if-in-resources-repositories,pos-if-in-pool-demands,pos-if-in-variables,pos-if-in-trigger}.md
    (live preview, checked 2026-08-12)

[C-E03-111] **Two byte-identical directive keys in one mapping are accepted**, and both bodies are
merged: `${{ if eq(1, 1) }}: {A: '1'}` twice alongside `BASE: '1'` expands to `{BASE, A, B}`.
**This contradicts our own C-E01-023 duplicate-key quirk**, which folds case and rejects a repeated
key at every nesting level with no exemption for `${{ }}` keys (`collectDuplicateKeys` in
`packages/engine/src/frontend/quirks.ts` compares raw key text) — so today the parser rejects a
document the service expands, and it rejects it at *parse* time, before any walker runs. Not fixed
here: the duplicate-key quirk belongs to E01-S01-T02, which is `[x]` done and whose 13 transcripts
simply never probed a `${{ }}` key — the quirk is right about every case it measured and wrong
about the one it did not. Filed as **E01-S01-T04** at the end of that story, with this transcript
as its grounding.
  — research/experiments/E03-walk/dup-identical-if-keys.md (live preview, checked 2026-08-12)

[C-E03-112] **A directive keyword in value position is not a directive.**
`steps:\n- script: ${{ if eq(1, 1) }}` is rejected `Unexpected value '${{ if eq(1, 1) }}'` — and
notably with **no** expression parse error alongside it, unlike the key-position fall-through of
C-E03-100. So directive detection keys off the mapping key / sequence item, never off scalar text
in a value.
  — research/experiments/E03-walk/if-as-scalar-value.md (live preview, checked 2026-08-12)

[C-E03-113] **A failed directive key in *sequence* position reports twice, in *mapping* position
once.** Every sequence-item rejection above is two newline-joined lines: the expression or
parameter-count error, then `Unexpected value '<raw key text>'`. The identical malformation as a
plain mapping key (`${{ INSERT }}`, `${{ foreach … }}` inside `env:`) reports only the first line —
because an expression *key* is legal in a mapping (`${{ pair.key }}: …`) while a sequence item that
is a one-key mapping with an unusable key has nothing left to be. Consistent with C-E02-110: the
service collects every error in the document rather than stopping at the first.
  — research/experiments/E03-walk/{unknown-keyword,unknown-keyword-mapping,case-insert-upper}.md
    (live preview, checked 2026-08-12)

[C-E03-117] **A literal `${{` is escaped by putting it inside an expression string**, which makes
the closing `}}` findable only by a quote-aware scan. The doc gives both spellings, including the
`''` escape inside the escape. Consequence for `loneExpression`: `endsWith('}}')` plus a
"contains `${{`" rejection reports *not a lone expression* for the doc's own canonical spelling —
and lone-expression-vs-mixed-content is precisely the distinction E03-S01-T05 is built on, so the
bug would surface there rather than here. The scan skips single-quoted strings (`''` = a literal
quote, C-E02-006) and takes the first `}}` outside one.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions (checked
    2026-08-12) — "If you need to escape a value that literally contains `${{`, wrap the value in
    an expression string. For example, use `${{ 'my${{value' }}` or `${{ 'my${{value with a ''
    single quote too' }}`."

### Handed to other epics

[C-E03-114] **E02 gap: `Expected '(' to follow a function: '<name>'` is a general expression error
kind that E02 does not implement.** It is not specific to the `each` variable slot of C-E03-105 —
a bare `${{ eq }}` in an ordinary variable value produces the same sentence with the same
`Located at position 1 within expression: 'eq'` framing. `ExprErrorCode` in
`packages/engine/src/expr/parser.ts` has no such member, and a bare known-function name currently
takes the `unrecognized-value` path, so we would render `Unrecognized value: 'eq'` where the
service says `Expected '(' to follow a function: 'eq'`. Not fixed here — it belongs to E02-S01 and
needs its own probe set (which names, and what a bare *context* name does by contrast).
  — research/experiments/E03-walk/bare-function-name-value.md (live preview, checked 2026-08-12)

[C-E03-115] **The `actions/runner` object-templating engine knows exactly one directive, `insert`.**
`TemplateConstants.cs` declares `InsertDirective = "insert"` and no `if`/`elseif`/`else`/`each`
counterpart anywhere in `src/Sdk/DTObjectTemplating/`. Combined with E02-S01-T01's finding that the
fork is the GitHub Actions dialect, this means the fork is usable for the *walk loop shape*
(depth-first over mapping/sequence tokens, `TemplateEvaluator`/`TemplateUnraveler`) and for nothing
about the directive set — the conditional and iterative directives this task recognizes have no
counterpart in it to read.
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateConstants.cs#L21
    (checked 2026-08-12) — `internal const String InsertDirective = "insert";`

[C-E03-116] **The fork's evaluation loop is a recursive `Evaluate(DefinitionInfo)` driven by a
`TemplateUnraveler`, and that shape — not its content — is what carries over.** `TemplateEvaluator`
recurses per node (`Evaluate` at L89) and consumes children through unraveler predicates rather
than an index: `while (!m_unraveler.AllowSequenceEnd(definition.Expand))` for sequences (L116) and
`while (m_unraveler.AllowScalar(definition.Expand, out ScalarToken nextKeyScalar))` for mapping
keys (L196), calling `Evaluate` again for each value (L203/L225/L314). Our `walkTemplate` is the
same recursion over E01's already-materialized DOM, which is why it needs no unraveler: the
streaming/`Expand` machinery exists to interleave expansion with reading, and T01 expands nothing.
Read to satisfy this task's **Ground** ("pin permalink to its evaluation loop"); the loop is
usable, its *directive* handling is not, per C-E03-115.
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateEvaluator.cs#L89-L203
    (checked 2026-08-12)

### Probe index

`research/experiments/E03-walk/` — 33 transcripts, re-runnable with `pnpm template-walk-survey
[probe-name]`. Controls (`ctl-*`) come first in the script so that a rejection elsewhere is a
statement about the variation and not about the harness.

---

## E03-S01-T02 — conditional insertion chains (`C-E03-120..139`)

Doc grounding and the first oracle matrix were captured 2026-08-18; an independent second matrix
followed 2026-08-19. The official documentation resolves the public syntax and the two supported
parent shapes and **nothing else** — not chain grouping, nesting, orphan cases, condition typing,
body shapes, or evaluation order. Those omissions are resolved by the **union of 45 live preview
probes and 37 successful input/`finalYaml` pairs**: 23 probes/19 pairs under
`research/experiments/E03-conditionals/` (`pnpm template-conditionals-survey`) and 22 probes/18
pairs under `research/experiments/E03-if/` (`pnpm if-survey [probe-name]`). The remaining eight
probes are rejection controls retained with their service transcripts.

Probes whose outcome could not be predicted from the docs are declared `expected: 'either'` in the
survey script rather than given a guessed expectation; its header says why. Two findings changed
the implementation — C-E03-128 (grouping is *not* adjacency-gated, and the winner splices at its
**own** position) and C-E03-132 (chain conditions evaluate in document order and stop at the
winner) — and each is mutation-checked in `packages/engine/test/template/conditionals.test.ts`.

[C-E03-120] **Conditional insertion is supported in both a sequence and a mapping, and an `if`
directive may also be used outside a template when written with template syntax.** The official
page separately gives a `steps` sequence example and an `env` mapping example, so both parent
shapes are part of the documented contract.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#conditional-insertion
    (checked 2026-08-18) — "If you want to conditionally insert into a sequence or a mapping in a
    template, use insertions and expression evaluation."
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L180-L238
    (source pin checked 2026-08-18)
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7d36475af0537d1e317e0a1cca2229c7eae20097/docs/pipelines/process/template-expressions.md#L180-L245
    (independent source pin checked 2026-08-18)

[C-E03-121] **The documented mapping form permits adjacent `if`, `elseif`, and `else` directive
keys, with each selected body contributing ordinary keys to the containing mapping.** Microsoft's
example puts the three directives under one variable entry and gives each body a `value` key. The
page does not define malformed/orphan-chain behavior; that remains an oracle question.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#conditional-insertion
    (checked 2026-08-18) — the `conditionalVar` example uses `if`, `elseif`, and `else` bodies whose
    values are `bar`, `qux`, and `default`.
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L263-L282
    (source pin checked 2026-08-18)
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7d36475af0537d1e317e0a1cca2229c7eae20097/docs/pipelines/process/template-expressions.md#L263-L289
    (independent source pin checked 2026-08-18)

[C-E03-122] **In sequence position a true `if` splices its body items into the parent sequence in
place; a false one contributes nothing and leaves the surrounding items adjacent.** The true probe
emitted `before`, `taken`, `after`; the false one emitted `before`, `after`.
  — research/experiments/E03-if/{sequence-true,sequence-false}/ (live preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/{sequence-if-wins,sequence-no-match-no-else}.md (live
    preview, checked 2026-08-18)

[C-E03-123] **In mapping position exactly one branch body's keys join the parent mapping, and the
other bodies contribute nothing.** Driving the same three-directive chain into each branch produced
`PICK: from-if`, `from-elseif` and `from-else` respectively, alongside the untouched sibling `BASE`.
  — research/experiments/E03-if/{mapping-chain-if,mapping-chain-elseif,mapping-chain-else}/ (live
    preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/mapping-elseif-wins.md (independent live preview,
    checked 2026-08-18)

[C-E03-124] **The `if`/`elseif`/`else` chain works identically in sequence position**, one sequence
item per directive. With both conditions false the probe emitted only `from-else`.
  — research/experiments/E03-if/sequence-chain-else/ (live preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/sequence-else-wins.md (independent live preview, checked
    2026-08-18)

[C-E03-125] **A chain with no `else` whose conditions are all false contributes nothing at all** —
it is not an error, and the surrounding items stay adjacent (`before`, `after`).
  — research/experiments/E03-if/no-else-all-false/ (live preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/{sequence-no-match-no-else,mapping-no-match-no-else}.md
    (live preview, checked 2026-08-18)

[C-E03-126] **Chains nest, and a losing outer branch discards the entire nested structure.** With
the outer condition true and the inner false, the inner `else` won (`inner-else`); with the outer
false, neither inner branch appeared and the surrounding `before`/`after` were adjacent.
  — research/experiments/E03-if/{nested-chain,nested-chain-outer-false}/ (live preview, checked
    2026-08-19)
  — research/experiments/E03-conditionals/{nested-sequence-chain,nested-mapping-chain}.md
    (independent live preview, checked 2026-08-18)

[C-E03-127] **A second `if` starts a new chain, so a trailing `else` binds to the nearest preceding
`if` rather than to the first one.** `if(true) / else / if(false) / else` emitted `first-if` and
`second-else` — the second `else` was resolved against the second `if`, not the satisfied first.
  — research/experiments/E03-if/two-chains-adjacent/ (live preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/adjacent-independent-if.md (independent live preview,
    checked 2026-08-18)

[C-E03-128] **Chain membership is not adjacency-gated, and the winning body is spliced at the
winning directive's own position — not at the chain head's.** An ordinary sibling written between
`${{ if }}` and `${{ else }}` neither breaks the chain nor moves the output, in **both** parent
shapes. The decisive probe is the false-`if` sequence case: the output order was `interrupt` then
`from-else`, i.e. the intervening step came first and the `else` body landed where the `else` was
written. The mapping case emitted `MIDDLE: middle` alongside `PICK: from-else`. The true-`if`
sequence control emitted `from-if` then `interrupt` with the `else` silently dropped, which
distinguishes "this `else` lost" from "this `else` is an orphan" (C-E03-129 — the orphan is a hard
400). Consequence for the implementation: a chain cannot be grouped forwards from its `if` and
emitted as a unit at the head's index, which is the reading the task's own **Do** field suggests
and which would reorder the first document.
  — research/experiments/E03-if/{interrupted-chain,interrupted-chain-false,mapping-interrupted-chain}/
    (live preview, checked 2026-08-19)
  — research/experiments/E03-conditionals/{interrupted-else-after-true,interrupted-else-sequence,
    interrupted-elseif-sequence,interrupted-else-mapping}.md (live preview, checked 2026-08-18)

[C-E03-129] **An `elseif` or `else` with no preceding `if` in its parent is rejected**, with two
newline-joined sentences and **no help link**: `The expression directive '<keyword>' is not
supported in this context` followed by `Unexpected value '<raw key text>'`. Both carry the host
scalar's `(Line, Col)` prefix, consistent with C-E02-105.
  — research/experiments/E03-if/{orphan-else,orphan-elseif}/ (live preview, HTTP 400
    `PipelineValidationException`, checked 2026-08-19)
  — research/experiments/E03-conditionals/{orphan-else-sequence,orphan-elseif-sequence}.md
    (independent live preview, HTTP 400, checked 2026-08-18)

[C-E03-130] **`else` terminates its chain**: an `elseif` written after the `else` is rejected with
the identical sentence pair as an orphan, i.e. the service does not treat it as a late member.
  — research/experiments/E03-if/elseif-after-else/ (live preview, HTTP 400, checked 2026-08-19)

[C-E03-131] **A primitive condition is not required to already be Boolean.** `${{ if 'text' }}` was
taken and `${{ if '' }}` was not — the same String truthiness the conversion matrix encodes
(C-E02-020). Collection truthiness is separate and measured by C-E03-135 because the documented
conversion matrix defines no Array/Object→Boolean conversion.
  — research/experiments/E03-if/{condition-non-boolean,condition-empty-string}/ (live preview,
    checked 2026-08-19)

[C-E03-132] **Chain conditions are evaluated in document order and evaluation stops at the first
winner.** `if(true) / elseif parameters.missing` expanded, and so did
`if(true) / elseif parameters.missing / else` — resolving the trailing `else` did not reach past
the winner to the raising member in between. This fixes the *order* an implementation may scan a
chain in: a backwards nearest-first scan would evaluate the raising `elseif` and reject a document
the service expands.
  — research/experiments/E03-if/{elseif-not-evaluated,chain-shortcircuit-else}/ (live preview,
    checked 2026-08-19)
  — research/experiments/E03-conditionals/{condition-short-circuit-after-if,
    condition-short-circuit-after-elseif}.md (independent live preview, checked 2026-08-18)

[C-E03-133] **A losing branch's body is never evaluated.** A false `if` whose body read
`${{ parameters.missing }}` expanded to just the preceding step.
  — research/experiments/E03-if/untaken-body-not-evaluated/ (live preview, checked 2026-08-19)

[C-E03-134] **Control for C-E03-132/133.** The same `parameters.missing` read in a position that is
definitely reached is a hard rejection — HTTP 400, `Key not found 'missing'`, matching the
`parameters` miss policy of C-E02-087/088. Without it the two laziness probes would prove nothing,
since an expansion could simply mean the read is harmless.
  — research/experiments/E03-if/ctl-missing-parameter/ (live preview, checked 2026-08-19)

[C-E03-135] **Conditional truthiness spans all expression value kinds.** Null, Boolean false,
Number zero, and empty String are false; nonzero Numbers, nonempty Strings, Version, Array, and
Object are true. Array/Object remain true when empty, so this is not implemented by the primitive
conversion table.
  — research/experiments/E03-conditionals/{condition-truthiness-primitives,
    condition-truthiness-collections,condition-truthiness-empty-collections}.md (live preview,
    checked 2026-08-18)
  — research/E02-expressions.md C-E02-020 (primitive/Version Boolean conversions)

[C-E03-136] **The winning body is structurally inserted according to both parent and body shape.**
A Sequence body in sequence position is flattened; a Mapping body in sequence position becomes one
item; a Mapping body in mapping position has its entries merged. A Sequence body in mapping
position is rejected `Expected a mapping`.
  — research/experiments/E03-conditionals/{sequence-mapping-body,mapping-sequence-body}.md (live
    preview, checked 2026-08-18)

[C-E03-137] **A second `else` is rejected after the first `else` terminates the chain.** In sequence
position the response carries both `The expression directive 'else' is not supported in this
context` and `Unexpected value '${{ else }}'`.
  — research/experiments/E03-conditionals/duplicate-else-sequence.md (live preview, HTTP 400,
    checked 2026-08-18)

**Open question — settled 2026-08-19 by E03-S01-T04, and the answer was the opposite of the
reading T02 shipped.** See C-E03-138/139 below.
(They were probed as C-E03-135/136; the ids were reassigned on the 2026-08-19 rebase onto
`main`, where the reconciled E03-S01-T02 survey had already claimed 135..137.)

[C-E03-138] **A *directive* sibling between two chain members breaks the chain, although an
ordinary sibling does not.** This is the question T02 filed. Placing `${{ insert }}` or
`${{ each }}` between `${{ if }}` and its `${{ else }}` makes the trailing member an **orphan**:
the service answers with C-E03-129's own sentence, `The expression directive 'else' is not
supported in this context`. Measured in both parent shapes (mapping via `variables:`, sequence via
`steps:`), for both intervening directives, and for a trailing `elseif` as well as a trailing
`else` — and with both truth values of the `if`, so it is not an artifact of the branch that won.
Two controls put the rule precisely at *between*: the same `${{ insert }}` placed **before** the
chain head expands (`MID` then `PICK: from-else`), and placed **after** the `else` it also expands
(`PICK: from-else` then `MID`). Contrast C-E03-128, where an ordinary `MIDDLE: middle` key in
exactly that position leaves the chain intact. So a chain survives an ordinary sibling and is
**ended** by any directive that is not `if`/`elseif` — the same treatment `else` already gets under
C-E03-130.
  — research/experiments/E03-insert/{chain-insert-between,chain-insert-between-true,
    chain-each-between,chain-each-between-sequence,chain-elseif-after-insert}/ vs the controls
    {chain-insert-before,chain-insert-after}/ and research/experiments/E03-if/
    if-mapping-interrupted-chain (live preview, checked 2026-08-19)

[C-E03-139] **The orphan rejection's wording is position-dependent, and T02 measured only one of
the two.** In *sequence* position it is the two sentences C-E03-129 recorded: `The expression
directive 'else' is not supported in this context` then `Unexpected value '${{ else }}'`, both
located at the key. In *mapping* position the second sentence is instead `A mapping was not
expected`, located at the branch **body** rather than the key, and a third sentence follows —
`Expected end of template object. State:` plus a dump of the engine's internal reader stack
(`LiteralState` / `MappingState` with `IsStart`/`Index`/`IsKey`/`IsEnd`). The state dump is a
service internal with no user-facing meaning; we reproduce the first two sentences per position and
deliberately not the third (docs/06 §5 decision 33).
  — research/experiments/E03-insert/{orphan-else-mapping,orphan-elseif-mapping}/ vs
    research/experiments/E03-if/{orphan-else,orphan-elseif}/ (live preview, checked 2026-08-19)

---

## E03-S01-T04 — the `insert` merge directive (`C-E03-160..174`)

Evidence: `research/experiments/E03-insert/` — **32 live preview probes** (`pnpm insert-survey`).
13 expanded and are committed as input/`finalYaml` fixture pairs under
`fixtures/oracle/directives/insert-*`; the other **19 were rejected**, and are asserted against
their committed error transcripts instead — for this task the rejections carry most of the claims,
because "error, not overwrite" and "a directive sibling breaks a chain" are both answers the service
gives by refusing a document.

Two notes on the Ground field before the claims:

- **The named source does not exist.** The task says "templates doc *Insertion*". The templates
  page has no such section — its "Insert a template" section is about `- template:` file includes,
  a different mechanism entirely (E03-S02). `${{ insert }}` is documented on
  **template-expressions**, under "Insertion", and that is one paragraph and one example
  (C-E03-160). It answers none of this task's questions.
- **Unlike T02 and T03, the `actions/runner` fork is a real second source here**, because `insert`
  is the one directive it implements (C-E03-115). It was read and pinned, and it predicted the
  collision answer correctly — but it also predicted the *non-key position* answer wrongly
  (C-E03-173), so every branch it suggested was still submitted to the oracle.

### What the sources say

[C-E03-160] **`${{ insert }}` is the documented way to merge a mapping into a mapping**, and it is
documented on the template-expressions page, not the templates page the Ground field names.
"To insert into a mapping (a collection of key-value pairs, similar to a dictionary or object in
YAML), use the special property `${{ insert }}`." The example places it inside a job's `variables:`
alongside two literal keys, fed by an `object` parameter:
`configuration: debug` / `arch: x86` / `${{ insert }}: ${{ parameters.additionalVariables }}`.
The page says nothing about collisions, ordering, non-mapping values, position restrictions, or
more than one insert per mapping.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/template-expressions
    §Insertion (checked 2026-08-19, page `ms.date` 2026-01-12)

[C-E03-161] **Sequence insertion is a different mechanism and is not this directive.** The same
section inserts into a sequence with a bare lone expression — `- ${{ parameters.preBuild }}` — and
states "When you insert an array into an array, you flatten the nested array." That is
lone-expression structural insertion and belongs to E03-S01-T05; `${{ insert }}` itself is
mapping-only (C-E03-173/174).
  — same page, §Insertion (checked 2026-08-19)

[C-E03-162] **The fork implements `insert` as a mapping-key-only, streamed, in-place merge whose
value must be a mapping.** `TemplateUnraveler.StartMappingInsertion` is entered only when the
insert token's parent is a `MappingState` with `IsKey`; it takes the sibling value, uses it
directly if it is a `MappingToken`, evaluates it via `EvaluateMappingToken` if it is an expression,
and otherwise raises `ExpectedMapping()` — "Expected a mapping". A nested mapping with zero entries
skips straight to the expression end, i.e. contributes nothing. Duplicate keys are caught one layer
up in `TemplateEvaluator`, against a `HashSet<String>(StringComparer.OrdinalIgnoreCase)`, raising
`ValueAlreadyDefined` — "'{0}' is already defined" — and skipping the later value. Azure agrees
with all of this (C-E03-163/165/168/169/172) and disagrees about non-key positions (C-E03-173).
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateUnraveler.cs#L434-L466
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateUnraveler.cs#L640-L703
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateEvaluator.cs#L193-L219
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/Resources/TemplateStrings.g.cs#L25-L29
    and #L127-L131 (read 2026-08-19)

### The merge

[C-E03-163] **The merged keys land at the directive's own position, in the source object's
authored order.** `BEFORE` / `${{ insert }}` / `AFTER` around a `{MID_A, MID_B}` object produced
`BEFORE, MID_A, MID_B, AFTER` — not appended at the end. And an object authored `ZETA, ALPHA,
MIDDLE` inserted in exactly that order, so the merge neither sorts nor re-orders, matching the
authored-order rule `each` follows over a mapping (C-E03-145).
  — research/experiments/E03-insert/{position,object-order,doc-canonical}/ (live preview,
    checked 2026-08-19)

[C-E03-164] **The value may be written as a literal mapping, not only as an expression.** Every
example in the docs uses `${{ parameters.x }}`; a directly authored two-key mapping merged
identically.
  — research/experiments/E03-insert/literal-mapping-value/ (live preview, checked 2026-08-19)

[C-E03-165] **An empty object contributes nothing and leaves no trace.** `default: {}` between
`BEFORE` and `AFTER` produced exactly those two keys, adjacent.
  — research/experiments/E03-insert/empty-object/ (live preview, checked 2026-08-19)

[C-E03-166] **The directive works in mappings with well-known schema keys, not only loose ones, and
nested values survive whole.** Inserting `{displayName, continueOnError, workspace: {clean: all}}`
into a **job** mapping produced all three beside the job's own `job:` and `steps:` keys, with the
nested `workspace` mapping intact. It also works in a step's `env:` mapping beside a literal key.
  — research/experiments/E03-insert/{job-mapping,step-env}/ (live preview, checked 2026-08-19)

[C-E03-167] **The source object may be a loop binding rather than a parameter.** Inside
`${{ each group in parameters.groups }}`, `${{ insert }}: ${{ group.vars }}` merged each group's
own variables into that group's stage.
  — research/experiments/E03-insert/inside-each/ (live preview, checked 2026-08-19)

[C-E03-168] **Two `${{ insert }}` keys in one mapping are accepted and both merge**, in document
order. The two keys are byte-identical, so this corroborates C-E03-111 for a second directive: the
service does not apply YAML duplicate-key rules to directive keys. *Our front end still rejects
this at parse time* (C-E01-023 / the gap filed as **E01-S01-T04**), so this probe has a committed
oracle pair but no local golden; the fixture test skips it by name and says why.
  — research/experiments/E03-insert/two-inserts-disjoint/ (live preview, checked 2026-08-19)

### Collision — the behavior the task flagged as unknown

[C-E03-169] **A key collision is a hard error, not an overwrite.** The task's **Do** field asks
"error vs overwrite"; it is **error**. HTTP 400, one sentence, `'FOO' is already defined` — the
fork's `ValueAlreadyDefined` string byte for byte. Neither value wins and no merge happens. Both
orders reject: a literal `FOO` followed by an insert supplying `FOO`, and an insert supplying `FOO`
followed by a literal `FOO`. The error is located at the **later** of the two occurrences — column
18 (the insert's value) in the first case, column 3 (the literal key) in the second — so the rule
is positional and streamed, exactly as C-E03-162 describes, rather than "the explicit key wins".
  — research/experiments/E03-insert/{collision-literal-before,collision-literal-after}/ (live
    preview, checked 2026-08-19)

[C-E03-170] **The collision comparison is case-insensitive, and the message echoes the later key as
it was written.** A literal `FOO` and an inserted `foo` collide, and the message is
`'foo' is already defined` — the inserted spelling, not the one already present. This matches the
fork's `StringComparer.OrdinalIgnoreCase` and is consistent with the case-folding of every other
name in the language (C-E02-011/012, C-E03-107).
  — research/experiments/E03-insert/collision-case/ (live preview, checked 2026-08-19)

[C-E03-171] **The collision rule belongs to the mapping, not to `insert`.** Two `${{ insert }}`
keys whose payloads share `FOO` reject identically, and so does a key produced by
`${{ each pair in … }}` colliding with a literal key — no `insert` involved at all. So the check
must live where a mapping is rebuilt after expansion, not inside the insert visitor, or the same
document would be accepted or rejected depending on which directive produced the duplicate.
  — research/experiments/E03-insert/{two-inserts-collision,collision-from-each}/ (live preview,
    checked 2026-08-19)

### Rejections

[C-E03-172] **A non-mapping value is rejected `Expected a mapping`**, one sentence, for all four
shapes probed: a `string` parameter, an `object` parameter whose default is a sequence, a plain
scalar written literally, and an empty (YAML null) value. The sentence is the fork's
`ExpectedMapping()` byte for byte and carries no help link, like every other directive rejection
(C-E03-129).
  — research/experiments/E03-insert/{value-string,value-array,value-scalar-literal,value-empty}/
    (live preview, checked 2026-08-19)

[C-E03-173] **Outside mapping-key position the keyword is still *recognized* but cannot act, and
its delimited text survives verbatim into schema validation.** As a bare sequence item
(`- ${{ insert }}`) and as a mapping *value* (`KEY: ${{ insert }}`), the service answers with the
single sentence `Unexpected value '${{ insert }}'` — one sentence, no help link, and the raw
`${{ insert }}` text quoted back.

The control that makes this precise is C-E03-151's: a bare *unknown name* in value position is an
ordinary expression failure, `Unrecognized value: 'index'. Located at position 20 within
expression: … For more help, refer to <link>`. `insert` in the same position produces neither that
sentence nor that shape, so it is not being parsed as an expression and failing to resolve — the
keyword is recognized, the directive is simply not permitted there, and the token degrades to its
own literal text. **This refines C-E03-112**, which reads "a directive keyword in value position is
not a directive": for `insert` it *is* still the directive token, it merely has nowhere to go.

Two consequences. Our walker is unaffected — it only ever classifies keys, so it must leave such a
scalar alone. But **E03-S01-T05 must not evaluate a lone `${{ insert }}` as an expression**: doing
so raises `Unrecognized value: 'insert'`, which is the sentence this probe proves the service does
*not* emit. Handed to T05 with the transcript.

Azure also diverges from the fork here: `TemplateUnraveler` would additionally raise
`DirectiveNotAllowed` ("The expression directive 'insert' is not supported in this context") before
falling back to a string token (C-E03-162); Azure emits no such sentence.
  — research/experiments/E03-insert/{bare-sequence-item,value-position}/ vs
    research/experiments/E03-each/implicit-index-name/ (live preview, checked 2026-08-19)

[C-E03-174] **`- ${{ insert }}: <object>` in a sequence is still a mapping-key insertion**, into
the one-key mapping the sequence *item* is — not an insertion into the parent sequence, and not a
rejection. So the sequence-position handler must return **one replacement item** holding the merged
mapping, where `if`/`each` splice their body's items into the parent.

Two probes, and the second exists because the first cannot carry the claim. `sequence-position`
merged `{A: a}` and then failed schema validation on the result, `Unexpected value 'A'` — a
step-schema complaint about the merged key, not about the directive. But its object has **one**
key, so merging and splicing produce the identical document; a test written on it passes under
either implementation, which mutation testing confirmed (swapping the visitor to splice left the
whole suite green). `sequence-position-valid` supplies two keys that together form one valid step,
`{script, displayName}`, and the service returned **one** step carrying both — `task: CmdLine@2`
with `displayName: Merged` and `inputs.script: echo merged`. Splicing would have produced a second
item holding a bare `displayName`, which is not a step.

That desugaring of `script:` into `task: CmdLine@2` is also why this pair is committed but is not a
byte-golden: the E03-S05-T01 normalizer deliberately does not desugar shortcuts (doing so there
would let a broken expander pass `preview-diff`), so the fixture is asserted structurally instead
and the test says which layer owes the rest.
  — research/experiments/E03-insert/{sequence-position,sequence-position-valid}/ (live preview,
    checked 2026-08-19)

---

## E03-S01-T03 — iterative insertion (`C-E03-140..159`)

Offline grounding completed 2026-08-18 against the live Microsoft Learn page. The task's Ground
field calls this the templates doc's "Iterative insertion" section; the section currently lives on
the separate **Template expressions** page. The page settles the public contract below but says
nothing about mapping enumeration order or an automatically available iteration index. Those two
rules, nested expansion, and exact splicing therefore still require the task's eight live preview
fixtures before implementation. The experiment could not run because `AZDO_ORG_URL`,
`AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, and `AZDO_PAT` were all absent and no `.env.oracle`
existed; setup/recovery instructions are in `research/oracle-setup.md`. No service behavior is
inferred from the examples beyond the claims they directly demonstrate.

[C-E03-140] **The `each` directive supports iterative insertion over both YAML sequences and YAML
mappings.**
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — "The `each` directive enables iterative insertion based on a YAML
    sequence (array) or mapping (key-value pairs)."

[C-E03-141] **During mapping iteration, the bound entry exposes its mapping key as `.key` and its
mapping value as `.value`.** The official job-wrapping example iterates `pair in job`, filters on
`pair.key`, and re-emits `${{ pair.key }}: ${{ pair.value }}`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — `${{ each pair in job }}` / `${{ pair.key }}: ${{ pair.value }}`

[C-E03-142] **A `jobList` parameter can be iterated with `each`, with every full job available to
the body for property re-emission and step wrapping.**
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — `type: jobList` / `${{ each job in parameters.jobs }}`

[C-E03-143] **Template files cannot declare `stringList`; Microsoft directs template authors to
use an `object` parameter for that list-shaped input instead.**
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — "The `stringList` data type isn't available in templates. Use the
    `object` data type in templates instead."

[C-E03-144] **Sequence iteration visits every element exactly once in authored order and binds the
element itself, retaining object shape for member access.** The scalar control emitted
`alpha`, `beta`, `gamma`; the object control emitted `first=one`, `second=two`.
  — research/experiments/E03-each/{sequence-scalars,sequence-objects}/ (live preview, checked
    2026-08-18)

[C-E03-145] **Mapping iteration visits entries in authored YAML order, without lexical,
case-folded, or integer-key sorting, and binds an object whose `.key` and `.value` are the entry's
original key and value.** The input order `Zulu`, `alpha`, `Middle` was retained; a separate input
with quoted integer-like keys retained `'10'`, `'2'`, `'01'` exactly, which a plain JavaScript
object would incorrectly reorder to `2`, `10`, `01`.
  — research/experiments/E03-each/{mapping-pair-order,mapping-numeric-key-order}/ (live preview,
    checked 2026-08-18)

[C-E03-146] **An `each` directive in mapping position splices every expanded body mapping into the
parent mapping in iteration order.** `BASE` followed by iterated `FIRST`, `SECOND` became three
variables in that order.
  — research/experiments/E03-each/mapping-body/ (live preview, checked 2026-08-18)

[C-E03-147] **Nested loops retain both bindings and enumerate inner items completely before the
next outer item.** The observed order was `apple-red`, `apple-green`, `lemon-yellow`.
  — research/experiments/E03-each/nested-each/ (live preview, checked 2026-08-18)

[C-E03-148] **`stepList` and `jobList` elements retain their complete mapping/sequence structure
when bound, so a lone loop-variable expression inserts the value structurally.** The stepList
fixture inserted both full task mappings; the jobList fixture wrapped each job with setup and
teardown while a nested loop inserted its original steps.
  — research/experiments/E03-each/{step-list,job-list-wrapping}/ (live preview, checked
    2026-08-18)

[C-E03-149] **Iterating an empty sequence inserts no nodes and preserves the surrounding order.**
The `before` and `after` tasks became adjacent.
  — research/experiments/E03-each/empty-sequence/ (live preview, checked 2026-08-18)

[C-E03-150] **The collection operand is evaluated as one complete expression before iteration.**
`each item in split('a in b', ' in ')` emitted `a` then `b`, corroborating C-E03-104's
tokenization rule with execution rather than recognition alone.
  — research/experiments/E03-each/collection-expression/ (live preview, checked 2026-08-18)

[C-E03-151] **Sequence iteration synthesizes no index.** Accessing `.index` on each scalar element
resolved to Null/empty (`echo alpha:`, `echo beta:`), while a bare `index` named value was rejected
`Unrecognized value: 'index'`; only the declared loop variable enters scope.
  — research/experiments/E03-each/{sequence-item-index,implicit-index-name}/ (live preview,
    checked 2026-08-18)

---

## E03-S01-T05 — scalar interpolation (`C-E03-175..194`)

Evidence: `research/experiments/E03-interpolation/` — **34 live preview probes**
(`pnpm interpolation-survey`), of which 27 expanded and 7 were rejected. The task's **Ground** field
asks for "docs/02 §3 spec + oracle probes for each stringification rule (esp. Boolean casing, float
rendering `0.5`/`1.0`)". Both docs were read first, and they settle less than the task assumes:

- The **expressions** page does give the three conversion rules by name, so `Null → ''` and
  `True`/`False` are documented rather than measured (C-E03-175). Its Number rule, however, is the
  one sentence in the whole table that is *false as written*.
- The **template-expressions** page never states the lone-expression-vs-mixed-content distinction
  that this entire task is about, states structural insertion only for the array-into-array case,
  and never mentions expressions in keys — although its own `each` example is built on
  `${{ pair.key }}: ${{ pair.value }}` (C-E03-176).

Two results changed the implementation rather than confirming it: the boundary between "lone" and
"mixed" is **not whitespace-tolerant** (C-E03-180), which makes T01's `loneExpression` wrong as it
stood; and key position has **two** distinct rejections rather than one (C-E03-191), which is what
proves keys run through the same split as values instead of having a rule of their own.

[C-E03-175] **The three stringification rules this task names are documented, and one of them is
wrong.** The conversion table gives Boolean → `'False'`/`'True'` and Null → `''` (the empty string)
verbatim, so the casing question the task flags is answered by the doc — but only for *values*
(C-E03-190 is the key half). The Number row reads "To string: Converts the number to a string with
no thousands separator and no decimal separator", which cannot be right: taken literally `0.5`
would render `05`. Measured, the separator that is absent is the *thousands* one only; the decimal
point is kept whenever the value has a fraction (C-E03-182).
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions (checked 2026-08-19) —
    "### Boolean … To string: `False` → `'False'`, `True` → `'True'`"; "### Null … To string: `''`
    (the empty string)"; "### Number … To string: Converts the number to a string with no thousands
    separator and no decimal separator"; "### Version … To string: Major.Minor or
    Major.Minor.Build or Major.Minor.Build.Revision."

[C-E03-176] **Neither doc states the rule this task implements.** The template-expressions page's
Insertion section shows a lone `${{ parameters.preBuild }}` sequence item and says only "When you
insert an array into an array, you flatten the nested array" — one sentence, the array case, and
nothing about a mapping value, about mixed content, or about what makes a scalar "lone". Expressions
in keys appear only implicitly, inside the `each` example (`${{ pair.key }}: ${{ pair.value }}`),
with no statement that the result is stringified or how. docs/02 §3 already carried the intended
rules; this task's job was to check them, and two were wrong (C-E03-180, C-E03-183).
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions (checked
    2026-08-19) — §Insertion, §Iterative insertion

[C-E03-177] **A mapping value that is exactly one expression returning an Object is inserted
structurally.** `env: ${{ parameters.envVars }}` with a two-key object default produced
`env:` with both keys as a real mapping, not a stringified one — the mapping case the doc never
states.
  — research/experiments/E03-interpolation/lone-object-value/ (live preview, checked 2026-08-19)

[C-E03-178] **In sequence position an Array splices and an Object becomes one item.** A `stepList`
parameter as `- ${{ parameters.preBuild }}` contributed its two steps as siblings of the literal
step (the doc's own example, and its flattening sentence), and `dependsOn: ${{ parameters.deps }}`
produced a two-element list. An *Object* in the same position produced exactly one step, keys
intact — so the two collection kinds behave differently and "flatten" is specifically the array
rule.
  — research/experiments/E03-interpolation/{lone-array-sequence-item,lone-array-flatten,
    lone-object-sequence-item}/ (live preview, checked 2026-08-19)

[C-E03-179] **The inserted structure is kept whole and typed at every depth.** An object carrying a
nested mapping (`workspace.clean`), an empty sequence (`dependsOn: []`) and a scalar merged into a
job with all three shapes preserved; nothing was flattened or stringified at any level.
  — research/experiments/E03-interpolation/lone-object-nested/ (live preview, checked 2026-08-19)

[C-E03-180] **"Exactly one expression" is a property of the raw scalar text and is *not*
whitespace-tolerant — but it is independent of YAML style.** Two probes separate the two
possibilities that T01 conflated:

- `env: "${{ parameters.envVars }}"` — double-quoted, no padding — **still inserts structurally**,
  so quoting alone does not demote a lone expression to mixed content.
- `env: '  ${{ parameters.envVars }}  '` — the same expression with two spaces either side —
  **rejects** `Unable to convert from Object to String. Value: Object`, i.e. it was compiled to
  `format('  {0}  ', …)` and the Object had to be stringified.
- The positive control settles the direction: `PROBE: "  ${{ 'x' }}  "` yields `'  x  '`. The spaces
  are *kept*, so the service is not trimming and then failing to re-add them — it never trimmed.

**Consequence for T01:** `loneExpression` began with `text.trim()`, which classifies the second
probe as lone and would have expanded a document the service rejects. The trim is removed. It was
invisible until now because YAML strips plain scalars itself, so only a *quoted* host scalar can
carry the padding into the engine — which is exactly what this probe had to be written as.
  — research/experiments/E03-interpolation/{lone-object-value-quoted,whitespace-around-lone-object,
    whitespace-around-lone-string}/ (live preview, checked 2026-08-19)

[C-E03-181] **A lone Boolean renders `True`/`False`**, from a typed `boolean` parameter and from the
literals alike — the documented casing, surviving into the emitted document rather than being
lower-cased by the YAML writer. The committed `insert-job-mapping` pair shows the same conversion
happening to a job's `continueOnError: true` once it passes through the engine.
  — research/experiments/E03-interpolation/lone-boolean/ (live preview, checked 2026-08-19)

[C-E03-182] **Number rendering is shortest-round-trip invariant, not the doc's sentence.** All four
measured shapes, in lone position and again inside mixed content: `0.5` → `0.5`, `1.0` → **`1`**
(the trailing zero is dropped, so the value is a double and not the authored text), `1000000` →
`1000000` (no grouping, which is the part of the doc's sentence that holds), `-1.25` → `-1.25`.
JavaScript's `String(number)` reproduces all four, which is why the implementation reuses
`convertValue(v, 'string')` rather than formatting numbers itself. Exponent-range values are **not**
measured and are a known divergence risk (`1e21` is `1e+21` in JS and `1E+21` in .NET).
  — research/experiments/E03-interpolation/{lone-number,mixed-number}/ (live preview, checked
    2026-08-19)

[C-E03-183] **Null renders as the empty string even in lone position, and is indistinguishable from
`${{ '' }}` in the output.** `PROBE: ${{ variables.nosuchvariable }}` and `PROBE: ${{ '' }}` both
came back as `PROBE: ''`, with the key present in both cases. **This is the finding that fixes the
lone-position value model:** a lone expression does not simply hand its typed result to the emitter,
or Null would have produced an empty/absent value rather than a String. Every scalar kind is
converted to its String form; only Object and Array stay structural.
  — research/experiments/E03-interpolation/{lone-null,lone-empty-string}/ (live preview, checked
    2026-08-19)

[C-E03-184] **A Version renders dotted, in lone and mixed position, for three and four segments** —
`${{ 1.2.3 }}` → `1.2.3`, `v${{ 1.2.3.4 }}` → `v1.2.3.4`, matching the documented Major.Minor.Build
.Revision rule and confirming the literal is a Version rather than a String that happens to contain
dots.
  — research/experiments/E03-interpolation/{lone-version,mixed-version}/ (live preview, checked
    2026-08-19)

[C-E03-185] **The result is not re-parsed as YAML, and the service's own `finalYaml` is lossy about
it.** `PROBE: "${{ 'a: b' }}"` came back as `PROBE: 'a: b'` — one scalar, quoted by the emitter,
not a nested mapping. But `${{ '0123' }}` came back as `PROBE: 0123`, **unquoted**: the value is
still the String `0123` inside the service (its own reader treats every scalar as text, which is
what makes `finalYaml` a fixpoint, C-E03-001), yet as *text* that document no longer says so. Our
front end types scalars (`0123` parses to the Number 123, C-E01-020's premise notwithstanding), so
`normalizeExpandedYaml` reads the service's side as `123` and ours as `0123` and reports drift that
does not exist. Recorded as C-E03-193 and handed to E03-S05-T03; the `interp-lone-string-numeric`
pair is therefore asserted against its raw `finalYaml` rather than through the normalizer.
  The unquoted spelling is not confined to this case — the emitter also wrote `HALF: '0.5'` quoted
  while writing `NEGATIVE: -1.25` bare in the same mapping, so its quoting is not a signal about the
  value's kind and must not be read as one.
  — research/experiments/E03-interpolation/{lone-string-yamlish-quoted,lone-string-numeric,
    lone-number}/ (live preview, checked 2026-08-19). The unquoted spelling
    `PROBE: ${{ 'a: b' }}` is *not* valid YAML at all — the `: ` ends the key — and its transcript
    (`lone-string-yamlish/`) records that rejection, which never reaches the template engine.

[C-E03-186] **Mixed content stringifies every hole and concatenates, literal text verbatim.**
`pre-${{ true }}-post` → `pre-True-post`; `pre-${{ false }}-post` → `pre-False-post`;
`pre-${{ variables.nosuchvariable }}-post` → `pre--post` (the two literals end up touching);
`${{ 'a' }} then ${{ 'b' }}` → `a then b`. **Adjacency is not loneness:**
`${{ 'a' }}${{ 'b' }}` → `ab`, two holes with an empty literal between them, which is the case a
"starts with `${{` and ends with `}}`" test gets wrong. This is `format`'s stringification, not a
second one — C-E02-109 measured the service compiling exactly these scalars into a synthetic
`format('<literal with {0} holes>', …)` and parsing *that*.
  — research/experiments/E03-interpolation/{mixed-boolean,mixed-null,mixed-two-expressions}/ (live
    preview, checked 2026-08-19)

[C-E03-187] **An Object or Array in mixed content is a hard rejection:** `Unable to convert from
Object to String. Value: Object` / `Unable to convert from Array to String. Value: Array` — file
coordinates only, **no** "Located at position N within expression" and **no** help link, unlike
every parse error in the E02 corpus. Two properties matter for the implementation: the sentence
names the *kind* twice rather than rendering the value, and the failed hole becomes the **empty
string** and evaluation continues — the whitespace probe returned this sentence *and* a second one,
`Unexpected value ''`, which is the schema then rejecting `env: ''`. So this is an accumulated
diagnostic with a substitution, not a throw. E02's `ExprConversionError` composes the same sentence
without the ` Value: <Kind>` suffix, so T05 appends it rather than reusing the message.
  — research/experiments/E03-interpolation/{mixed-object,mixed-array,whitespace-around-lone-object}/
    (live preview, checked 2026-08-19)

[C-E03-188] **The documented `${{` escape works and its result is not re-scanned.**
`${{ 'my${{value' }}` → `my${{value` and `${{ 'my${{value with a '' single quote too' }}` →
`my${{value with a ' single quote too`. Both are lone expressions whose *result* contains the
opening delimiter, so a second interpolation pass over the output would loop or fail; there is
exactly one pass. This is C-E03-117's quote-aware delimiter scan proven by execution rather than by
recognition.
  — research/experiments/E03-interpolation/{escape-literal,escape-literal-quote}/ (live preview,
    checked 2026-08-19)

[C-E03-189] **A block scalar interpolates as one scalar and keeps its content.** `script: |` with
three lines and an expression on the middle one came back with the parameter substituted and the
line structure intact — re-emitted in folded (`>`) style with blank-line separators, which is the
same string. Consistent with C-E02-109, where the synthetic `format` literal for a block scalar
carried real newlines.
  — research/experiments/E03-interpolation/block-scalar-expression/ (live preview, checked
    2026-08-19)

[C-E03-190] **Expressions in keys stringify, and the Boolean casing is `True`.** In a loose mapping
(`env:`): `${{ true }}:` → `True:`; `${{ 1.0 }}:` → `1:`; `${{ 0.5 }}:` → `'0.5':`;
`${{ variables.nosuchvariable }}:` → `'':` — an **empty key**, which the schema accepts there; and
mixed key content concatenates, `PRE_${{ parameters.suffix }}:` → `PRE_TAIL:`. This closes the
docs/02 §8 ambiguity list's "Boolean stringification casing in keys" entry: the answer is the same
`True`/`False` as values, so keys need no separate casing rule — but they *do* need a separate value
model, because a key is always the String form while a value may stay structural (C-E03-177).
  — research/experiments/E03-interpolation/{key-boolean,key-number,key-null,key-mixed,key-string}/
    (live preview, checked 2026-08-19)

[C-E03-191] **Key position has two distinct rejections, and the pair proves keys run through the
same lone/mixed split as values.** A **lone** Object key rejects `Expected a scalar value` — one
sentence, no help link, located at the key. The *same* object in **mixed** key content
(`PRE_${{ parameters.obj }}:`) rejects `Unable to convert from Object to String. Value: Object`
instead, i.e. C-E03-187's sentence. A single "keys must be scalars" rule cannot produce two
different sentences for two spellings of the same failure; a shared lone/mixed split with a
key-specific structural check does.
  — research/experiments/E03-interpolation/{key-object,key-mixed-object}/ (live preview, checked
    2026-08-19)

[C-E03-192] **The rendered key text is confirmed independently at the schema layer.** `${{ true }}:`
written into a *job* — a mapping with a known schema, where an unrecognized key is fatal — rejects
`Unexpected value 'True'`. The casing is therefore visible in the service's own error text and does
not depend on how `env:`'s loose mapping or the YAML emitter chose to render it.
  — research/experiments/E03-interpolation/key-boolean-nonloose/ (live preview, checked 2026-08-19)

[C-E03-193] **`normalizeExpandedYaml` compares scalar leaves *after* typing them, which is one layer
too late.** Rule N7 is "scalar leaves compared as strings", but it stringifies the values the YAML
parser already produced, so the service's `PROBE: 0123` becomes `"123"` while our
`PROBE: "0123"` stays `"0123"` — two spellings of one value reported as drift. The service's reader
has no such step, which is why its `finalYaml` round-trips (C-E03-001). The fix is to compare a
scalar's **source text**, and it belongs to the normalizer, not here: added as **E03-S05-T03**. Until
then the one affected fixture is asserted against its raw `finalYaml`.
  — research/experiments/E03-interpolation/lone-string-numeric/ + `packages/engine/src/normalize/
    normalize.ts` `plain()` (checked 2026-08-19)

[C-E03-194] **A lone directive keyword in *value* position is left as literal text and never
evaluated.** Inherited from C-E03-173 rather than re-measured: `KEY: ${{ insert }}` survives verbatim
into schema validation as `Unexpected value '${{ insert }}'` with no expression error, so an
interpolator that evaluates every lone expression would emit `Unrecognized value: 'insert'` — the one
sentence that probe proves the service does *not* emit. The rule is implemented by classifying the
lone text with `parseDirectiveKey` first and returning the node untouched when a keyword is
recognized. It applies to the lone case only, which is all C-E03-173 measured.
  — research/experiments/E03-insert/{value-position,bare-sequence-item}/ (live preview, checked
    2026-08-19 against the T04 transcripts)
