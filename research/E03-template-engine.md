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
| `C-E03-120..139` | E03-S01-T02 conditional insertion chains | this file | 120–121 used |
| `C-E03-140..159` | E03-S01-T03 iterative insertion (`each`) | this file | free |
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

Grounding pass started 2026-08-18. The official documentation resolves the public syntax and the
two supported parent shapes, but it does not specify chain grouping/adjacency, nested-chain
behavior, or what happens to an `elseif`/`else` without a preceding winning `if`. Those are the
task's mandatory oracle-fixture questions. The local checkout has none of `AZDO_ORG_URL`,
`AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, or `AZDO_PAT`, and no `.env.oracle`; consequently no
oracle result is claimed here and implementation remains blocked rather than inferred.

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
