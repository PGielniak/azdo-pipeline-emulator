# 02 — Template & expression engine

The hard core of the project: reimplementing what the Azure DevOps service does between "YAML files in repos" and "final expanded pipeline". References: templates doc (…/process/templates), expressions doc (…/process/expressions), runtime-parameters doc, and — corrected 2026-07-30 (C-E00-012/013) — the C# engine sources in the `actions/runner` fork (`src/Sdk/DTExpressions2`, `DTObjectTemplating`, `DTPipelines`) as the open behavioral reference; `microsoft/azure-pipelines-agent` itself has no engine sources (it consumes the closed expressions NuGet; runtime conditions evaluated in `src/Agent.Worker/ExpressionManager.cs`). Parity is verified against the real service via the preview endpoint (§8), which outranks the fork on any divergence.

## 1. When things evaluate (the phase model)

| Phase | Happens (service) | Happens (us) | Constructs |
|---|---|---|---|
| Compile time | Server, at queue | `azdo-emu convert` | template includes/`extends`, parameter binding, `${{ }}` expressions, `${{ if/elseif/else }}`, `${{ each }}`, `${{ insert }}` |
| Job dispatch | Server, when job is about to run | job start in `run-job.sh` | `$[ ]` runtime expressions (variable values), stage/job `condition:`, `dependencies` / `stageDependencies` contexts, `counter()` |
| Step execution | Agent, per step | `run_step` | `$(macro)` textual substitution in task inputs; step `condition:` |

Consequence of doing compile-time at convert: a converted project is a snapshot of one parameter set. Changing a **runtime parameter** requires re-convert (fast, offline with `--frozen`) — or not: for parameters only used in *runtime* positions we pass them through to `.env`. The README of the generated project lists which parameters were baked in.

## 2. Expansion algorithm

```
expand(rootFile, cliParameters):
  dom  = parse(rootFile)                         # expressions inert
  params = bindRuntimeParameters(dom.parameters, cliParameters)   # typed, values-validated
  ctx  = { parameters: params, variables: collectFileVariables(dom), system }
  out  = walk(dom, ctx)
  validate(out, strictSchema); enforceServerLimits(out)
  return out

walk(node, ctx):                                  # depth-first over the DOM
  mapping → for each key:
      key is '${{ if C }}' / '${{ elseif C }}' / '${{ else }}' → §4 conditional insertion
      key is '${{ each k in coll }}'                            → §4 iterative insertion
      key is '${{ insert }}'                                    → merge evaluated mapping into parent
      else: evalKey(key, ctx) → walk(value, ctx)
  sequence → same directive handling for mapping-items; flatten insertions
  scalar  → interpolate(scalar, ctx)              # §3 lone-expression vs string-concat
  template reference → resolveTemplate(ref, ctx)  # §5: fetch file, bind ITS parameters,
                                                  # recurse with the template file's own context
```

`extends` is expansion of the target template with the root's `parameters:` bound — the root contributes only `resources`, `parameters`, `variables`(root), `trigger/pr/schedules`, `pool`, `name`; everything else must come from the template (enforced, matching server error).

Server limits enforced identically so we fail where the server would: max distinct files, max nesting depth, max expanded size (exact current numbers pulled from the docs at implementation time and encoded as named constants with doc links).

## 3. Scalar interpolation rules (exact server semantics)

- A scalar that is **exactly one expression** (`${{ parameters.jobs }}`) evaluates to the expression's typed result — if it is a mapping/sequence it is inserted **structurally**, not stringified.
- Mixed content (`name-${{ parameters.suffix }}`) → each expression stringified and concatenated; Null → empty string, Boolean → `True`/`False` (server casing!), Number → invariant format.
  - **How the service actually does it (grounded 2026-08-12, C-E02-109):** it compiles the whole scalar into a synthetic `format('<literal with {0} holes>', <expr>, …)` call and parses *that* — a parse error in `prefix ${{ null }} suffix` is reported as `position 29 within expression: 'format('prefix {0} suffix', null)'`, and a block scalar becomes one `format` whose literal carries real newlines. So the concatenation rule above is `format`'s stringification, not a separate one, and E03-S01-T05 can reuse the same code path. Our own diagnostics deliberately report the user's expression rather than the synthetic text, which appears nowhere in their file.
- Expressions may appear in mapping **keys**; result must stringify.
- After evaluation the result is **not re-parsed as YAML** (no injection); structural insertion happens on the DOM only.

## 4. Directives

**Conditional insertion** — mapping keys / sequence items `${{ if C }}:`, `${{ elseif C }}:`, `${{ else }}:` — chains resolved in document order; contents spliced into the parent on the winning branch. Works in mappings and sequences.

**Iterative insertion** — `${{ each x in seq }}:` splices the body once per element (sequence) or per key (`x` = key; `seq[x]` unavailable — use `${{ each pair in mapping }}` → `pair.key` / `pair.value`). Iteration variables live in the expression context for the body. Nested `each` supported. Loop over `parameters` of type `object`, `jobList`, `stepList` etc. is the bread-and-butter template pattern — first-class tests.

**`${{ insert }}`** — merge a mapping into the parent mapping (used e.g. to inject extra keys into a job).

**Recognition rules (measured 2026-08-12, E03-S01-T01, C-E03-100..113; 33 preview probes in `research/experiments/E03-walk/`).** The four paragraphs above describe what the directives *do*; none of the rules below is stated by either doc, and three of them are the opposite of the natural guess:

- **The keyword set is closed and case-sensitive** — lower-case only. `${{ IF … }}`, `${{ EACH … }}`, `${{ INSERT }}` are rejected, and rejected *as expressions*: a wrongly cased keyword is not a mis-spelled directive, it is not a directive at all and the whole delimited text falls through to ordinary expression parsing. This is the only case-sensitive corner of the language — names, functions and boolean literals all fold case (C-E02-002/011/012).
- **Directive parameters are top-level expression units, not whitespace-split words.** `eq(1, 1)` counts as one, which is why `${{ else if eq(1, 1) }}` is rejected "Exactly 0 parameter(s) were expected following the directive 'else'. Actual parameter count: 2". Expected counts: `each` 3, `else` 0, `insert` 0; `if`/`elseif` never produce that sentence and fall through to an expression parse instead. **Implementation consequence:** the directive text is tokenized with the expression lexer, never string-split — `${{ each item in split('a in b', ' in ') }}` iterates `a`,`b`, and an `indexOf(' in ')` splitter iterates the wrong collection *silently*.
- **Loop variables share one flat namespace with the contexts, and redefinition is an error rather than shadowing**: `${{ each variables in … }}` → "The idenfifier 'variables' has already been defined within the current scope" (the service's own typo). Variable names fold case; the keyword does not.
- **Directives are recognized on mapping keys and one-key sequence items only** — never on a scalar value, where `${{ if … }}` is rejected `Unexpected value '<raw>'` with no expression error at all.
- **Position sensitivity is real but narrow, and the template-expressions doc's statement about it is wrong.** That doc says expressions are expanded "only for `stages`, `jobs`, `steps`, and `containers`" and not inside `trigger` — but `trigger: [${{ 'main' }}]` expands, as does an expression in `pool.demands`, and an `if` directive expands in `pool.demands` and in root `variables:`. Exactly one position rejects a directive with its own sentence, `A template expression is not allowed in this context`: inside `resources.repositories`. Inside `trigger:` a directive is simply left unexpanded and then fails schema validation. So the gate is a per-position attribute with one measured member and is modelled as a seam, not as a table extrapolated from the doc's list.

## 5. Template resolution

Reference forms, all supported (P1 local, P3 remote):

```yaml
- template: steps/build.yml                 # relative to the REFERRING file
- template: /pipelines/steps/build.yml      # repo-root-relative
- template: build.yml@templates             # alias from resources.repositories
- template: build.yml@self                  # explicitly the source repo
  parameters: { toolset: msbuild }
```

- Path resolution is per-file: relative paths resolve against the directory of the file containing the reference; `@alias` switches repo context (and stays for nested relative refs within that file).
- Remote aliases resolve through the Loader/Fetcher (docs/05): ADO Git or GitHub, ref taken from `resources.repositories[].ref` (default branch when absent), pinned to a commit SHA in the lockfile.
- Template `parameters:` are **typed**: `string, number, boolean, object, step, stepList, job, jobList, deployment, deploymentList, stage, stageList`. Binding validates type and `values:`; missing required parameter = convert error (server-identical message shape). Extra parameters = error.
- Each template file expands in **its own context**: its bound parameters + its own `variables` (per official rule that templates see their own parameters, not the caller's). What exactly the compile-time `variables.*` context contains across files (root vs template-local, declaration order effects) is under-documented → resolved empirically via the oracle (§8) and encoded as table-driven tests; the engine keeps this policy in one function (`compileTimeVariableScope(file)`) so oracle findings are easy to apply.
- `templateContext` on stages/jobs/steps passes an arbitrary payload into templates iterating over `*List` parameters — supported as opaque data.
- Cycle detection on (file, repo, commit) tuples; depth counter for the server limit.

## 6. The expression language

One implementation, two backends:
- **Eval backend** (convert time): full evaluator over the typed DOM.
- **Shell backend** (run time): compiles the same AST to bash (later pwsh) predicates/string builders that read the local state store — used for `condition:`, `$[ ]`, dependency outputs. No interpreter ships in the output.

**Implementation status (2026-08-18):** `evaluateExpression` walks the parser's AST and composes the
grounded value, context, access, general, logical, and status evaluators. Filtered arrays (`.*` /
`[*]`) are supported by the eval backend: a wildcard returns every Array item or Object value in
order; later postfixes map over the children, omit misses/non-collections, and retain present empty
values; another wildcard flattens one collection level; and a wildcard over Null, missing, or a
primitive returns an empty filtered array (C-E02-160..164). The result keeps filtered identity, so
`groups.*[0]` selects item zero from every child Array rather than item zero from the result. The
shell backend continues to reject filtered traversal because its scalar store cannot represent
Object/Array values.

### Types & coercion
Types: Null, Boolean, Number (double), String, Version, Object/Array. Implement the documented conversion table exactly: comparisons convert the right operand to the left kind; `eq`/`ne` return false/true on conversion failure while ordered comparisons error; strings compare **ordinal ignore-case**; Boolean→String is `'True'/'False'`; String→Number accepts invariant decimal/grouped text. Version **literals** have 3–4 parts, while String/Number conversion can produce 2–4 (corrected 2026-08-12, C-E02-005/021/022). Object/Array equality is reference identity (C-E02-023). Table-driven unit tests + oracle cases back every murky corner.

**Syntax (grounded 2026-08-11, C-E02-001).** The language has **no operators at all** — the service rejects `1 == 1`, `!true`, `a && b`, `a || b`, `>`/`<`, and even parenthesised grouping `(true)`, while accepting `eq(1, 1)` in the same position. The grammar is therefore `primary postfix*` with primaries `boolean | number | version | string | namedValue | function '(' args ')'` and postfixes `.name`, `.*`, `[expr]`, `[*]`; no precedence climbing, and `(` is legal only directly after a function name. `null` is not a literal either (it is an unresolvable *name*, C-E02-003). Function and context names are case-insensitive and are resolved — with their arity — **while parsing** (C-E02-011/012), and nesting is capped at depth 50 counting function arguments only, member-access chains being free (C-E02-014). Implementation: `packages/engine/src/expr/{lexer,parser}.ts`; evidence: `research/experiments/E02-grammar/survey.md`.

**Error rendering (grounded 2026-08-12, C-E02-101..110).** A rejection is rendered
`<file> (Line: L, Col: C): <sentence>. Located at position N within expression: '<expr>'. For more help, refer to <fwlink>`, where `L`/`C` locate the **host scalar** and `N` is 1-based inside the expression *after the service trims the delimited text*; two of the seven error kinds carry no position and one carries no help link. Runtime (`$[ ]`) errors drop the file coordinates for `An error occurred while loading the YAML build pipeline.` and are otherwise identical. A bare name registered as a function adds the seventh kind, `Expected '(' to follow a function: '<name>'` (C-E02-132); a bare legal context remains a named value and a status-function spelling outside its slot stays `Unrecognized value` (C-E02-133/134). Also measured: name resolution is **deferred** behind the syntax parse (`nosuchfunc(1) 2` reports the trailing `2`, `eq(1) 2` reports the arity error), the service reports *every* bad expression in a document, and it truncates a compile-time message at 500 characters mid-word. Implementation: `packages/engine/src/expr/errors.ts` — which renders the service's sentence verbatim but ranges the **offending token** so the code frame can caret it, and never truncates; evidence: `research/experiments/E02-errors/` (64 live rejections, replayed row by row as a parity test) and `research/experiments/E02-bare-functions/`.

### Contexts
`parameters.*`, `variables.*` (incl. `variables['dotted.name']`), `dependencies.<job>` (`result`, `outputs['step.var']`), `stageDependencies.<stage>.<job>`, `resources.repositories.<alias>.*` and `resources.containers.<alias>.*`, `pipeline.*`, `environment.*` (deployment). **`resources.pipeline.<alias>.*` is deliberately not in that list (grounded 2026-08-12, C-E02-120/121):** the twelve documented pipeline-resource fields are predefined *variables* whose names merely look like a path — measured live, the context chain returns Null while `variables['resources.pipeline.<alias>.runID']` and the `$( )` macro return the value, and `convertToJson(resources)` contains only `repositories` and `containers`. They are built by `pipelineResourceVariables()` (from the lockfile pin) into the **runtime** variables table only, and are readable in a job/stage `condition:` through `variables[…]` even though `resources` itself is rejected there. Index syntax and property syntax both use the same null-propagating operation: missing member and access into Null/non-collections → Null, enabling safe chains. Object values carry a key-comparison policy because nested parameter objects are ordinal case-sensitive while variables are ordinal-ignore-case (C-E02-024..027). Array indices convert to Number, floor non-negative fractions, and return Null when invalid/out of range.

**Availability (grounded 2026-08-12, C-E02-080..091).** Which contexts exist is a property of the **slot**, not of a compile/runtime phase, and there are **three** tables rather than the doc's two: `${{ }}` values and `${{ if }}` carry `parameters` + `variables`; a root `$[ ]` variable carries `variables` + `resources` + `pipeline`; a job or stage `condition:` carries `variables` + `dependencies` + `stageDependencies` + `pipeline`. `resources` and `dependencies` are a double dissociation — each is legal in exactly one of the two *runtime* slots and rejected in the other — which is why the gate is keyed on `ExprSlot`. A wrong-slot context is rejected **byte-identically** to a nonexistent one (`Unrecognized value: '<name>'` at position 1), so gating is a per-slot `namedValues` set handed to `parseExpression` and needs no new error kind. Two slots validate nothing and can never be used as evidence: a step `condition:` (already recorded as decision 17) and, newly measured, a **job-scoped** `variables:` value, where `$[ nosuchcontext.probe ]` and even `$[ eq(1) ]` are accepted. Two provider rules do not follow the general value model: the top-level `parameters` context folds key case *and* raises `Key not found 'x'` on a miss — an evaluation error whose shape appears nowhere in the parse-error corpus — while `variables` folds case, null-propagates, and is **flat**, so `variables['My.Var']` finds a dotted name that `variables.My.Var` cannot. The compile-time `variables` table includes the predefined `system.*` variables. The function table is slot-keyed in both directions: status functions are condition-only (C-E02-065) and `counter` is legal in **exactly one** slot, the runtime variable — rejected in both conditions *and* in a compile-time `${{ }}` variable definition, which is narrower than Learn's "only in an expression that defines a variable" (C-E02-096). Implementation: `packages/engine/src/expr/context.ts`; evidence: `research/experiments/E02-context/survey.md` (65 live probes).

### Functions (implement all; ✱ = stateful/local behavior noted)

`and or not xor eq ne lt le gt ge in notIn contains containsValue startsWith endsWith format join split replace length lower upper trim coalesce iif convertToJson counter✱` — plus status functions valid only in conditions: `always() canceled() failed([names]) succeeded([names]) succeededOrFailed([names])`.

- `counter(prefix, seed)`✱: per-prefix state file under `<out>/.work/.state/counters/` incremented per local run — mirrors "per pipeline+prefix" semantics locally.
- `format`: composite formatting incl. `{{` escapes; date specifiers only exist in the `name:` run-number context (separate mini-formatter shared with `Build.BuildNumber` evaluation).
- Status functions read the runtime results store; `succeeded('A','B')` checks named dependencies (docs/04 §6).

**General-function corrections (grounded 2026-08-12, C-E02-041..051).** The implemented non-status registry is checked as an exact set against the current Learn catalogue, including the newly documented `startsWith`, `endsWith`, and `xor`. Live preview corrects four gaps in the prose: `iif` is exactly three arguments and evaluates both branches eagerly (not minimum one); `counter` parses with one or two arguments (not exactly two), exists only in `$[ ]` variable definitions, and passes an absent seed through the E06 state-provider seam rather than inventing a default in E02; `length` counts Object properties in addition to Strings and Arrays; and `split` treats its delimiter as one exact string, preserving empty fields, while an empty delimiter leaves the input unsplit. `format` supports reordered/reused numeric indexes and doubled braces and reproduces the service's invalid-format/missing-index errors; DateTime specifiers remain owned by E05-S04 because E02 has no DateTime value kind. Evidence: `research/experiments/E02-general/` (30 live preview probes).

**Status functions (grounded 2026-08-12, C-E02-060..072).** They are the only family with **two implementations behind one spelling**, and the split is by *slot*, not by preference. A **step** condition is evaluated by the agent, where all five take exactly zero arguments; four read `Agent.JobStatus`, defaulting to `Succeeded` when unset, while `always()` returns literal True without reading context (which is why `succeeded()` is true on a job's first step, and why an absent `condition:` means `succeeded()`). `canceled()` there is the *job's* status, not run-level cancellation. A **job/stage** condition is evaluated by the orchestrator, where `always`/`canceled` stay 0-arity but `succeeded`/`failed`/`succeededOrFailed` take 0..N dependency names — ordinary expressions converted to String, matched case-insensitively, never validated against the graph (an unknown name is simply False, not an error). Arguments **replace** the dependency set rather than filtering it. Three measured rules do not follow from the docs: `succeeded()` is all-of while `failed()` is any-of; `succeededOrFailed()` is any-of **except over an empty dependency set, where it is True**, so Learn's "evaluates to `True` regardless" and "like `always()`, except … when the pipeline is canceled" are both wrong — it is also False when every dependency was skipped, which is exactly why Learn's own entry recommends `not(canceled())` there; and a job whose *condition itself* errors completes as **`Abandoned`**, a sixth result Learn never lists, which no status function except `always()` matches. The family exists in the condition table only: `${{ always() }}`, `${{ if succeeded() }}` and even `$[ always() ]` in a variable are all rejected `Unrecognized value`, so "conditions, but not variable definitions" is enforced by the service, not advice. Implementation: `packages/engine/src/expr/status.ts` (scope-tagged `StatusContext`, scope-dependent signature table); evidence: `research/experiments/E02-status/` — 54 live preview calls for legality/arity plus one real agentless run for the truth tables, because preview never *evaluates* a status function.
- Function list is re-synced against the expressions doc at implementation time; unknown function = convert error naming the doc.

### Compilation examples (shell backend)

```yaml
condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
```
```bash
# generated into the job's conditions.sh
cond_step_040() {
  azdo_status_succeeded && azdo_expr_cmp eq str "$(azdo_var 'Build.SourceBranch')" str refs/heads/main
}
```

```yaml
variables:
  isMain: $[ eq(variables['Build.SourceBranch'], 'refs/heads/main') ]   # runtime expr
```
```bash
# evaluated once at job start, result written into the job's variable store
azdo_var_set 'isMain' "$(azdo_expr_cmp eq str "$(azdo_var 'Build.SourceBranch')" str refs/heads/main; azdo_expr_bool $?)"
```

Cross-job output reference `$[ dependencies.A.outputs['setSha.short'] ]` compiles to a read of `.work/state/outputs/<stage>/A/setSha.short` with Null→empty fallback. String functions that are awkward in pure bash (`format`, `replace`, `trim`, …) compile to calls on `packages/runtime/lib/expr.sh` — still plain bash, sourced by the generated project.

**Comparisons do not compile to `[ ]` (corrected 2026-08-13, C-E02-145).** The first version of the compiler mapped `eq`/`lt`/… onto `test` operators, which loses the one thing the conversion table needs: the operand's *kind*. `eq(1, true)` is True by Boolean→Number conversion and `[ "1" = True ]` is silently False; `lt('alpha','BETA')` needs ordinal-ignore-case ordering that `-lt` cannot express at all. Every value therefore crosses into the shell as its **String form** carrying a kind tag — `bool | num | str | ver` — and `azdo_expr_cmp <op> <lkind> <l> <rkind> <r>` reproduces `compareValues()` there. Exit status is the datum: **0 True, 1 False, 2 evaluation error**, chosen because `test` itself already reserves >1 for errors and a missing helper exits 127 (C-E02-135/136). String operations pin `LC_ALL=C`, because `[[ < ]]` and `${v^^}` are both locale-collated and would otherwise give different answers on different developer machines (C-E02-142).

**Three declared divergences**, each pinned by a row in the conformance harness so it can neither widen nor silently disappear:
- **No Null.** A missing store read is the empty String. Equality is unaffected (Null `==` `''`), but an *ordered* comparison against a missing variable answers instead of raising (C-E02-138).
- **Errors do not propagate across `||` or out of a value position.** `or(<error>, true)` answers True because an OR list cannot tell status 2 from status 1, and a helper's error status inside `"$( … )"` is discarded with the substitution (C-E02-143/144). A status-preserving condition protocol belongs with the runtime's condition evaluation (E06-S03-T03), not with the compiler.
- **Non-ASCII case folding** differs from .NET OrdinalIgnoreCase under `LC_ALL=C` (C-E02-141).

Anything the shell backend cannot express falls back to **convert-time evaluation with a `degraded` warning** if inputs are static, else a convert error explaining the construct. Measured, that set is: Object/Array values and the functions that produce or consume them (`split`, `join`, `convertToJson`, `containsValue`), a dynamic index, and `counter`, which reads the convert-time state provider (C-E02-139).

**Parity is enforced, not asserted (E02-S05-T02).** One row table — `packages/engine/test/expr/conformance.table.ts` — drives both backends: the evaluator through the E02-S02/S03 entry points, and the compiled bash through `packages/runtime/test/expr-conformance.bats`, which is generated from that table (`pnpm expr-conformance-bats`) and committed. The engine suite fails while the generated file is stale, so a compiler change that is not regenerated is red rather than untested. Each row declares what the shell backend is allowed to do — agree, refuse with `BashCompileError`, or diverge with a claim and the measured answer — and nothing is skipped.

## 7. Provenance

Expansion maintains an origin map: every output DOM node → stack of `(file, line, repo@sha, templateParams-hash)`. Uses: step-header comments (`# from: templates/build.yml:14 (via azure-pipelines.yml:22)`), error messages, `expansion-map.json` next to `pipeline.expanded.yml`, and the manifest. This is a first-class feature — debugging template-heavy pipelines is exactly where users bleed time.

## 8. Oracle verification (the parity contract)

`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1` with `{"previewRun": true, "yamlOverride": "<candidate yaml>", "templateParameters": {…}}` returns the service's `finalYaml` **without running anything**. (api-version 7.1 and the single-field `{finalYaml}` response confirmed live in E00-S03-T02, C-E00-022; requires a real pipeline definition to hang the preview on — the harness maintains one dummy definition in the test org.) Client: `packages/fetch/src/oracle.ts`.

Three live-verified traps the harness must respect (C-E00-024/025/026, transcripts in `research/experiments/oracle-spike/`): an **empty `yamlOverride` returns 200** carrying the *committed* YAML rather than erroring, so a fixture generated from an empty override is silently wrong; an **invalid PAT returns 302** to a sign-in page, not 401, so the HTTP client must not follow redirects; and a **missing `pipelineId` returns 500**, not 404, so 5xx here must not be blindly retried as transient.

- `azdo-emu preview-diff <yaml>`: expands locally, fetches `finalYaml`, normalizes both (key order, insignificant whitespace, server-injected defaults), semantic-diffs, exits non-zero on drift.
- CI: nightly corpus run (docs/06 §3). Every ambiguity we resolve empirically becomes a permanent fixture pair so regressions in *our* engine — or behavior changes in *their* service — surface immediately.
- Known ambiguity backlog to resolve via oracle, tracked as fixtures: compile-time variable visibility across template files; declaration-order effects in `variables` lists mixing `group`/`template`/inline; `each` over object parameters key ordering; Boolean stringification casing in keys; `extends` + nested `extends`; empty-`dependsOn` parallelism defaults in conditions context.
