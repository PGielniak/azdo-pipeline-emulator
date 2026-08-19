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
| `C-E03-120..139` | E03-S01-T02 conditional insertion chains | this file | 120–134 used |
| `C-E03-140..159` | E03-S01-T03 iterative insertion (`each`) | this file | 140–151 used |
| `C-E03-160..174` | E03-S01-T04 `${{ insert }}` merge | this file | free |
| `C-E03-175..194` | E03-S01-T05 scalar interpolation | this file | free |
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

Doc grounding 2026-08-18, oracle matrix 2026-08-19. The official documentation resolves the public
syntax and the two supported parent shapes and **nothing else** — not chain grouping, not nesting,
not the orphan cases, not condition typing, not evaluation order. All of that is C-E03-122..133,
measured by 22 live preview probes under `research/experiments/E03-if/` (`pnpm if-survey
[probe-name]`): 18 are committed as input/`finalYaml` pairs under `fixtures/oracle/directives/if-*`
and 4 are rejections with no golden.

Probes whose outcome could not be predicted from the docs are declared `expected: 'either'` in the
survey script rather than given a guessed expectation; its header says why. Two findings changed
the implementation — C-E03-128 (grouping is *not* adjacency-gated, and the winner splices at its
**own** position) and C-E03-132 (chain conditions evaluate in document order and stop at the
winner) — and each is mutation-checked in `packages/engine/test/template/conditional.test.ts`.

[C-E03-120] **Conditional insertion is supported in both a sequence and a mapping, and an `if`
directive may also be used outside a template when written with template syntax.** The official
page separately gives a `steps` sequence example and an `env` mapping example, so both parent
shapes are part of the documented contract.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#conditional-insertion
    (checked 2026-08-18) — "If you want to conditionally insert into a sequence or a mapping in a
    template, use insertions and expression evaluation."
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L180-L238
    (source pin checked 2026-08-18)

[C-E03-121] **The documented mapping form permits adjacent `if`, `elseif`, and `else` directive
keys, with each selected body contributing ordinary keys to the containing mapping.** Microsoft's
example puts the three directives under one variable entry and gives each body a `value` key. The
page does not define malformed/orphan-chain behavior; that remains an oracle question.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#conditional-insertion
    (checked 2026-08-18) — the `conditionalVar` example uses `if`, `elseif`, and `else` bodies whose
    values are `bar`, `qux`, and `default`.
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L263-L282
    (source pin checked 2026-08-18)

[C-E03-122] **In sequence position a true `if` splices its body items into the parent sequence in
place; a false one contributes nothing and leaves the surrounding items adjacent.** The true probe
emitted `before`, `taken`, `after`; the false one emitted `before`, `after`.
  — research/experiments/E03-if/{sequence-true,sequence-false}/ (live preview, checked 2026-08-19)

[C-E03-123] **In mapping position exactly one branch body's keys join the parent mapping, and the
other bodies contribute nothing.** Driving the same three-directive chain into each branch produced
`PICK: from-if`, `from-elseif` and `from-else` respectively, alongside the untouched sibling `BASE`.
  — research/experiments/E03-if/{mapping-chain-if,mapping-chain-elseif,mapping-chain-else}/ (live
    preview, checked 2026-08-19)

[C-E03-124] **The `if`/`elseif`/`else` chain works identically in sequence position**, one sequence
item per directive. With both conditions false the probe emitted only `from-else`.
  — research/experiments/E03-if/sequence-chain-else/ (live preview, checked 2026-08-19)

[C-E03-125] **A chain with no `else` whose conditions are all false contributes nothing at all** —
it is not an error, and the surrounding items stay adjacent (`before`, `after`).
  — research/experiments/E03-if/no-else-all-false/ (live preview, checked 2026-08-19)

[C-E03-126] **Chains nest, and a losing outer branch discards the entire nested structure.** With
the outer condition true and the inner false, the inner `else` won (`inner-else`); with the outer
false, neither inner branch appeared and the surrounding `before`/`after` were adjacent.
  — research/experiments/E03-if/{nested-chain,nested-chain-outer-false}/ (live preview, checked
    2026-08-19)

[C-E03-127] **A second `if` starts a new chain, so a trailing `else` binds to the nearest preceding
`if` rather than to the first one.** `if(true) / else / if(false) / else` emitted `first-if` and
`second-else` — the second `else` was resolved against the second `if`, not the satisfied first.
  — research/experiments/E03-if/two-chains-adjacent/ (live preview, checked 2026-08-19)

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

[C-E03-129] **An `elseif` or `else` with no preceding `if` in its parent is rejected**, with two
newline-joined sentences and **no help link**: `The expression directive '<keyword>' is not
supported in this context` followed by `Unexpected value '<raw key text>'`. Both carry the host
scalar's `(Line, Col)` prefix, consistent with C-E02-105.
  — research/experiments/E03-if/{orphan-else,orphan-elseif}/ (live preview, HTTP 400
    `PipelineValidationException`, checked 2026-08-19)

[C-E03-130] **`else` terminates its chain**: an `elseif` written after the `else` is rejected with
the identical sentence pair as an orphan, i.e. the service does not treat it as a late member.
  — research/experiments/E03-if/elseif-after-else/ (live preview, HTTP 400, checked 2026-08-19)

[C-E03-131] **The condition is converted to Boolean rather than required to be one.**
`${{ if 'text' }}` was taken and `${{ if '' }}` was not — the same String→Boolean rule the
conversion matrix already encodes (C-E02-020), not a separate truthiness notion.
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

[C-E03-133] **A losing branch's body is never evaluated.** A false `if` whose body read
`${{ parameters.missing }}` expanded to just the preceding step.
  — research/experiments/E03-if/untaken-body-not-evaluated/ (live preview, checked 2026-08-19)

[C-E03-134] **Control for C-E03-132/133.** The same `parameters.missing` read in a position that is
definitely reached is a hard rejection — HTTP 400, `Key not found 'missing'`, matching the
`parameters` miss policy of C-E02-087/088. Without it the two laziness probes would prove nothing,
since an expansion could simply mean the read is harmless.
  — research/experiments/E03-if/ctl-missing-parameter/ (live preview, checked 2026-08-19)

**Open question, deliberately not claimed.** No probe placed an `each` or `insert` directive between
two members of a chain, so whether *those* siblings break a chain is unmeasured.
`packages/engine/src/template/conditional.ts` skips them, which is the reading consistent with
C-E03-128, and says so at the point where it does. E03-S01-T04 should settle it while it holds the
`insert` oracle budget.

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
