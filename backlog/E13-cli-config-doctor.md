# E13 — CLI, config & doctor

Phase: P0–P4 (incremental) · Depends on: E00 · Design: docs/06 §1–§2
Primary grounding set: docs/06 (internal spec) · consuming epics' manifests · vendor docs for version-detection commands in doctor.

## E13-S01 — As a user, the CLI skeleton exists early with stable UX conventions, so every feature lands behind a consistent interface. (P0)
- [x] **E13-S01-T01 — CLI framework & command scaffold** *(done 2026-08-11. commander 15.0.0 exact-pinned — clipanion's current release is a pre-release (`4.0.0-rc.4`). `packages/cli/src/`: `exit.ts` (EXIT 0/1/2/3 + `CliError`/`NotImplementedError`), `program.ts` (all six commands of docs/06 §1 with help text, global `--json`, `run()` returning a code and never calling `process.exit`), `bin.ts` (the only module touching process state; `azdo-emu` bin). Unimplemented commands are registered and fail naming the epic that implements them. 27 tests: 9 `--help` snapshots, exit-code policy, and the usage-error matrix. **Decided and recorded** (docs/06 §1 + §5 #11): CLI usage errors reuse exit 1 (also commander's default, C-E13-007); the engines floor rises to ≥22.12 for `packages/cli` alone, per commander 15's own floor and C-E00-002's decision-entry requirement.)*
  **Do:** `packages/cli` (commander or clipanion): `auth login|status`, `convert`, `doctor`, `fetch-artifacts`, `preview-diff`, `run` registered with help text per docs/06 §1; global `--json`, exit-code policy (0/1/2/3) centralized.
  **Ground:** docs/06 §1 as spec; chosen CLI lib docs pinned.
  **Done:** `--help` snapshots; exit-code unit tests; unknown-flag behavior defined.
- [x] **E13-S01-T02 — Config loader & precedence** *(done 2026-08-11. `packages/cli/src/config/`: `types.ts` (typed `AzdoEmuConfig` + total `ResolvedSettings` + `DEFAULTS`), `load.ts` (discovery beside the pipeline, plain-`yaml` parse, hand-written validation with `file:line:col` + did-you-mean, every failure a `CliError`), `parameters.ts` (`--parameter name=value`, `@file.json`, `@@` escape), `resolve.ts` (CLI > config > defaults with per-key provenance). Schema published at `schema/azdo-emu.schema.json` (draft-07) with a drift-guard test pinning it to the loader's key set **and** defaults. 90 tests incl. a literal precedence matrix over all 14 scalar keys × 3 layers. **Decided** (C-E13-012/013): map-valued keys (`parameters`, `repositories`, `tasks.overrides`) merge per key while scalars/lists replace; CLI paths resolve from cwd, config paths from the config file's directory.)*
  **Do:** `azdo-emu.yaml` schema (typed, validated with friendly errors), precedence CLI > config > defaults, `--parameter` repeatable + `@file.json` complex values.
  **Ground:** docs/06 §2 example as schema source; JSON-schema for the config committed (self-documenting).
  **Done:** precedence matrix tests; schema published in repo.

## E13-S02 — As a user, `convert` exposes the full P2 surface honestly. (P2)
- [ ] **E13-S02-T01 — `convert` wiring & flags**
  **Do:** `-o`, `--target-os`, `--checkout-mode`, `--only-stage`, `--group-names`, `--min-coverage`, `--offline`, `--frozen/--update`, `--strict`; progress output; final coverage one-liner.
  **Ground:** docs/06 §1 flag list; each flag's behavior test cites the epic that implements it (cross-link table in research note).
  **Done:** e2e per flag on fixtures; `--json` output schema stable.
- [ ] **E13-S02-T02 — `run` convenience proxy**
  **Do:** thin passthrough to `<outdir>/run.sh` forwarding args; zero logic duplication (guard test: proxy adds nothing but exec).
  **Ground:** docs/04 §2 entry-point contract (the proxy must forward exactly the documented flags; cite the flag claims from E05-S01-T03); POSIX `exec`/arg-forwarding semantics from the GNU bash manual (pin).
  **Done:** e2e parity: proxy vs direct invocation identical, including exit codes and signal handling.

## E13-S03 — As a user, auth commands make sign-in state obvious. (P3)
- [ ] **E13-S03-T01 — `auth login`/`auth status` UX**
  **Do:** device-code display flow (code + URL + spinner), mode display, org/identity/expiry table, `--github` variant; failure hints (firewall, conditional access).
  **Ground:** E08-S01 implementations + their pinned sources; UX copy reviewed against the real `az login` device flow wording (screenshot in research note) for familiarity.
  **Done:** manual walkthrough recorded; non-tty behavior defined & tested.

## E13-S04 — As a user, `doctor` tells me exactly what my machine is missing for a given generated project. (P4)
- [ ] **E13-S04-T01 — Doctor engine**
  **Do:** read `manifest.json` `tools[]`; probe PATH + versions (per-tool version-command table), compare semver ranges; remediation strings (install hints per OS); `--json`.
  **Ground:** each probe command cited from the tool's official docs (`az version`, `docker version --format`, `helm version --template`, `kubectl version --client -o json`, `dotnet --version`, `pwsh -v` — pin each vendor page; output-format claims per tool).
  **Done:** probe table tests with canned outputs; fixture manifest → doctor snapshot.
- [ ] **E13-S04-T02 — Doctor↔handler contract**
  **Do:** handler `ToolRequirement` schema finalized (cmd, min, neededBy, remediation); aggregation in manifest; CI check: every handler emitting CLI calls declares requirements.
  **Ground:** requirement values cite handler research notes (E09–E11) — doctor never invents versions.
  **Done:** contract test over all registered handlers.
