# E13 — CLI, config & doctor: grounding notes

Spec source for this epic is **docs/06 §1** (the CLI surface) and **§2** (the config file); those are
internal design, so the external grounding is the CLI library's actual behaviour, pinned to source.

## E13-S01-T01 — CLI framework & command scaffold

### Library choice

[C-E13-001] **commander 15.0.0** is chosen over clipanion because clipanion's current release is a
pre-release (`4.0.0-rc.4`, i.e. no stable line), while commander ships a stable major. Exact-pinned
in `packages/cli/package.json` per the repo convention for behaviour-critical dependencies.
  — https://registry.npmjs.org/clipanion/latest — `"version": "4.0.0-rc.4"` (checked 2026-08-11)
  — https://registry.npmjs.org/commander/latest — `"version": "15.0.0"` (checked 2026-08-11)

[C-E13-002] commander 15 declares `"engines": {"node": ">=22.12.0"}` — *higher* than this repo's
`>=22` floor. Node 22.12.0 is the first 22.x in the LTS line, so nothing supported is excluded; the
floor is raised **for `packages/cli` only**, which is the package that depends on commander. C-E00-002
requires a decision-record entry for a floor raise (docs/06 §5 #11).
  — https://registry.npmjs.org/commander/latest — `"engines": {"node": ">=22.12.0"}` (checked 2026-08-11)

### Behaviour this scaffold depends on — all pinned to `tj/commander.js@ba6d13dd`

[C-E13-003] **`exitOverride()` does not stop commander from exiting** — `_exit()` calls the callback
and *then* calls `process.exit(exitCode)` regardless. The comment in the source says the line is
"Expecting this line is not reached", i.e. the callback is required to throw (the default callback
does). Our override therefore throws a typed error rather than returning a code, or the process would
exit with commander's own code before our exit-code policy ran.
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L534-L540
  — "_exit(exitCode, code, message) { if (this._exitCallback) { this._exitCallback(new CommanderError(exitCode, code, message)); // Expecting this line is not reached. } process.exit(exitCode); }"

[C-E13-004] **Unknown option** → message `error: unknown option '<flag>'` (plus a did-you-mean
suggestion when one is close) written to **stderr**, `CommanderError.code = 'commander.unknownOption'`,
and exit code **1**, because `error()` defaults `exitCode` to 1. Same path for every usage error
(missing argument, unknown command, excess arguments), all defaulting to 1.
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L2148
  — "const message = `error: unknown option '${flag}'${suggestion}`; this.error(message, { code: 'commander.unknownOption' });"
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L1966-L1969
  — "const exitCode = config.exitCode || 1; const code = config.code || 'commander.error'; this._exit(exitCode, code, message);"

Forward note for **E13-S02-T02** (`run <outdir> [args...]` proxy): as registered by the scaffold,
`azdo-emu run out --foo` hits the unknown-option path above *before* reaching the action, because
commander parses flags it does not recognize as errors rather than as positional arguments. A proxy
that forwards arbitrary flags to `run.sh` needs `.passThroughOptions()` (and
`.enablePositionalOptions()` on the parent) — settled there, not here.

[C-E13-005] **`--help` and `--version` exit through the same override as errors**, with code
`commander.helpDisplayed` / `commander.version` and exit code **0**; `.help({error: true})` (help
printed to stderr) exits **1**. A policy that maps "any CommanderError ⇒ failure" would therefore make
`--help` exit non-zero — the mapping must be by `err.exitCode`, not by "an error was thrown".
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L2706
  — "this.outputHelp(); … this._exit(0, 'commander.helpDisplayed', '(outputHelp)');"
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L2220
  — "this._exit(0, 'commander.version', str);"
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L2636-L2647
  — "let exitCode = Number(process.exitCode ?? 0); if (exitCode === 0 && … contextOptions.error) { exitCode = 1; }"

[C-E13-006] **Help output is environment-dependent in two ways that would make snapshots flaky.**
Width: `getOutHelpWidth()` returns `process.stdout.columns` **only when stdout is a TTY**, and
`Help.prepareContext` falls back to `80` otherwise — so a developer's wide terminal wraps differently
from CI. Colour: `useColor()` returns **true whenever `FORCE_COLOR` or `CLICOLOR_FORCE` is set**, even
for a non-TTY stream, so a CI runner that exports either would inject ANSI codes into captured output.
Both are pinned explicitly in our output configuration for tests rather than left to the environment.
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L66-L73
  — "getOutHelpWidth: () => process.stdout.isTTY ? process.stdout.columns : undefined" ·
    "useColor() ?? (process.stdout.isTTY && process.stdout.hasColors?.())"
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/command.js#L2781-L2788
  — "if (process.env.NO_COLOR || process.env.FORCE_COLOR === '0' || … ) return false; if
    (process.env.FORCE_COLOR || process.env.CLICOLOR_FORCE !== undefined) return true;"
  — https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/lib/help.js#L31
  — "this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;"
  — Addendum (found while building): commander's *types* declare `getOutHelpWidth: () => number`
    while its own default implementation returns `number | undefined`, so under
    `exactOptionalPropertyTypes` an override cannot simply forward an optional width. We install the
    width getters only when a caller pins one, leaving commander's terminal-reading default in place
    for real users (`packages/cli/src/program.ts`).

### Exit-code policy (docs/06 §1 + a gap it does not cover)

[C-E13-007] docs/06 §1 fixes the *conversion* outcomes: `0` ok, `1` conversion errors, `2`
warnings-as-errors under `--strict`, `3` below `--min-coverage`. It says nothing about **CLI usage
errors** (unknown flag, missing argument, unknown command). Decided: usage errors reuse **1**, the
generic failure code, rather than inventing a fourth value that would contradict the documented set —
which also happens to be commander's own default (C-E13-004), so the two agree without translation.
Recorded here so a later change does not "fix" the overlap by splitting it.
  — docs/06 §1 — "exit codes 0 ok / 1 conversion errors / 2 warnings-as-errors (`--strict`) / 3 below
    `--min-coverage`"
  — **Addendum 2026-08-22 (E12-S02-T01).** The quoted excerpt is accurate as of the 2026-08-11 check;
    docs/06 §1 was revised on 2026-08-22 and the documented set is now **`0` ok / `1` conversion
    errors / `2` warnings-as-errors** — `3` went with the weighted coverage metric and the
    `--min-coverage` gate (PLAN D10 revised, docs/07 §6, docs/06 §5 decision 43). `EXIT.coverage` is
    removed from `packages/cli/src/exit.ts`. **The decision this claim records is unchanged:** usage
    errors still reuse `1` rather than a code outside the documented set, and that is still
    commander's own default (C-E13-004). The original quote is left verbatim rather than rewritten,
    per the Grounding Protocol — a claim records what a source said on the date it was read.

## E13-S01-T02 — config loader & precedence

### Spec source

[C-E13-008] The config surface is **docs/06 §2** (internal design): `organization`, `project`,
`auth.{azdo,github}`, `parameters`, `repositories.<alias>.path`, `variableGroups.listNames`,
`coverage.min` *(removed 2026-08-22 — see the addendum below)*,
`tasks.{unknown,overrides,execute}`, `output.{targetOs,checkoutMode,sharedWorkspace}`,
`output.execution.{environment,image,dockerSocket}` — "next to the pipeline, all keys optional;
CLI > config > defaults". docs/06 §1's flag list contains **no `--config` flag**, so discovery is by
convention (beside the pipeline file) and not overridable at this task's scope.
  — docs/06 §2 (checked 2026-08-11)
  — **Addendum 2026-08-22 (E12-S02-T01).** `coverage.min` was removed from docs/06 §2, from the
    loader's `CONFIG_KEYS`, and from `schema/azdo-emu.schema.json` with the coverage metric it gated
    (docs/06 §5 decision 43). The surface this claim enumerates is otherwise unchanged, and the
    "all keys optional; CLI > config > defaults" rule it pins is untouched.

### Runtime parameters — what the CLI layer may and may not do

[C-E13-009] There are **13** runtime parameter data types, one more than the list in docs/02 §… —
`stringList` — and it is explicitly **"Not available in templates"**. docs/02's sentence is scoped to
*template* parameters, so it is correct as written; the note to carry forward is that a **root-level**
pipeline parameter may additionally be `stringList` (bind/validate in the E03/E04 binder, not here).
  — https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters (checked 2026-08-11)
  — "| `stringList` | a list of items, multiple can be selected. Not available in templates |"
  — "The `stringList` data type isn't available in templates. Use the `object` data type in templates instead."

[C-E13-010] Parameters are evaluated at **template parsing (queue)** time and are **immutable after
queue**, which is precisely why parameter values enter through this CLI/config layer rather than
through `.env` at run time.
  — https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters (checked 2026-08-11)
  — "| **Evaluation Time** | Template parsing (queue) | … |" · "| **Mutability** | Immutable after queue | … |"

**Open questions deliberately left to the binder epic (E03 expansion / E04 model), not answered here.**
The loader never sees the pipeline's declared parameter types — it reads `azdo-emu.yaml` and CLI
arguments — so it cannot coerce `--parameter n=42` to a number, and must not try. It passes the raw
string (or the parsed JSON structure from `@file.json`) through; binding coerces against the declared
type, per docs/01 ("Bound at convert time from `--parameter`/config/defaults; `values:` and type
validation enforced"). Two behaviours the binder will need, both worth an oracle probe *there*:
  1. How the service coerces a queue-time string into a `boolean`/`number`/`object` parameter (the
     preview endpoint takes `templateParameters` as strings, so this is directly observable).
  2. What happens when a parameter has no `default:` — the docs say "You can't make parameters
     optional… If you don't assign a default value or set `default` to `false`, the first available
     value is used", which reads as *first entry of `values:`*, and does not say what happens when
     there is neither. docs/01 currently says "missing required parameter = convert error"; these two
     need reconciling **with evidence** before either is implemented.
  — https://learn.microsoft.com/azure/devops/pipelines/process/runtime-parameters (checked 2026-08-11)
  — "Parameters must contain a name and data type. You can't make parameters optional. You need to
     assign a default value in your YAML file or when you run your pipeline. If you don't assign a
     default value or set `default` to `false`, the first available value is used."

### The committed JSON schema

[C-E13-011] The config schema is committed at **`schema/azdo-emu.schema.json`** in **draft-07** and is
consumed by editors through a modeline. `yaml-language-server` (the engine behind VS Code's YAML
support) accepts `draft-04`, `draft-07`, `2019-09` and `2020-12`, so draft-07 is not a compatibility
compromise; it is chosen because it is the dialect this repo already vendors and validates elsewhere
(the pipeline schema, C-E00-008/C-E01-030), keeping one dialect in the codebase. The modeline form —
and the fact that a *relative* `$schema` path resolves from the YAML file's own location, which is
what makes a repo-relative reference work — is pinned below.
  — https://github.com/redhat-developer/yaml-language-server/blob/d399eb99100eaa3a6399a5ffca01d281d0074516/README.md
  — "Schema validation supports JSON Schema `draft-04`, `draft-07`, `2019-09`, and `2020-12`."
  — "# yaml-language-server: $schema=<schema-url-or-path>"
  — "Relative paths in modelines are resolved from the YAML file's location, not the workspace root."

### Decisions this task must make (docs/06 §2 does not state them)

[C-E13-012] **Map-valued keys merge per key; every other key replaces.** `parameters`,
`repositories` and `tasks.overrides` are maps, and "CLI > config > defaults" does not say whether a
CLI entry replaces the whole map or one key of it. Decided: per-key merge — config
`parameters: {a: 0, b: 2}` plus `--parameter a=1` yields `{a: 1, b: 2}`. Rationale: `--parameter` is
*repeatable* (docs/06 §1), which only makes sense if each occurrence contributes one entry rather
than redefining the set; the same reading is applied to `repositories` and `tasks.overrides` for
consistency. Scalars and lists (`tasks.execute`) replace wholesale.

[C-E13-013] **`@file.json` and path resolution.** A `--parameter name=@file.json` value loads and
parses that file as JSON, giving the complex value docs/06 §1 calls for. Decided: paths **typed on
the command line resolve from the process working directory** (that is where a shell user's relative
path points), while paths **written inside the config file** — `repositories.<alias>.path` — resolve
**from the config file's own directory**, so a config stays valid regardless of where it is invoked
from. A literal value beginning with `@` is escaped by doubling it (`@@x` ⇒ `@x`); a missing file or
invalid JSON is a `CliError` naming the resolved path, never a silent fallback to the literal string.
