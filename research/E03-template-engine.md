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
| `C-E03-140..159` | E03-S01-T03 iterative insertion (`each`) | this file | 140–151 used — recorded 2026-08-24 from the 12 committed probes (`research/experiments/E03-each/`, 11 pairs + 1 rejection); 152..159 free |
| `C-E03-160..174` | E03-S01-T04 `${{ insert }}` merge | this file | 160–174 used — recorded 2026-08-24 from the 32 committed probes (`research/experiments/E03-insert/`, 13 pairs + 19 rejections) |
| `C-E03-175..194` | E03-S01-T05 scalar interpolation | this file | 175–194 used — recorded 2026-08-25 from the 34 committed probes (`research/experiments/E03-interpolation/`, 27 pairs + 7 rejections), plus `E03-insert/value-position/` for 194 |
| `C-E03-195..229` | E03-S02 template resolution & parameters | this file | 195–218 used — recorded 2026-08-25 from the 34 committed probes (`research/experiments/E03-references/`, 21 pairs + 13 rejections, two-repository fixture at `fixtures/oracle/references/repos/`); `C-E03-204` was recorded earlier by E03-S02-T05. 219..229 free — E03-S02-T02 (typed parameter binding) has its own block at 300. |
| `C-E03-230..249` | E03-S03 compile-time variable visibility | this file | free |
| `C-E03-250..279` | E03-S04 limits, emitter, strict validation | this file | 250–253 used (E03-S04-T02) and 254–258 used (E03-S04-T03, three live mutation probes), both recorded 2026-08-25; 259–279 free |
| `C-E03-280..299` | E03-S05-T02 `preview-diff` | this file | free |
| `C-E03-300..339` | E03-S02-T02 typed parameter binding | this file | 300–333 used — recorded 2026-08-25 from the 88 committed probes (`research/experiments/E03-parameters/`, 42 pairs + 46 rejections); 334–339 free |
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

*Progress: the drift is closed.* `C-E03-120..139` (T02) and `C-E03-140..151` (T03) were recorded
2026-08-23/24, `C-E03-160..174` (T04) on 2026-08-24, and `C-E03-175..194` (T05) and
`C-E03-195..218` (E03-S02-T01) on 2026-08-25. No block on this epic now has code citing entries
that do not exist. The one number set still outstanding is `C-E03-300..339`, which the 2026-08-20
parameter lane cited from `research/experiments/E03-parameters/` READMEs and never consolidated
here — E03-S02-T02 reclaims it.

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

## E03-S01-T03 — iterative insertion (`each`) (`C-E03-140..151`)

Evidence: `research/experiments/E03-each/` — **12 live preview probes** (`pnpm each-survey`,
2026-08-18), with 11 successful input/`finalYaml` pairs promoted to
`fixtures/oracle/directives/each-*.{input,final}.yml` and the one rejection kept in place because a
rejected preview has no `finalYaml`. The task's **Ground** field asks for the templates doc plus
≥ 8 oracle fixtures including each-over-mapping key order and each wrapping full jobs; both are
answered here, and the ordering result (C-E03-145) is the "record observed ordering as a claim" the
**Done** field names. `packages/engine/src/template/each.ts` and its suite were written against
these probes and cite these IDs; this block records them so the citations resolve. The four doc
claims (140..143) are what the "Iterative insertion" section actually states; the eight probe
claims (144..151) are the behaviors the section leaves unsaid and the service settles.

[C-E03-140] **The `each` directive iterates a YAML sequence (array) or a mapping (key-value pairs),
inserting the expanded body once per element.** The doc states both container kinds verbatim and
names no third; the rejection of any other collection is the engine's to define (C-E03-144..151).
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — "The `each` directive enables iterative insertion based on a YAML
    sequence (array) or mapping (key-value pairs)."
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L292-L294
    (source pin checked 2026-08-24)

[C-E03-141] **Mapping iteration exposes the key/value pair as `pair.key` and `pair.value`, and
that is the doc's own idiom for re-emitting a job's properties.** The `job.yml` example iterates
`${{ each pair in job }}` and reconstructs every property except `steps` with
`${{ pair.key }}: ${{ pair.value }}`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — the `job.yml` example: `- ${{ each pair in job }}:  # Insert all
    properties other than "steps"` … `${{ if ne(pair.key, 'steps') }}:  ${{ pair.key }}: ${{ pair.value }}`
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L306-L309
    (source pin checked 2026-08-24)

[C-E03-142] **A `jobList` is iterated as full jobs, and the doc's canonical use is wrapping each
job's steps with pre- and post-steps.** The `steps:` block is written *around* `- ${{ job.steps }}`
so the user's steps land between the wrapper's own, which is exactly the `job-list-wrapping` probe
shape (C-E03-148).
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — "For example, you can wrap the steps of each job with other pre- and
    post-steps:"
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L296-L315
    (source pin checked 2026-08-24)

[C-E03-143] **`stringList` is documented for iterating a list-of-items parameter, but the doc's own
note says it is not available in templates and to use `object` instead** — which is why the probe
fixtures, and the engine's collection handling, exercise the `object` type for template inputs.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#iterative-insertion
    (checked 2026-08-18) — "The `stringList` data type isn't available in templates. Use the
    `object` data type in templates instead."
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L331-L334
    (source pin checked 2026-08-24)

[C-E03-144] **Sequence iteration binds the element itself, once, in source order: a scalar element
yields the scalar, an object element keeps its object shape and member access.**
  — `research/experiments/E03-each/sequence-scalars/`, `sequence-objects/` (live preview, checked
    2026-08-18) — `[alpha, beta, gamma]` expands to `echo alpha`, `echo beta`, `echo gamma`; the
    object sequence expands `${{ item.name }}=${{ item.value }}` to `echo first=one`,
    `echo second=two`.

[C-E03-145] **Mapping iteration preserves authored key order, including integer-like keys that a
JavaScript object would reorder.** `'10': ten`, `'2': two`, `'01': leading` expands to `10=ten`,
`2=two`, `01=leading` exactly as authored — and mixed-case keys (`Zulu`, `alpha`, `Middle`) stay in
their authored order too. The engine carries explicit order metadata for this (`value.ts`,
`objectEntries`), because a plain JS object would sort the integer-like keys.
  — `research/experiments/E03-each/mapping-pair-order/`, `mapping-numeric-key-order/` (live preview,
    checked 2026-08-18)

[C-E03-146] **In mapping position, each walked body is spliced into the parent mapping rather than
nested: the body's entries become sibling entries of the containing mapping, one body's worth per
iteration.**
  — `research/experiments/E03-each/mapping-body/` (live preview, checked 2026-08-18) —
    `variables: {BASE: base, ${{ each pair in parameters.entries }}: {${{ pair.key }}: ${{ pair.value }}}}`
    expands to the list `BASE`, `FIRST`, `SECOND` — three flat entries, not a nested mapping.

[C-E03-147] **Nested `each` expands outer-major / inner-minor with both loop variables in scope.**
  — `research/experiments/E03-each/nested-each/` (live preview, checked 2026-08-18) — an outer
    `each fruit` over two fruits each carrying a `colors` list expands to `echo apple-red`,
    `echo apple-green`, `echo lemon-yellow`, the outer body walked once per fruit and the inner body
    once per color.

[C-E03-148] **`stepList` and `jobList` parameters iterate like any sequence: a bound step is
inserted structurally, and a `jobList` iterated as full jobs wraps every job body.**
  — `research/experiments/E03-each/step-list/`, `job-list-wrapping/` (live preview, checked
    2026-08-18) — `- ${{ each step in parameters.injected }}: - ${{ step }}` splices the two
    authored steps in place; `- ${{ each job in parameters.buildJobs }}:` with a
    `steps: [setup, - ${{ each step in job.steps }}: - ${{ step }}, teardown]` body expands each
    job's own steps between `setup` and `teardown`.

[C-E03-149] **An empty collection runs the body zero times, and surrounding items keep their
authored order.**
  — `research/experiments/E03-each/empty-sequence/` (live preview, checked 2026-08-18) —
    `default: []` with `before`/`after` steps expands to `echo before`, `echo after` with no trace
    of the body.

[C-E03-150] **The collection operand is a full expression; the separator `in` inside string
literals is not a split point.**
  — `research/experiments/E03-each/collection-expression/` (live preview, checked 2026-08-18) —
    `${{ each item in split('a in b', ' in ') }}` iterates `a` and `b`, the ` in ` inside both
    literals ignored — the same token-split rule C-E03-104 measured at the walker level.

[C-E03-151] **No implicit index: a sequence element receives no synthesized `.index` member, and a
bare `index` in the body is an unknown name, not a loop value.**
  — `research/experiments/E03-each/sequence-item-index/`, `implicit-index-name/` (live preview,
    checked 2026-08-18) — `${{ item.index }}` renders empty (`echo alpha:`, `echo beta:`), and a
    bare `${{ index }}` is rejected `"/azure-pipelines.yml (Line: 13, Col: 21): Unrecognized value:
    'index'. Located at position 20 within expression: 'format('echo {0}', index)'"` — so only the
    declared binding enters the frame.


---

## E03-S01-T04 — `${{ insert }}` merge (`C-E03-160..174`)

Evidence: `research/experiments/E03-insert/` — **32 live preview probes** (`pnpm insert-survey`,
2026-08-19), with **13** successful input/`finalYaml` pairs promoted to
`fixtures/oracle/directives/insert-*.{input,final}.yml` and the 19 rejections kept in place because a
rejected preview has no `finalYaml`. `packages/engine/src/template/insert.ts` and its suite were
written against these probes and cite these IDs; this block records them so the citations resolve.
The **Ground** field names the "templates doc 'Insertion'", and the first finding is that the
section is on the **template-expressions** page, not the templates page (C-E03-160); the
`actions/runner` fork, uniquely among this epic's directives, *does* implement `insert` and is a
usable reference (C-E03-162). The task's **Do** asks "error vs overwrite" for collisions and the
answer is **error** (C-E03-169); the collision case the **Done** field asks to record is
C-E03-169/170. The two chain questions this task inherited from E03-S01-T02 (C-E03-138/139) were
recorded in that task's block and are cited from here rather than re-recorded.

[C-E03-160] **The "Insertion" section is on the template-expressions page, not the templates page
the Ground field names.** It documents two distinct forms: inserting an array into a sequence with a
bare expression (`- ${{ parameters.preBuild }}`), which "flatten[s] the nested array", and inserting
a key-value collection into a mapping with the special property `${{ insert }}`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#insertion
    (checked 2026-08-24) — "When you insert an array into an array, you flatten the nested array."
    … "To insert into a mapping (a collection of key-value pairs, similar to a dictionary or object
    in YAML), use the special property `${{ insert }}`."
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L150-L152
    (source pin checked 2026-08-24)

[C-E03-161] **The documented mapping form is `${{ insert }}: ${{ parameters.x }}` with the
parameter declared `type: object`, and the doc shows only that expression-value spelling** — never a
literal mapping value, a sequence position, or a non-mapping value. Those shapes are therefore
probe questions (C-E03-164/172/174), not doc-grounded facts.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions#insertion
    (checked 2026-08-24) — the `additionalVariables` example declares `type: object`,
    `default: {}`, and inserts it with `${{ insert }}: ${{ parameters.additionalVariables }}` under
    `variables:`.
  — https://github.com/MicrosoftDocs/azure-devops-docs/blob/7ba9a9ac7d28a7edbbddf0d9bfd480bce665b55b/docs/pipelines/process/template-expressions.md#L154-L166
    (source pin checked 2026-08-24)

[C-E03-162] **The `actions/runner` fork implements `insert` and its handling matches the service on
every shape this task measured.** `TemplateUnraveler.cs` treats an insert in mapping-key position via
`StartMappingInsertion()` (L447): the value is accepted as a literal `MappingToken` directly (L664),
or evaluated to a mapping when it is an expression (`EvaluateMappingToken`, L675), or else rejected
`ExpectedMapping()` ("Expected a mapping", L685) — and an empty result moves straight to the
expression end, contributing nothing. An insert in any other position is rejected
`DirectiveNotAllowed()` (L462), the "not supported in this context" sentence. This is the one
directive the fork and the service agree on, which makes it usable here where it is useless for
`if`/`each` (C-E03-115).
  — https://github.com/actions/runner/blob/34ef7f24/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateUnraveler.cs#L447-L462
    and #L640-L685; TemplateConstants.cs#L21 — checked 2026-08-24.

[C-E03-163] **The merged entries land at the directive's own position, and the source object's
authored order survives unsorted.** A `variables:` mapping with `BEFORE`, the insert, then `AFTER`
expands to `BEFORE`, the inserted keys, `AFTER` — the keys are not appended to the end — and a source
authored `ZETA, ALPHA, MIDDLE` stays in that order, not lexical.
  — `research/experiments/E03-insert/position/`, `object-order/` (live preview, checked 2026-08-19)
    — `position` expands `BEFORE, MID_A, MID_B, AFTER`; `object-order` expands
    `BASE, ZETA, ALPHA, MIDDLE`.

[C-E03-164] **The value may be a literal mapping rather than an expression.** `${{ insert }}:`
followed by a `LIT_A`/`LIT_B` mapping merges both entries at the directive's position — the doc
shows only the expression form (C-E03-161), so this is a measured fact, not a doc one.
  — `research/experiments/E03-insert/literal-mapping-value/` (live preview, checked 2026-08-19) —
    expands `BEFORE, LIT_A, LIT_B, AFTER`.

[C-E03-165] **An empty object contributes nothing.** `default: {}` with `BEFORE`/`AFTER` around the
directive expands to `BEFORE`, `AFTER` with no trace of the directive — zero entries is legal and
leaves the document exactly as if the key were absent.
  — `research/experiments/E03-insert/empty-object/` (live preview, checked 2026-08-19)

[C-E03-166] **`insert` composes with the other directives.** Nested inside a winning `${{ if }}`
body it merges into that body's mapping (not the outer one), and fed by an `${{ each }}` loop
binding it merges once per iteration with the loop variable in scope.
  — `research/experiments/E03-insert/nested-in-if-body/`, `inside-each/` (live preview, checked
    2026-08-19) — `nested-in-if-body` expands `BASE, PICK, MID` (the insert's `MID` landing inside
    the `if` body); `inside-each` expands two stages, each with its own `G` variable from
    `group.vars`.

[C-E03-167] **`insert` works in well-known schema mappings, not only loose ones.** A job mapping
accepts `displayName`/`continueOnError`/`workspace` — note `continueOnError: true` is rendered
`True` in the expansion — and a step `env:` mapping, the deepest loose mapping the schema has,
accepts it the same way.
  — `research/experiments/E03-insert/job-mapping/`, `step-env/` (live preview, checked 2026-08-19)

[C-E03-168] **Two byte-identical `${{ insert }}` keys in one mapping both merge, in document order.**
`${{ insert }}: ${{ parameters.first }}` then `${{ insert }}: ${{ parameters.second }}` expands
`ONE` before `TWO` — the duplicate-key exemption of C-E03-111 applies to a second directive, and the
merge is sequential, not "last directive wins".
  — `research/experiments/E03-insert/two-inserts-disjoint/` (live preview, checked 2026-08-19)

[C-E03-169] **A key collision is a hard error, not an overwrite.** A literal key then an inserted
duplicate (or inserted then literal, or two inserts colliding) is rejected `'<key>' is already
defined`, reported at the **later** occurrence, and neither value wins — the later entry is dropped.
  — `research/experiments/E03-insert/collision-literal-before/`, `collision-literal-after/`,
    `two-inserts-collision/` (live preview, checked 2026-08-19) — `collision-literal-before` returns
    `"/azure-pipelines.yml (Line: 8, Col: 18): 'FOO' is already defined"`, located at the insert
    expression (the later occurrence); `collision-literal-after` reports at the later literal.

[C-E03-170] **The collision comparison folds case and the message echoes the later spelling.**
Literal `FOO` then inserted `foo` is rejected `'foo' is already defined` — the *inserted* (later)
spelling, not the key already present. An implementation that echoed the pre-existing key would say
`FOO` and pass a case-sensitive test while failing this one.
  — `research/experiments/E03-insert/collision-case/` (live preview, checked 2026-08-19)

[C-E03-171] **The collision rule is the mapping's, not `insert`'s.** A key produced by `${{ each }}`
colliding with a literal rejects identically — `'FOO' is already defined` — with no `insert` anywhere
in the document. So the check lives where a mapping is rebuilt (`walk.ts`), not in the insert
visitor: putting it here would accept or reject the same document depending on which directive
happened to produce the duplicate.
  — `research/experiments/E03-insert/collision-from-each/` (live preview, checked 2026-08-19)

[C-E03-172] **The value must resolve to a mapping.** A `string` parameter, a `type: object` whose
default is a sequence, a plain scalar, and an empty (YAML-null) value all reject with the same bare
sentence `Expected a mapping` — no help link, unlike expression rejections, and no per-shape wording.
  — `research/experiments/E03-insert/{value-string,value-array,value-scalar-literal,value-empty}/`
    (live preview, checked 2026-08-19) — each returns
    `"/azure-pipelines.yml (Line: N, Col: 18): Expected a mapping"`.

[C-E03-173] **A directive is recognized only in mapping-key position.** As a bare sequence item
(`- ${{ insert }}`) or in value position (`KEY: ${{ insert }}`) the text is not evaluated at all —
it survives verbatim and reaches schema validation, which rejects
`Unexpected value '${{ insert }}'`, *not* the `Unrecognized value: 'insert'` an expression
evaluation would produce. The control — a bare unknown name as an ordinary value — is
`Unrecognized value: 'index'` (C-E03-151), so the two families are distinguishable.
  — `research/experiments/E03-insert/{bare-sequence-item,value-position}/` (live preview, checked
    2026-08-19)

[C-E03-174] **In sequence position the directive is still a mapping-key insertion — into the
one-key mapping the item is — not a splice into the parent sequence.** `- ${{ insert }}:
<object>` returns **one** merged item: with a single key that is not a valid step key the merged
mapping is rejected by the step schema (`Unexpected value 'A'`), and with two keys that together
form a valid step it produces exactly one step carrying both. This is why the visitor returns one
replacement item rather than `if`/`each`'s spliced list.
  — `research/experiments/E03-insert/sequence-position/`, `sequence-position-valid/` (live preview,
    checked 2026-08-19) — `sequence-position` returns `"/azure-pipelines.yml (Line: 11, Col: 24):
    Unexpected value 'A'"`; `sequence-position-valid` expands to one `task: CmdLine@2` with
    `displayName: Merged` and `script: echo merged`.

---

## E03-S01-T05 — scalar interpolation (`C-E03-175..194`)

Evidence: `research/experiments/E03-interpolation/` — **34** live preview probes (27 expanded pairs,
7 rejections), captured by the 2026-08-23 interpolation survey and replayed as goldens by
`packages/engine/test/template/interpolate.test.ts`. Two docs pages carry the rest: the expressions
page's type-casting table and the template-expressions page's single structural sentence.

Bookkeeping note: `packages/engine/src/template/interpolate.ts` and its suite have cited these IDs
since 2026-08-23, and this entry is the record they were citing — written from the transcripts that
were already on disk, with **no re-implementation** (the reconciliation E03-S01-T06 asked for). Each
claim below names the probe directory that measures it, so a reader following a citation from the
code lands on the transcript, not on a summary of it.

### What the documentation actually says

[C-E03-175] **The documented conversion table is the source for three of the four scalar
stringifications, and is wrong about the fourth.** The expressions page's type-casting table gives
`Null → ''` and Boolean → `False`/`True` outright (transcribed cell-for-cell as C-E02-020), and
those two are exactly what the service does in interpolation. Its Number row is the one that does
not survive contact: the page describes Int32-shaped behavior, while the live service round-trips a
double (C-E02-021, and C-E03-182 below).
  — https://learn.microsoft.com/azure/devops/pipelines/process/expressions#type-casting
    (checked 2026-08-12 as C-E02-020, re-read for this task 2026-08-19)

[C-E03-176] **The template-expressions page never states the rule the whole pass rests on.** It
documents *one* structural case — "When you insert an array into an array, you flatten the nested
array" — and nothing else: not the mapping case, not the lone-expression-vs-mixed-content
distinction, not expressions in keys, even though its own `each` example is built on
`${{ pair.key }}: ${{ pair.value }}`. Everything below that is not C-E03-175 or C-E03-178 is
therefore measured, not read.
  — https://learn.microsoft.com/azure/devops/pipelines/process/template-expressions
    ("Insertion", re-read 2026-08-19; page-source pins `MicrosoftDocs/azure-devops-docs@7ba9a9ac`,
    `@7d36475a`)

### A lone expression inserts collections structurally

[C-E03-177] **An Object in lone value position becomes a real mapping, not text.** `env: ${{
parameters.envVars }}` where the parameter is `{ALPHA: a, BETA: b}` expands to a two-entry `env:`
mapping. The host scalar's own quoting does not matter: the double-quoted spelling
`env: "${{ parameters.envVars }}"` produces the identical mapping.
  — `research/experiments/E03-interpolation/lone-object-value/`, `lone-object-value-quoted/`
    (live preview, checked 2026-08-23) — both expand to `env:\n  ALPHA: a\n  BETA: b`

[C-E03-178] **Array into array flattens; Object into array does not.** A lone array expression as a
sequence *item* splices its elements into the parent sequence — `- ${{ parameters.preBuild }}` with
two steps yields two steps followed by the literal one. A lone **Object** in the same position stays
**one** item. This is the page's single structural sentence (C-E03-176) confirmed, plus the case it
never mentions.
  — `research/experiments/E03-interpolation/lone-array-sequence-item/`,
    `lone-object-sequence-item/` (live preview, checked 2026-08-23) — the array probe expands to
    `echo pre-one`, `echo pre-two`, `echo probe`; the object probe to one `displayName: From Object`
    step plus the literal one

[C-E03-179] **The structure survives at every depth, including in a well-known schema mapping.** An
object spliced through `${{ insert }}` into a job carries a nested mapping (`workspace: {clean:
all}`), an empty sequence (`dependsOn: []`) and a plain scalar (`displayName: Nested`) into the
expansion unchanged — no depth limit, and no flattening of the nested mapping.
  — `research/experiments/E03-interpolation/lone-object-nested/` (live preview, checked 2026-08-23)

[C-E03-180] **The lone/mixed boundary is not whitespace-tolerant.** `'  ${{ parameters.envVars }}  '`
— the same object expression with padding *outside* the delimiters — is **mixed content**, and the
service rejects it (`Unable to convert from Object to String. Value: Object`). The same padding
around a *string* result is preserved verbatim: `"  ${{ 'x' }}  "` expands to `'  x  '`. So the
padding is neither trimmed before the decision nor trimmed after it.
  — `research/experiments/E03-interpolation/whitespace-around-lone-object/`,
    `whitespace-around-lone-string/` (live preview, checked 2026-08-23) — the object probe is
    HTTP 400 and also reports `Unexpected value ''`

### Every other kind becomes its String form

[C-E03-181] **Boolean stringifies `True`/`False`, capitalized, in every position.** A `type:
boolean` parameter and the literals `${{ true }}`/`${{ false }}` all render `True`/`False`, and the
casing is what the *service* emits before YAML re-types it (C-E03-193).
  — `research/experiments/E03-interpolation/lone-boolean/` (live preview, checked 2026-08-23) —
    `FROM_PARAM: True`, `LITERAL_TRUE: True`, `LITERAL_FALSE: False`

[C-E03-182] **Number stringifies as an invariant double, not as the source text.** `${{ 1.0 }}`
renders `1` — the trailing zero is *lost*, which is only possible if the value is a double rather
than the characters that were written. `${{ 0.5 }}` → `0.5`, `${{ 1000000 }}` → `1000000` (no
grouping separators), `${{ -1.25 }}` → `-1.25` (a leading `-`, and no leading `+` anywhere). Mixed
content produces the same four renderings.
  — `research/experiments/E03-interpolation/lone-number/`, `mixed-number/` (live preview, checked
    2026-08-23) — `HALF: '0.5'`, `ONE_POINT_ZERO: 1`, `MILLION: 1000000`, `NEGATIVE: -1.25`

[C-E03-183] **Null renders as the empty string even in lone position — which is what proves the
lone case converts at all.** `PROBE: ${{ variables.nosuchvariable }}` expands to `PROBE: ''`: the
entry is present with an empty value, not dropped and not a YAML null. A lone `${{ '' }}` is
indistinguishable from it. If a lone expression simply handed its typed result to the emitter, Null
would have come back as `null`; it does not, so every scalar kind goes through the String
conversion and only collections stay structural.
  — `research/experiments/E03-interpolation/lone-null/`, `lone-empty-string/` (live preview, checked
    2026-08-23) — both expand `BEFORE: before` then `PROBE: ''`

[C-E03-184] **Version stringifies by its dotted components, in both lone and mixed position.**
`${{ 1.2.3 }}` renders `1.2.3` and `v${{ 1.2.3.4 }}` renders `v1.2.3.4` — the four-component form
keeps all four. A Version is therefore *not* a Number that happens to have dots, which is what makes
`1.0` (Number, C-E03-182) and `1.2.3` (Version) render by different rules.
  — `research/experiments/E03-interpolation/lone-version/`, `mixed-version/` (live preview, checked
    2026-08-23)

[C-E03-185] **The result is never re-parsed as YAML.** `${{ '0123' }}` stays the four characters
`0123` rather than becoming the number 123, and `"${{ 'a: b' }}"` — a string whose content is a
YAML mapping — comes back as the scalar `'a: b'`. The unquoted spelling of the same probe is a
**parse** failure of the source document (`Mapping values are not allowed in this context`), which
is the host scalar's own YAML, not the expression's result.
  — `research/experiments/E03-interpolation/lone-string-numeric/`,
    `lone-string-yamlish-quoted/`, `lone-string-yamlish/` (live preview, checked 2026-08-23)

### Mixed content is one `format` call

[C-E03-186] **Anything that is not exactly one expression is mixed content: each hole is stringified
and concatenated with the literal text around it.** `pre-${{ true }}-post` → `pre-True-post`;
`pre-${{ variables.nosuchvariable }}-post` → `pre--post` (the Null hole contributes nothing but the
entry keeps its shape); `${{ 'a' }} then ${{ 'b' }}` → `a then b`; and — the case that pins the
boundary — **two adjacent expressions** `${{ 'a' }}${{ 'b' }}` → `ab`, i.e. adjacency does not make
a lone expression. This is not a second stringification rule: the service compiles the whole scalar
into a synthetic `format('<literal with {0} holes>', …)` and parses *that* (C-E02-109), so the
conversion is `format`'s own.
  — `research/experiments/E03-interpolation/mixed-boolean/`, `mixed-null/`,
    `mixed-two-expressions/` (live preview, checked 2026-08-23)

[C-E03-187] **A collection reaching a string position is rejected with a sentence that names the
kind twice.** `pre-${{ parameters.obj }}` returns `Unable to convert from Object to String. Value:
Object`, and the Array form returns the same sentence with `Array` — the ` Value: <Kind>` suffix
names the *kind* again rather than rendering the value. The sentence carries no "For more help"
link, unlike the schema-layer rejections in the same corpus.
  — `research/experiments/E03-interpolation/mixed-object/`, `mixed-array/` (live preview, checked
    2026-08-23) — `"/azure-pipelines.yml (Line: 15, Col: 18): Unable to convert from Object to
    String. Value: Object"` and the `Array` counterpart at `(Line: 16, Col: 18)`

[C-E03-188] **The documented escape spelling works by execution, not merely by recognition.**
`${{ 'my${{value' }}` expands to the literal `my${{value` — so the scanner's quote-awareness
(C-E03-117) is *required*, and the result is **not** re-scanned for expressions. The doubled-quote
form `${{ 'my${{value with a '' single quote too' }}` expands with a single `'`, confirming the
string literal's own escape rule survives the same path.
  — `research/experiments/E03-interpolation/escape-literal/`, `escape-literal-quote/` (live preview,
    checked 2026-08-23)

[C-E03-189] **A block scalar interpolates as one scalar and keeps its lines.** A `script: |` body
carrying `echo ${{ parameters.who }}` on its middle line expands with the substitution in place and
the line structure intact; the service re-emits it as a folded (`>`) scalar with blank-line
separators, which is a *rendering* choice of its emitter and not a change to the value.
  — `research/experiments/E03-interpolation/block-scalar-expression/` (live preview, checked
    2026-08-23)

### Keys run through the same split, with their own rejection

[C-E03-190] **A key is *always* the String form — it has no structural option.** `${{ true }}: value`
becomes the key `True`; `${{ 1.0 }}`/`${{ 0.5 }}` become `1` and `'0.5'` (the same Number rendering
as C-E03-182); `${{ 'PROBE' }}` becomes `PROBE`; and a **Null** key becomes the **empty key** `'':
value` — present, in place, not a dropped entry. Mixed content in key position concatenates like any
other scalar: `PRE_${{ parameters.suffix }}` → `PRE_TAIL`.
  — `research/experiments/E03-interpolation/key-boolean/`, `key-number/`, `key-string/`,
    `key-null/`, `key-mixed/` (live preview, checked 2026-08-23)

[C-E03-191] **Key position has *two* rejection sentences, and which one fires depends on lone vs
mixed.** A **lone** collection key is `Expected a scalar value`; the **same** object in **mixed**
key content is `Unable to convert from Object to String. Value: Object` — C-E03-187's sentence. One
rule could not produce two sentences, so keys go through the same lone/mixed split as values, with a
structural rejection where a value would have inserted structurally.
  — `research/experiments/E03-interpolation/key-object/`, `key-mixed-object/` (live preview, checked
    2026-08-23) — `"(Line: 15, Col: 11): Expected a scalar value"` and `"(Line: 15, Col: 11): Unable
    to convert from Object to String. Value: Object"`

[C-E03-192] **The rendered key is text by the time the schema sees it.** In a mapping with a known
schema, where an unexpected key is a hard error, `${{ true }}` is rejected as `Unexpected value
'True'` — the capitalized String form of C-E03-181, quoted as a string. The rendering therefore
happens before schema validation and is not an artifact of the loose `env:` mapping the other key
probes use. This is the docs/02 §8 entry "Boolean stringification casing in keys" — an open
question there, closed here and by C-E03-190.
  — `research/experiments/E03-interpolation/key-boolean-nonloose/` (live preview, checked
    2026-08-23) — `"/azure-pipelines.yml (Line: 5, Col: 5): Unexpected value 'True'"`

[C-E03-193] **The service's own `finalYaml` is lossy about exactly the cases C-E03-185 and C-E03-190
pin.** The expansion is re-emitted as YAML, so the string `0123` and the key `True` come back as an
unquoted `0123` and an unquoted `True` — text that a YAML reader re-types as a number and a boolean.
The **value** the service computed is the string, proven by the probes above; only the transport is
ambiguous. Consequence for us: these two goldens are compared against the raw `finalYaml` text
rather than a re-parsed tree, and closing the gap on our own emitter side is E03-S05-T03's.
  — `research/experiments/E03-interpolation/lone-string-numeric/`, `key-boolean/` (live preview,
    checked 2026-08-23) — `PROBE: 0123` and `True: value`, both unquoted in `finalYaml`

[C-E03-194] **The interpolation pass must leave a lone directive keyword in *value* position
untouched.** This is C-E03-173 read as a requirement on *this* pass rather than on directive
recognition: the service does not evaluate `KEY: ${{ insert }}` as an expression — the text survives
the whole expansion verbatim and is rejected only by schema validation, `Unexpected value
'${{ insert }}'`. An interpolator that treated it as an ordinary lone expression would instead
produce `Unrecognized value: 'insert'`, the one sentence the probe proves the service never emits.
So the exemption is keyed on the **keyword set**, not on the text looking like a directive.
  — `research/experiments/E03-insert/value-position/` (live preview, checked 2026-08-19) —
    `"/azure-pipelines.yml (Line: 3, Col: 8): Unexpected value '${{ insert }}'"`. No new probe was
    run for this task: E03-S01-T04's transcript is decisive and `interpolate.test.ts` replays it
    directly.

---

## E03-S02-T01 — reference resolution (`C-E03-195..218`)

Evidence: `research/experiments/E03-references/` — **34** live preview probes (21 expanded pairs,
13 rejections) against a **two-repository** oracle fixture, whose tree is committed at
`fixtures/oracle/references/repos/` (`self/` and `templates/`). The second repository is not a
convenience: every question this block answers is *which repository was that path read from*, and
one repository cannot tell the answers apart. The probes were captured by `pnpm reference-survey`
and are replayed by `packages/engine/test/template/reference.test.ts`.

Bookkeeping note: `packages/engine/src/template/reference.ts` has cited `C-E03-195..218` since
2026-08-20 and `packages/engine/src/template/inline.ts` and E03-S06's shipped bundler consume
several of them, but only `C-E03-204` was ever written down (by E03-S02-T05). This entry records
the rest **from the transcripts already on disk** — transcription, not new measurement, and no
re-implementation. `C-E03-204` keeps its own section below and is not repeated here.

Three IDs inside the block were never cited by the code and are assigned here to findings the survey
made and nothing had recorded: `C-E03-199` (`./` prefix), `C-E03-202` (`../` from a subdirectory),
`C-E03-214` (an alias naming a repository that does not exist).

### Where a path is resolved from

[C-E03-195] **A leading `/` makes the path repository-absolute, at any depth.** `/e03-refs/leaf.yml`
from the root file and the *same* absolute path written inside `/e03-refs/dir/deep-abs.yml` both
reach `/e03-refs/leaf.yml` — the two would differ if an absolute path were relative to the including
template.
  — `research/experiments/E03-references/abs-from-root/`, `abs-from-template/` (live preview,
    checked 2026-08-20) — both expand to `script: echo self-leaf`

[C-E03-199] **An explicit `./` prefix is accepted as relative, not as a literal path segment.**
`./e03-refs/leaf.yml` from the root file resolves like the bare spelling. Undocumented; measured
because the naive "starts with `/`?" test would send it down the relative branch and then fail on a
`.` segment.
  — `research/experiments/E03-references/dot-slash/` (live preview, checked 2026-08-20)

[C-E03-201] **An absolute path discards the base directory entirely — in the *frame's* repository,
not the definition's.** `/cross/leaf.yml` written inside `/cross/abs.yml`, itself read from the
aliased repository, reaches the aliased repository's `/cross/leaf.yml`; the same string resolved
against the definition's repository would not exist.
  — `research/experiments/E03-references/cross-abs-inside/` (live preview, checked 2026-08-20)

[C-E03-202] **`../` from a subdirectory is legal and resolves against the including file's
directory.** `../leaf.yml` written in `/e03-refs/dir/deep-parent.yml` reaches `/e03-refs/leaf.yml` —
the documented nested-hierarchy form, confirmed by execution.
  — `research/experiments/E03-references/parent-traversal/`, and the bare-relative control
    `rel-from-root/` + `nested-relative/` (live preview, checked 2026-08-20)

[C-E03-203] **Backslashes are normalized to forward slashes.** `e03-refs\leaf.yml` resolves to
`/e03-refs/leaf.yml`. Undocumented, and the opposite of what a strict POSIX reading would give (a
single filename containing backslashes).
  — `research/experiments/E03-references/backslash/` (live preview, checked 2026-08-20)

[C-E03-205] **A reference is not trimmed before resolution.** The quoted spelling
`"/e03-refs/leaf.yml "` — with the trailing space forced past the YAML parser — is looked up *with*
the space and fails, and the failure sentence prints the path with the space still on it.
  — `research/experiments/E03-references/trailing-space/` (live preview, checked 2026-08-20) —
    `"File /e03-refs/leaf.yml  not found in repository …"` (two spaces before `not`)

[C-E03-206] **The escape check is on the *resolved* path, not on each step.** `../leaf.yml` from a
subdirectory is legal (C-E03-202) while three levels of `../` from the same place is not, so a
traversal may dip toward the root mid-string as long as it does not end above it. Both escapes are
rejected, one from the root file and one from two levels down.
  — `research/experiments/E03-references/escape-root-direct/`, `escape-root-nested/` (live preview,
    checked 2026-08-20) — `"The file path //../outside.yml is invalid"` and
    `"/e03-refs/escape.yml: The file path /e03-refs/../../../outside.yml is invalid"`

[C-E03-200] **The invalid-path rejection prints the *unnormalized* join, base directory and all.**
The root file's base is `/`, so `../outside.yml` is printed `//../outside.yml` — a double slash that
only exists before normalization — and a reference that crosses a repository boundary with an empty
base prints a single-slash `/../e03-refs/leaf.yml`. Reproducing the sentence therefore requires
keeping the joined string, not just the resolved one.
  — `research/experiments/E03-references/escape-root-direct/`, `cross-rel-self/` (live preview,
    checked 2026-08-20)

### Repositories and aliases

[C-E03-197] **`self` is the alias for the repository the *pipeline definition* came from, not
"the current repository".** A template read from the aliased repository writes
`/e03-refs/leaf.yml@self` and reaches the definition's repository — the documented cross-repo
scenario — and `@self` needs no `resources:` block to be legal.
  — `research/experiments/E03-references/cross-back-to-self/`, `self-alias-root/` (live preview,
    checked 2026-08-20)

[C-E03-196] **Each repository resource is pinned to one commit per run, and the two repositories in
an expansion carry different commits.** The schema page documents the pinning directly: a repository
resource's metadata "is available to all jobs in the form of runtime variables", among them
`resources.repositories.<Alias>.version` — one version per resource per run. The transcripts show
the second half: within one survey the definition's repository resolves to `version da8a3041…` while
the aliased `azdo-emu-templates` resolves to `version 2cc1a2e5…`, so a reference's commit is a
property of the repository it names, not of the expansion as a whole. This is what lets a repository
resource carry a pinned commit rather than a ref to be re-resolved per reference.
  — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/resources-repositories-repository
    (deep-verified 2026-08-25, "Variables") — "In each run, the metadata for a repository resource is
    available to all jobs in the form of runtime variables", listing
    `resources.repositories.<Alias>.version`
  — `research/experiments/E03-references/missing-file/`, `cross-missing-file/` (live preview,
    checked 2026-08-20)
  — **Not measured:** *when* within a run the resolution happens. `reference.ts`'s header reads
    "once, at pipeline start", which is a design reading of per-run pinning plus the fact that a
    synchronous `read` is only sound if every repository is already fetched by expansion time — not
    something these probes establish. Recorded so a reader following the citation is not misled.

[C-E03-198] **A repository resource that omits `ref:` defaults to `refs/heads/main`, and an explicit
`ref:` is accepted.** The documented default, confirmed against the service.
  — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/resources-repositories-repository
    (deep-verified 2026-08-25; `git_commit_id` `d089fd2dbb54483ec611eeb478e3eff14be74393`,
    `ms.date` 2026-07-29) — "`ref`: string # ref name to checkout; defaults to 'refs/heads/main'."
  — `research/experiments/E03-references/alias-ref-pinned/` (live preview, checked 2026-08-20) —
    the explicit `ref: refs/heads/main` probe expands identically to the omitted-`ref` probes

[C-E03-218] **The default ref is observable in the service's own error text.** The not-found sentence
prints `branch refs/heads/main` for a repository whose resource declared no `ref:` — so the default
is applied at resolution time and is what a diagnostic must echo, not a value we may leave blank.
  — `research/experiments/E03-references/missing-file/`, `cross-missing-file/` (live preview,
    checked 2026-08-20)

[C-E03-210] **The alias splits on the *first* `@`, not the last.** `a.yml@self@self` is rejected
`No repository found by name self@self` — everything after the first `@` is the alias — and a file
genuinely named `we@ird.yml` is unreachable, rejected `No repository found by name ird.yml`. A
`lastIndexOf('@')` implementation reproduces neither sentence.
  — `research/experiments/E03-references/double-at/`, `at-in-filename/` (live preview, checked
    2026-08-20)

[C-E03-212] **An empty alias is a real reference that lands on `self`, and is not the same as no
alias at all.** `/e03-refs/leaf.yml@` expands. The distinction matters because an absent alias
resolves in the *frame's* repository (C-E03-216) while an explicit one goes through the alias
lookup, so collapsing `@` to "no alias" would change where a cross-repo template's references read
from.
  — `research/experiments/E03-references/empty-alias/` (live preview, checked 2026-08-20)

[C-E03-213] **Alias lookup folds case; path lookup does not.** An alias declared `templates` and
referenced `@TEMPLATES` resolves, while a path differing only in case is rejected (C-E03-204). The
two halves of one reference string therefore obey different comparison rules.
  — `research/experiments/E03-references/alias-case/` (live preview, checked 2026-08-20) — expands
    to `script: echo cross-leaf`

[C-E03-211] **An alias no `resources:` block declares is rejected `No repository found by name
<alias>`**, with no help link and no mention of the file that would have been read.
  — `research/experiments/E03-references/unknown-alias/` (live preview, checked 2026-08-20) —
    `"/azure-pipelines.yml: No repository found by name nosuchalias"`

[C-E03-214] **An alias that *is* declared but names a repository that does not exist fails
differently — at fetch time, not at alias lookup.** The sentence is "The repository `<name>` in
project `<project-id>` could not be retrieved. Verify the name and credentials being used and
permissions." — a retrieval/permissions failure that names the project, where C-E03-211 names only
the alias. A converter that reported one sentence for both would lose the distinction between "you
did not declare it" and "we could not read it".
  — `research/experiments/E03-references/alias-undeclared-repo/` (live preview, checked 2026-08-20)
    — the project GUID is elided in the sentence above but kept in the transcript, as it is in
    `research/experiments/E02-resources/real-run.md` and `packages/engine/test/expr/resources.test.ts`:
    the redaction rule (`research/oracle-setup.md`) is about the **org name**, which is redacted
    everywhere in this corpus.

### Crossing a repository boundary

[C-E03-215] **Crossing a repository boundary resets the base directory to the repository root; a
reference that stays home keeps the including file's directory.** The pair is decisive.
`cross/leaf.yml@templates` written in `/e03-refs/dir/` resolves — which is only possible if the base
became `/` rather than `/e03-refs/dir`. `../e03-refs/leaf.yml@self` written in `/cross/` (the other
repository) is *rejected* `The file path /../e03-refs/leaf.yml is invalid` — which is only possible
if the base became empty rather than `/cross`, where it would have resolved. The control:
`../leaf.yml@self` written in `/e03-refs/dir/` of the **same** repository resolves, so an explicit
`@self` does not reset the base by itself — only an actual change of repository does.
  — `research/experiments/E03-references/cross-rel-outward/`, `cross-rel-self/`,
    `self-alias-relative-nested/`, `self-alias-relative/`, `self-alias-nested/` (live preview,
    checked 2026-08-20)

[C-E03-216] **Inside a template read from another repository, a bare reference stays in *that*
repository.** `leaf.yml` written in `/cross/outer.yml` of the aliased repository reads the aliased
repository's `/cross/leaf.yml`; it does not fall back to the definition's repository (where the
path does not exist). The repository context follows the frame, and the same is true of the
absolute form (C-E03-201).
  — `research/experiments/E03-references/cross-bare-inside/` (live preview, checked 2026-08-20) —
    expands to `script: echo cross-leaf`

[C-E03-207] **The not-found sentence names path, repository URL, branch and commit**, in that order:
`File <path> not found in repository <url> branch <ref> version <commit>.` For a cross-repo
reference it names the **other** repository, which is what makes the sentence usable for telling the
two apart.
  — `research/experiments/E03-references/missing-file/`, `cross-missing-file/`, `case-mismatch/`
    (live preview, checked 2026-08-20) — the cross-repo probe names
    `…/_git/azdo-emu-templates branch refs/heads/main version 2cc1a2e5…`

[C-E03-217] **A file is *named* in diagnostics bare inside the definition's own repository and
`<path>@<alias>` anywhere else.** The rejection raised inside the aliased repository's
`/cross/rel-self.yml` is prefixed `/cross/rel-self.yml@templates:`, while every rejection inside the
definition's repository is prefixed with the bare path. Error prefixes therefore encode the
repository, and a frame must carry the alias to reproduce them.
  — `research/experiments/E03-references/cross-rel-self/`, `escape-root-nested/` (live preview,
    checked 2026-08-20)

### Cycles

[C-E03-208] **The service has no cycle detection: a cycle recurses until it dies of `Maximum object
depth exceeded`, located at the repeated file.** A self-including template and a two-file mutual
cycle produce the same sentence, prefixed with the file that repeats — not the file that opened the
cycle.
  — `research/experiments/E03-references/self-cycle/`, `mutual-cycle/` (live preview, checked
    2026-08-20) — `"/e03-refs/self-cycle.yml: Maximum object depth exceeded"` and
    `"/e03-refs/cycle-a.yml: Maximum object depth exceeded"`
  — **Deliberate divergence:** we detect the repeat on `(repository, commit, path)` and report that
    same sentence at that same file. Recursing until the stack blows is a hang, not a behavior. Same
    observable result, terminating implementation; recorded here so the mechanism difference is not
    mistaken for a parity bug.

[C-E03-209] **The same file included twice from one parent is a diamond, not a cycle, and expands
twice.** This is the control that stops cycle detection from degenerating into "have I seen this
path before" — a `Set` of visited paths would reject a legal pipeline.
  — `research/experiments/E03-references/diamond-not-cycle/` (live preview, checked 2026-08-20) —
    the expansion contains `script: echo self-leaf` twice

---

## E03-S02-T02 — typed parameter binding (`C-E03-300..333`)

Evidence: `research/experiments/E03-parameters/` — **88** live preview probes (42 expanded pairs,
46 rejections), captured by `pnpm parameter-binding-survey` and replayed by
`packages/engine/test/template/parameters.test.ts`.

This block is unusual in one way worth stating up front: **the three documented sources disagree
with each other**, before the service was asked. Two process pages list 13 type names, the
yaml-schema page 12, and the vendored service schema 16 in one position and 20 in the other. Four
documented statements turn out to be false as written. The probes are therefore not confirmation of
a doc — they are the arbiter between docs, which is why the survey is this large.

Bookkeeping note: `packages/engine/src/template/parameters.ts` has cited `C-E03-300..333` since
2026-08-20 and the probe READMEs cite `300..303`; nothing was ever written into this file. Recorded
2026-08-25 from the transcripts on disk. Three IDs the code never cited — `C-E03-310`, `C-E03-319`,
`C-E03-331` — are assigned here to findings the survey made and nothing had recorded.

### What the three sources say (and where they are wrong)

[C-E03-300] **The two process pages list 13 type names and state that `stringList` is unavailable in
templates.** The list is `string`, `number`, `boolean`, `object`, `step`, `stepList`, `job`,
`jobList`, `deployment`, `deploymentList`, `stage`, `stageList`, `stringList`.
  — https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters and
    …/process/template-parameters (checked 2026-08-20)
  — "The `stringList` data type isn't available in templates. Use the `object` data type in
    templates instead." — **measured false**, C-E03-306.

[C-E03-301] **The yaml-schema page lists 12 type names — `stringList` is absent — and states that
`type` and `name` are required and that a parameter "must include a default value".**
  — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/parameters-parameter
    (checked 2026-08-20)
  — the requiredness half is **measured false**, C-E03-308 (`type:` is optional) and C-E03-309
    (a parameter with no default is legal; it is simply required at call time).

[C-E03-302] **The vendored service schema has *two* type vocabularies, of 16 and 20 names**:
`definitions.templateParameterType` (template position) and
`definitions.pipelineTemplateParameterType` (root position). They are not nested — `legacyObject`
is in the first and not the second — and neither matches either documentation page.
  — `packages/engine/schema/` (the vendored org schema, C-E00-007/008), read 2026-08-20

[C-E03-303] **The documented account of a missing default is self-contradictory.** The yaml-schema
page's prose says a parameter "must include a default value", its own `default` row says the value
must then be given at runtime, and runtime-parameters says that when there is no default "the first
available value is used" — i.e. `values:` supplies one.
  — as C-E03-301, plus …/process/runtime-parameters (checked 2026-08-20) — the "first available
    value" statement is **measured false**, C-E03-309.

### The real vocabulary, measured name by name

[C-E03-304] **Inside a template the accepted vocabulary is the vendored schema's
`templateParameterType`, exactly — all 16 names, no more.** Every documented name is accepted, and
so are `container`, `containerList`, `legacyObject` and `stringList`, none of which the yaml-schema
page lists.
  — `research/experiments/E03-parameters/type-tmpl-documented/`, `type-tmpl-stringlist/`,
    `type-tmpl-legacyobject/`, `type-tmpl-containerlist/`, `type-tmpl-container/` (live preview,
    checked 2026-08-20)

[C-E03-305] **The two positions are genuinely different vocabularies, not a superset and a subset.**
`legacyObject` is accepted in a template and rejected at the root; `environment`, `filePath`,
`pool`, `secureFile` and `serviceConnection` are accepted at the root and rejected in a template.
Six names, six probes, both directions — a single `PARAMETER_TYPES` set would accept five names the
service refuses in templates and refuse one it accepts.
  — `research/experiments/E03-parameters/type-tmpl-legacyobject/`, `type-root-legacyobject/`,
    `type-root-schema-only/`, `type-tmpl-environment/`, `type-tmpl-filepath/`, `type-tmpl-pool/`,
    `type-tmpl-securefile/`, `type-tmpl-serviceconnection/` (live preview, checked 2026-08-20) —
    the root rejection is `"Unexpected value 'legacyObject'"`, the template ones name each
    root-only type

[C-E03-306] **`stringList` *is* available in templates** — C-E03-300's flat statement is false. The
template probe expands, and a `stringList` argument binds as an array of strings with per-item
`values:` checking.
  — `research/experiments/E03-parameters/type-tmpl-stringlist/`, `pass-stringlist-values/`
    (live preview, checked 2026-08-20)

[C-E03-307] **An unknown type is rejected `Unexpected value '<spelling>'` at the `type:` node, and
the match is case-sensitive.** `String` is as unknown as `notAType`, and the sentence is identical
in both positions — it does not enumerate the accepted names, which is why the vocabulary had to be
measured name by name.
  — `research/experiments/E03-parameters/type-root-unknown/`, `type-tmpl-unknown/`,
    `type-root-case/` (live preview, checked 2026-08-20)

[C-E03-310] **A `container` parameter takes a resource-shaped *mapping*, not a bare string.** The
bare-string default is rejected `The 'p' parameter is not a valid Container.` followed by
`Unexpected value 'alpine'`, while a mapping spelled like a `resources.containers` entry
(`container: c1`, `image: alpine`) binds and keeps both keys. `containerList` is the sequence form.
  — `research/experiments/E03-parameters/type-container-string/`, `type-container-resource/`,
    `type-root-container/`, `type-tmpl-container/`, `type-tmpl-containerlist/` (live preview,
    checked 2026-08-20)

### Declarations

[C-E03-308] **`type:` is optional and defaults to `string`** — not "required", and not inferred from
the default. Omitting it is accepted; omitting it *and* giving a mapping default is rejected
`The 'p' parameter is not a valid String.`, which is only possible if the missing type became
`string` rather than being read off the value.
  — `research/experiments/E03-parameters/type-root-missing/`,
    `type-root-missing-untyped-object/` (live preview, checked 2026-08-20)

[C-E03-333] **A declaration with no `name:` never reaches the binder**: the schema's
"required as first property" rule rejects the document first, with `Unexpected value 'type'` at the
declaration's first key. A binder that checked for a missing name would be reproducing a sentence
that is not the service's.
  — `research/experiments/E03-parameters/decl-missing-name/` (live preview, checked 2026-08-20)

[C-E03-313] **A name declared twice is rejected `The 'p' parameter is declared more than once in the
parameter list.`**, located at the *second* declaration. Declarations are sequence items, so the
parser's duplicate-key rule (E01-S01-T04) does not apply and this is a binder-level check.
  — `research/experiments/E03-parameters/decl-duplicate-name/` (live preview, checked 2026-08-20) —
    `"(Line: 5, Col: 3): The 'p' parameter is declared more than once…"`

[C-E03-316] **Parameter names fold case, on both sides.** A parameter declared `myParam` is readable
as `${{ parameters.MYPARAM }}`, and an argument spelled `P:` binds a parameter declared `p`. So the
declaration table, the argument lookup and the context read all compare case-insensitively.
  — `research/experiments/E03-parameters/decl-name-case/`, `pass-name-case/` (live preview, checked
    2026-08-20)

[C-E03-317] **Reading an undeclared parameter is `Key not found '<name>'`** — the `parameters`
context raises on a miss rather than null-propagating, which is the general provider rule
(C-E02-087) confirmed in this position.
  — `research/experiments/E03-parameters/decl-unknown-name/` (live preview, checked 2026-08-20)

[C-E03-315] **A `default:` is not an expression slot.** It admits exactly one expression form — a
lone **single-quoted string literal**, which folds to its text — and nothing else. `${{ 42 }}`,
`${{ true }}`, `${{ format(…) }}`, `${{ parameters.other }}`, `${{ variables.x }}` and mixed content
are all rejected `A template expression is not allowed in this context`. The deciding factor is the
literal *kind*, not the parameter type: `${{ 42 }}` on a `string` parameter still rejects, while
`${{ 'x' }}` on a `number` parameter is accepted. This is template-parameters' "You can only use
literals for parameter default values", enforced far more narrowly than it reads.
  — `research/experiments/E03-parameters/default-expression/`,
    `default-expression-literal-string-on-number/` (accepted) and
    `default-expression-function/`, `default-expression-literal-boolean/`,
    `default-expression-literal-number/`, `default-expression-literal-number-on-string/`,
    `default-expression-mixed/`, `default-expression-parameter/`, `default-expression-variables/`
    (all rejected with the one sentence) — live preview, checked 2026-08-20

[C-E03-312] **A default is type-checked at the declaration**, with the same sentence a passed value
gets: `The 'p' parameter value 'abc' is not a valid Number.`
  — `research/experiments/E03-parameters/default-wrong-type/` (live preview, checked 2026-08-20)

[C-E03-309] **A parameter with no default is legal and simply required at call time**, rejected
`A value for the '<name>' parameter must be provided.` — and **`values:` does not supply one**,
which makes C-E03-303's "the first available value is used" false. Every requiredness rejection is
*accumulated*: four undefaulted parameters produce four sentences in one response.
  — `research/experiments/E03-parameters/default-missing-string/`, `default-missing-values/`,
    `default-missing-typed/`, `pass-missing-required/` (live preview, checked 2026-08-20) —
    `default-missing-typed` returns the sentence for `n`, `b`, `o` and `l` together

### Binding a value

[C-E03-321] **A scalar binds as its *source text*, and the per-type parse runs on that string.**
There is no Number→String or Boolean→String conversion: `42` binds to a `string` parameter as
`"42"`, `true` as `"true"`, YAML `True` as `"True"` and `007` as `"007"`. The `True` case is
decisive twice over — it shows the source text rather than the value (a value-based conversion would
give `"true"`), and it shows binding is **not** the expression language's stringification, which
renders Boolean as `True`/`False` regardless of spelling (C-E03-181).
  — `research/experiments/E03-parameters/pass-number-to-string/`, `pass-boolean-to-string/`,
    `pass-boolean-titlecase-to-string/`, `pass-leading-zero-to-string/` (live preview, checked
    2026-08-20) — `OUT: '"42"'`, `'"true"'`, `'"True"'`, `'"007"'`

[C-E03-332] **Null binds as the empty string, in one step rather than as a per-type special case.**
`p:` bound to `string` is `""`; the same `p:` bound to `number` or `boolean` is rejected quoting the
**empty string** — `The 'p' parameter value '' is not a valid Number.` — which is exactly what an
explicit `''` produces. So Null became `''` first and then failed the per-type parse.
  — `research/experiments/E03-parameters/pass-null/`, `default-null/`, `pass-null-to-number/`,
    `pass-null-to-boolean/`, `empty-string-to-number/` (live preview, checked 2026-08-20)

[C-E03-322] **`number` accepts any number-like string and binds a double.** `'8'` binds 8, a
`number` default `'8'` binds 8, `1.0` binds `1` and `0.5` binds `0.5`; `abc` and `''` are rejected
`The 'p' parameter value '<text>' is not a valid Number.` Binding `1.0` to a **string** parameter
gives `"1.0"` — the source text (C-E03-321) — so the trailing-zero loss belongs to the number parse,
not to a stringification.
  — `research/experiments/E03-parameters/pass-string-to-number/`, `default-number-like-string/`,
    `number-float-binding/`, `pass-nonnumeric-to-number/`, `empty-string-to-number/` (live preview,
    checked 2026-08-20) — `number-float-binding` returns `{"a": 1, "b": 0.5, "c": "1.0"}`

[C-E03-323] **`boolean` accepts exactly the two literals, case-insensitively, and nothing else.**
`true`, the quoted `'true'` and YAML `True` all bind; `yes` and `1` are rejected
`The 'p' parameter value 'yes' is not a valid Boolean.` A `boolean` default written `'true'` binds
`true`, so the quoting is invisible by the time the parse runs — consistent with C-E03-321.
  — `research/experiments/E03-parameters/pass-bool-titlecase/`, `pass-bool-quoted-true/`,
    `default-boolean-quoted/`, `pass-bool-yes/`, `pass-bool-number/` (live preview, checked
    2026-08-20)

[C-E03-324] **`object` keeps every leaf's YAML type, at any depth, and accepts a scalar.** A deep
value round-trips as `{"s":"text","n":3,"f":0.5,"b":true,"nil":"","list":[1,"two"],"nested":{…}}` —
strings stay strings, numbers numbers, booleans booleans — with the one exception that a **null leaf
is the empty string**. A bare scalar bound to `object` is that scalar, and `p:` (null) is `""`.
  — `research/experiments/E03-parameters/pass-object-deep/`, `pass-string-to-object/`,
    `pass-null-to-object/` (live preview, checked 2026-08-20)

[C-E03-325] **`legacyObject` is `object` with every scalar leaf stringified.** The *same* deep value
bound to both types differs leaf by leaf: `3` becomes `"3"`, `true` becomes `"true"`, the sequence
`[1, "two"]` becomes `["1","two"]`; a null leaf is `""` in both. Undocumented on every page, and the
only place in the system where the reader's types are deliberately discarded.
  — `research/experiments/E03-parameters/legacyobject-deep/` (live preview, checked 2026-08-20)

[C-E03-326] **`stringList` binds a sequence of strings, and its rejections are quoted where the other
list types' are not.** A bare scalar is rejected `The 'p' parameter value 'a' is not a valid
StringList.` — with the value quoted — while a scalar bound to `stepList` gets the value-less form
(C-E03-327). Membership is checked **per item**, at the item's own position.
  — `research/experiments/E03-parameters/pass-stringlist-values/`, `pass-stringlist-scalar/`,
    `pass-stringlist-invalid/` (live preview, checked 2026-08-20) —
    `"(Line: 5, Col: 5): The 'p' parameter value 'zzz' is not a valid value."`

[C-E03-327] **The structural types are schema-validated at binding time, and a shape mismatch takes
the value-less sentence.** A scalar bound to `stepList` returns *two* sentences —
`The 'p' parameter is not a valid StepList.` and `Unexpected value 'nope'` — and a mapping with no
known step keyword bound to `step` returns `The 'p' parameter is not a valid Step.` plus
`Unexpected value 'notAStep'`. A mapping bound to a scalar type takes the same value-less form
(`The 'p' parameter is not a valid String.`), because there is no single token to quote.
  — `research/experiments/E03-parameters/pass-steplist-scalar/`, `pass-step-invalid-shape/`,
    `pass-object-to-string/` (live preview, checked 2026-08-20)

[C-E03-328] **A bound `stepList` is already normalized.** The two-step probe comes back as
`task: CmdLine@2` with `inputs.script` and `task: Bash@3` with `inputs.targetType`/`script` — the
shortcut→task rewrite has already run by the time a template reads the parameter, so a binder must
not run it a second time.
  — `research/experiments/E03-parameters/pass-steplist-valid/` (live preview, checked 2026-08-20)

### `values:`

[C-E03-311] **A value outside `values:` is rejected `The '<name>' parameter value '<text>' is not a
valid value.`**, whether it arrives as a default, as an argument, or at queue time.
  — `research/experiments/E03-parameters/default-not-in-values/`, `pass-not-in-values/`,
    `runtime-not-in-values/` (live preview, checked 2026-08-20)

[C-E03-314] **The membership test is case-sensitive and runs *after* coercion.** `ALPHA` against
`values: [alpha]` is rejected, while a `number` restricted to `[1, 2]` accepts the *string* `'2'` —
which is only possible if the string became the number 2 before the comparison. A `values:` list on
a type that cannot carry one (`object`) is silently ignored rather than rejected.
  — `research/experiments/E03-parameters/values-case/`, `values-number-coerced/`,
    `values-on-object/` (live preview, checked 2026-08-20)

### Arguments and scope

[C-E03-318] **An argument the callee never declared is rejected `Unexpected parameter '<name>'` — but
only if the callee declares a `parameters:` block at all.** A template with *no* `parameters:` block
accepts any argument silently. The asymmetry is measured, not a courtesy.
  — `research/experiments/E03-parameters/pass-extra-parameter/`, `pass-extra-to-none/` (live
    preview, checked 2026-08-20)

[C-E03-320] **Argument values are ordinary expression slots evaluated in the *caller's* frame.**
`${{ parameters.outer }}` in an argument mapping resolves to the caller's parameter, while
`${{ parameters.p }}` naming the *callee's* parameter is rejected `Key not found 'p'` — the callee's
parameters do not exist yet when its arguments are evaluated.
  — `research/experiments/E03-parameters/pass-expression/`,
    `pass-expression-callee-param/` (live preview, checked 2026-08-20)

[C-E03-319] **Each file gets its own `parameters` frame; the contexts do not merge.** A template that
dumps `parameters` wholesale prints `{"p": "ok"}` — its own parameter alone — with no trace of the
caller's `outer`. So binding replaces the context rather than layering onto it.
  — `research/experiments/E03-parameters/pass-callee-scope/` (live preview, checked 2026-08-20)

### Queue-time (runtime) parameters

[C-E03-329] **Queue-time values are strings run through the same per-type conversion as YAML values,
with one addition: a JSON string bound to an `object` parameter is parsed.** `"8"` binds the number
8 to a `number` parameter exactly as YAML `'8'` does, `"true"` binds `true` to a `boolean`, and
`{"a": 1}` binds the object `{"a": 1}` rather than the six-character string.
  — `research/experiments/E03-parameters/runtime-override-number/`, `runtime-override-boolean/`,
    `runtime-override-string/`, `runtime-override-object/` (live preview via the preview body's
    `templateParameters`, checked 2026-08-20)

[C-E03-331] **A queue-time value satisfies requiredness and is subject to `values:`.** A root
parameter with no default expands when supplied only at queue time, and a queue-time value outside
`values:` is rejected with C-E03-311's sentence — so the queue-time path runs the whole binding
pipeline, not just the conversion.
  — `research/experiments/E03-parameters/runtime-required/`, `runtime-not-in-values/` (live preview,
    checked 2026-08-20)

[C-E03-330] **An undeclared queue-time parameter is rejected `Unexpected parameter '<name>'` with no
file position.** The sentence matches the argument-site one (C-E03-318) but arrives without the
`/azure-pipelines.yml (Line: n, Col: m):` prefix every in-document rejection carries, because a
queue-time value has no source location.
  — `research/experiments/E03-parameters/runtime-undeclared/` (live preview, checked 2026-08-20)

---

## E03-S04-T02 — expanded-YAML serialization (`C-E03-250..253`)

Evidence: the ten committed corpus pairs (`fixtures/oracle/*.final.yml`). No new probe was run and
none is needed — these claims are about the **shape of the service's own output**, and ten samples
of it are already on disk. The test that pins them is a *fixpoint*: parse each `final.yml`,
re-serialize it, and compare bytes.

[C-E03-250] **`finalYaml` is block YAML whose sequences are not indented under their key.** A
sequence item sits at the same column as its key (`stages:` then `- stage: build`), which is the
`yaml` library's non-default `indentSeq: false`. The default indents and diverges on line 8 of every
corpus entry.
  — `fixtures/oracle/*.final.yml` (ten samples, checked 2026-08-25) — re-serializing with
    `indentSeq: false` reproduces all ten; with the default, none.

[C-E03-251] **Where a quote is needed the service uses single quotes, it never folds a long scalar,
and the document ends with a blank line.** `'**' + '/*.sln'` comes back single-quoted; no line is
wrapped at any width; every `finalYaml` ends `\n\n`.
  — `fixtures/oracle/*.final.yml` (checked 2026-08-25) — the three settings that complete the
    fixpoint are `singleQuote: true`, `lineWidth: 0`, and one appended newline.

[C-E03-252] **The service preserves the author's quoting on a scalar that would also be legal
plain.** `'0 3 * * Mon-Fri'` is a valid *plain* scalar, and comes back quoted because that is how it
was written. Consequence for us: an emitter that serializes from plain JavaScript values cannot
reach the fixpoint — the authored style has to survive into the emitter, which is why
`serializeExpandedYaml` walks the DOM and sets each scalar's type from `ScalarNode.style`.
  — `fixtures/oracle/10-monorepo-triggers-pools.final.yml` vs
    `fixtures/corpus/10-monorepo-triggers-pools/pipeline.yml` (checked 2026-08-25) — the one
    corpus entry where a value-based emitter and the service disagree

[C-E03-253] **Every node in an expanded DOM has a provenance, including the synthesized ones.**
`insert` stamps its merged mapping with the directive site's `pos`, `each` gives every copy of a
body the body's own `pos`, and interpolation gives a replacement the host scalar's. So "the map
covers 100% of emitted nodes" is a property of the walk rather than of the map builder, and the
useful fact it records is that two emitted nodes on different lines can share one authored line.
  — `packages/engine/src/template/{insert,each,interpolate}.ts` (read 2026-08-25) and the
    corpus-wide coverage test in `packages/engine/test/template/expand.test.ts`

---

## E03-S04-T03 — strict validation of the expanded document (`C-E03-254..258`)

Evidence: `research/experiments/E03-strict-validation/` — three live preview probes, each injecting
one mutation into a **known-good expansion** (`fixtures/oracle/10-monorepo-triggers-pools.final.yml`,
a document the service itself produced, so it accepts it unmutated by C-E03-001). The mutation is
therefore the only difference between an accepted and a rejected document.

The check runs in **one direction on purpose**. A validator that rejects what the service accepts
turns a working pipeline into a conversion failure — the one failure mode a user cannot tell from
their own mistake — so what needs proving is that each family we reject is also rejected there.

[C-E03-254] **The service rejects an unknown property in an expanded document.** `notAStageKey`
injected at stage level returns `Unexpected value 'notAStageKey'`, the same sentence an authored
document gets, located at the injected line.
  — `research/experiments/E03-strict-validation/unknown-key/` (live preview, checked 2026-08-25) —
    `"/azure-pipelines.yml (Line: 44, Col: 3): Unexpected value 'notAStageKey'"`

[C-E03-255] **The service type-checks the expanded document, not only its shape.** A `condition:`
given a mapping where the schema says string returns `A mapping was not expected` — so a strict
validator's type family is not stricter than the authority.
  — `research/experiments/E03-strict-validation/bad-type/` (live preview, checked 2026-08-25) —
    `"/azure-pipelines.yml (Line: 45, Col: 5): A mapping was not expected"`

[C-E03-256] **The service resolves task references during preview and rejects an unknown one, with
a sentence that names the task, its version, the job and the step.** `task: NoSuchTask@9` returns
"A task is missing. The pipeline references a task called 'NoSuchTask'. … (Task version 9, job
'container_job', step ''.)" — including the Marketplace suggestion.
  — `research/experiments/E03-strict-validation/unknown-task/` (live preview, checked 2026-08-25)

[C-E03-257] **Δ We report an unknown task as a *warning* where the service rejects, deliberately.**
The two catalogues are not the same thing: ours is the vendored snapshot of in-box tasks, the
service's is the organization's installed set (C-E01-033). Erroring against the vendored snapshot
would fail every pipeline that uses a marketplace task — a false positive on a working pipeline,
which is the failure this whole comparison exists to avoid. The divergence is **severity, not
detection**: the diagnostic is raised either way, and it becomes an error once an org schema is
supplied (E01-S02-T03 / E09).

[C-E03-258] **An expansion is a different dialect from an authored document, and the difference is
measurable on the corpus.** Validating the ten committed `final.yml`s with the authored-document
validator reports two families in nine of them — `trigger:`/`pr:` `{enabled: false}`, which the
service emits and refuses as input (C-E03-002), and the three desugared GUID tasks, which have no
name spelling for a name-keyed catalogue to find (C-E04-030/031). Both are output-only, and a
post-expansion validator that does not accept them reports errors in documents the authority
produced.
  — `fixtures/oracle/*.final.yml` (ten samples, checked 2026-08-25) — 2 diagnostics in each of
    seven entries, 4–6 in the three that carry desugared GUIDs, 0 in the one with neither

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
