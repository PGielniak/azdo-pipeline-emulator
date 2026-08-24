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
| `C-E03-120..139` | E03-S01-T02 conditional insertion chains | this file | 120–139 used — recorded 2026-08-23 from the two committed surveys (`research/experiments/E03-conditionals/` 24 probes, `research/experiments/E03-if/` 22 probes) |
| `C-E03-140..159` | E03-S01-T03 iterative insertion (`each`) | this file | **not free — owed.** 13 transcripts in `research/experiments/E03-each/` cite these IDs; no entry written (E03-S01-T06) |
| `C-E03-160..174` | E03-S01-T04 `${{ insert }}` merge | this file | **not free — owed.** 32 transcripts in `research/experiments/E03-insert/`; no entry written (E03-S01-T06) |
| `C-E03-175..194` | E03-S01-T05 scalar interpolation | this file | **not free — owed.** 34 transcripts in `research/experiments/E03-interpolation/`; no entry written (E03-S01-T06) |
| `C-E03-195..229` | E03-S02 template resolution & parameters | this file | **204 used; 195..203 and 205..215 owed** — `packages/engine/src/template/reference.ts` and its test **cite** those IDs, and 34 transcripts sit in `research/experiments/E03-references/`, but no entry is written, so a reader following a citation finds nothing (E03-S01-T06). E03-S06's shipped code consumes several of them. |
| `C-E03-230..249` | E03-S03 compile-time variable visibility | this file | free |
| `C-E03-250..279` | E03-S04 limits, emitter, strict validation | this file | free |
| `C-E03-280..299` | E03-S05-T02 `preview-diff` | this file | free |
| `C-E03-300..339` | E03-S02-T02 typed parameter binding | this file | **effectively taken** — the 2026-08-20 lane cited this block in `research/experiments/E03-parameters/` READMEs and never consolidated it here (`grep -c 'C-E03-3'` = 0). Do not reallocate; that task reclaims it. |
| `C-E03-400..429` | **E03-S06 local bundler** | this file | 400–407 used (S06-T01), 408–413 (S06-T02), 414–418 (S06-T03), 419–420 (S06-T04) |
| `C-E03-430..449` | E03-S07 bundle provenance & diagnostics | this file | free |

Leave gaps. A branch that numbers from what it can see collides silently with every sibling.

**Reconciliation note (2026-08-23, E03-S01-T06).** Four blocks above are marked *owed* rather than
*free*. The pattern behind them is worth stating once: on this epic the oracle probes were run, the
transcripts committed, the code written against them and the claim IDs cited in comments and test
names — and then the claim entries themselves were never added to this file. That leaves citations
pointing at nothing, which is worse than an unstarted block, because the code *looks* grounded.
Recording those entries is the remaining work on E03-S01-T02..T05 and E03-S02-T01; the transcripts
they must be written from are already here, so it is transcription, not new measurement, and no
oracle budget is needed.

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

Grounding pass started 2026-08-18 and completed 2026-08-23. The official documentation resolves the
public syntax and the two supported parent shapes (C-E03-120/121), but not chain grouping/adjacency,
nested-chain behavior, or what happens to an `elseif`/`else` without a preceding winning `if`. Those
were the task's mandatory oracle-fixture questions, answered by **two live-preview surveys whose
transcripts are already committed**: 24 probes in `research/experiments/E03-conditionals/` (checked
2026-08-18) and 22 in `research/experiments/E03-if/` (checked 2026-08-19), with 37 successful pairs
promoted to `fixtures/oracle/directives/` and the rejections asserted against their transcripts.
`packages/engine/src/template/conditionals.ts` and its suite were written against these probes and
cite these IDs; this block records them so the citations resolve. The two questions E03-S01-T02
could not answer on its own — a *directive* sibling between two chain members (C-E03-138), and the
mapping-position orphan's second sentence (C-E03-139) — were settled by E03-S01-T04's `insert`
survey and are recorded here because they live in this task's block.

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

[C-E03-122] **In a sequence, a conditional chain contributes exactly one body — the body of the
first `if`/`elseif` whose condition is true, or of `else` when every condition is false — spliced
into the parent sequence at the directive's position.**
  — `research/experiments/E03-conditionals/sequence-if-wins.md`, `sequence-elseif-wins.md`,
    `sequence-else-wins.md` (live preview, checked 2026-08-18) — `sequence-if-wins` request
    `- ${{ if eq(1, 1) }}:` / `- ${{ elseif eq(2, 2) }}:` / `- ${{ else }}:`; response contains only
    `script: echo selected-if` between the ordinary `before`/`after` steps, the `elseif` and `else`
    bodies absent.

[C-E03-123] **In a mapping, only the winning branch's entries are merged into the containing mapping
at the directive's position, between ordinary sibling keys — and a conditional in mapping position
requires a mapping body, a sequence body there being rejected "Expected a mapping".**
  — `research/experiments/E03-conditionals/mapping-elseif-wins.md`,
    `mapping-sequence-body.md` (checked 2026-08-18) — an `env:` with `BEFORE`, an
    `if`/`elseif`/`else` chain each setting `PICKED`, and `AFTER` expands to `BEFORE`,
    `PICKED: elseif`, `ELSEIF_ONLY: yes`, `AFTER` — the two unselected branches' keys absent; while
    `${{ if eq(1, 1) }}:` whose body is `- A` (a sequence) returns
    `"/azure-pipelines.yml (Line: 5, Col: 5): Expected a mapping"`.

[C-E03-124] **`else` is selected only when every preceding `if`/`elseif` condition evaluated false;
a true earlier condition suppresses it.**
  — `research/experiments/E03-conditionals/sequence-else-wins.md`, `sequence-if-wins.md` (checked
    2026-08-18) — `- ${{ if eq(1, 2) }}` / `- ${{ elseif eq(2, 3) }}` / `- ${{ else }}:` expands to
    `script: echo selected-else` alone.

[C-E03-125] **A chain whose conditions all evaluate false and which has no `else` contributes
nothing, and ordinary siblings keep their authored order.**
  — `research/experiments/E03-conditionals/sequence-no-match-no-else.md`,
    `mapping-no-match-no-else.md` (checked 2026-08-18) — `- script: echo before` / two false
    directives / `- script: echo after` expands to `echo before`, `echo after` with no trace of the
    directive bodies.

[C-E03-126] **A selected body is expanded recursively: a nested chain inside it gets its own
independent state and is selected on its own terms.**
  — `research/experiments/E03-conditionals/nested-sequence-chain.md`, `nested-mapping-chain.md`
    (checked 2026-08-18) — an outer `if eq(1, 1)` whose body contains a full `if/elseif/else` chain
    expands to the outer `echo outer-before`, the nested `echo nested-selected-elseif`, and the outer
    `echo outer-after`, the nested `else` not selected.

[C-E03-127] **A new `if` begins a fresh chain regardless of proximity to a prior unmatched `if`; the
following `else` belongs to the newest `if`.**
  — `research/experiments/E03-conditionals/adjacent-independent-if.md` (checked 2026-08-18) —
    `if eq(1, 2)` (false) immediately followed by `if eq(2, 2)` (true) then `else`: the response
    contains `echo second-selected` and no `else` body, so the `else` paired with the second `if`.

[C-E03-128] **Chain membership is stateful over the whole containing sequence/mapping, not
adjacency-based: an ordinary sibling does not end a chain, and the winning body is emitted at its own
directive's position, not at the chain head.**
  — `research/experiments/E03-conditionals/interrupted-else-sequence.md`,
    `interrupted-elseif-sequence.md`, `interrupted-else-after-true.md`,
    `interrupted-else-mapping.md` (checked 2026-08-18) — `- ${{ if eq(1, 2) }}` /
    `- script: echo interruption` / `- ${{ else }}` expands to `echo interruption` then `echo orphan`,
    the `else` still bound to the earlier `if` and its body landing where the `else` was written.

[C-E03-129] **An `elseif` or `else` with no live preceding `if` (an orphan) is rejected, in a
sequence, as "The expression directive '<kw>' is not supported in this context" followed by
"Unexpected value '<raw>'".**
  — `research/experiments/E03-conditionals/orphan-else-sequence.md`, `orphan-elseif-sequence.md`
    (checked 2026-08-18) — response `"/azure-pipelines.yml (Line: 2, Col: 3): The expression
    directive 'else' is not supported in this context\n… Unexpected value '${{ else }}'"`,
    `typeKey: PipelineValidationException`.

[C-E03-130] **A clause written after an `else` has already closed the chain is rejected identically
to an orphan — an `elseif` following `else` fails even though its own condition is valid.**
  — `research/experiments/E03-if/elseif-after-else/response.json` (live preview, checked
    2026-08-19) — `else` then `elseif parameters.b` returns "The expression directive 'elseif' is
    not supported in this context … Unexpected value '${{ elseif parameters.b }}'".

[C-E03-131] **A condition uses expression truthiness for primitives: nonempty String, nonzero
Number, and Boolean true are true; empty String, zero, and Null are false.**
  — `research/experiments/E03-conditionals/condition-truthiness-primitives.md` (checked 2026-08-18) —
    `${{ if 'text' }}` and `${{ if 1 }}` select their body; `${{ if '' }}`, `${{ if 0 }}`, and
    `${{ if variables.absent }}` fall through to their `else`.

[C-E03-132] **Conditions evaluate in document order and stop at the first winner: after a branch is
selected, later `elseif` conditions are not evaluated at all.**
  — `research/experiments/E03-conditionals/condition-short-circuit-after-if.md`,
    `condition-short-circuit-after-elseif.md` (checked 2026-08-18) — a true `if` followed by
    `elseif lt(1, 'not-a-number')` expands HTTP 200, i.e. the raising later condition was never
    reached (control: the same `lt(1, 'not-a-number')` reached as the *first* condition is a hard 400
    — C-E03-134).

[C-E03-133] **An unselected branch's body is never evaluated: a false `if` whose body reads a missing
parameter still expands.**
  — `research/experiments/E03-if/untaken-body-not-evaluated/` (live preview, checked 2026-08-19) —
    `${{ if parameters.a }}` with `a` false and body `script: echo ${{ parameters.missing }}` returns
    HTTP 200, where a *reached* `parameters.missing` read is a hard 400 (C-E03-134).

[C-E03-134] **A condition that is actually evaluated and reads a missing value is a hard 400, not a
false-y fallback — which is what makes C-E03-132/133's laziness observable.**
  — `research/experiments/E03-if/ctl-missing-parameter/response.json` (checked 2026-08-19) —
    `${{ if parameters.missing }}` returns `"/azure-pipelines.yml (Line: 13, Col: 9): Key not found
    'missing'"`, `typeKey: PipelineValidationException`.

[C-E03-135] **Array and Object results are truthy in a condition even when empty; collection
truthiness does not depend on count.**
  — `research/experiments/E03-conditionals/condition-truthiness-collections.md`,
    `condition-truthiness-empty-collections.md` (checked 2026-08-18) — `${{ if split('a,b', ',') }}`
    and `${{ if parameters.items }}` (where `items: []`) both select their body.

[C-E03-136] **In sequence position, a selected mapping body is inserted as one item, while a sequence
body is flattened into the parent sequence.**
  — `research/experiments/E03-conditionals/sequence-mapping-body.md` (checked 2026-08-18) —
    `- ${{ if eq(1, 1) }}:\n    script: echo wrong-shape` (a mapping body, no list) expands to one
    `CmdLine@2` step.

[C-E03-137] **Only one `else` may terminate a chain; a second `else` is rejected as orphaned.**
  — `research/experiments/E03-conditionals/duplicate-else-sequence.md` (checked 2026-08-18) —
    `if false` / `else` / `else` returns "The expression directive 'else' is not supported in this
    context … Unexpected value '${{ else }}'" located at the second `else`.

[C-E03-138] **A *directive* sibling (`${{ each }}` or `${{ insert }}`) written between two chain
members ends the chain: the member that follows is orphaned, even though an ordinary sibling does not
(C-E03-128).**
  — `research/experiments/E03-insert/chain-insert-between/`, `chain-each-between/`,
    `chain-elseif-after-insert/` (live preview, checked 2026-08-19) — `if parameters.a` /
    `${{ insert }}: ${{ parameters.extra }}` / `${{ else }}` returns "The expression directive 'else'
    is not supported in this context" — with controls `chain-insert-before`/`chain-insert-after` (an
    insert written *outside* the chain) expanding successfully.

[C-E03-139] **The orphan rejection's second sentence depends on the parent shape: in a sequence the
service echoes the raw key ("Unexpected value '…'"), while in a mapping it reports "A mapping was not
expected" located at the branch body — followed by a third sentence dumping the engine's internal
reader stack, which is deliberately not reproduced (docs/06 §5 decision 33).**
  — `research/experiments/E03-insert/orphan-elseif-mapping/`, `orphan-else-mapping/` (live preview,
    checked 2026-08-19) vs `orphan-elseif-sequence.md` (2026-08-18) — mapping form:
    `"/azure-pipelines.yml (Line: 7, Col: 3): The expression directive 'elseif' is not supported in
    this context\n… (Line: 8, Col: 5): A mapping was not expected\n… Expected end of template object.
    State: …"`.


---

## E03-S02-T05 — path lookup is case-sensitive (`C-E03-204`)

Evidence: `research/experiments/E03-references/case-mismatch/` — one live preview probe, captured by
E03-S02-T01's reference survey and replayed by `packages/engine/test/template/reference.test.ts`.
**No new probe was run for this task**: the service's answer was already on file and is decisive.

Bookkeeping note: `C-E03-204` is cited in `packages/engine/src/template/reference.ts` since
E03-S02-T01, but that task's claim block (`C-E03-195..229`) was never written into this file — the
code is ahead of its evidence record. This entry writes **only** the claim this task implements
against; the remaining IDs stay E03-S02-T01's to record, and the table above now says so instead of
reading `free` while the numbers are in use.

[C-E03-204] **A template path is matched against the repository tree case-sensitively: a reference
whose spelling differs only in case is rejected, not resolved.** The probe references
`/E03-REFS/LEAF.YML` in a repository whose tree spells the file `/e03-refs/leaf.yml`. The service
answers HTTP 400 `PipelineValidationException` and names the path it looked for in the uppercase
spelling — i.e. it neither folded the case nor fell back to the file that exists. Git trees are
case-sensitive and the service reads the tree, so this is the behavior a local resolver has to
reproduce **regardless of the host filesystem's own comparison rules**.
  — `research/experiments/E03-references/case-mismatch/probe.yml` + `response.json`
    (live probe, checked 2026-08-22) — request `- template: /E03-REFS/LEAF.YML`; response
    `"/azure-pipelines.yml: File /E03-REFS/LEAF.YML not found in repository … branch refs/heads/main
    version da8a304…"`, `typeKey: PipelineValidationException`.
  — Consequence recorded here because it is what the implementation turns on: reading the path with
    `readFileSync` delegates the comparison to the **host**, so a case-insensitive filesystem
    (macOS APFS, Windows) resolves what the service rejects. `localFetcher` therefore walks the
    path one segment at a time and requires a byte-identical `readdirSync` entry (E03-S02-T05).

---

## E03-S06-T01 — where a `template:` reference may appear (`C-E03-400..407`)

Evidence: the templates doc page (fetched 2026-08-23, page `ms.date: 2026-06-17`, source commit
`be5c6557603d2e61bafaa70ec0d4e4ec1351d058` of `MicrosoftDocs/azure-devops-docs-pr`
`docs/pipelines/process/templates.md`) and the **vendored service schema**
`packages/engine/vendor/schema/service-schema.json`.

Two source tiers are used here and they are labelled per claim, because decision 8 (docs/06 §5)
established that the vendored schema is **not** self-sufficient and that the docs outrank it. Claims
marked *(schema-derived)* are not doc-grounded and are not measured against the live service; where
that matters, the claim says which task owns the probe. This task detects reference **positions**
only — the reference *string* semantics (path math, alias resolution, case rules) are E03-S02-T01's
`C-E03-195..215`, already implemented in `packages/engine/src/template/reference.ts`, and are reused
rather than re-grounded.

[C-E03-400] **A `template:` reference appears in exactly two syntactic shapes: the mapping value
`extends.template`, and a sequence item whose mapping carries a `template` key.** The doc shows the
sequence form under four container keys — `stages`, `jobs`, `steps` and `variables` —
— https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates — "`extends:` / `  template: start-extends-template.yml`",
"`stages:` / `- template: templates/insert-stage1.yml # Template reference`",
"`jobs:` / `- template: templates/insert-jobs.yml  # Template reference`",
"`steps:` / `- template: templates/insert-npm-steps.yml  # Template reference`",
"`variables:` / `- template: insert-vars.yml  # Template reference`" — checked 2026-08-23.

[C-E03-401] **A `variables:` template may only define variables**, unlike the other container
forms — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates — "If you're
using a template to include variables in a pipeline, the included template can only be used to
define variables. You can use steps and more complex logic when you're extending from a template."
— checked 2026-08-23. The same page shows the form at **stage** level as well as global
(`stages:` / `- stage: Release_Stage` / `  variables: # Stage variables` / `  - template: package-release-with-params.yml`),
so the container key is not confined to the document root. Consequence for detection: the rule keys
off the **container key name at any depth**, never off a fixed root-level path.

[C-E03-402] **The `@` suffix names a `resources.repositories` entry, and `@self` names the
repository the pipeline itself was found in.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates — "When you refer to
the core repo, use `@` and the name you gave it in `resources`." and "You can also use `@self` to
refer to the repository where the original pipeline was found. This is convenient for use in
`extends` templates if you want to refer back to contents in the extending pipeline's repository."
— checked 2026-08-23. Worked example: "`- template: BuildJobs.yml@self`". The split itself, the
empty-alias case (`a.yml@` lands on self) and the alias's case-folding are already grounded as
C-E03-210/212/213 and implemented by `parseReference`/`isSelfAlias`; this claim records only that
`self` is a *documented* alias and not an invention of ours.

[C-E03-403] **Template expansion is bounded by three published limits**, which the bundler's
recursion must respect rather than discover —
https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates — "No more than 100
separate YAML files may be included (directly or indirectly)", "No more than 100 levels of template
nesting (templates including other templates)", "No more than 20 megabytes of memory consumed while
parsing the YAML" — checked 2026-08-23. Recorded here for **E03-S06-T02** (recursive inliner): a
bundle that exceeds these is rejected by the service after we send it, so the inliner should stop
first with our own diagnostic.

[C-E03-404] **A template file must exist in the repository at run start; it cannot come from an
artifact** — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates —
"Template files need to exist on your filesystem at the start of a pipeline run. You can't reference
templates in an artifact." — checked 2026-08-23. This is the doc sentence that makes the bundler
sound: inlining a *working-tree* file into the `yamlOverride` is the only way an uncommitted edit
can reach the expansion, because the service reads templates from the committed tree.

[C-E03-405] *(schema-derived)* **There are five sequence-item template branches, not four: the doc's
`stage`, `job`, `step` and `variable`, plus the deprecated `phase`.** Each branch is exactly
`{template, parameters}` with `additionalProperties: false` and `firstProperty: ["template"]` —
`packages/engine/vendor/schema/service-schema.json`, definitions `stage`/`job`/`step`/`variable`/`phase`
— e.g. `"phase"`: `{"type":"object","properties":{"template":{"$ref":"#/definitions/nonEmptyString"},"parameters":{"$ref":"#/definitions/mapping"}},"additionalProperties":false,"firstProperty":["template"]}`
— checked 2026-08-23. `phases:` is absent from the doc page entirely (the schema marks the container
`"deprecationMessage": "This option is deprecated, use `jobs` instead"`). Detection includes it —
missing a real reference silently is the failure this story exists to prevent — but **no live probe
has confirmed a `phases: - template:` reference**, and that probe belongs to E03-S06-T02's
`research/experiments/E03-bundle/`. Also schema-derived and used by the detector: every container
key name equals its definition name (`stages`/`jobs`/`phases`/`steps`/`variables`), verified by
walking every `$ref` to those definitions in the vendored document — so a key-name rule covers the
nested occurrences (a job's `steps`, a deployment strategy's `steps`) by construction.

[C-E03-406] *(schema-derived)* **`extends` is `{template, parameters}` with
`additionalProperties: false` and, unlike the sequence forms, no `firstProperty`** —
`packages/engine/vendor/schema/service-schema.json`, definition `extends`:
`{"type":"object","properties":{"template":{...},"parameters":{...}},"additionalProperties":false}`
— checked 2026-08-23. So `extends` is matched as a mapping *property*, and the sequence-item rule
does not apply to it.

[C-E03-407] *(mirror decision, not measured)* **Detection matches the `template` key
case-sensitively and by presence, not by first position.** Neither the schema's `template` property
nor its containers carry `ignoreCase`, and `ignoresKeyCase` (`packages/engine/src/frontend/validate.ts`)
reads that keyword off the property's own schema, so the walk folds no case — the same rule the
validator applies. Ordering is deliberately *not* required even though `firstProperty` names
`template` as the discriminator: `checkFirstProperty` enforces presence as an error and ordering only
as a **warning**, because "the service's own tolerance is not yet oracle-verified"
(`research/E01-yaml-frontend.md`'s open question Q1, docs/06 §5 decision 8). A detector
stricter than the validator would silently skip a reference the service accepts, so it matches the
looser of the two. If Q1 resolves to "the service errors on order", this claim is unaffected —
detection would still be correct, merely permissive.

---

## E03-S06-T02 — is a mechanical splice equivalent to the committed form? (`C-E03-408..413`)

Evidence: `research/experiments/E03-bundle/` — **12 live preview probes** (`pnpm bundle-survey`), six
shapes each submitted twice: `<shape>-committed` references the file in the repository,
`<shape>-inlined` carries the bytes a mechanical splice produces. Every probe is declared `either`;
the equivalence question is exactly what they ask. Verdicts are on the **normalized** expansion
(`normalizeExpandedYaml`, E03-S05-T01), so formatting is never read as divergence — see
`comparison.md` in that directory.

The question exists because docs/02 §5.1 specifies the bundler as "a mechanical inliner, not an
expander — it never evaluates `${{ }}`, never resolves a directive, and never binds a parameter",
and does not say whether that is *equivalent*. It is not, and the boundary is not where the
specification implies.

[C-E03-408] **A parameterless include splices soundly: the inlined override expands to a
normalized-identical document.** `research/experiments/E03-bundle/plain-{committed,inlined}/` — both
HTTP 200, normalized expansions equal — checked 2026-08-23. This is the base case the whole bundler
rests on, and it is the one shape the task's Ground field asked for.

[C-E03-409] **Recursion adds nothing: nested includes are the plain case applied twice.** A root →
mid → leaf chain, all parameterless, inlines to a normalized-identical expansion
(`research/experiments/E03-bundle/nested-{committed,inlined}/`, both HTTP 200) — checked 2026-08-23.
Note what makes this hold: once both files are inlined **no reference is left to rebase**, so the
`yamlOverride`-stands-at-`/azure-pipelines.yml` rule (C-E12-011) and the
reference-relative-to-its-own-file rule (C-E12-012) never come into conflict. A reference the
bundler *cannot* inline is a different matter — it stays in the override and is then resolved from
the root's directory rather than its original file's, which is why a skipped reference inside a
non-root file is unsound to leave in place unless it is repository-absolute.

[C-E03-410] **The trigger is *reading* a parameter, not *declaring* one.** A template that declares
`parameters:` with a default and never reads it inlines to a normalized-identical expansion
(`declared-unused-{committed,inlined}`, both HTTP 200) — checked 2026-08-23. This widens the sound
subset materially: the guard is "does this file contain a `${{ parameters.* }}` reference", not
"does it have a `parameters:` block".

[C-E03-411] **Splicing a template that reads its own parameters is rejected — loudly — when the
parent does not declare the name.** Both the defaults-only and the value-passing shapes return
**HTTP 400 `PipelineValidationException`**: `"/azure-pipelines.yml (Line: 2, Col: 11): Key not found
'greeting'"` (`defaults-inlined/`, `passed-inlined/`), against HTTP 200 for the committed halves —
checked 2026-08-23. The mechanism is decision 19(c)'s: the `parameters` context raises `Key not
found 'x'` on a miss where `variables` would return Null. The template's `parameters:` declaration
block is not legal inside a `steps:` list, so a splice necessarily drops it and the reference
resolves against the **parent's** table.

[C-E03-412] **When the parent *does* declare the same name, the same splice is silently wrong.**
`shadowed-{committed,inlined}` — **both HTTP 200**, normalized expansions **divergent**: the
committed form expands the leaf's own default (`script: echo leaf-default`), the inlined form
expands the root's (`script: echo root-value`) — checked 2026-08-23. This is the claim the guard
must be built on. C-E03-411's failure is loud and the service catches it; this one is not, and it
produces a pipeline that converts, runs, and does the wrong thing. Together they mean the inliner
cannot rely on the service to police the parameter case and must refuse it itself.

[C-E03-413] **Therefore: a template is mechanically inlinable iff its content reads no
`${{ parameters.* }}`.** Derived from C-E03-408..412 rather than measured separately. The
consequence for the product is worth stating plainly rather than leaving in the code: a
*parameterized* template — the common shape in real pipelines, and the whole point of `extends` —
cannot be bundled by a mechanical inliner at all. Making the user's local edits to those files
visible needs the parameter values substituted at the splice, which is **binding**, which is the
service's job under PLAN D3. That is a real scope boundary of the simplification, not an oversight
of this task; see E03-S06-T05 and docs/06 §5 decision 54.

---

## E03-S06-T03 — what `templateParameters` in the request actually does (`C-E03-414..418`)

Evidence: `research/experiments/E03-parameters-request/` — **8 live preview probes**
(`pnpm template-parameters-survey`). C-E00-018 records the field's *existence* from the REST
reference and nothing about its behavior; every rule below is measured, and every probe is declared
asking rather than asserting.

[C-E03-414] **A value supplied in `templateParameters` overrides the root pipeline's declared
default.** `declared-overridden/` expands `${{ parameters.greeting }}` to `from-request` against the
declared `default: from-default`; the control `declared-not-supplied/` expands it to `from-default`
— both HTTP 200 — checked 2026-08-23. This is the premise of threading the field at all, and the
reason the expansion cache key had to grow to cover it.

[C-E03-415] **A name the pipeline does not declare is rejected: HTTP 400
`PipelineValidationException`, `"Unexpected parameter 'nosuchparameter'"`** (`undeclared-name/`) —
checked 2026-08-23. The field is not a free-form bag; the service validates it against the root
`parameters:` block, so a client must not invent or pass through names speculatively.

[C-E03-416] **Values are coerced to the declared type, and the wire type is looser than
`Record<string, string>`.** A `type: number` parameter given the **string** `'42'` expands to `42`
(`number-typed/`), and given the raw JSON number `42` also expands to `42` (`number-typed-raw/`) —
both HTTP 200 — checked 2026-08-23. So the client's `Record<string, string>` typing, taken from the
REST doc, is narrower than the service requires; that is harmless and is kept, because the string
form is accepted for every scalar type.

[C-E03-417] **A structured value must be sent as serialized JSON, not as a raw JSON object.** An
`object`-typed parameter given `{"key": "value"}` as a raw object is refused with HTTP 400
**`ArgumentNullException`** — `"Value cannot be null.\nParameter name: runParameters"`
(`object-typed-raw/`) — while the same object sent as the *string* `'{"key":"value"}'` expands, and
`convertToJson(parameters.config)` renders it as a real object (`object-typed-string/`, HTTP 200) —
checked 2026-08-23. Two things worth noting: the rejection is a server-side **argument fault**, not
a pipeline-validation message, so it carries no line/col and no remediation; and this is what makes
the CLI's `--parameter name=@file.json` (C-E13-009/010) reachable at all — its parsed structure is
serialized on the way out.

[C-E03-418] **`templateParameters` binds only the *root* pipeline's parameters; it can never reach a
template's.** A root with no `parameters:` that includes a committed template declaring `greeting`,
sent with `templateParameters: {greeting: …}`, is rejected `"Unexpected parameter 'greeting'"`
(`template-scoped/`, HTTP 400) — checked 2026-08-23. **This closes option (c) of E03-S06-T05 by
measurement**: there is no request shape that lets the service bind a *template's* parameters while
we supply local bytes for that template, so a parameterized local template cannot be bundled that
way. It also corrects this task's own **Do**, which reads "pass `templateParameters` (and
`parameters:` at the `extends` boundary) through to the expansion call … as the `templateParameters`
request field": reference-level and `extends`-level `parameters:` are written **in the YAML** and
are bound there by the service. Nothing carries them in the request, and nothing needs to —
E03-S06-T02's `passed-committed` transcript shows a `- template:` + `parameters:` expanding to the
supplied value with no client plumbing at all.

---

## E03-S06-T04 — cross-repo references (`C-E03-419..420`)

Evidence: reused rather than re-probed. E03-S02-T01's survey already measured the cross-repo cases
(`research/experiments/E03-references/cross-*`, `alias-*`), and the templates doc supplies the
sentence that explains *why* the bundler cannot help here. Per BACKLOG §3, this task grounds only
its own mechanic — what the diagnostic is allowed to assert — not reference resolution, which is
`C-E03-195..215`.

[C-E03-419] **A cross-repo reference in a `yamlOverride` resolves and expands: HTTP 200.**
`research/experiments/E03-references/cross-alias-rel/` (a relative path with `@alias`, read from the
second repository) and its siblings `cross-alias-abs`, `cross-bare-inside`, `cross-abs-inside`,
`cross-back-to-self` — all expanded — checked 2026-08-23 (probes recorded 2026-08-20). So an
un-inlined `@other` reference is **not** a broken conversion: the expansion is correct, it is simply
read from the *committed* state of that repository. That fixes the severity of this task's
diagnostic at **warning** rather than error, and rules out "stops" from its Done criterion's
either/or — stopping would refuse a pipeline the service expands fine.

[C-E03-420] **What the user loses is documented, and it is exactly one thing: their uncommitted
edits to the other repository.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/process/templates — "Repositories are
resolved only once, when the pipeline starts up. After that, the same resource is used during the
pipeline run. Only the template files are used." — checked 2026-08-23. Combined with C-E03-404
(template files must exist in the repository at run start; they cannot come from an artifact) and
C-E12-011 (the request carries exactly one document, the root override), this closes the question
the bundler faces: there is **no** request shape that carries a second repository's bytes, so
`@other` cannot be inlined by any mechanism available on the default path. The remedy is fetching
and pinning that repository, which is **E09**'s, and the diagnostic says so rather than implying the
bundler will grow the ability.
