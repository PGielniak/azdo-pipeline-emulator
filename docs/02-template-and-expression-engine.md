# 02 — Template & expression engine

Originally the hard core of the project: reimplementing what the Azure DevOps service does between
"YAML files in repos" and "final expanded pipeline". **Since the 2026-08-22 re-orientation the
service does that for us** (PLAN **D3**) — what is still ours is the *runtime* expression half of §6
and the bundler of §5.1. References: templates doc (…/process/templates), expressions doc (…/process/expressions), runtime-parameters doc, and — corrected 2026-07-30 (C-E00-012/013) — the C# engine sources in the `actions/runner` fork (`src/Sdk/DTExpressions2`, `DTObjectTemplating`, `DTPipelines`) as the open behavioral reference; `microsoft/azure-pipelines-agent` itself has no engine sources (it consumes the closed expressions NuGet; runtime conditions evaluated in `src/Agent.Worker/ExpressionManager.cs`). Parity is verified against the real service via the preview endpoint (§8), which outranks the fork on any divergence.

> **Status — half live, half fallback (revised 2026-08-22, E12-S03-T01).** PLAN **D3** makes the
> Pipelines `preview` endpoint the expansion step (docs/07 §4), so everything the *service* performs
> at compile time — template resolution, `extends`, `${{ }}` evaluation, the directives, parameter
> binding, server limits — is no longer ours to perform on the default path. Read the sections with
> this table beside them:
>
> | Section | Status on the active path |
> |---|---|
> | §1 phase model | **live** as a description of *when* things happen — but the "Happens (us)" compile-time cell is now "the service, during `convert`" |
> | §2 expansion algorithm · §3 interpolation · §4 directives | **fallback-only** — built, tested and retained, reachable only through `--offline-expand` (E12-S01-T01), whose entry point is still missing (E03-S04-T02) |
> | §5 template resolution | resolution *semantics* are fallback-only; the reference **forms** are live input to the **bundler** (§5.1), which is on the default path |
> | §6 expression language | **split** — the runtime slots (`$[ ]`, job/stage/step `condition:`, `$( )` macros, `dependencies.*`/`stageDependencies.*`) are local and live (PLAN **D6**); the compile-time `${{ }}` evaluator is fallback-only |
> | §7 provenance | the expansion origin map is fallback-only; on the default path provenance is the bundler's (E03-S07-T01) |
> | §8 | **live, re-scoped** — the preview endpoint is the *expansion source*, not a test-only oracle |
>
> Nothing here is deleted (BACKLOG rule 3): the fallback is complete enough to cross-check the
> service wherever both answers exist (PLAN §8, E11-S02).

## 1. When things evaluate (the phase model)

| Phase | Happens (service) | Happens (us) | Constructs |
|---|---|---|---|
| Compile time | Server, at queue | **the service**, called by `azdo-emu convert` (`--offline-expand`: the local walk of §2) | template includes/`extends`, parameter binding, `${{ }}` expressions, `${{ if/elseif/else }}`, `${{ each }}`, `${{ insert }}` |
| Job dispatch | Server, when job is about to run | job start in `run-job.sh` | `$[ ]` runtime expressions (variable values), stage/job `condition:`, `dependencies` / `stageDependencies` contexts, `counter()` |
| Step execution | Agent, per step | `run_step` | `$(macro)` textual substitution in task inputs; step `condition:` |

Consequence of resolving compile time at convert: a converted project is a snapshot of one parameter set. Changing a **runtime parameter** requires re-convert (fast, offline with `--frozen`) — or not: for parameters only used in *runtime* positions we pass them through to `.env`. The README of the generated project lists which parameters were baked in.

## 2. Expansion algorithm — **fallback-only (E12-S03-T01)**

> **Not on the active path.** The service performs this walk (PLAN D3); the algorithm below is the
> retained offline engine (`packages/engine/src/template/`), reachable only via `--offline-expand`.
> Its whole-document entry point is **E03-S04-T02** — until that lands the flag refuses with a
> message naming it (E12-S01-T01).

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

## 3. Scalar interpolation rules (exact server semantics) — **fallback-only (E12-S03-T01)**

> Grounded and implemented, but exercised only by `--offline-expand` and by the conformance
> cross-check (E11-S02): on the default path the service has already applied these rules and the
> expanded YAML contains no `${{ }}` at all.

Implemented in `packages/engine/src/template/interpolate.ts` (E03-S01-T05) and grounded by 35 live
preview probes under `research/experiments/E03-interpolation/` (C-E03-175..194). The expressions
page's conversion table supplies `Null → ''` and Boolean → `True`/`False` outright; everything below
that distinguishes *positions* is measured, because neither doc states it.

- A scalar that is **exactly one expression** (`${{ parameters.jobs }}`) is replaced by the
  expression's result. Object and Array are inserted **structurally**, whole and typed at every
  depth (C-E03-177/179). Every other kind is converted to its **String form** — that is not a
  simplification: `${{ variables.nosuch }}` alone in a value comes back `''`, byte-identical to
  `${{ '' }}`, so Null's documented conversion applies in lone position too (C-E03-183).
- **"Exactly one" is a property of the raw text and is not whitespace-tolerant** (C-E03-180).
  Padding *inside* the delimiters is trimmed (C-E02-104); padding *outside* them is literal text
  that makes the scalar mixed content — `'  ${{ obj }}  '` is rejected `Unable to convert from
  Object to String`, while the unpadded double-quoted spelling inserts structurally, so YAML style
  is irrelevant and whitespace is not. Adjacency is not loneness either: `${{ 'a' }}${{ 'b' }}` is
  two holes with an empty literal between them (C-E03-186).
- Mixed content (`name-${{ parameters.suffix }}`) → each expression stringified and concatenated;
  Null → empty string, Boolean → `True`/`False` (server casing!), Number → invariant format,
  Version → dotted. Measured: `0.5` → `0.5`, `1.0` → **`1`**, `1000000` → `1000000`, `-1.25` →
  `-1.25` — shortest-round-trip invariant, which makes the expressions page's "no thousands
  separator and **no decimal separator**" false as written (C-E03-182/184). Exponent-range values
  are unmeasured and a known divergence risk (`1e21` is `1e+21` in JS, `1E+21` in .NET).
  - **How the service actually does it (grounded 2026-08-12, C-E02-109):** it compiles the whole scalar into a synthetic `format('<literal with {0} holes>', <expr>, …)` call and parses *that* — a parse error in `prefix ${{ null }} suffix` is reported as `position 29 within expression: 'format('prefix {0} suffix', null)'`, and a block scalar becomes one `format` whose literal carries real newlines. So the concatenation rule above is `format`'s stringification, not a separate one, and interpolation reuses that code path (`convertValue(v, 'string')`). Our own diagnostics deliberately report the user's expression rather than the synthetic text, which appears nowhere in their file.
- **An Object or Array in a string position is a hard rejection**, `Unable to convert from <Kind> to
  String. Value: <Kind>` — file coordinates only, no expression position, no help link. The failed
  hole becomes the **empty string** and evaluation continues, which is why the service's response to
  the padded-object probe carries that sentence *and* the schema's follow-on `Unexpected value ''`
  (C-E03-187). Accumulated, never thrown, like every other rejection in the walk.
- Expressions may appear in mapping **keys**, which run through the same lone/mixed split but have
  no structural option: the result is always the String form, so `${{ true }}:` is the key `True`
  (confirmed by the service's own `Unexpected value 'True'` in a schema-checked mapping),
  `${{ 1.0 }}:` is `1`, and a Null key is the **empty key**, accepted in a loose mapping
  (C-E03-190/192). The two failure modes differ and that is the evidence the split is shared: a
  *lone* collection key is `Expected a scalar value`, a collection in *mixed* key content gives the
  conversion sentence (C-E03-191).
- **In sequence position an Array splices and an Object does not.** `- ${{ parameters.steps }}`
  contributes its items as siblings (the doc's "insert an array into an array, you flatten the
  nested array"), while an Object becomes exactly one item (C-E03-178). This is the only place a
  scalar's replacement splices, and it lives in `walkSequence`.
- After evaluation the result is **not re-parsed as YAML** (no injection); structural insertion
  happens on the DOM only. `${{ 'a: b' }}` stays one scalar and the documented `${{` escape
  (`${{ 'my${{value' }}`) survives verbatim, so there is exactly one interpolation pass
  (C-E03-185/188).
- **A lone directive keyword in value position is never evaluated** (C-E03-194/173): `KEY:
  ${{ insert }}` keeps its text and is rejected by the *schema*, so an interpolator that evaluated
  it would emit `Unrecognized value: 'insert'`, a sentence the service does not produce.

## 4. Directives — **fallback-only (E12-S03-T01)**

> Same status as §2/§3: the service resolves every directive before we parse. Retained because the
> measured contract below is what the offline fallback must reproduce, and because it is the
> reference for triaging a service-drift report (E11-S03-T02).

**Conditional insertion** — mapping keys / sequence items `${{ if C }}:`, `${{ elseif C }}:`,
`${{ else }}:`. Chains resolve in document order and the winning branch's body is spliced into the
parent. The service contract below is grounded by the union of 45 live preview probes and 37
successful input/`finalYaml` pairs under `research/experiments/E03-conditionals/`,
`research/experiments/E03-if/`, and `fixtures/oracle/directives/` (C-E03-120..137):

- **A chain is not a contiguous run, and the winner splices at its *own* position** — not at the
  `if`'s. An ordinary sibling written between `${{ if }}` and `${{ else }}` breaks nothing: with a
  false `if`, the intervening step is emitted **first** and the `else` body lands where the `else`
  was written. Each directive therefore expands in place and merely consults the members before it;
  grouping a chain forwards from its head and emitting the winner at the head's index reorders that
  document (C-E03-128).
- **Conditions evaluate in document order and stop at the first winner.** A losing branch's
  condition and body are never evaluated at all — `if(true) / elseif parameters.missing / else`
  expands, while the same `parameters.missing` read in a position that *is* reached is a hard
  rejection (C-E03-132/133/134). This fixes the *order* an implementation may scan a chain in, not
  merely that it short-circuits.
- **A new `if` starts a new chain** (a trailing `else` binds to the nearest preceding `if`), and
  **`else` terminates one** — an `elseif` after the `else` is rejected (C-E03-127/130).
- **An ordinary sibling is invisible to a chain, but a *directive* sibling terminates it.** An
  `${{ each }}` or `${{ insert }}` written between two members orphans the member that follows —
  measured in both parent shapes, for both directives, and for a trailing `elseif` as well as a
  trailing `else`, against controls placing the same `insert` immediately before and immediately
  after the chain, where the document expands (C-E03-138). E03-S01-T02 shipped the opposite reading
  as an explicit guess and E03-S01-T04 refuted it.
- **An orphan `elseif`/`else` is a hard error**, distinct from one that merely loses: two
  newline-joined sentences with no help link (C-E03-129). The first is always `The expression
  directive '<kw>' is not supported in this context`; **the second depends on the parent shape** —
  `Unexpected value '<raw key>'` in a sequence, but `A mapping was not expected` in a mapping,
  located at the branch *body*, followed by a third sentence dumping the engine's internal reader
  stack that we deliberately do not reproduce (C-E03-139). A chain with no `else` whose conditions
  are all false is *not* an error and contributes nothing (C-E03-125).
- **Conditions use expression truthiness rather than requiring a Boolean.** Null, false, zero, and
  empty String are false; nonzero Numbers, nonempty Strings, Version, Array, and Object are true.
  Arrays and Objects remain true when empty, a rule outside the primitive conversion table
  (C-E03-131/135).
- **Body shape controls the structural splice.** A sequence body in sequence position is flattened;
  a mapping body becomes one sequence item. A mapping body in mapping position has its entries
  merged, while a sequence body there is rejected `Expected a mapping` (C-E03-122/123/136).
- Chains nest, and a losing outer branch discards the whole nested structure unevaluated
  (C-E03-126).

**Iterative insertion** — `${{ each x in seq }}:` splices the body once per sequence element and
binds the element itself. Over a mapping it binds a pair object exposing `.key` and `.value`, not
the key alone. Mapping traversal preserves authored YAML order exactly, including integer-like keys
(`'10'`, `'2'`, `'01'`) that a plain JavaScript object would reorder. Only the declared loop
variable enters the expression context; neither a bare `index` nor an `.index` member is
synthesized. Nested `each` is outer-major/inner-minor and retains both bindings. Looping over
`object`, `jobList`, `stepList`, and the other `*List` parameter values preserves their structural
shape (C-E03-140..151; 12 live probes under `research/experiments/E03-each/`).

**`${{ insert }}`** — merge a mapping into the parent mapping (used e.g. to inject extra keys into a
job). That one sentence was all this section said; the rules below were measured by 32 preview
probes (E03-S01-T04, C-E03-160..174, `research/experiments/E03-insert/`). The directive is
documented on the **template-expressions** page under "Insertion" — the templates page has no such
section, and its "Insert a template" is the unrelated `- template:` file include (E03-S02). Unlike
the other directives, `actions/runner` implements this one, and it predicted the collision rule
correctly and the position rule wrongly (C-E03-162).

- **Mapping-key only.** As a bare sequence item or as a mapping *value* the directive cannot act and
  its delimited text survives verbatim into schema validation: `Unexpected value '${{ insert }}'`,
  one sentence, no help link. That is *not* an expression failure — a bare unknown name in the same
  position gives `Unrecognized value: 'index'` with a position and a help link (C-E03-151), so the
  keyword is still recognized; it simply has nowhere to go (C-E03-173). **Consequence for
  E03-S01-T05:** a lone `${{ insert }}` scalar must be left as literal text, never evaluated.
- **`- ${{ insert }}: <object>` is still a mapping-key insertion** — into the one-key mapping the
  sequence *item* is. It merges into that item and does **not** splice into the parent sequence, so
  two inserted keys forming one valid step produce one step, not two items (C-E03-174).
- **The merge is in place and order-preserving.** Merged keys land at the directive's own position,
  not appended, in the source object's authored order — unsorted, like `each` over a mapping
  (C-E03-163). The value may be a literal mapping as well as an expression (C-E03-164); an empty
  object contributes nothing (C-E03-165); it works in loose mappings and in ones with well-known
  schema keys, nested values intact (C-E03-166); the source may be a loop binding (C-E03-167); two
  `${{ insert }}` keys in one mapping both merge, in document order (C-E03-168).
- **A key collision is an error, not an overwrite** — `'<key>' is already defined`, HTTP 400,
  reported at the **later** occurrence, comparison folding case, message echoing the later spelling
  (C-E03-169/170). Neither value wins. **The rule belongs to the mapping, not to `insert`:** two
  colliding inserts, and an `each`-produced key colliding with a literal, reject identically, so the
  check lives where a mapping is rebuilt after expansion (C-E03-171). Directive keys are exempt,
  matching the parse-time exemption of C-E01-038/039.
- **A non-mapping value is `Expected a mapping`**, one sentence, for a string, a sequence, a bare
  scalar and an empty value alike (C-E03-172).

**Recognition rules (measured 2026-08-12, E03-S01-T01, C-E03-100..113; 33 preview probes in `research/experiments/E03-walk/`).** The four paragraphs above describe what the directives *do*; none of the rules below is stated by either doc, and three of them are the opposite of the natural guess:

- **The keyword set is closed and case-sensitive** — lower-case only. `${{ IF … }}`, `${{ EACH … }}`, `${{ INSERT }}` are rejected, and rejected *as expressions*: a wrongly cased keyword is not a mis-spelled directive, it is not a directive at all and the whole delimited text falls through to ordinary expression parsing. This is the only case-sensitive corner of the language — names, functions and boolean literals all fold case (C-E02-002/011/012).
- **Directive parameters are top-level expression units, not whitespace-split words.** `eq(1, 1)` counts as one, which is why `${{ else if eq(1, 1) }}` is rejected "Exactly 0 parameter(s) were expected following the directive 'else'. Actual parameter count: 2". Expected counts: `each` 3, `else` 0, `insert` 0; `if`/`elseif` never produce that sentence and fall through to an expression parse instead. **Implementation consequence:** the directive text is tokenized with the expression lexer, never string-split — `${{ each item in split('a in b', ' in ') }}` iterates `a`,`b`, and an `indexOf(' in ')` splitter iterates the wrong collection *silently*.
- **Loop variables share one flat namespace with the contexts, and redefinition is an error rather than shadowing**: `${{ each variables in … }}` → "The idenfifier 'variables' has already been defined within the current scope" (the service's own typo). Variable names fold case; the keyword does not.
- **Directives are recognized on mapping keys and one-key sequence items only** — never on a scalar value, where `${{ if … }}` is rejected `Unexpected value '<raw>'` with no expression error at all.
- **Position sensitivity is real but narrow, and the template-expressions doc's statement about it is wrong.** That doc says expressions are expanded "only for `stages`, `jobs`, `steps`, and `containers`" and not inside `trigger` — but `trigger: [${{ 'main' }}]` expands, as does an expression in `pool.demands`, and an `if` directive expands in `pool.demands` and in root `variables:`. Exactly one position rejects a directive with its own sentence, `A template expression is not allowed in this context`: inside `resources.repositories`. Inside `trigger:` a directive is simply left unexpanded and then fails schema validation. So the gate is a per-position attribute with one measured member and is modelled as a seam, not as a table extrapolated from the doc's list.

## 5. Template resolution — **fallback-only, except the reference forms (E12-S03-T01)**

> The *forms* below are live: the **bundler** (§5.1) has to recognise every one of them in the raw
> document. The *resolution semantics* — per-file base directories, cross-repo rules, cycle
> detection, typed parameter binding, per-file compile-time contexts — are the service's on the
> default path and are retained for `--offline-expand`.

Reference forms, all supported (P1 local, P3 remote):

```yaml
- template: steps/build.yml                 # relative to the REFERRING file
- template: /pipelines/steps/build.yml      # repo-root-relative
- template: build.yml@templates             # alias from resources.repositories
- template: build.yml@self                  # explicitly the source repo
  parameters: { toolset: msbuild }
```

- Path resolution is per-file: relative paths resolve against the directory of the file containing the reference; `@alias` switches repo context (and stays for nested relative refs within that file).
- **Corrected 2026-08-20 (E03-S02-T01, C-E03-215).** The per-file base directory survives only while the *repository* does: a reference whose target repository differs from the including file's resolves against that repository's **root**, not against the including file's directory. Writing `@self` from inside the definition's own repo keeps the base (it is not a switch); omitting the alias inside a cross-repo template also keeps it. The alias text is not what decides — the resolved repository is. Two further measured rules the bullet above does not imply: the alias splits on the **first** `@` (C-E03-210, so a file named `we@ird.yml` is unreachable), and alias lookup folds case while path lookup does not (C-E03-213/204).
- **Cycles are not detected by the service** (C-E03-208): a self- or mutually-including template recurses until `Maximum object depth exceeded`, which is none of the three documented limits (C-E03-199). Our resolver detects the repeat on `(repository, commit, path)` over the *active* stack — a diamond is legal and expands twice (C-E03-209) — and reports that same sentence at the repeated file, matching the service's own attribution. Implementation: `packages/engine/src/template/reference.ts`.
- Remote aliases resolve through the Loader/Fetcher (docs/05): ADO Git or GitHub, ref taken from `resources.repositories[].ref` (default branch when absent), pinned to a commit SHA in the lockfile.
- Template `parameters:` are **typed**: `string, number, boolean, object, step, stepList, job, jobList, deployment, deploymentList, stage, stageList`. Binding validates type and `values:`; missing required parameter = convert error (server-identical message shape). Extra parameters = error.
- Each template file expands in **its own context**: its bound parameters + its own `variables` (per official rule that templates see their own parameters, not the caller's). What exactly the compile-time `variables.*` context contains across files (root vs template-local, declaration order effects) is under-documented → resolved empirically via the oracle (§8) and encoded as table-driven tests; the engine keeps this policy in one function (`compileTimeVariableScope(file)`) so oracle findings are easy to apply.
- `templateContext` on stages/jobs/steps passes an arbitrary payload into templates iterating over `*List` parameters — supported as opaque data.
- Cycle detection on (file, repo, commit) tuples; depth counter for the server limit.

### 5.1 The bundler (live — the default path's only local template work)

PLAN §2 goal 2 and docs/07 §5 Phase 1: the user edits template files locally, so the expansion
request must carry them. The bundler is a **mechanical inliner, not an expander** — it never
evaluates `${{ }}`, never resolves a directive, and never binds a parameter; it only makes the
service see the user's uncommitted bytes. **That constraint has a measured cost, recorded here
because it bounds what the default path can do (2026-08-23, C-E03-408..413):** a template that
*reads* its own `${{ parameters.* }}` cannot be inlined at all, because the splice drops the scope
those references resolve in. Such a reference stays in the override and the service reads the
**committed** file, so local edits to parameterized templates are not visible on the default path —
a warning, not an error. **Product answer (2026-08-25, E03-S06-T05; docs/06 §5 decision 66): this is
a documented default-path limitation.** The tool does not silently switch expansion authority based
on pipeline shape: commit the template to let the service see it, or explicitly choose
`--offline-expand`, whose local result is labelled degraded because it can differ from the service.
The same answer covers `extends:` targets and references inside a `parameters:` value. Bundle
warnings carry that consequence and remedy into the generated README. Scope per task, none of it
invented here:

| Mechanic | Owner | Note |
|---|---|---|
| Detect `extends.template` and stage/job/step `- template:` references (incl. `@self`) in the raw DOM, with `file:line` | E03-S06-T01 | reference forms are §5's, above |
| Resolve each `@self`/relative reference against the **local working tree** and inline it, recursing into nested references; report cycles | E03-S06-T02 | **measured 2026-08-23, and narrower than this row read:** a mechanical splice is equivalent only for a file that reads no `${{ parameters.* }}` (C-E03-408..413). One that does is HTTP 400 `Key not found` when the parent lacks the name and, when the parent *has* it, expands the **wrong value** at HTTP 200 — so those are refused and warned about. `extends:` and references inside a `parameters:` value are likewise reported, not inlined. **Resolved 2026-08-25 (E03-S06-T05):** documented limitation on the service-backed path; commit, or explicitly select the degraded `--offline-expand` fallback. |
| Pass `parameters:` / `templateParameters` through to the `preview` request — binding stays the service's | E03-S06-T03 | request shape C-E00-018 |
| Cross-repo (`@other`) references: convert-time **diagnostic**, never a silent wrong expansion | E03-S06-T04 | v1 answer is "resolves against the committed repo; see E09" |
| Write the exact (redacted) `yamlOverride` plus a `local path → inlined location` map and file hashes into the output | E03-S07-T01 | **done 2026-08-23:** `pipeline.bundled.yml` + `bundle.json`, now pinned in docs/04 §1. The map records the **skipped** references too, with the reason — that half is what separates "expanded from your working tree" from "expanded from what is committed". Hashes are of the **working-tree** content, pre-recursion, so an edit is attributable to the file the user edited. |
| Missing-file and cycle diagnostics in the E01 diagnostic shape | E03-S07-T02 | |

The bundled override is what `expand()` sends (docs/05 §2/§4); everything after that comes back as
`finalYaml`.

## 6. The expression language — **split: runtime live, compile-time fallback (E12-S03-T01)**

> The **shell backend and the runtime slots are the live half** — `$[ ]`, job/stage/step
> `condition:`, `dependencies.*`/`stageDependencies.*` outputs, status functions and `$( )` macros
> are evaluated by the *agent* at run time and cannot be delegated to `preview` (PLAN **D6**). The
> **eval backend's compile-time use** (`${{ }}` slots, parameter binding) is fallback-only; the same
> evaluator is still live where it serves a runtime slot at convert time (e.g. compiling a
> condition, or the degraded convert-time evaluation described at the end of this section).

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
- **A standalone compiled snippet cannot propagate errors across `||` or out of a value position.** `or(<error>, true)` answers True because an OR list cannot tell status 2 from status 1, and a helper's error status inside `"$( … )"` is discarded with the substitution (C-E02-143/144); those remain declared conformance-harness divergences. At the `run_step` condition boundary, E06-S03-T03 now exports a private error marker that expression helpers can write from the current shell or a command-substitution subshell, so the complete runtime still turns either case into condition-evaluation `Failed` rather than Boolean false (C-E06-042).
- **Non-ASCII case folding** differs from .NET OrdinalIgnoreCase under `LC_ALL=C` (C-E02-141).

Anything the shell backend cannot express falls back to **convert-time evaluation with a `degraded` warning** if inputs are static, else a convert error explaining the construct. Measured, that set is: Object/Array values and the functions that produce or consume them (`split`, `join`, `convertToJson`, `containsValue`), a dynamic index, and `counter`, which reads the convert-time state provider (C-E02-139).

**Parity is enforced, not asserted (E02-S05-T02).** One row table — `packages/engine/test/expr/conformance.table.ts` — drives both backends: the evaluator through the E02-S02/S03 entry points, and the compiled bash through `packages/runtime/test/expr-conformance.bats`, which is generated from that table (`pnpm expr-conformance-bats`) and committed. The engine suite fails while the generated file is stale, so a compiler change that is not regenerated is red rather than untested. Each row declares what the shell backend is allowed to do — agree, refuse with `BashCompileError`, or diverge with a claim and the measured answer — and nothing is skipped.

## 7. Provenance

> **Re-scoped 2026-08-22 (E12-S03-T01).** The origin map below is produced by the *local* expansion
> and is therefore fallback-only (its emitter is E03-S04-T02). On the default path the service
> returns `finalYaml` with no provenance of its own, so the attributable unit is the **bundler's**
> map (§5.1, E03-S07-T01: `local path → inlined location` + file hashes) plus the positions the
> front end reads off the expanded document. Step-header "from:" comments are therefore only as
> precise as that map — docs/04 §12's sample shows the fallback's fuller form.

Expansion maintains an origin map: every output DOM node → stack of `(file, line, repo@sha, templateParams-hash)`. Uses: step-header comments (`# from: templates/build.yml:14 (via azure-pipelines.yml:22)`), error messages, `expansion-map.json` next to `pipeline.expanded.yml`, and the manifest. This is a first-class feature — debugging template-heavy pipelines is exactly where users bleed time.

## 8. The expansion contract (was: oracle verification) — **live, re-scoped (E12-S03-T01)**

> The endpoint below is no longer a *test-only* oracle: it is the product's expansion step (PLAN
> **D3**, docs/07 §4), consumed through `expand()`/`expandCached()` (E00-S04, docs/05 §2/§4).
> "Parity" with it is therefore true by construction on the default path; what remains to check is
> (a) **service drift** over time and (b) the **fallback's** agreement when it is used.

`POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1` with `{"previewRun": true, "yamlOverride": "<candidate yaml>", "templateParameters": {…}}` returns the service's `finalYaml` **without running anything**. (api-version 7.1 and the single-field `{finalYaml}` response confirmed live in E00-S03-T02, C-E00-022; requires a real pipeline definition to hang the preview on — the harness maintains one dummy definition in the test org.) Client: `packages/fetch/src/oracle.ts`.

Three live-verified traps the harness must respect (C-E00-024/025/026, transcripts in `research/experiments/oracle-spike/`): an **empty `yamlOverride` returns 200** carrying the *committed* YAML rather than erroring, so a fixture generated from an empty override is silently wrong; an **invalid PAT returns 302** to a sign-in page, not 401, so the HTTP client must not follow redirects; and a **missing `pipelineId` returns 500**, not 404, so 5xx here must not be blindly retried as transient.

- ~~`azdo-emu preview-diff <yaml>`~~ — **removed from the CLI surface** (E03-S05-T02 demoted 2026-08-22; command dropped from `packages/cli/src/program.ts` and docs/06 §1 by E12-S03-T01): with the service *as* the expansion there is nothing to diff on the default path. Its two jobs moved — service-drift detection to the nightly re-expansion harness (**E11-S03-T01**), fallback parity to conformance (**E11-S02**). The normalizer it was built on (E03-S05-T01) stays: the nightly compares normalized expansions.
- CI: nightly corpus run (docs/06 §3). Every ambiguity we resolve empirically becomes a permanent fixture pair so regressions in *our* engine — or behavior changes in *their* service — surface immediately.
- Known ambiguity backlog, tracked as fixtures — **fallback-only since 2026-08-22 (E12-S03-T01)**: every item below is a question about whether the *local* engine agrees with the service, not about what the shipped conversion does (the service answers it by producing `finalYaml`). They are E11-S02 conformance cases now: compile-time variable visibility across template files; declaration-order effects in `variables` lists mixing `group`/`template`/inline; `extends` + nested `extends`; empty-`dependsOn` parallelism defaults in conditions context. **Closed:** `each` over object parameters key ordering (authored order, unsorted, C-E03-145) and Boolean stringification casing in keys (`True`, C-E03-190/192).
