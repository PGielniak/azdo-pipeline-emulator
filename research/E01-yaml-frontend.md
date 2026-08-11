# E01 — YAML front end: grounding notes

## E01-S01-T01 — CST-backed parse with provenance (2026-07-30)

[C-E01-001] The `yaml` npm package is pinned at **2.9.0** (registry `latest` on 2026-07-30);
repo tag `v2.9.0` is annotated and dereferences to commit
`ddb21b04cb889722cec8f89dc1b67f19d62d7f7d` — all doc quotes below are from `docs/` at that
commit (rendered at eemeli.org/yaml).
  — https://registry.npmjs.org/yaml/latest (checked 2026-07-30)
  — https://github.com/eemeli/yaml/tree/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs

[C-E01-002] `parseDocument(str, options)` parses exactly one document and reports a
multi-document input as an error; parse problems land in `doc.errors` as `YAMLParseError`
objects carrying `{ code, message, pos: [number, number], linePos }`, where `linePos` is the
one-indexed `{line, col}` pair (populated when `prettyErrors` is on, its default).
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/04_documents.md#L56 (checked 2026-07-30)
  — "Will include an error if `str` contains more than one document."
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/08_errors.md
  — "pos · `[number, number]` · The position in the source at which this error or warning was
    encountered." · "If that array is not empty when constructing a native representation of a
    document, the first error will be thrown."

[C-E01-003] Passing a `LineCounter` instance as the `lineCounter` option enables
offset→position mapping: `lineCounter.linePos(offset)` returns the **1-indexed** `{line, col}`
for any offset within the input.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/03_options.md#L29 (checked 2026-07-30)
  — "If set, newlines will be tracked, to allow for `lineCounter.linePos(offset)` to provide
    the `{ line, col }` positions within the input."

[C-E01-004] Every parsed content node exposes `range: [start, value-end, node-end]` character
offsets ("The `value-end` and `node-end` positions are themselves not included in their
respective ranges" — i.e. ends are exclusive); a `Pair` has **no range of its own** — it is
`{ key, value }` whose members are nodes carrying ranges.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/05_content_nodes.md#L15-L19 (checked 2026-07-30)
  — "range?: [number, number, number] // The `[start, value-end, node-end]` character offsets
    for the part of the source parsed into this node (undefined if not parsed)."

[C-E01-005] The `keepSourceTokens: true` option retains the CST on the AST: each parsed node
gets a `srcToken` value holding the CST token it was composed from (this is the "CST retained"
requirement of docs/01 §1).
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/03_options.md#L28 (checked 2026-07-30)
  — "Include a `srcToken` value on each parsed `Node`, containing the CST token that was
    composed into this node."

[C-E01-006] `Scalar.type` distinguishes the five source styles
`'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE'`, and the
package exports the type guards `isMap / isSeq / isScalar / isPair / isAlias / isNode` for
traversal.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/05_content_nodes.md (checked 2026-07-30)
  — "type?: 'BLOCK_FOLDED' | 'BLOCK_LITERAL' | 'PLAIN' | 'QUOTE_DOUBLE' | 'QUOTE_SINGLE' |
    undefined" · "import { isAlias, isCollection, isDocument, isMap, isNode, isPair, isScalar,
    isSeq } from 'yaml'"

## E01-S01-T03 — Diagnostics reporter (2026-07-30)

[C-E01-007] The DistributedTask templating engine prefixes template/YAML errors as
`<file> (Line: <line>, Col: <col>): <message>` — the location format string is
`"(Line: {0}, Col: {1})"` (`TemplateStrings.LineColumn`), assembled by
`TemplateContext.GetErrorPrefix` as `$"{fileName} {LineColumn(line, column)}:"` and prepended
to the message as `$"{prefix} {message}"`.
  — https://github.com/actions/runner/blob/34ef7f24f8875a3da11ae40ffd9668f0b4ca8440/src/Sdk/Resources/TemplateStrings.g.cs#L61-L65 (checked 2026-07-30)
  — 'const string Format = @"(Line: {0}, Col: {1})";'
  — https://github.com/actions/runner/blob/34ef7f24f8875a3da11ae40ffd9668f0b4ca8440/src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateContext.cs (GetErrorPrefix at ~L203 / Error at ~L154; checked 2026-07-30 — a parallel copy exists at `src/Sdk/WorkflowParser/ObjectTemplating/TemplateContext.cs`)
  — 'return $"{fileName} {TemplateStrings.LineColumn(line, column)}:";' · 'message = $"{prefix} {message}";'

[C-E01-008] Real rendered sample as users see it (public paste, Microsoft Q&A, asked
2024-10-17): `/azure-pipelines.yml (Line: 7, Col: 1): While parsing a block mapping, did not
find expected key.` — file paths are repo-root-relative **with a leading slash**; `az
pipelines`/the web UI surface these service messages verbatim, so our reporter's location
prefix mirrors this exact style.
  — https://learn.microsoft.com/en-us/answers/questions/2105104/azure-devops-yaml-syntax-issues (checked 2026-07-30)
  — "/azure-pipelines.yml (Line: 7, Col: 1): While parsing a block mapping, did not find
    expected key."

Structural notes (not server-behavior claims): parse.ts emits its own `ALIAS_UNSUPPORTED` /
`NON_SCALAR_KEY` errors because the DOM cannot represent aliases or non-string keys (the
vendored draft-07 JSON schema world is string-keyed, C-E00-006). Whether the *service* accepts
anchors/aliases, duplicate keys, or multi-doc files is **E01-S01-T02's oracle experiment** —
that task owns the behavior toggles; T01 only passes through the yaml package's own defaults
(`uniqueKeys`, single-doc) plus the two structural errors above.

## E01-S02-T01 — Validator over the vendored schema (2026-07-30)

Cross-check method: the five keyword pages named by the task (`steps-script`, `steps-task`,
`jobs-job`, `pool`, `variables`, plus the supporting `boolean` page) were fetched and compared
property-by-property against the corresponding definitions of the vendored
`service-schema.json` (pin `2f4500cf`, C-E00-006). All six pages render from
MicrosoftDocs/azure-devops-yaml-schema-pr at `git_commit_id`
`d089fd2dbb54483ec611eeb478e3eff14be74393` (`ms.date` 2026-07-29) — that commit is the pin for
every doc quote below. Four divergences were found (C-E01-011..C-E01-014); two of them change
acceptance and are encoded in the validator.

[C-E01-009] The docs' phrase "**Required as first property**" is the human-readable form of the
schema's non-standard `firstProperty` keyword: every documented "required as first property"
key (`script`, `task`, `job`, `stage`, `name`/`group`/`template`) appears as
`"firstProperty": ["<key>"]` on the matching schema branch, and the vendor's own validator
enforces it with "The first property must be one of: …".
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/steps-script?view=azure-pipelines (checked 2026-07-30)
  — "**`script`** string. Required as first property. An inline script."
  — https://github.com/microsoft/azure-pipelines-language-server/blob/543ceeecb21bf51bfe742c49169c747e90ec4f2f/language-service/src/parser/jsonParser.ts#L1054-L1067 (checked 2026-07-30)
  — 'localize(\'firstPropertyErrorList\', "The first property must be one of: {0}", schema.firstProperty.join(separator))'

[C-E01-010] `steps.script` matches the vendored schema exactly: the doc lists
`script, failOnStderr, workingDirectory, condition, continueOnError, displayName, target,
enabled, env, name, timeoutInMinutes, retryCountOnTaskFailure` — the same twelve properties, in
the same order, as `#/definitions/step/anyOf[1]` (`required: ["script"]`,
`additionalProperties: false`). No divergence.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/steps-script?view=azure-pipelines (checked 2026-07-30)
  — "```yaml\nsteps:\n- script: string # Required as first property. An inline script.\n  failOnStderr: string …"

[C-E01-011] **Divergence (acceptance-changing).** `steps.task` documents a `target` property,
but `#/definitions/task` has no `target` in `properties` while setting
`additionalProperties: false` — so the vendored schema rejects documented-valid task steps
(verified: `{steps:[{task:'PowerShell@2',target:'host'}]}` → invalid, 104 ajv errors).
Encoded as the single entry of `DOCUMENTED_CORRECTIONS` in `packages/engine/src/frontend/schema.ts`.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/steps-task?view=azure-pipelines (checked 2026-07-30)
  — "**`target`**[target](target). Environment in which to run this task." · "If you don't specify
    a command mode, you can shorten the `target` structure to: `- task:` / `target: string`"
  — schema: `#/definitions/task/properties` = task, displayName, name, condition,
    continueOnError, enabled, retryCountOnTaskFailure, timeoutInMinutes, inputs, env

[C-E01-012] **Divergence.** `jobs.job` documents `job` as "Required as first property", but
`#/definitions/job/anyOf[0]` carries only `firstProperty: ["job"]` — no `required` — so plain
JSON-Schema validation accepts a job block with no `job`/`deployment`/`template` key at all
(verified: `{jobs:[{displayName:'x',steps:[…]}]}` → valid under raw ajv). The validator treats
the discriminator as required (error `SCHEMA_NO_MATCHING_FORM`). Its *ordering* is only a
warning — see open question Q1.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/jobs-job?view=azure-pipelines (checked 2026-07-30)
  — "**`job`** string. Required as first property. ID of the job." (16 documented properties;
    identical set to the schema branch)

[C-E01-013] **Divergence (permissive direction, left alone).** The `pool` page documents exactly
two implementations — `pool: string` and `pool: {name, demands, vmImage}` — but the schema's
object branch sets `additionalProperties: true`, so unknown pool keys pass silently. Kept as-is:
tightening beyond the machine-readable schema would risk rejecting YAML the service accepts.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/pool?view=azure-pipelines (checked 2026-07-30)
  — "| pool: string | Specify a private pool by name. | pool: name, demands, vmImage | Full syntax
    for using demands and Microsoft-hosted pools. |"

[C-E01-014] `variables` matches: two forms (mapping "string dictionary" and list), and list
entries are discriminated by `name` / `group` / `template`, which is exactly
`#/definitions/variable.anyOf` with `firstProperty: ["name"|"group"|"template"]`.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/variables?view=azure-pipelines (checked 2026-07-30)
  — "List syntax requires you to specify whether you're mentioning a variable (`name`), a variable
    group (`group`), or a template (`template`)."

[C-E01-015] Pipeline values are **strings**: the `boolean` type is defined as the string set
`true | y | yes | on | false | n | no | off`, and the schema encodes it as eight case-insensitive
string patterns rather than a JSON boolean. Consequently a YAML boolean/number/null must satisfy
`type: string`, which the vendor's validator implements explicitly (`BooleanASTNode` /
`NullASTNode` / "count strings that look like numbers as strings").
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/boolean?view=azure-pipelines (checked 2026-07-30)
  — "**`boolean`** string. Allowed values: true | y | yes | on | false | n | no | off. Azure
    pipelines uses any of the previous string values to represent a boolean value in a pipeline."
  — https://github.com/microsoft/azure-pipelines-language-server/blob/543ceeecb21bf51bfe742c49169c747e90ec4f2f/language-service/src/parser/jsonParser.ts#L399-L406 (checked 2026-07-30)
  — "//The pipeline parser allows expressions that evaluate to booleans and right now the generated
    schema is not precise about that and allows any string. The values 'true' and 'false' get
    parsed into BooleanASTNodes but we need to allow them to match against 'string' in the schema."
  — same file L371-L373: "//allow empty values to validate as strings"

[C-E01-016] Values that are wholly an expression — `${{ … }}`, `$[ … ]`, `$( … )` — are exempt
from type checking, because Azure Pipelines substitutes them later.
  — https://github.com/microsoft/azure-pipelines-language-server/blob/543ceeecb21bf51bfe742c49169c747e90ec4f2f/language-service/src/parser/jsonParser.ts#L189-L198 (checked 2026-07-30)
  — "// Ignore expressions as those will be replaced by Azure Pipelines
    isVariableExpression = (currentValue.startsWith('${{') && currentValue.endsWith(\"}}\"))
      || (currentValue.startsWith('$[') && currentValue.endsWith(\"]\"))
      || (currentValue.startsWith('$(') && currentValue.endsWith(\")\"));"

[C-E01-017] `ignoreCase` and `aliases` change acceptance and must be honored: `ignoreCase:
"value" | "all"` makes enum/pattern comparison case-insensitive, `ignoreCase: "key" | "all"`
makes property-name matching case-insensitive, and `aliases` lists alternative property names
(task-input aliases such as `ConnectedServiceNameARM` for `azureSubscription`). Occurrence counts
in the pinned schema: ignoreCase key 2769 / all 475 / value 528; aliases 552.
  — https://github.com/microsoft/azure-pipelines-language-server/blob/543ceeecb21bf51bfe742c49169c747e90ec4f2f/language-service/src/parser/jsonParser.ts#L155-L162 (checked 2026-07-30)
  — 'return schema && (schema.ignoreCase === "value" || schema.ignoreCase === "all");' ·
    'return schema && (schema.ignoreCase === "key" || schema.ignoreCase === "all");'
  — same file L289-L292 (enum compare `e.toUpperCase() === val.toUpperCase()`), L801-L814 and
    L857-L866 (`propSchema.aliases` accepted as property names)

[C-E01-018] The vendor resolves the alternatives explosion by *discriminator-first* branch
selection: candidates are the branches whose `firstProperty` key is the mapping's first key **and**
whose value validates against that branch's property schema (this is what selects one of the 259
per-task `inputs` branches by matching `"pattern": "^PowerShell@2$"`); only if that yields nothing
are all alternatives tried, keeping the "best match" for the error message.
  — https://github.com/microsoft/azure-pipelines-language-server/blob/543ceeecb21bf51bfe742c49169c747e90ec4f2f/language-service/src/parser/jsonParser.ts#L232-L273 (checked 2026-07-30)
  — "const firstPropMatches: JSONSchema[] = this.getFirstPropertyMatches(alternatives);
    const possibleMatches: JSONSchema[] = (…firstPropMatches.length > 0) ? firstPropMatches : alternatives;"
  — same file L1076-L1126 (`getFirstPropertyMatches`, incl. the property-value validation at
    L1113-L1118)
  Our implementation generalizes the key lookup to any position (so a `displayName:`-first step
  still resolves to one branch) and reports the ordering separately as `SCHEMA_FIRST_PROPERTY`.

[C-E01-019] Measurement (reproducible with `ajv@8` `{strict:false, unicodeRegExp:false,
allErrors:true}` over the pinned schema, 2026-07-30) — raw JSON-Schema output is unusable as a
user-facing message, which is what the post-processing layer in this task exists to fix:
  · `steps: [{scripts: 'echo hi'}]` (one mistyped key) → **1265** errors
  · `steps: [{script: 42}]` → 1262 errors · `steps: [{task:'MyCustom@1', …}]` → 3362 errors
  · `steps: [{task:'PowerShell@2', target:'host'}]` → 104 errors (and it is *valid* YAML, C-E01-011)
  · `pool: {vmImage:…, bogusKey:1}` → accepted (C-E01-013) · job without `job:` → accepted (C-E01-012)
  — measured against https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cfdcb1449a588e08286d0bbbb5f62d2d83/service-schema.json

[C-E01-020] The schema's task catalog is a closed list: `#/definitions/task/properties/task` is
an `anyOf` of **259 `enum` branches with no string fallback**, so any marketplace or custom task
fails validation outright. Since docs/01 §1 makes the org-fetched schema (which includes installed
marketplace tasks) the authority when authenticated, an unrecognized task name is a **warning**
(`SCHEMA_UNKNOWN_TASK`), never an error; unknown *inputs* of a known task are likewise warnings,
because the doc page defines `inputs` only as a "string dictionary" while the schema pins it to
the vendored snapshot's input set.
  — https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cfdcb1449a588e08286d0bbbb5f62d2d83/service-schema.json (checked 2026-07-30)
  — every branch of `properties.task.anyOf` has the shape
    `{"description":…,"doNotSuggest":false,"ignoreCase":"value","enum":["PowerShell@2"]}`
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/steps-task?view=azure-pipelines
  — "**`inputs`** string dictionary. Inputs for the task."

### Open questions (need the oracle — E00-S03 test org)

- **Q1 — is the discriminator required to be *first*, or only present?** The docs say "Required as
  first property" and the vendor's editor validator errors when it is not first
  (C-E01-009/C-E01-018), but neither proves the *service* rejects `- displayName: … / script: …`.
  Until a preview-API experiment settles it, out-of-order discriminators are a **warning**
  (`SCHEMA_FIRST_PROPERTY`) and missing ones an error. Experiment: submit both orderings via the
  preview endpoint (research/oracle-setup.md) and compare acceptance.
- **Q2 — does the service reject unknown task inputs?** We warn (C-E01-020). An oracle run with a
  deliberately misspelled input on `CmdLine@2` would settle whether the service errors at queue
  time, warns, or ignores it.

## E01-S01-T02 — server-quirk conformance (2026-08-11)

Experiment transcripts: `research/experiments/E01-quirks/` (11 probes, live preview endpoint,
captured 2026-08-11). Each quirk probe is paired with a control that differs only by the quirk,
so every 400 below is attributable to the quirk itself: `control-variables` (200) covers the
anchor and duplicate-key probes, `control-single-doc` (200) covers the document-marker probes.

[C-E01-021] The YAML schema reference states that Azure Pipelines does not implement the whole
YAML language, and names **anchors**, complex keys and sets as unsupported — but says nothing
about duplicate mapping keys or multi-document files, which is why those two are settled by
experiment below rather than by citation.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/?view=azure-pipelines
    ("See also", checked 2026-08-11; the section is present in the rendered HTML)
  — "Azure Pipelines doesn't support all YAML features. Unsupported features include anchors,
    complex keys, and sets."
  — https://github.com/MicrosoftDocs/azure-devops-yaml-schema/blob/d089fd2dbb54483ec611eeb478e3eff14be74393/content/index.md#L714-L716

[C-E01-022] **Anchors are rejected outright, and the rejection fires on the anchor *definition*,
not on its use.** `&shared` alone (never aliased) is rejected exactly like `&shared` + `*shared`
and like the merge key `<<: *shared`; all three return HTTP 400
`PipelineValidationException` with the identical message. The message is **file-scoped — it
carries no `(Line: N, Col: M)`** and ends with a server-side null-reference artifact.
  — research/experiments/E01-quirks/anchor-only.md · anchor-alias.md · merge-key.md (2026-08-11)
  — "/azure-pipelines.yml: Anchors are not currently supported. Remove the anchor 'shared'\n
    Object reference not set to an instance of an object."

[C-E01-023] **Duplicate mapping keys are rejected**, with a positional message naming the key and
pointing at its **second** occurrence — confirmed at three nesting levels: document root
(`variables:` twice → `Line: 3, Col: 1`), inside a mapping (`a:` twice → `Line: 3, Col: 3`) and
inside a step mapping (`displayName:` twice → `Line: 4, Col: 3`).
  — research/experiments/E01-quirks/dup-key-root.md · dup-key-mapping.md · dup-key-step.md (2026-08-11)
  — "/azure-pipelines.yml (Line: 3, Col: 3): 'a' is already defined"

[C-E01-028] **The duplicate-key check folds case, and it does so at the mapping layer rather than
for schema keywords only.** `displayName:` + `displayname:` in a step collide, and so do `a:` +
`A:` under `variables:` — user-chosen names the schema knows nothing about. The message quotes the
*second* key with its own spelling. Our check therefore compares lower-cased keys in `quirks.ts`,
which is schema-unaware by construction.
  — research/experiments/E01-quirks/dup-key-case.md · dup-key-case-user-data.md (2026-08-11)
  — "/azure-pipelines.yml (Line: 4, Col: 3): 'displayname' is already defined"
  — "/azure-pipelines.yml (Line: 3, Col: 3): 'A' is already defined"

[C-E01-024] **A pipeline file may contain only one YAML document**: two documents separated by
`---` are rejected with a file-scoped (non-positional) parse-stream error.
  — research/experiments/E01-quirks/multi-doc.md (2026-08-11)
  — "/azure-pipelines.yml: Expected stream end parse event"

[C-E01-025] **Document *markers* are not document *separators*: a single document is accepted with
a leading `---` and with a trailing `...`.** Both expand normally (HTTP 200, canonical
`stages: __default` → `job: Job` → `CmdLine@2` form). docs/01 §1 said "`---` separators rejected",
which read literally would have made us reject the very common `---`-prefixed pipeline file; the
doc was corrected (CLAUDE.md rule 5, docs/06 §5 decision 9).
  — research/experiments/E01-quirks/leading-doc-start.md · trailing-doc-end.md (2026-08-11)

[C-E01-026] The service's own YAML front end therefore rejects on: anchors (any), duplicate keys
(any level), more than one document. Only the duplicate-key rejection is positional; the other two
name the file alone, so a diagnostic built from the service's text cannot always be anchored to a
source range — our own checks do carry ranges, which is a deliberate superset (docs/01 §1 requires
`file:line:col` on every diagnostic).
  — research/experiments/E01-quirks/README.md (2026-08-11)

[C-E01-027] In the `yaml` package a node's `range` starts **after** its anchor, so an anchor's own
position is only available from the CST, where `&name` is a `SourceToken` of `type: 'anchor'`
carrying `offset`/`source` and living in the documented `start`/`sep` token arrays of collection
items. Our anchor diagnostic therefore detects on the AST (`node.anchor`, which also covers an
anchor on the document root, where no content-token exists) and positions from the CST.
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/07_parsing_yaml.md#L78-L90 (checked 2026-08-11)
  — "| `&` | anchor |" (token identified by its first character)
  — https://github.com/eemeli/yaml/blob/ddb21b04cb889722cec8f89dc1b67f19d62d7f7d/docs/07_parsing_yaml.md#L186
  — "`start`, `sep`, `end` · `SourceToken[]` · Content before, within, and after "actual" values.
    Includes item and collection indicators, anchors, tags, comments, as well as other things."
  — verified locally against yaml@2.9.0: `a: &shared first` → anchor token at offset 5, while the
    scalar node's range starts at `first`; `--- &root` leaves no anchor token under
    `doc.contents.srcToken` but does set `doc.contents.anchor`.

## E01-S02-T03 — the per-org YAML schema (`distributedtask/yamlschema`)

Experiment: `research/experiments/E01-orgschema/` (`node scripts/org-schema.ts`, 2026-08-11).

[C-E01-029] The org schema route is **organization-scoped — no project segment**:
`GET https://dev.azure.com/{organization}/_apis/distributedtask/yamlschema?api-version=7.1`, with an
optional `validateTaskNames` query parameter. The client the VS Code extension uses passes no route
values at all, which is what makes the route org-level.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/distributedtask/yamlschema/get?view=azure-devops-rest-7.1 (checked 2026-08-11)
  — "GET https://dev.azure.com/{organization}/_apis/distributedtask/yamlschema?api-version=7.1"
  — https://github.com/microsoft/azure-devops-node-api/blob/cdf57a1407df00ed9465eeaed6c90c7777b74bb1/api/TaskAgentApiBase.ts#L7536-L7560
  — "GET the Yaml schema used for Yaml file validation." · area `"distributedtask"`, locationId
    `"1f9990b9-1dba-441f-9c2e-6485888c42b6"`, `let routeValues: any = { };`
  — https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cf/src/schema-association-service.ts#L337-L339
  — "const taskAgentApi = await azureDevOpsClient.getTaskAgentApi();
     const schema = JSON.stringify(await taskAgentApi.getYamlSchema());"
  — live: HTTP 200, `content-type: application/json; charset=utf-8; api-version=7.2-preview.1`,
    611 170 bytes. `api-version=7.1` and an omitted `api-version` answer 200 as well.

[C-E01-030] **The org response is the same document kind as the vendored `service-schema.json` — same
generator, same dialect, same custom keywords.** It is draft-07, carries the vendor `$id`, and uses
all four VS Code-extension keywords our walk implements (org counts: `firstProperty` 304,
`ignoreCase` 3981, `aliases` 581, `doNotSuggest` 561, `deprecationMessage` 188 — the vendored file
has 294/3772/552/541/157). `unsupportedKeywords()` returns `[]` for the live response, and both
documents have the same 119 `definitions` and the same 2-branch top-level `oneOf`. **Consequence:
injection is a wholesale swap, not a merge** — no vendored keyword annotation is lost by using the
org document, so `firstProperty` (C-E01-013) and case-insensitive enums (C-E01-017) keep working.
  — research/experiments/E01-orgschema/yamlschema.json — `"$schema": "http://json-schema.org/draft-07/schema#"`,
    `"$id": "https://github.com/Microsoft/azure-pipelines-vscode/blob/main/service-schema.json"`

[C-E01-031] The org document is a **strict superset of the vendored task list**: 269 task names vs
254, with **zero** vendored tasks missing from it. The extras are (a) in-box tasks newer than the
vendored snapshot (`AzureCLI@3`, `BicepDeploy@0`, `AzurePowerShell@3`, `UniversalPackages@1`, …) and
(b) the marketplace extension installed in the test org, `qetza.replacetokens`, contributing
`replacetokens@3..@7` with fully described inputs (`replacetokens@7`: 25 input properties,
`inputs.additionalProperties: false`). `GET {org}/_apis/extensionmanagement/installedextensions`
shows it is the only extension not flagged `builtIn` (32 installed, 31 `builtIn, trusted`). This is
the concrete payoff the task exists for: marketplace task **inputs** only validate under the org
schema.
  — research/experiments/E01-orgschema/yamlschema.json · installedextensions listing (2026-08-11)

[C-E01-032] Outside the task list the two documents differ in **exactly one** node, and that
difference is **behaviourally inert**: `definitions.repositoryResource.properties.endpoint.$ref` is
`#/definitions/string_allowExpressions` in the org response but `#/definitions/nonEmptyString` in the
vendored file — while *both* definitions are, in both documents, the same schema `{"type":"string"}`.
(The names suggest a stricter/looser pair; the vendored generator does not implement either as such,
so nothing about acceptance changes.) Everything else — all 119 definitions, the root `oneOf` — is
byte-identical once the task alternatives are set aside. This is what lets the swap test assert
diagnostic-for-diagnostic equality on the in-box corpus rather than an approximate match.
  — research/experiments/E01-orgschema/README.md (2026-08-11)
  — packages/engine/vendor/schema/service-schema.json — `"nonEmptyString": {"type": "string"}`,
    `"string_allowExpressions": {"type": "string"}`

[C-E01-033] `validateTaskNames=false` does **not** shrink or change the task list. It appends exactly
one catch-all alternative to `definitions.task.anyOf` — `{"properties":{"task":{"type":"string"},
"inputs":{"additionalProperties":true}},"firstProperty":["task"],"required":["task"]}` — plus a bare
`{"type":"string"}` to `definitions.task.properties.task.anyOf`. So the service's own "offline tools"
mode is precisely *accept any task name with any inputs*, which is the behaviour our unknown-task /
unknown-input **warnings** (C-E01-020) approximate when running against the vendored schema.
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/distributedtask/yamlschema/get?view=azure-devops-rest-7.1
  — "Whether the schema should validate that tasks are actually installed (useful for offline tools
     where you don't want validation)."
  — research/experiments/E01-orgschema/README.md — 611 170 bytes vs 611 314, 269 task names in both

[C-E01-034] **The response is not byte-stable across calls.** Three fetches inside ten minutes
produced two different orderings of `definitions.task.anyOf` (e.g. `Bash@3`/`ShellScript@2`
transposed) with an identical task *set*; the documents are identical once the task alternatives are
sorted. A pinned sample must therefore be compared structurally, and any per-org cache (docs/05 §…,
E08-S03-T07) must not key on a body hash.
  — measured 2026-08-11 over three consecutive `scripts/org-schema.ts` runs

[C-E01-035] The extension's own cache comment states there is **no service-side version to bust a
cache on**, which is why it caches per session only — and the observed `$comment` values confirm it
is not usable as a freshness signal: the live org reports `v1.183.0` while the *newer* vendored
snapshot reports `v1.261.1`, yet the live org is the one carrying the newer tasks (C-E01-031).
  — https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cf/src/schema-association-service.ts#L325-L331
  — "NOTE: Despite saving the schema to disk, we can't use it as a persistent cache because:
     1. ADO doesn't provide an API to indicate which version (milestone) it's on, so we don't have a
     way of busting the cache. 2. Even if we did, organizations can add/remove tasks at any time."

[C-E01-036] The documented authorization scope for this operation is **`vso.agentpools`** ("Grants
the ability to view tasks, pools, queues, agents, …"), which is *wider* than the `vso.build` scope
the oracle needs (C-E00-019). E08's auth must request it explicitly; our live call only succeeded
because the test-org PAT is broader than the runbook prescribes (deviation already recorded in
research/oracle-setup.md).
  — https://learn.microsoft.com/en-us/rest/api/azure/devops/distributedtask/yamlschema/get?view=azure-devops-rest-7.1 (checked 2026-08-11)
  — "vso.agentpools | Grants the ability to view tasks, pools, queues, agents, and currently running
     or recently completed jobs for agents"

[C-E01-037] The org document omits `target` on task steps exactly as the vendored file does
(both list `task, displayName, name, condition, continueOnError, enabled, retryCountOnTaskFailure,
timeoutInMinutes, inputs, env` and set `additionalProperties: false`), so the documented correction
C-E01-011 is a property of the *generator*, not of the vendored snapshot: it must be applied to an
injected org schema too, or `target:` — which learn.microsoft.com documents — would be rejected
whenever a user is authenticated.
  — research/experiments/E01-orgschema/yamlschema.json vs packages/engine/vendor/schema/service-schema.json (2026-08-11)
