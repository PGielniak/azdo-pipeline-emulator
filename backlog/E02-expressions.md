# E02 — Runtime expressions & conditions

Phase: P2 · Depends on: E00, E06 (fixture-store APIs) · Design: docs/02 §6
Primary grounding set: learn.microsoft.com/azure/devops/pipelines/process/expressions · …/process/conditions · `actions/runner` `src/Sdk/DTExpressions2` (open fork, shape reference only) · real hosted-agent runs for runtime-only truth tables.

> **Re-scoped by the simplification (docs/07).** This epic was originally "reimplement the whole
> expression language for both compile-time `${{ }}` and runtime `$[ ]`". Now it is **runtime only**:
> the parser / evaluator / bash compiler built in S01–S05 serve `$[ ]` job & step conditions and
> `dependencies.*.outputs` — the part the **agent** evaluates at run time and which therefore cannot
> be delegated to the service. Compile-time `${{ }}` evaluation is the server's job (PLAN D3); the
> machinery is retained only as the offline fallback and is demoted off the critical path (see E12).
> All S01–S05 work carries over and is `[x]`; the full completion detail lives in CHANGELOG-BACKLOG.md.
>
> **Demotion sweep result (2026-08-22, E12-S01-T02): nothing in this epic is `[~]`, and that is a
> finding, not an omission.** The sweep looked for "old E02 compile-time evaluation entry points"
> and found none to demote: every task here is `[x]` (S03-T02 was already `[~]`, superseded by
> S03-T04), so there is no unbuilt compile-time scope to cut, and marking delivered code `[~]`
> would misreport it. The one shared entry point, `evaluateExpression` (S05-T03), serves **both**
> halves — runtime `$[ ]` on the default path and the offline fallback's `${{ }}` — so it is not a
> compile-time-only surface either. The demotion is therefore recorded at epic level (above) and
> nowhere else.

## E02-S01 — As an engine developer, the documented expression grammar parses into one AST, so runtime conditions and the offline fallback never diverge structurally.
Acceptance: parser covers the full documented syntax; parse errors match server style.

- [x] **E02-S01-T01 — Tokenizer + parser**
  **Do:** `packages/engine/src/expr/{lexer,parser}.ts`: single-quoted strings (`''` escape), numbers, booleans, null, identifiers, property/index access, function calls, nesting; AST nodes carry spans.
  **Ground:** expressions doc syntax; cross-read the agent SDK tokenizer (pin permalinks); 74 live probes settled the grammar (no operators; case-insensitive booleans) — C-E02-001…005.
  **Done:** parser test table ≥ 60 cases incl. errors; spans verified.
- [x] **E02-S01-T02 — Server-style parse errors**
  **Do:** error messages carry the offending expression with a caret position, mirroring service phrasing.
  **Ground:** 66 live rejections replayed as a parity table (`research/experiments/E02-errors/`).
  **Done:** snapshot tests match collected shapes; documented divergences asserted.
- [x] **E02-S01-T03 — Missing error kind: `Expected '(' to follow a function`**
  **Do:** route a bare known-function name to a positioned seventh parse error.
  **Ground:** C-E03-114 + 4 live previews (`research/experiments/E02-bare-functions/`).
  **Done:** parity table gains the rows, compared byte-for-byte.

## E02-S02 — As a pipeline developer, type coercions and comparisons behave exactly like the service, so my conditions don't flip meaning locally.
Acceptance: the documented conversion table implemented and cross-verified.

- [x] **E02-S02-T01 — Value model**
  **Do:** `ExprValue` = Null | Boolean | Number | String | Version(3–4 parts) | Object | Array, kind-tagged.
  **Ground:** expressions doc "Types" section; agent SDK value kinds (pin). C-E02-018/019.
  **Done:** unit tests incl. Version edge cases.
- [x] **E02-S02-T02 — Coercion & equality table**
  **Do:** conversion matrix + `eq/ne/lt/le/gt/ge`; ordinal-ignore-case strings, Boolean→String, invariant String→Number, Null interactions, Version comparisons.
  **Ground:** the doc's conversion table verbatim + 28 live preview transcripts (`research/experiments/E02-coercion/`).
  **Done:** `coercion.table.ts` 120 rows, each citing a claim/experiment id.
- [x] **E02-S02-T03 — Member access semantics**
  **Do:** property/index on Objects/Arrays; missing member → Null; null-propagating chains; case rules per context.
  **Ground:** 21 live probes (C-E02-024..027).
  **Done:** tests incl. `variables['no.such']`, chained missing access.

## E02-S03 — As a pipeline developer, every documented function works locally, so conditions never need rewriting.
Acceptance: full function set incl. status functions, each with cited behavior.

- [x] **E02-S03-T01 — Logical & membership functions**
  **Do:** short-circuit `and`/`or`; string-only `contains`; `containsValue` for arrays/objects; `in`/`notIn`.
  **Ground:** 12 live probes; per-function claims (C-E02-028..032).
  **Done:** per-function test groups referencing claims.
- [~] **E02-S03-T02 — String/util functions** — *superseded 2026-08-12 by E02-S03-T04 (catalogue drift: `startsWith`/`endsWith`/`xor` were missing — C-E02-040).*
- [x] **E02-S03-T03 — Status functions: `always canceled failed succeeded succeededOrFailed`**
  **Do:** against an injected `StatusContext`; exact truth table per scope.
  **Ground:** conditions doc truth tables + one real agentless run + pinned agent source (C-E02-060..072).
  **Done:** truth-table tests; integration test with a fake results store.
- [x] **E02-S03-T04 — Remaining general functions**
  **Do:** complete the current documented general-function catalogue; `format` with `{{`/`}}` escapes; `counter(prefix, seed)` via state-provider seam; `convertToJson`.
  **Ground:** expressions-doc entries + 30 live probes (C-E02-041..051).
  **Done:** 28-name catalogue registry; claim-linked test groups.

## E02-S04 — As an engine developer, expression contexts resolve like the service in each slot, so the same expression means the same thing at the same time.
Acceptance: `variables`, `dependencies`, `stageDependencies`, `resources` contexts with slot gating.

- [x] **E02-S04-T01 — Context interface + parameters/variables**
  **Do:** `ExprContext` API; per-slot availability grid; `parameters`/`variables` builders.
  **Ground:** 61 live probes measured three slot-keyed name tables (C-E02-080..091).
  **Done:** slot-gating tests; `parameters` miss policy.
- [x] **E02-S04-T02 — `dependencies` / `stageDependencies` shapes**
  **Do:** case-insensitive `dependencies.<job>` / `stageDependencies.<stage>.<job>` with `result` + flattened `outputs['step.var']`.
  **Ground:** real run transcript (`research/experiments/E02-dependencies/real-run.md`).
  **Done:** shape fixtures generated from the experiment.
- [x] **E02-S04-T03 — `resources.pipeline.*` (variable family, not context)**
  **Do:** `resourcesContext()` + `pipelineResourceVariables()` for the flat runtime-only entries.
  **Ground:** two real runs (`research/experiments/E02-resources/real-run.md`) — C-E02-120..127.
  **Done:** tests reading lockfile-shaped input.

## E02-S05 — As a pipeline developer, conditions and runtime expressions execute in the generated scripts without any interpreter.
Acceptance: AST→bash compiler with conformance vs the evaluator.

- [x] **E02-S05-T01 — Bash compilation of predicates & strings**
  **Do:** `packages/engine/src/expr/compile-bash.ts`; comparisons/logical → `[ ]`/`&&`/`||`; string ops → helpers in `lib/expr.sh`; store reads via `azdo_var`/`azdo_output`.
  **Ground:** docs/02 §6 compiled examples; GNU bash manual for quoting/exit-code semantics.
  **Done:** golden tests; shellcheck-clean output.
- [x] **E02-S05-T02 — Dual-backend conformance harness**
  **Do:** one row table driving the evaluator and the compiled bash (bats vs fixture store); claim IDs on failure.
  **Ground:** BACKLOG §3; claims attached to rows carry over.
  **Done:** CI runs both; divergence = red build.
- [x] **E02-S05-T03 — AST evaluator (`evaluateExpression`)**
  **Do:** recursive walk over `ExprNode` threading `ExprContext` + `StatusContext`, preserving argument laziness.
  **Ground:** compose existing claims (C-E02-020..091); no new service behavior.
  **Done:** every `evaluate()` thunk in the table replaced by `evaluateExpression`.
- [x] **E02-S05-T04 — Filtered-array evaluation**
  **Do:** ground + implement `.*` / `[*]` traversal in the evaluator.
  **Ground:** 24 live preview probes + pinned `actions/runner` `Index.cs` (C-E02-160..164).
  **Done:** every measured cell is a permanent evaluator case; shell backend limitation declared.
