# E04 — semantic model: claims

Claim format per BACKLOG.md §3. IDs are **never reused** and are allocated from the block table
below rather than by "next free number" — see `research/E03-template-engine.md`'s header for the
collision that made this convention mandatory.

## Claim-ID block allocation

| Block | Task | File | Status |
|---|---|---|---|
| `C-E04-001..029` | **E04-S01-T01 model types & builder** | this file | 001–005 used |
| `C-E04-030..059` | E04-S01-T02 normalization boundary | this file | 030–037 used |
| `C-E04-060..079` | E04-S01-T03 common step fields | this file | 060–067 used |
| `C-E04-080..109` | E04-S02 variables & scoping | this file | 080–086 (S02-T01), 087–092 (S02-T02), 093–096 (S02-T03) |
| `C-E04-110..139` | E04-S03 dependency graph & matrix | this file | 110–122 (T01), 123–138 (T02) |
| `C-E04-140..169` | E04-S03-T03 deployment job model | this file | 140–… |

Leave gaps. A branch that numbers from what it can see collides silently with every sibling.

---

## E04-S01-T01 — what shape the service's `finalYaml` actually arrives in (`C-E04-001..005`)

Evidence of two kinds, and they are labelled apart because they carry different weight. **A corpus
observation** over the 147 `final.yml` transcripts this epic inherits from E00/E02/E03
(`research/experiments/*/*/final.yml`) — strong, but it measures the probes that happened to be
written, not the whole input space. And **two probes run for this task**
(`research/experiments/E04-model/`), which close the one root shorthand the corpus never exercised.

[C-E04-001] **Every expansion the service returns is rooted at `stages:`.** All **147** captured
`final.yml` documents carry a top-level `stages` key; none is rooted at `jobs:` or `steps:`
— `research/experiments/*/*/final.yml`, counted 2026-08-23. The other top-level keys that survive
expansion are `parameters`, `variables` and `resources`; the observed key sets are exactly
`{stages}` (63), `{parameters, stages}` (62), `{parameters, stages, variables}` (13),
`{resources, stages}` (8) and `{stages, variables}` (1). Consequence for the builder: on the
**default** path there is no stage/job wrapping left to do. The wrapping it still implements is for
the `--offline-expand` fallback (PLAN D3/D4), whose local engine makes no such guarantee, and that
is why the code keeps it rather than asserting the invariant.

[C-E04-002] **A root-level `steps:` is wrapped as stage `__default` → job `Job` → `task: CmdLine@2`.**
Corpus: `__default` appears as a stage name in 78 transcripts and `Job` as a job name in the same
78 — exactly the probes whose input was rooted at bare `steps:` (141 probe inputs are
`{steps}` or `{parameters, steps}`; the difference is the ones the service rejected). This restates
C-E00-017/018's measurement, which the task's **Ground** field names, and confirms it holds across
every later probe rather than only the original spike.

[C-E04-003] **A root-level `jobs:` is wrapped in `__default` too, and keeps its own job name.**
`research/experiments/E04-model/root-jobs/` — input `jobs:\n- job: Build\n  steps: …`, HTTP 200,
expanded to `stages:\n- stage: __default\n  jobs:\n  - job: Build\n    steps:\n    - task: CmdLine@2`
— checked 2026-08-23. The corpus could not answer this: **no** inherited probe is rooted at `jobs:`
(the 147 inputs are `{steps}`, `{stages}` and their `parameters`/`variables`/`resources`
combinations), which is why this was probed rather than assumed from the `steps:` case.

[C-E04-004] **An explicitly written but unnamed job keeps the empty string as its name — it does
*not* get the synthetic `Job`.** `research/experiments/E04-model/root-jobs-unnamed/` — input
`jobs:\n- job:\n  steps: …`, HTTP 200, expanded to `- job: ''` — checked 2026-08-23. The synthetic
`Job` of C-E04-002 is what the service supplies when it invents the job, not a default it applies
to a job the author wrote. Consequence, and the reason this is a separate claim: **job identity may
be the empty string**, so the model must not treat a job name as non-empty, and anything deriving a
directory or a script filename from it (E05) needs its own fallback rather than trusting the name.

[C-E04-005] **`stages:` at the root passes through unwrapped.** 100 of the inherited probe inputs
are rooted at `stages:` and every corresponding expansion is likewise rooted at `stages:` with the
authored stage names intact (`probe`, `alpha`, `beta` in the corpus, alongside the synthetic
`__default` from the `steps:`-rooted probes) — counted 2026-08-23. Together with C-E04-002/003 this
gives the builder its input contract: one shape, always, on the default path.

---

## E04-S01-T02 — the normalization boundary (`C-E04-030..037`)

Evidence: `research/experiments/E04-normalization/` — **9 live probes** (`pnpm normalization-survey`),
one per step shorthand the task's **Do** names plus a canonical-`task:` control, each submitted as a
bare `steps:` document. `matrix.md` is the summary. Every probe is declared asking, not asserting.

The task says to "implement a `normalize.ts` pass for **only** the remainder". The measurement makes
that instruction resolve oddly and the resolution is the finding: **the remainder is empty in the
sense the task meant, and non-empty in a sense it did not anticipate.**

[C-E04-030] **Every documented step shorthand is desugared by the service into `task: …@version`.**
`script` → `CmdLine@2`, `bash` → `Bash@3`, `pwsh` → `PowerShell@2`, `powershell` → `PowerShell@2`,
`publish` → `ecdc45f6-832d-4ad9-b52b-ee49e94659be@1`, `download` →
`30f35852-3f7e-4c0c-9a88-e127b4f97211@1`, `checkout` → `6d15af64-176c-496d-b583-fd2ae21d4df4@1` —
all HTTP 200, `research/experiments/E04-normalization/<keyword>/` — checked 2026-08-23. No shorthand
keyword survives into the expansion, and the canonical-`task:` control passes through unchanged. So
**we desugar nothing**: a `normalize.ts` pass that rewrote `bash:` into `Bash@3` would be a second,
divergent implementation of work the authority already did.

[C-E04-031] **Three of them desugar to a bare GUID with no name spelling, and that is the real
normalization need.** `checkout`, `download` and `publish` arrive as `task: <guid>@1`. This is not a
new discovery for the repo — the normalizer records it as C-E12-019 and holds the grounded mapping
`ecdc45f6…` → `PublishPipelineArtifact`, while deliberately **refusing** to name the `checkout` and
`download` GUIDs because they are agent-internal, return 404 from
`GET _apis/distributedtask/tasks/{guid}`, and have no catalogue name to unify with. What is new is
the consequence for **this** epic: PLAN D4 emits `checkout` natively, and a model that carries only
`task: 6d15af64-…@1` gives E05 nothing to match on. The keyword the author wrote is *gone* by the
time the model is built.

[C-E04-032] **The GUID↔keyword association is measured here, directly.** Each association comes from
submitting that keyword and reading the expansion: `checkout: self` →
`6d15af64-176c-496d-b583-fd2ae21d4df4@1` with `inputs: {repository: self}`; `download: current` →
`30f35852-3f7e-4c0c-9a88-e127b4f97211@1` with `inputs: {alias: current, artifact: drop}`;
`publish: <path>` → `ecdc45f6-832d-4ad9-b52b-ee49e94659be@1` with
`inputs: {path: …, artifactName: drop}` — checked 2026-08-23. Note the input renaming that comes
with it: the author's `artifact:` becomes `artifactName:` for `publish` but stays `artifact:` for
`download`, and `download:`'s scalar becomes `alias:`. A model that assumed the authored key names
would read the wrong input.

[C-E04-033] **Recovering the keyword is not the same operation the normalizer refuses.** The
normalizer declines to *rename* these GUIDs because its output is a diff and an invented name would
make the diff lie. Recording "this step came from the `checkout` keyword" is a different fact: it is
measured (C-E04-032), it is not a claim about the task catalogue, and it does not rename anything.
The two coexist — `TASK_GUID_NAMES` stays as it is, with its single grounded entry, and the model
carries the origin keyword in its own field.

[C-E04-034] **`download:` and `DownloadPipelineArtifact@2` are different tasks and must not be
folded.** Recorded in `packages/engine/src/normalize/normalize.ts` from C-E12-019 and restated here
because this task is where something might have folded them: the origin keyword `download` maps to
the agent-internal GUID only, never to the catalogue task of a similar name.

[C-E04-035] **`getPackage` never reaches the model as a shorthand: without a matching package
resource the service rejects the pipeline.** `research/experiments/E04-normalization/getPackage/` —
HTTP 400 `PipelineValidationException`, `"/azure-pipelines.yml (Line: 2, Col: 15): Cannot find
package resource for pkg"` — checked 2026-08-23. So the shorthand is resource-gated rather than
free-standing, and a conversion that reaches the model at all has already had it either desugared or
rejected. Not implemented, and the reason is recorded rather than left as a silent hole: probing the
desugared form needs a `resources.packages` entry in the test organization, which no current task
provisions.

[C-E04-036] **The canonical control passes through untouched.** `- task: CmdLine@2` with `inputs:`
expands to exactly itself (`task-explicit/`, HTTP 200) — checked 2026-08-23. This is what makes the
rows above attributable to the shorthand rather than to the expansion rewriting steps in general.

[C-E04-037] **`pwsh` and `powershell` both become `PowerShell@2` and are told apart by an input.**
Both expand to the same task; the `pwsh` probe's expansion carries `pwsh: true` among its inputs
while the `powershell` probe's does not — checked 2026-08-23,
`research/experiments/E04-normalization/{pwsh,powershell}/final.yml`. Anything dispatching on the
task reference alone cannot distinguish them, which matters to E07's disposition registry.

---

## E04-S01-T03 — common step fields, and which of them are not step fields (`C-E04-060..067`)

Evidence: the `steps.task` schema page (fetched 2026-08-23, `ms.date: 2026-07-29`, source commit
`d089fd2dbb54483ec611eeb478e3eff14be74393` of `MicrosoftDocs/azure-devops-yaml-schema-pr`
`content/steps-task.md`) and **6 live probes** under `research/experiments/E04-step-fields/`.

[C-E04-060] **The documented common properties survive expansion at step level, verbatim.**
`name`, `displayName`, `enabled`, `timeoutInMinutes`, `retryCountOnTaskFailure`, `continueOnError`
and `condition` all appear as step keys in the expansion, unchanged
(`research/experiments/E04-step-fields/control-fields/`, HTTP 200) — checked 2026-08-23. The page
lists exactly this set — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/steps-task
— "`task` … `inputs` … `condition` … `continueOnError` … `displayName` … `target` … `enabled` …
`env` … `name` … `timeoutInMinutes` … `retryCountOnTaskFailure`".

[C-E04-061] **`workingDirectory` and `failOnStderr` are *not* step properties — they are task
inputs, and the expansion puts them there.** `- script: echo hi` with both set expands to
`task: CmdLine@2` whose `inputs` are `{script, failOnStderr, workingDirectory}`, with neither at
step level (`script-inputs/`); the `bash` shorthand does the same into `Bash@3`, additionally
gaining `targetType: inline` (`bash-inputs/`) — both HTTP 200, checked 2026-08-23. The schema page
omits both from the common list, which is consistent. This matters because **this task's own Do
lists them among "common step fields"**: a model reading them off the step mapping finds nothing,
silently, for every pipeline. It is also the same fact C-E06-033 records from the other side —
`failOnStderr` "is not an agent-level input at all: it is the Bash/PowerShell shortcuts' own flag".

[C-E04-062] **`target:` is normalized to its object form, and the scalar shorthand becomes a
`container`.** `target: host` expands to `target: {container: host}` (`target-scalar/`), and the
object form passes through with its command mode intact — `target: {container: c, commands:
restricted}` (`target-object/`) — both HTTP 200, checked 2026-08-23. So the model never sees the
scalar spelling, and the word `host` arrives as a *container name* rather than as a distinct kind.

[C-E04-063] **There is no auto-generated step name: the VERIFY resolves to "no scheme exists".**
Two unnamed steps expand with **no** `name:` key at all (`no-name/`, HTTP 200) — checked
2026-08-23 — and across the **157** captured expansions in `research/experiments/` no step-level
`name:` appears that the author did not write (the 84 files matching `name:` are all
`resources.repositories[].name`). The schema page describes `name` as "ID of the step. Acceptable
values: `[-_A-Za-z0-9]*`" and says nothing about generation. Consequence: **the model must not
invent one.** A step without an authored name has unreferenceable outputs — that is the pipeline
author's problem, not something for the converter to paper over — and E05 derives file names from
the ordinal and `displayName` (docs/04 §1), which needs no step `name`.

[C-E04-064] **`enabled: false` survives expansion rather than the step being dropped.** The
control probe sets it and the step is still present in the expansion with `enabled: false`
(`control-fields/`) — checked 2026-08-23. So skipping a disabled step is the *runner's* job, not
something the expansion has already done, and the model must carry the flag rather than assume
every step it sees is live.

[C-E04-065] **`displayName` is not defaulted by the service.** No probe's expansion gains a
`displayName` the author did not write — checked 2026-08-23 across
`research/experiments/E04-step-fields/` and the wider corpus. What the ADO UI shows for an unnamed
step is a presentation concern computed elsewhere; the model defaults it locally (to the task name,
then to the ordinal) so downstream code always has a label, and that default is **ours** rather
than a claim about the service.

[C-E04-066] **`continueOnError`, `enabled` and the numeric fields arrive as YAML scalars of the
authored type, and must be read as text.** The control probe authored `enabled: false`,
`continueOnError: true`, `timeoutInMinutes: 3` and `retryCountOnTaskFailure: 2`, and each is echoed
in the expansion in that spelling — checked 2026-08-23. Combined with C-E01-015/C-E01-020 (pipeline
values are strings, and `fetchDepth: 1` and `'1'` are the same pipeline), the model parses them
from text rather than trusting the YAML scalar kind.

[C-E04-067] **`bash` gains an input the author never wrote: `targetType: inline`.**
`bash-inputs/`, HTTP 200 — checked 2026-08-23. Recorded because it is a case of the expansion
*adding* inputs rather than only renaming them (C-E04-032's `artifactName`), so a consumer
comparing authored inputs against expanded ones must expect additions in both directions.

---

## E04-S02-T01 — variable scope and precedence (`C-E04-080..086`)

Evidence: the variables doc (fetched 2026-08-23, `ms.date: 2026-03-04`, source commit
`1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32` of `MicrosoftDocs/azure-devops-docs-pr`
`docs/pipelines/process/variables.md`) and **5 live probes** under
`research/experiments/E04-variables/`.

[C-E04-080] **The expansion does *not* resolve variable precedence: all three scopes survive.** A
document setting `a` at root, stage and job comes back with all three `variables:` blocks intact,
each with its own value (`three-scopes/`, HTTP 200) — checked 2026-08-23. This is the load-bearing
claim of the task: unlike the step shorthands of C-E04-030, **layering is ours**, and the model has
to implement it rather than read an already-resolved answer.

[C-E04-081] **Nor does it collapse duplicates within one scope.** Two entries named `a` in one
stage's list both survive, in authored order (`same-scope-duplicate/`, HTTP 200) — checked
2026-08-23. So last-wins is ours too.

[C-E04-082] **The documented precedence, quoted.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/process/variables — "When you set a
variable with the same name in multiple scopes, the following precedence applies (highest
precedence first): 1. Job level variable set in the YAML file 2. Stage level variable set in the
YAML file 3. Pipeline level variable set in the YAML file 4. Variable set at queue time 5. Pipeline
variable set in Pipeline settings UI" — checked 2026-08-23. And within one scope: "When you set a
variable with the same name in the same scope, the last set value takes precedence." Levels 4 and 5
are outside the YAML and therefore outside the model: they are the `.env` boundary (PLAN D7), which
is why the resolver layers exactly three.

[C-E04-083] **The scope rule in the page's own words.**
— same page — "At the root level, to make it available to all jobs in the pipeline. At the stage
level, to make it available only to a specific stage. At the job level, to make it available only to
a specific job." and "Variables at the job level override variables at the root and stage level.
Variables at the stage level override variables at the root level." — checked 2026-08-23. A job
therefore sees root + its own stage + itself, and **never a sibling stage's or a sibling job's**.

[C-E04-084] **The mapping shorthand is normalized to the list form by the service.**
`variables: {a: from-mapping, b: two}` expands to `- name: a / value: from-mapping` and
`- name: b / value: two` (`mapping-vs-list/`, HTTP 200) — checked 2026-08-23. So on the default path
the model only ever sees the list form, the same way `target:` only arrives as an object
(C-E04-062). The mapping branch is kept for the `--offline-expand` arm.

[C-E04-085] **`readonly: true` survives expansion verbatim**, so the model can carry it to the
manifest and the runtime (`readonly-flag/`, HTTP 200) — checked 2026-08-23. This matters because the
runtime already enforces it: a read-only overwrite emits an error and preserves the first value
(C-E06-005/006), and it needs to be told which names are read-only.

[C-E04-086] **An unresolvable `group:` is rejected by the service, so it never reaches the model.**
`- group: nonexistent-group` returns HTTP 400 — "An error occurred while loading the YAML build
pipeline. Variable group  was not found or is not authorized for use." (`group-entry/`) — checked
2026-08-23. What an **authorized** group expands to is *not* measured: it needs a variable group
provisioned and authorized in the test organization, which no current task does, and PLAN D7 forbids
fetching group *values* in any case. Recorded as a gap rather than guessed — the resolver carries a
group entry as a named marker contributing no value, which is the behavior E04-S02-T02's
classification and the `.env.example` synthesis (docs/04 §10) both expect.

---

## E04-S02-T02 — variable classification (`C-E04-087..092`)

Evidence: docs/01 §4 (the internal spec this task's **Ground** names) plus **existing** E06 claims for
the two syntaxes being scanned. No new probe was run and that is deliberate: the macro and
`setvariable` grammars are already measured, and re-probing them would produce a second recording of
the same facts rather than new evidence.

[C-E04-087] **The macro scanner mirrors the runtime's, rather than being a second regex.**
`azdo__macro_scan` (`packages/runtime/lib/core.sh`) finds `$(` and takes everything up to the
**first** `)` as the name — non-greedy, which is why `$(a$(b))` yields the candidate `a$(b` rather
than a nested reference (C-E06-018..024, docs/06 §5 decision 29). The static scanner uses the same
rule so a name it reports is a name the runtime would look up; candidates containing `$(` are
discarded as not-a-name rather than reported, since the runtime resolves the inner macro first and
the outer candidate never becomes one.

[C-E04-088] **Where a macro may appear is settled by docs/01 §4 and is narrower than "anywhere".**
— docs/01 §4 — "`$(x)` macro | Just before a task executes; textual substitution in task inputs
only | Task inputs (incl. inline script bodies), `env:` values | Left **literally** as `$(x)`" —
checked 2026-08-23. So the scan covers step `inputs` values and step `env` values, and nothing else;
a `$(x)` in a `displayName` is not a macro position and is not reported.

[C-E04-089] **A reference that resolves to nothing is not an error, which is why the classification
has an `env-required` class at all.** The same table records the missing-variable behavior per
syntax: a macro is "Left **literally** as `$(x)`", while both expression forms yield the empty
string. So an unresolved name is a *conversion-time question for the user* — supply it in `.env` —
rather than something to reject, and docs/01 §4's variable-group decision makes the same point from
the other side: "every `- group: X` maps to a documented block in `.env.example` that the user
fills".

[C-E04-090] **A group's members are unknowable at convert time by decision, not by omission.**
— docs/01 §4 — "variable groups are **never value-resolved** … When authenticated anyway (e.g. for
remote templates), the converter lists the group's variable **names** inside that block (values
always left empty); unauthenticated, it emits a placeholder block naming the group." — checked
2026-08-23; PLAN D7 is the decision. Consequence for classification: when a pipeline declares any
group, a name that is otherwise unaccounted for **may** be a group member, and the honest class is
`group-member` — a *possibility* carrying the declared group names, not a resolved fact. With no
group declared the same name is unambiguously `env-required`.

[C-E04-091] **`setvariable` producers are recognisable statically, and the recogniser is the
runtime's own command grammar.** The logging command is
`##vso[task.setvariable variable=v;isoutput=true]val` (docs/01 §4; the parser and its
case-insensitive property lookup are C-E06-044..049, and `setvariable` itself C-E06-050..056). The
scan is **best-effort by construction**, as the task's Do says: a script that composes the command
from a variable, or emits it from a program it invokes, cannot be seen — so a missed producer
degrades to `env-required`, which prompts the user rather than failing.

[C-E04-092] **The predefined table is not this task's, and the classifier takes it as an injected
port.** E04-S02-T03 owns `packages/engine/data/predefined-vars.json` and is scheduled *after* this
task, so the dependency runs backwards. Rather than build a second table here — the failure mode
C-E04-031's GUID case already illustrated — the classifier accepts the set and defaults to empty.
With no table injected nothing is classed `predefined`, and the **prefix heuristic** below is what
keeps the gap visible: a name beginning `Build.`, `System.`, `Agent.`, `Pipeline.`, `Environment.`
or `Release.` that is not in the injected table is reported as a warning
(`unknown-predefined`), because those namespaces are the service's and a converter silently
demanding one in `.env` would be wrong. The heuristic is *ours*, is not a claim about the service,
and is labelled as such.

---

## E04-S02-T03 — the predefined-variable table (`C-E04-093..096`)

Evidence: `packages/engine/data/predefined-vars.json`, generated by `pnpm predefined-vars` from
**`MicrosoftDocs/azure-devops-docs`** — the include
`docs/pipelines/build/includes/variables-hosted.md` at commit
`8e41b654da0437cb473ea1c78cf3df6a36289237`, plus the page
`docs/pipelines/build/variables.md` at `1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`.

[C-E04-093] **The rendered page cannot be pinned; the markdown behind it can, and that is why the
scraper reads the repository.** `learn.microsoft.com/.../pipelines/build/variables` builds its
table through an `[!INCLUDE]` directive — the page source contains
`[!INCLUDE [include](includes/variables-hosted.md)]` and no table — so the rendered HTML has no
version to fetch and would change with the site's templates. The public docs repository has both,
addressable by commit. Checked 2026-08-23. This is what makes the task's "scraper re-run produces
stable output" criterion a **property**: re-running at the same pins produces byte-identical output,
verified by regenerating and diffing.

[C-E04-094] **Two pins are needed, because the doc splits the content.** The include holds the
tables (Agent / Build / Pipeline / Deployment job / System / Checks variables, 89 rows); the page
holds two further variables in their own `##` sections. Fetching only the include silently loses
them — which the coverage check against docs/01 §5 caught, since that section requires
`System.Debug`. Checked 2026-08-23; the generated file records both commits in its `source` block.

[C-E04-095] **`Build.Clean` and `System.Debug` are the only writable predefined variables, and the
page says so in one sentence.** — https://learn.microsoft.com/en-us/azure/devops/pipelines/build/variables
(`docs/pipelines/build/variables.md` @ `1eeaa8de…`) — "These variables are automatically set by the
system and read-only. (The exceptions are Build.Clean and System.Debug.)" — checked 2026-08-23.
They are documented in their own sections *because* they are the exceptions, which is also why the
include's table does not carry them. The generated rows carry `writable: true`, so a consumer can
tell "a pipeline is assigning to a predefined name" (a bug worth pointing at) from the two cases
where that is legitimate.

[C-E04-096] **The table covers every name docs/01 §5 maps, with the wildcard expanded.** All 31
names §5 references resolve against the 91 generated rows, counting `System.PullRequest.*` as
covered by its eight concrete members and `Build.SourceBranch(Name)` as the two spellings it
abbreviates — checked 2026-08-23 by a coverage assertion that is part of the suite rather than a
one-off. §5's local-mapping strategy is unchanged by this task: it says what each name resolves to
*locally*, while this table says which names exist and where they are documented. Keeping them
apart is deliberate — the mapping is ours and the list is the service's, and merging them would make
a stale doc look like a design decision.

---

## E04-S03-T01 — matrix & `parallel` expansion (`C-E04-110..122`)

Evidence: two doc pages — the jobs concept page (…/process/phases, fetched 2026-08-24, source commit
`1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32` of `MicrosoftDocs/azure-devops-docs-pr`
`docs/pipelines/process/phases.md`) and the strategy schema page (`…/yaml-schema/jobs-job-strategy`,
fetched 2026-08-24, `ms.date: 2026-07-29`, source commit
`d089fd2dbb54483ec611eeb478e3eff14be74393` of `MicrosoftDocs/azure-devops-yaml-schema-pr`
`content/jobs-job-strategy.md`) — plus one real run in the oracle org
(`research/experiments/E04-strategy/real-run.md`). The schema page carries the naming sentence the
concept page omits, which is why both were fetched.

[C-E04-110] **A matrix key is *appended* to the job name to form the copy's name, space-separated.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/jobs-job-strategy — "For each
occurrence of *string1* in the matrix, a copy of the job is generated. The name *string1* is the
copy's name and is appended to the name of the job." and, from the Python example, "This matrix
creates three jobs: 'Build Python35,' 'Build Python36,' and 'Build Python37.'" — checked
2026-08-24. The separator is a **space**, not the `Job_<key>` underscore docs/01 §2 wrote (corrected
below, rule 5), and the name is the job's display name as the UI and timeline show it.

[C-E04-111] **Matrix key character set and length are constrained.** — same schema page — "Matrix
configuration names must contain only basic Latin alphabet letters (A-Z and a-z), digits (0-9), and
underscores (`_`). They must start with a letter. Also, their length must be 100 characters or
fewer." — checked 2026-08-24. Consequence: a key is a safe filename fragment and a safe variable
suffix; the model does not need to sanitize it (the service rejects invalid keys before a pipeline
reaches the model, so a key we see is already legal).

[C-E04-112] **Each matrix value pair becomes a variable available to the job.** — same page — "For
each occurrence of *string2*, a variable called *string2* with the value *string3* is available to
the job." — checked 2026-08-24. So expanding a matrix leg into a concrete job is: same job, plus the
key's mapping injected as job-level variables. Their precedence is that of any job-level variable
(C-E04-082), which is what lets a leg's `$(imageName)` override a pool macro.

[C-E04-113] **`maxParallel` is a scheduling cap, not a shape change, and `0`/absent means unlimited.**
— schema page — "The optional `maxParallel` keyword specifies the maximum number of simultaneous
matrix legs to run at once." and "If `maxParallel` is unspecified or set to 0, no limit is applied."
— checked 2026-08-24. It does not alter the set of concrete jobs; it only bounds how many run
concurrently, so the model records it rather than using it to merge or drop legs.

[C-E04-114] **`parallel: N` duplicates the job N times and adds `System.JobPositionInPhase` /
`System.TotalJobsInPhase`.** — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases —
"The `parallel` strategy enables a job to be duplicated many times. Variables `System.JobPositionInPhase`
and `System.TotalJobsInPhase` are added to each job. The variables can then be used within your
scripts to divide work among the jobs." — checked 2026-08-24. These two names are **not** in the
`build/variables` predefined table (they are documented only here, on the jobs page); the model
injects them as slice-scoped variables.

[C-E04-115] **`matrix` and `parallel` are mutually exclusive; `maxParallel` is only valid with
`matrix`.** — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases (the full job
syntax block) — "`parallel` and `matrix` are mutually exclusive — you may specify one or the other;
including both is an error — `maxParallel` is only valid with `matrix`" — checked 2026-08-24. The
service rejects the combination at load time, so a `strategy:` mapping reaching the model carries at
most one of the two.

[C-E04-116] **A `matrix` may be a runtime expression, and then its leg count is unknowable at convert
time.** — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases — "`matrix` accepts
a runtime expression containing a stringified JSON object. That JSON object, when expanded, must
match the matrixing syntax." — checked 2026-08-24. A `matrix: $[ … ]` leg set depends on a prior
job's output variable, so the model cannot expand it into concrete jobs; docs/01 §2 specifies the
degraded path (warning, the job survives unexpanded). This is the "runtime-expression matrix →
warning path" the Done field names.

[C-E04-117] **Multi-configuration always produces at least one job, even with an empty variable.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases — "Multi-configuration
always generates at least one job, even if a multi-configuration variable is empty." — checked
2026-08-24. An empty matrix mapping is therefore *not* "no jobs" — it is one job with no injected
variables. The model must not drop a matrix job that has a zero-entry mapping.

[C-E04-118] **The service does not expand `strategy:` — that is this epic's work, restated with the
claim this task owns.** E12-S01-T02's corpus sweep recorded that "`strategy: matrix`/`parallel` is
**not expanded** by the service, so no golden can ever prove job multiplication" (C-E12-018, flagged
"that is E04's, verified at L6"). Checked 2026-08-24: the preview endpoint returns a `finalYaml` that
still carries the authored `strategy:` block verbatim, so matrix/parallel expansion is **local**, and
a golden that never shows multiplication proves only that the service does not do it.

[C-E04-119] **The real run confirms the space-separated naming: matrix legs appear in the timeline as
`<JobName> <key>`.** `research/experiments/E04-strategy/real-run.md` (run 546) — the two Job records
are `Build Beta` and `Build Alpha` — checked 2026-08-24. This settles C-E04-110's sentence against
docs/01 §2's `Job_<key>` underscore, which was wrong (corrected under rule 5 below).

[C-E04-120] **Inside a matrix leg, `System.JobName` is the matrix key *alone*, not the full name —
only `System.JobDisplayName` and `Agent.JobName` carry `<JobName> <key>`.** Same run: in the `Beta`
leg `SYSTEM_JOBNAME=Beta`, `SYSTEM_JOBDISPLAYNAME=Build Beta`, `AGENT_JOBNAME=Build Beta` (and
`Alpha` symmetrically) — checked 2026-08-24. So the leg's *identity* is the key; the shared base name
lives only in the display name. This is a runtime-seeding fact (E06) rather than a model-shape fact,
but it is the sharpest naming nuance the run produced: anything that seeds `System.JobName` per leg
must use the matrix key, not `id`.

[C-E04-121] **`parallel: N` slices are named `<JobName> <position>`, and `System.JobPositionInPhase`
is 1-based.** Same run: the two Job records are `Slice 1` and `Slice 2`, and the echoed values are
`POSITION=1`/`POSITION=2` with `TOTAL=2` — checked 2026-08-24. So a parallel slice carries the same
space-appended naming as a matrix leg, but the suffix is the **1-based** position rather than a
matrix key, and the two slice variables are exactly `{1..N}` for `JobPositionInPhase` and `N` for
`TotalJobsInPhase`.

[C-E04-122] **Matrix value pairs are injected as macro-resolvable variables, verified live.** Same
run: `MATRIX_VAR=b` in the `Beta` leg and `MATRIX_VAR=a` in `Alpha` — checked 2026-08-24. This
confirms C-E04-112 executes as documented: the leg's `$(MATRIX_VAR)` resolves to its own value, so
the model injecting the mapping as job-level variables reproduces the service.

---

## E04-S03-T02 — dependency graphs & defaults (`C-E04-123..138`)

Evidence: the **stages** doc (…/process/stages, fetched 2026-08-24, `git_commit_id`
`1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`) and the **jobs** doc (…/process/phases, same commit),
for the differing defaults; plus **12 live preview probes** under
`research/experiments/E04-dependency-graph/` (six committed as transcripts by
`pnpm dependency-survey`, six more run inline during grounding) for the error phrasing the docs do
not state. The two defaults are the one thing the docs settle outright; everything about a broken
graph is measured.

[C-E04-123] **Stages default to sequential: a stage without `dependsOn` runs after the stage before
it in YAML order.** — https://learn.microsoft.com/en-us/azure/devops/pipelines/process/stages —
"When you define multiple stages in a pipeline, they run sequentially by default in the order you
define them in the YAML file. The exception to this is when you add dependencies. With dependencies,
stages run in the order of the `dependsOn` requirements." — checked 2026-08-24. So the stage graph's
default edge is stage *i* → stage *i+1*; the model applies it, the service leaves it implicit in the
expanded YAML.

[C-E04-124] **Jobs default to parallel: a job without `dependsOn` has no dependency.** —
https://learn.microsoft.com/en-us/azure/devops/pipelines/process/phases — "By default Azure DevOps
YAML pipeline jobs run in parallel unless the `dependsOn` value is set." — checked 2026-08-24. The
job graph's default is therefore no edge at all — the opposite default of stages, which is exactly
the asymmetry the task's **Do** names.

[C-E04-125] **`dependsOn: []` is the explicit opt-out that breaks the sequential stage default, and
it survives expansion verbatim.** — stages doc example: `- stage: AcceptanceTest` /
`dependsOn: [] # Runs in parallel with FunctionalTest` — checked 2026-08-24; and
`research/experiments/E04-dependency-graph/empty-dependson-stage/` (HTTP 200) shows the expanded
YAML still carries `dependsOn: []` unchanged, so the "run in parallel" meaning is run-time ordering,
not something the expansion rewrites. The model therefore must distinguish **absent** `dependsOn`
(→ sequential default) from **explicit empty** (→ no dependency), which is why `Stage.dependsOn`
carries `undefined` for the former.

[C-E04-126] **A missing *stage* dependency is a validation error with a fixed sentence.**
`research/experiments/E04-dependency-graph/missing-stage-dep/` — HTTP 400 `PipelineValidationException`,
`"Stage B depends on unknown stage NoSuchStage."` — checked 2026-08-24. One sentence per missing
target, naming the source stage and the unknown name.

[C-E04-127] **A missing *job* dependency names its stage too.**
`research/experiments/E04-dependency-graph/missing-job-dep/` — HTTP 400, `"Stage A job A2 depends on
unknown job NoSuchJob."` — checked 2026-08-24. The job-level sentence is the stage-level one with the
owning stage prefixed.

[C-E04-128] **A graph with no dependency-free stage is rejected by a dedicated sentence, not by a
cycle message.** `research/experiments/E04-dependency-graph/stage-cycle/` and `stage-self-dep/` —
HTTP 400, `"The pipeline must contain at least one stage with no dependencies."` — checked
2026-08-24. This is the service's spelling of the docs' "Pipelines must contain at least one stage
with no dependencies", and it fires on the **effective** graph — a bare `dependsOn: [Z]` (even one
naming a nonexistent stage) still makes a stage "have a dependency" for this check, as does the
sequential default on a later stage.

[C-E04-129] **The job-level equivalent of C-E04-128.**
`research/experiments/E04-dependency-graph/job-cycle/` — HTTP 400, `"Stage A must contain at least
one job with no dependencies."` — checked 2026-08-24.

[C-E04-130] **A cycle that leaves a root elsewhere is reported edge-by-edge.**
`stage-cycle-with-root` (A root; B `dependsOn: [A, C]`; C `dependsOn: B`) → HTTP 400 with **two**
sentences, `"Stage B depends on stage C which creates a cycle in the dependency graph."` and
`"Stage C depends on stage B which creates a cycle in the dependency graph."` — checked 2026-08-24.
So cycle detection is not a single "cycle" error: every edge that participates in a cycle gets its
own sentence, phrased `"<src> depends on <dst> which creates a cycle in the dependency graph."`.

[C-E04-131] **The job-level cycle sentence is the stage one with the stage prefixed.**
`job-cycle-with-root` → HTTP 400, `"Stage A job B depends on job C which creates a cycle in the
dependency graph."` + `"Stage A job C depends on job B which creates a cycle in the dependency
graph."` — checked 2026-08-24.

[C-E04-132] **Cycle edges are reported in source-declaration order.** In both C-E04-130's and
C-E04-131's transcripts the earlier-declared node's edge precedes the later's — checked 2026-08-24.
The model reports each cycle edge in node order (then authored edge order within a node), matching
that transcript byte-for-byte.

[C-E04-133] **The three checks have a fixed precedence: "no dependency-free node" shadows everything.**
`stage-missing-and-noroot` (A `dependsOn: Z` unknown, B `dependsOn: A`) → HTTP 400 with **only**
`"The pipeline must contain at least one stage with no dependencies."` — the missing `Z` is not
reported — checked 2026-08-24. So when no stage/job has zero effective dependencies, that single
sentence is emitted and the reference and cycle checks do not run.

[C-E04-134] **Cycle detection runs before the missing-target check.**
`stage-root-missing-cycle` (A root; B `dependsOn: [A, C]`; C `dependsOn: [B, Z]`) → HTTP 400 with the
two cycle sentences (C-E04-130) **first**, then `"Stage C depends on unknown stage Z."` — checked
2026-08-24. So the order is: root check → cycle edges → missing targets.

[C-E04-135] **A self-loop is a cycle edge, reported when a root exists elsewhere.**
`stage-self-loop-with-root` (A no deps; B `dependsOn: B`) → HTTP 400, `"Stage B depends on stage B
which creates a cycle in the dependency graph."` — checked 2026-08-24. A lone self-loop with no
other stage is instead the C-E04-128 "no dependency-free stage" case (the loop itself makes the
stage depend on something), which is the measured asymmetry.

[C-E04-136] **`dependsOn` references the *authored job name*, not a matrix/parallel leg name.** A job
`dependsOn: Build` where `Build` has `strategy: matrix` (and likewise `parallel`) is **accepted**
(HTTP 200, three probes) — checked 2026-08-24. The reference resolves to the whole matrix/parallel
job, i.e. every leg, so the model's job graph must resolve `dependsOn` targets against the base job
name and not against the leg ids (`Build Alpha`, `Build Beta`) that E04-S03-T01 renamed them to.

[C-E04-137] **Duplicate stage names are rejected before any graph is built.**
`stage-duplicate-name` → HTTP 400, `"The stage name A appears more than once. Stage names must be
unique within a pipeline."` — checked 2026-08-24. Recorded for completeness; it is **not** this
task's to implement (out of the **Do** field) — the service rejects duplicates before expansion, so
a `finalYaml` reaching the model on the default path is already unique. The offline-expand arm would
need it as a separate check.

[C-E04-138] **Duplicate job names are rejected the same way, scoped to a stage.**
`job-dup-in-stage` → HTTP 400, `"Stage A job A1 appears more than once. Job names must be unique
within a stage."` — checked 2026-08-24. Same out-of-scope status as C-E04-137.

---

## E04-S03-T03 — deployment job model (`C-E04-140..169`)

Evidence: the deployment-jobs concept page (…/process/deployment-jobs, fetched 2026-08-24, source
commit `1eeaa8de39f8b7130d8eb45ec907d9e47d6f5a32`), three yaml-schema pages
(`jobs-deployment`, `jobs-deployment-environment`, `jobs-deployment-strategy-run-once`, all fetched
2026-08-24 at source commit `d089fd2dbb54483ec611eeb478e3eff14be74393`), the corpus golden
`fixtures/oracle/08-deployment-runonce.final.yml`, **5 live preview probes**
(`research/experiments/E04-deployment/`, `pnpm`-less `node scripts/deployment-survey.ts`), and **one
hosted real run** (`research/experiments/E04-deployment/real-run.md`, run 548).

[C-E04-140] **A deployment job's name follows the same charset rule as a job's, and `deploy` is a
reserved keyword that cannot be the name.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/jobs-deployment — "Name of the
deployment job, A-Z, a-z, 0-9, and underscore. The word deploy is a keyword and is unsupported as the
deployment name." — checked 2026-08-24. Consequence: a deployment job id is a safe identifier the
way a job id is, and the model does not sanitize it (an invalid name is rejected before expansion).

[C-E04-141] **A deployment job carries no top-level `steps:` — its steps live under the strategy's
lifecycle hooks.** `fixtures/oracle/08-deployment-runonce.final.yml` and the `runonce-all-hooks`
probe both expand a `deployment:` job with no `steps:` key at job level; the hooks (`preDeploy`,
`deploy`, `routeTraffic`, `postRouteTraffic`, `on`) each carry their own `steps:`. — checked
2026-08-24. The builder therefore cannot read a deployment job's steps from the job mapping; the
hook sequence is the only place they are.

[C-E04-142] **`environment: <scalar>` is promoted to `environment: {name}` by the expansion.**
`research/experiments/E04-deployment/env-scalar/` — `environment: corpus-staging` → `environment:\n
name: corpus-staging`, HTTP 200 — checked 2026-08-24. Sibling of C-E04-062 (`target:`) and C-E04-084
(`variables:` mapping): the service normalizes the scalar shorthand, so on the default path the model
only ever sees the object form.

[C-E04-143] **The dotted `environment: env.resource` shorthand is understood by the service as name +
resource, and the resource must exist.** `research/experiments/E04-deployment/env-dotted/` —
`environment: corpus-staging.someResource` → HTTP 400 `"Job D: Resource someResource does not exist
in environment corpus-staging."` — checked 2026-08-24. The rejection proves the service parses the
dotted spelling into (environment, resource); it is not a scalar the model is free to treat as a
name. So the model never sees the dotted form on the default path (it is rejected before expansion);
the split belongs to the `--offline-expand` scalar branch, which must split on the **first** `.`.

[C-E04-144] **The full `environment: {name, resourceName, resourceType}` syntax is rejected when the
named resource does not exist.** `research/experiments/E04-deployment/env-full/` → HTTP 400, the same
sentence as C-E04-143 — checked 2026-08-24. A resource-form `environment:` can only appear in a
`finalYaml` whose resource exists, and no current task provisions one (a VM or Kubernetes resource);
the model's object-form parse is therefore doc-grounded rather than measured, and its resourceName /
resourceType fields are populated from the docs' shape (C-E04-145).

[C-E04-145] **The environment object's fields and the resourceType values, from the schema page.**
— https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/jobs-deployment-environment —
"`environment: string` | Deployment job with environment name." and "`environment: name,
resourceName, resourceId, resourceType, tags` | Full syntax for complete control." with the example
"`resourceType: string # type of the resource you want to target. Supported types - virtualMachine,
Kubernetes`" — checked 2026-08-24. The model carries exactly the three the task's **Do** names —
`name`, `resourceName`, `resourceType` — and leaves `resourceId`/`tags` out as not needed for the
naming quirk.

[C-E04-146] **The runOnce hook sequence and its order.** — the deployment-jobs page (…/process/
deployment-jobs) — "runOnce is the simplest deployment strategy wherein all the lifecycle hooks,
namely `preDeploy` `deploy`, `routeTraffic`, and `postRouteTraffic`, are executed once. Then, either
`on: success` or `on: failure` is executed." — checked 2026-08-24. The order
`preDeploy → deploy → routeTraffic → postRouteTraffic` then `on:{success,failure}` is exact, and the
model's fixed hook fields encode it rather than leaving it to a consumer.

[C-E04-147] **Each lifecycle hook is a step list with an optional `pool`, and by default the hooks
inherit the deployment job's pool.** — deployment-jobs page — "Each of the lifecycle hooks resolves
into an agent job or a server job … depending on the `pool` attribute. By default, the lifecycle
hooks inherit the `pool` specified by the `deployment` job." — checked 2026-08-24. Pool is metadata
(docs/01 §2) and its hook-level override is reserved for E08; the model records the hook's steps and
leaves the pool to that task.

[C-E04-148] **`strategy:` survives the expansion verbatim — the hooks' steps are not flattened.**
`runonce-all-hooks/` (HTTP 200) and `fixtures/oracle/08-deployment-runonce.final.yml` both keep the
authored `strategy: runOnce: {…}` block with each hook's `steps:` intact, only the step *shorthands*
inside being desugared (C-E04-030). — checked 2026-08-24. This is the same fact C-E04-118 records
for `matrix`/`parallel`: the multiplied/hooked structure is the model's to build, and the preview
never does it.

[C-E04-149] **The download-artifact task is auto-injected only in the `deploy` hook, and
`download: none` suppresses it.** — https://learn.microsoft.com/azure/devops/pipelines/yaml-schema/jobs-deployment-strategy-run-once —
"Download artifact task will be auto injected only in the `deploy` hook for deployment jobs. To stop
downloading artifacts, use `- download: none` …" — checked 2026-08-24. This is the same behavior
C-E06-096 pins ("only in deployment jobs, only for the `deploy` lifecycle hook … `download: none`
suppresses it"), so the model's auto-download flag is the deploy hook's *lack* of a `download: none`
step.

[C-E04-150] **`download: none` desugars to the `download` GUID task with `condition: false` and
`inputs: {alias: none}`.** `research/experiments/E04-deployment/download-none/` — the deploy hook's
`- download: none` expands to `task: 30f35852-…@1` with `condition: false` and `inputs: {alias:
none}`, HTTP 200 — checked 2026-08-24. The `download` GUID is the agent-internal one C-E04-032 maps
to the origin keyword `download`, so the model detects suppression as a deploy-hook step whose
`origin === 'download'` and `inputs.alias === 'none'`; the `condition: false` is the service's own
way of making the marker step a no-op, and it is asserted in the test rather than trusted.

[C-E04-151] **runOnce output variables (no resource) are keyed by the *job name*, not the lifecycle
hook.** — deployment-jobs page — "For **runOnce** strategy:
`$[dependencies.<job-name>.outputs['<job-name>.<step-name>.<variable-name>']]` (for example,
`$[dependencies.JobA.outputs['JobA.StepA.VariableA']]`)" — checked 2026-08-24. The first segment is
the deployment job's name, not `deploy`/`preDeploy`/etc.

[C-E04-152] **runOnce output variables *with* a resource are keyed `Deploy_<resource-name>` instead.**
— deployment-jobs page — "For **runOnce** strategy plus a resourceType:
`$[dependencies.<job-name>.outputs['Deploy_<resource-name>.<step-name>.<variable-name>']]`. (for
example, `$[dependencies.JobA.outputs['Deploy_VM1.StepA.VariableA']]`)" — checked 2026-08-24. The
`stageDependencies` form is the same key with the stage/job path: the doc's two examples use
`Deploy_DevEnvironmentV` and `Deploy_vmsfortesting`, so the prefix is literally
`Deploy_` + the `resourceName` field.

[C-E04-153] **The job-name nuance is confirmed live: the hook-name spelling does not resolve.**
`research/experiments/E04-deployment/real-run.md` (run 548) — reading both spellings from a later
stage, `CASE JOBNAME_KEY=[deployment-value]` and `CASE HOOKNAME_KEY=[]` — checked 2026-08-24. The
job-name key (`A1.setvarStep.myOutputVar`) resolves and the hook-name key
(`deploy.setvarStep.myOutputVar`) is empty, which is exactly C-E04-151 and refutes the obvious
"lifecycle-hook first segment" reading. This is the "job-name nuance between runOnce and matrix"
docs/01 §3 flagged as needing oracle verification.

[C-E04-154] **canary and rolling use a different first segment, and are reserved for E08.**
— deployment-jobs page — "For **canary** strategy:
`$[dependencies.<job-name>.outputs['<lifecycle-hookname>_<increment-value>.<step-name>.<variable-name>']]`"
and "For **rolling** strategy:
`$[dependencies.<job-name>.outputs['<lifecycle-hookname>_<resource-name>.<step-name>.<variable-name>']]`"
— checked 2026-08-24. The model records these two strategies as a `rolling`/`canary` marker and
implements neither (E08 owns them); the output-key helper only answers for runOnce.

[C-E04-155] **A deployment job does not clone the source repo automatically.** — deployment-jobs
page — "A deployment job doesn't automatically clone the source repo. You can check out the source
repo within your job with `checkout: self`." — checked 2026-08-24. Recorded because it is the
deployment-job analogue of the auto-download rule the emitter must respect: unlike an agent job,
nothing is checked out unless a `checkout` step says so.
