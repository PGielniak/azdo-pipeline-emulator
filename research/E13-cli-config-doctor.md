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
