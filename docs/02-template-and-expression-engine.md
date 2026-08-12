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
  - **How the service actually does it (grounded 2026-08-12, C-E02-026):** it compiles the whole scalar into a synthetic `format('<literal with {0} holes>', <expr>, …)` call and parses *that* — a parse error in `prefix ${{ null }} suffix` is reported as `position 29 within expression: 'format('prefix {0} suffix', null)'`, and a block scalar becomes one `format` whose literal carries real newlines. So the concatenation rule above is `format`'s stringification, not a separate one, and E03-S01-T05 can reuse the same code path. Our own diagnostics deliberately report the user's expression rather than the synthetic text, which appears nowhere in their file.
- Expressions may appear in mapping **keys**; result must stringify.
- After evaluation the result is **not re-parsed as YAML** (no injection); structural insertion happens on the DOM only.

## 4. Directives

**Conditional insertion** — mapping keys / sequence items `${{ if C }}:`, `${{ elseif C }}:`, `${{ else }}:` — chains resolved in document order; contents spliced into the parent on the winning branch. Works in mappings and sequences.

**Iterative insertion** — `${{ each x in seq }}:` splices the body once per element (sequence) or per key (`x` = key; `seq[x]` unavailable — use `${{ each pair in mapping }}` → `pair.key` / `pair.value`). Iteration variables live in the expression context for the body. Nested `each` supported. Loop over `parameters` of type `object`, `jobList`, `stepList` etc. is the bread-and-butter template pattern — first-class tests.

**`${{ insert }}`** — merge a mapping into the parent mapping (used e.g. to inject extra keys into a job).

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

### Types & coercion
Types: Null, Boolean, Number (double), String, Version, Object/Array. Implement the documented conversion table exactly (memberwise: e.g. `eq` is case-insensitive **ordinal ignore-case** for strings; Boolean→String is `'True'/'False'`; String→Number invariant parse; Version **3–4** part comparisons — corrected 2026-08-11, C-E02-005: a 2-part literal such as `1.2` is a *Number*, settled live by `gt(1.10, 1.9)` returning False, i.e. numeric ordering). Table-driven unit tests + oracle cases for the murky corners (`'' vs null`, `0 vs ''`, objects in `eq`).

**Syntax (grounded 2026-08-11, C-E02-001).** The language has **no operators at all** — the service rejects `1 == 1`, `!true`, `a && b`, `a || b`, `>`/`<`, and even parenthesised grouping `(true)`, while accepting `eq(1, 1)` in the same position. The grammar is therefore `primary postfix*` with primaries `boolean | number | version | string | namedValue | function '(' args ')'` and postfixes `.name`, `.*`, `[expr]`, `[*]`; no precedence climbing, and `(` is legal only directly after a function name. `null` is not a literal either (it is an unresolvable *name*, C-E02-003). Function and context names are case-insensitive and are resolved — with their arity — **while parsing** (C-E02-011/012), and nesting is capped at depth 50 counting function arguments only, member-access chains being free (C-E02-014). Implementation: `packages/engine/src/expr/{lexer,parser}.ts`; evidence: `research/experiments/E02-grammar/survey.md`.

**Error rendering (grounded 2026-08-12, C-E02-018..027).** A rejection is rendered
`<file> (Line: L, Col: C): <sentence>. Located at position N within expression: '<expr>'. For more help, refer to <fwlink>`, where `L`/`C` locate the **host scalar** and `N` is 1-based inside the expression *after the service trims the delimited text*; two of the six error kinds carry no position and one carries no help link. Runtime (`$[ ]`) errors drop the file coordinates for `An error occurred while loading the YAML build pipeline.` and are otherwise identical. Also measured: name resolution is **deferred** behind the syntax parse (`nosuchfunc(1) 2` reports the trailing `2`, `eq(1) 2` reports the arity error), the service reports *every* bad expression in a document, and it truncates a compile-time message at 500 characters mid-word. Implementation: `packages/engine/src/expr/errors.ts` — which renders the service's sentence verbatim but ranges the **offending token** so the code frame can caret it, and never truncates; evidence: `research/experiments/E02-errors/` (64 live rejections, replayed row by row as a parity test).

### Contexts
`parameters.*`, `variables.*` (incl. `variables['dotted.name']`), `dependencies.<job>` (`result`, `outputs['step.var']`), `stageDependencies.<stage>.<job>`, `resources.pipeline.<alias>.*` (populated from pinned run metadata), `pipeline.*`, `environment.*` (deployment). Index syntax and property syntax both supported; missing member → Null (with the documented notable exception that indexing into Null yields Null, enabling safe chains).

### Functions (implement all; ✱ = stateful/local behavior noted)

`and or not eq ne lt le gt ge in notIn contains containsValue startsWith endsWith format join split replace length lower upper trim coalesce iif convertToJson counter✱` — plus status functions valid only in conditions: `always() canceled() failed([names]) succeeded([names]) succeededOrFailed([names])`.

- `counter(prefix, seed)`✱: per-prefix state file under `<out>/.work/.state/counters/` incremented per local run — mirrors "per pipeline+prefix" semantics locally.
- `format`: composite formatting incl. `{{` escapes; date specifiers only exist in the `name:` run-number context (separate mini-formatter shared with `Build.BuildNumber` evaluation).
- Status functions read the runtime results store; `succeeded('A','B')` checks named dependencies (docs/04 §6).
- Function list is re-synced against the expressions doc at implementation time; unknown function = convert error naming the doc.

### Compilation examples (shell backend)

```yaml
condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
```
```bash
# generated into the job's conditions.sh
cond_step_040() {
  azdo_status_succeeded && [ "$(azdo_var 'Build.SourceBranch')" = "refs/heads/main" ]
}
```

```yaml
variables:
  isMain: $[ eq(variables['Build.SourceBranch'], 'refs/heads/main') ]   # runtime expr
```
```bash
# evaluated once at job start, result written into the job's variable store
azdo_var_set 'isMain' "$(azdo_expr_bool "$([ "$(azdo_var 'Build.SourceBranch')" = 'refs/heads/main' ] && echo True || echo False)")"
```

Cross-job output reference `$[ dependencies.A.outputs['setSha.short'] ]` compiles to a read of `.work/state/outputs/<stage>/A/setSha.short` with Null→empty fallback. String functions that are awkward in pure bash (`format`, `split`+index) compile to small generated helper functions in `lib/expr.sh` — still plain bash, just emitted per-need.

Anything the shell backend cannot express (rare: heavy Object manipulation in a runtime expression) falls back to **convert-time evaluation with a `degraded` warning** if inputs are static, else a convert error explaining the construct.

## 7. Provenance

Expansion maintains an origin map: every output DOM node → stack of `(file, line, repo@sha, templateParams-hash)`. Uses: step-header comments (`# from: templates/build.yml:14 (via azure-pipelines.yml:22)`), error messages, `expansion-map.json` next to `pipeline.expanded.yml`, and the manifest. This is a first-class feature — debugging template-heavy pipelines is exactly where users bleed time.

## 8. Oracle verification (the parity contract)

`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1` with `{"previewRun": true, "yamlOverride": "<candidate yaml>", "templateParameters": {…}}` returns the service's `finalYaml` **without running anything**. (api-version 7.1 and the single-field `{finalYaml}` response confirmed live in E00-S03-T02, C-E00-022; requires a real pipeline definition to hang the preview on — the harness maintains one dummy definition in the test org.) Client: `packages/fetch/src/oracle.ts`.

Three live-verified traps the harness must respect (C-E00-024/025/026, transcripts in `research/experiments/oracle-spike/`): an **empty `yamlOverride` returns 200** carrying the *committed* YAML rather than erroring, so a fixture generated from an empty override is silently wrong; an **invalid PAT returns 302** to a sign-in page, not 401, so the HTTP client must not follow redirects; and a **missing `pipelineId` returns 500**, not 404, so 5xx here must not be blindly retried as transient.

- `azdo-emu preview-diff <yaml>`: expands locally, fetches `finalYaml`, normalizes both (key order, insignificant whitespace, server-injected defaults), semantic-diffs, exits non-zero on drift.
- CI: nightly corpus run (docs/06 §3). Every ambiguity we resolve empirically becomes a permanent fixture pair so regressions in *our* engine — or behavior changes in *their* service — surface immediately.
- Known ambiguity backlog to resolve via oracle, tracked as fixtures: compile-time variable visibility across template files; declaration-order effects in `variables` lists mixing `group`/`template`/inline; `each` over object parameters key ordering; Boolean stringification casing in keys; `extends` + nested `extends`; empty-`dependsOn` parallelism defaults in conditions context.
