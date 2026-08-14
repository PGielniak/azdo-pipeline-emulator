# E02 — Expression language: evaluator + shell compiler

Phase: P1 (evaluator) / P2 (shell backend) · Depends on: E00 · Design: docs/02 §1, §6
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/process/expressions · …/process/conditions · **actions/runner** `src/Sdk/DTExpressions2` (open fork of the DistributedTask expressions engine — corrected 2026-07-30, C-E00-012/013: the agent repo has no engine sources, only `src/Agent.Worker/ExpressionManager.cs` consuming the closed NuGet; pin actions/runner permalinks per claim) · oracle (compile-time cases; outranks the fork on divergence).

## E02-S01 — As an engine developer, the documented expression grammar parses into one AST used by both backends, so evaluation and compilation can never diverge structurally.
Acceptance: parser covers the full documented syntax; parse errors match server style.

- [x] **E02-S01-T01 — Tokenizer + parser**
  **Do:** `packages/engine/src/expr/{lexer,parser}.ts`: single-quoted strings (with `''` escape), numbers, booleans, null, identifiers, property access `a.b`, index access `a['b']`/`a[0]`, function calls, nesting. AST nodes carry source spans.
  **Ground:** expressions doc syntax sections (pin per-claim); cross-read the tokenizer in the agent repo's expressions SDK to confirm literal rules (esp. string escaping, number formats) — pin permalinks to the relevant methods. Claims `[C-E02-…]` per rule.
  **Done:** parser test table ≥ 60 cases incl. error cases; spans verified.
  *Done 2026-08-11:* `packages/engine/src/expr/{lexer,parser}.ts`; 68-row table + span-slice and print
  round-trip invariants (`packages/engine/test/expr/parser.test.ts`, 85 tests). Grammar decided by 74
  live probes (`research/experiments/E02-grammar/survey.md`) because the fork named above is the
  **Actions** dialect: Azure Pipelines has no operators at all (C-E02-001).
- [x] **E02-S01-T02 — Server-style parse errors**
  **Do:** error messages carry the offending expression with a caret position, mirroring service phrasing where documented.
  **Ground:** collect 5 real service error strings by submitting invalid expressions via oracle preview; store transcripts `research/experiments/E02-errors/`.
  **Done:** snapshot tests match our renderer against collected shapes (not necessarily byte-identical; same information).
  *Done 2026-08-12:* `packages/engine/src/expr/errors.ts`; **66** live rejections (`pnpm
  expr-error-survey` → `research/experiments/E02-errors/{survey.md,cases.json}`) replayed as a
  parity table — 62 rows compared field-by-field *and* byte-for-byte against our renderer, six rows
  asserted as documented divergences (`packages/engine/test/expr/errors.test.ts`, 80 tests). Two
  findings changed the parser rather than the renderer (C-E02-101/102/103), closing the `! true`
  divergence T01 left open.
- [x] **E02-S01-T03 — Missing error kind: `Expected '(' to follow a function`**
  *Filed 2026-08-12 by E03-S01-T01, which hit it while grounding the `each` loop-variable slot and
  then confirmed it is general rather than directive-specific.*
  **Do:** a bare known-**function** name with no argument list is rejected by the service
  `Expected '(' to follow a function: 'eq'. Located at position 1 within expression: 'eq'`, while
  `ExprErrorCode` in `packages/engine/src/expr/parser.ts` has no such member and the name takes the
  `unrecognized-value` path — so we render `Unrecognized value: 'eq'` for the same input. Add the
  code, route a name that matches the registry's *function* table to it, and extend the
  `errors.ts` shape table (it is `positioned`, with the help link).
  **Ground:** `research/experiments/E03-walk/bare-function-name-value.md` (C-E03-114) is the datum
  for `eq` in a variable value. Probe before coding: whether the same holds in a condition slot,
  what a bare *context* name does by contrast (C-E02-086 suggests `Unrecognized value`), and
  whether a status function outside its slot picks this message or the availability one.
  **Done:** the parity table in `packages/engine/test/expr/errors.test.ts` gains the new rows,
  compared byte-for-byte like the existing 62.
  *Done 2026-08-12:* `expected-function-call` is a positioned seventh parse error; it is selected
  by the per-slot function registry while legal contexts and unavailable status functions retain
  their distinct paths. Four live previews and the 82-test parity suite establish the behavior
  (C-E02-132..134; `research/experiments/E02-bare-functions/`).

## E02-S02 — As a pipeline developer, type coercions and comparisons behave exactly like the service, so my conditions don't flip meaning locally.
Acceptance: the documented conversion table implemented and cross-verified.

- [x] **E02-S02-T01 — Value model**
  **Do:** `ExprValue` = Null | Boolean | Number(double) | String | Version | Object | Array with kind tags; Version parsing (2–4 numeric parts).
  **Ground:** expressions doc "Types"/conversion sections; agent expressions SDK value kinds (pin). Record claim per type rule.
  **Done:** unit tests for construction/round-trip incl. Version edge cases (`1.2`, `1.2.3.4`, invalid).
  *Note (E02-S01-T01, C-E02-005):* "Version 2–4 parts" above is wrong — a Version has **3 or 4**
  segments; `1.2` is a Number, settled live by `gt(1.10, 1.9)` → False. The lexer already classifies
  both, so this task inherits the split rather than re-deciding it.
  *Done 2026-08-12:* `packages/engine/src/expr/value.ts` defines the seven-kind tagged model,
  parser-literal bridge, validated 3–4 segment Version constructor/parser, and tagged recursive
  round-trip encoding. `packages/engine/test/expr/value.test.ts`: 22 tests (C-E02-018/019).
- [x] **E02-S02-T02 — Coercion & equality table**
  **Do:** implement conversion matrix + `eq/ne/lt/le/gt/ge` semantics: ordinal-ignore-case string compare, Boolean→String `'True'/'False'`, String→Number invariant parse (failure semantics per doc), Null interactions, Version comparisons.
  **Ground:** the doc's conversion table verbatim (quote each cell you encode as a claim); ambiguous cells (`'' vs null`, objects in `eq`, number formatting of `0.5`) → oracle experiments with `${{ }}` probes; transcripts in `research/experiments/E02-coercion/`.
  **Done:** table-driven test file `coercion.table.ts` ≥ 120 rows, every row citing claim or experiment ID.
  *Done 2026-08-12:* `packages/engine/src/expr/coercion.ts`; exactly 120 comparison rows
  (20 grounded scenarios × 6 operators), each citing C-E02-020..023; 28 live preview transcripts.
- [x] **E02-S02-T03 — Member access semantics**
  **Do:** property/index on Objects/Arrays; missing member → Null; index into Null → Null (safe chaining); case-insensitivity of property names (verify!).
  **Ground:** expressions doc + oracle probes for case sensitivity and missing-member behavior; pin agent SDK `Get`/indexer code path.
  **Done:** tests incl. `variables['no.such']`, chained missing access.
  *Done 2026-08-12:* `packages/engine/src/expr/access.ts`; 21 live probes established
  context-specific object casing, null-propagating chains, and array index conversion (C-E02-024..027).

## E02-S03 — As a pipeline developer, every documented function works locally, so expressions never need rewriting.
Acceptance: full function set incl. status functions, each with cited behavior.

- [x] **E02-S03-T01 — Logical & membership: `and or not eq ne lt le gt ge in notIn contains containsValue`**
  **Do:** short-circuit `and`/`or`; string-only `contains`; `containsValue` for arrays and objects.
  **Ground:** expressions doc per-function entries — quote each signature+behavior as a claim; confirm short-circuiting via doc or agent SDK code (pin).
  **Done:** per-function test groups referencing claims.
  *Done 2026-08-12:* `packages/engine/src/expr/functions.ts`; 12 live probes and 16 tests cover all
  13 functions, including lazy short-circuiting and the grounded `contains`/`containsValue` split.
- [~] **E02-S03-T02 — String/util: `format join split replace lower upper trim length coalesce iif convertToJson counter`**
  *Superseded 2026-08-12 by E02-S03-T04: the current documented catalogue also includes
  `startsWith`, `endsWith`, and `xor`, so this task cannot satisfy the story's “every documented
  function” acceptance criterion (C-E02-040).*
  **Do:** `format` composite formatting incl. `{{`/`}}` escapes and index reuse; `counter(prefix, seed)` delegates to a state provider interface (local impl in E06); `convertToJson` object serialization.
  **Ground:** doc entries per function; `counter` semantics section (per-prefix persistence) — our local deviation (per-run local state) written up as a documented delta in the research note; `format` specifics validated by oracle probes (date-format claims belong to run-number task E05-S04, not here).
  **Done:** test groups per function; `counter` tested against the state-provider fake.
- [x] **E02-S03-T03 — Status functions: `always canceled failed succeeded succeededOrFailed` (with job-name args)**
  **Do:** implemented against an injected `StatusContext` (job/step results, dependency names); exact truth table per doc incl. behavior with arguments.
  **Ground:** conditions doc (…/process/conditions) truth tables + job status semantics — quote; the behaviour of args referencing skipped dependencies — settled 2026-08-12 by the real-run experiment below, since agent source covers the step level only.
  **Done:** truth-table tests; integration test with fake results store.
  *Done 2026-08-12:* `packages/engine/src/expr/status.ts`; scope-specific signatures and truth
  tables backed by 54 preview probes, one real agentless run, pinned agent source, and a fake-store
  integration test (C-E02-060..072; `packages/engine/test/expr/status.test.ts`).
- [x] **E02-S03-T04 — Remaining general functions: `startsWith endsWith xor format join split replace lower upper trim length coalesce iif convertToJson counter`**
  **Do:** implement the complete current documented general-function remainder; `format` composite
  formatting includes `{{`/`}}` escapes and index reuse; `counter(prefix, seed)` delegates to a
  state-provider interface (local impl in E06); `convertToJson` serializes Object/Array values.
  **Ground:** expressions-doc entries per function, including the catalogue drift recorded by
  C-E02-040; `counter` semantics section (per-prefix persistence) with our per-run local-state
  deviation documented in research; validate `format` specifics and any documentation/arity
  ambiguities with oracle probes (date-format claims belong to E05-S04).
  **Done:** per-function claim-linked test groups; `counter` tested against a state-provider fake;
  the implemented general-function registry matches the current documented non-status catalogue.
  *Done 2026-08-12:* all 15 functions in `packages/engine/src/expr/general-functions.ts`, with a
  28-name exact-catalogue registry, fake counter provider, 20 claim-linked tests, and 30 live
  preview probes (C-E02-041..051; `research/experiments/E02-general/`).

## E02-S04 — As an engine developer, expression contexts resolve like the service in each evaluation phase, so the same expression means the same thing at the same time.
Acceptance: `parameters`, `variables`, `dependencies`, `stageDependencies`, `resources.pipeline` contexts with phase gating.

- [x] **E02-S04-T01 — Context interface + parameters/variables**
  *Unblocked 2026-08-12: the earlier `[!]` reported the `AZDO_*` credentials missing, but they live
  in `.env.oracle`, which every `scripts/expr-*-survey.ts` loads via `loadEnvFile` rather than
  reading the ambient environment. The oracle probe ran.*
  **Do:** `ExprContext` provider API; compile-time contexts wired by E03; index & property syntax; unknown context name = error matching service.
  **Ground:** expressions doc context availability matrix (which contexts exist in which phase) — encode as a table with claims; verify one "not available here" error via oracle.
  **Done:** phase-gating tests (e.g. `dependencies` rejected at compile time).
  *Done 2026-08-12:* `packages/engine/src/expr/context.ts` — `ExprSlot`, the measured
  `SLOT_AVAILABILITY` grid, `registryForSlot`, `resolveContext`, and the `parameters`/`variables`
  context builders; `packages/engine/test/expr/context.test.ts` (31 tests). 61 live probes
  (`research/experiments/E02-context/survey.md`) found **three** slot-keyed name tables rather than
  the documented compile/runtime binary, and proved a wrong-slot context is rejected
  byte-identically to a nonexistent one — so gating needed no new error kind (C-E02-080..091).
- [x] **E02-S04-T02 — `dependencies` / `stageDependencies` shapes** *(done 2026-08-12. `packages/engine/src/expr/dependencies.ts` builds the case-insensitive `dependencies.<job>` and `stageDependencies.<stage>.<job>` objects with stable `result` and flattened `outputs['step.var']` fields; optional service metadata remains outside the expression contract. Grounded by the real run in `research/experiments/E02-dependencies/real-run.md`, which found empty same-stage dependencies across stages and the stage→job→outputs shape. Tests: 3 focused cases; engine suite 641 green.)*
  **Do:** context objects exposing `result` and `outputs['step.var']` per documented shape, backed by the runtime store (E06) at run time.
  **Ground:** jobs & stages dependency docs (…/process/expressions#dependencies + deployment-jobs doc for deployment naming quirks); **experiment**: real pipeline in test org dumping `convertToJson(dependencies)` at stage and job level; transcripts stored and cited (this shape is notoriously under-documented).
  **Done:** shape fixtures generated from the experiment; unit tests against them.
- [x] **E02-S04-T03 — `resources.pipeline.*` context** *(done 2026-08-12. **The task title's premise
  is wrong and the experiment is what found it: there is no `resources.pipeline` context.** Two real
  runs (`research/experiments/E02-resources/real-run.md`) read the same metadata three ways in a run
  that demonstrably had it — the context chain returns Null, while `variables['resources.pipeline.
  <alias>.runID']` and the `$( )` macro return the value, and `convertToJson(resources)` contains only
  `repositories` and `containers`. So `packages/engine/src/expr/resources.ts` ships **two** builders:
  `resourcesContext()` for the real context and `pipelineResourceVariables()` for the flat, runtime-only
  variable entries built from the lockfile pin. 15 tests in `packages/engine/test/expr/resources.test.ts`.
  This supersedes an earlier doc-only pass (C-E02-111/112, `pipelineResourcesContext`) that had modelled
  the family as a context object; those claims are marked superseded rather than deleted.)*
  **Do:** populate from pinned run metadata (lockfile, E08); fields per doc (`runID`, `sourceBranch`, etc.).
  **Ground:** resources doc (…/process/resources-pipelines… pin exact page) field list; sample metadata captured from a real run via REST stored in research.
  **Done:** tests reading lockfile-shaped input.

## E02-S05 — As a pipeline developer, conditions and runtime expressions execute in the generated scripts without any interpreter, so the output stays dependency-free but behaves live.
Acceptance: AST→bash compiler with conformance vs the evaluator.

- [x] **E02-S05-T01 — Bash compilation of predicates & strings**
  *Done 2026-08-12:* `packages/engine/src/expr/compile-bash.ts` compiles literals, variable reads,
  status/predicate calls, logical/comparison expressions, and helper-backed string calls with
  shell-safe quoting; unsupported dynamic access/functions raise `BashCompileError`. Golden tests
  cover the documented condition shape, quote escaping, and fallback behavior.
  **Do:** `packages/engine/src/expr/compile-bash.ts`: comparisons/logical ops → `[ ]`/`&&`/`||` with correct quoting; string ops → emitted helper functions in `lib/expr.sh`; store reads via `azdo_var`/`azdo_output` runtime API (E06). Unsupported-in-shell nodes → typed fallback error at convert time (docs/02 §6 policy).
  **Ground:** docs/02 §6 compiled examples as the spec; POSIX/bash semantics claims (quoting, exit codes) cited from GNU bash manual (pin section links) — external-but-real grounding required for shell semantics.
  **Done:** golden tests: expression → emitted bash snapshot; shellcheck-clean output.
- [x] **E02-S05-T02 — Dual-backend conformance harness**
  *Done 2026-08-13:* `packages/engine/test/expr/conformance.table.ts` is the single row set;
  `conformance.test.ts` runs it through the evaluator entry points, asserts the compiler's
  disposition per row, and **generates** `packages/runtime/test/expr-conformance.bats` (104 executed
  rows) as a committed file whose staleness fails the engine suite. Every row carries its claim ID
  in both test names. Building the runner falsified T01's compiled output (C-E02-145), so
  `compile-bash.ts` was rewritten around a kind-tagged value model and `packages/runtime/lib/expr.sh`
  — named in T01's **Do** but never written — now exists. Three divergences are declared as rows
  with the measured shell answer (C-E02-138/143/144), five constructs are asserted to raise
  `BashCompileError`, and nothing is skipped. Three mutation checks confirm the gate is real.
  **Do:** the E02-S02/S03 test tables execute through both the evaluator and the compiled bash (via bats running each compiled snippet against a fixture store); one table, two runners.
  **Ground:** BACKLOG §3 (protocol); claims already attached to table rows carry over — harness must print claim IDs on failure.
  **Done:** CI job runs both; divergence = red build.
- [ ] **E02-S05-T03 — AST evaluator (`evaluateExpression(node, context)`)**
  *Filed 2026-08-13 by E02-S05-T02, which needed it and found it absent.* docs/02 §6 promises "one
  implementation, two backends", but only the **shell** backend consumes an `ExprNode`: the eval
  side is a set of per-family entry points (`compareValues`, `evaluateLogicalMembershipFunction`,
  `evaluateGeneralFunction`, `evaluateStatusFunction`) that callers must wire together by hand, and
  no E02 task ever allocated the walker. T02's rows therefore carry an explicit `evaluate()` thunk;
  once this lands, those thunks collapse into one call and the table gets strictly stronger.
  **Do:** `packages/engine/src/expr/evaluate.ts`: recursive walk over `ExprNode` threading an
  `ExprContext` (E02-S04-T01) and a `StatusContext`, dispatching to the existing family evaluators,
  preserving argument laziness for `and`/`or`/`coalesce`, applying the null-propagating access rules
  of C-E02-024..027 and the `parameters` miss policy of C-E02-087. Errors are *evaluation* errors
  (`ExprConversionError`, `ExprKeyNotFoundError`), never parse errors.
  **Ground:** no new service behavior — every rule is already claimed in `research/E02-expressions.md`
  (C-E02-020..032, 041..051, 060..072, 080..091). The task is to compose them; cite the claim per
  dispatch branch. Any behavior *not* covered by an existing claim needs its own oracle probe first.
  **Done:** every `evaluate()` thunk in `conformance.table.ts` replaced by `evaluateExpression`, with
  the table's expectations unchanged; laziness cases from `functions.test.ts` re-asserted through the
  walker.
