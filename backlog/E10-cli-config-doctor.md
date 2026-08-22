# E10 — CLI, config & doctor

Phase: P1–P3 (incremental) · Depends on: E00 · Design: docs/06 §1–§2
Primary grounding set: docs/06 (internal spec) · consuming epics' manifests · vendor docs for version-detection commands in doctor.

> **Trimmed by the simplification (docs/07).** The `preview-diff` command is gone (there is no
> local expansion to diff against — the service *is* the expansion, PLAN D3); `--min-coverage` and
> `--target-os` are dropped with the coverage metric and the deferred Windows host.

## E10-S01 — As a user, the CLI skeleton exists early with stable UX conventions, so every feature lands behind a consistent interface. (P1)
- [x] **E10-S01-T01 — CLI framework & command scaffold**
  **Do:** `packages/cli` (commander): `auth login|status`, `convert`, `doctor`, `fetch-artifacts`, `run` registered with help text per docs/06 §1; global `--json`, exit-code policy (0/1/2/3) centralized.
  **Ground:** docs/06 §1 as spec; chosen CLI lib docs pinned.
  **Done:** `--help` snapshots; exit-code unit tests; unknown-flag behavior defined.
- [x] **E10-S01-T02 — Config loader & precedence**
  **Do:** `azdo-emu.yaml` schema (typed, validated with friendly errors), precedence CLI > config > defaults, `--parameter` repeatable + `@file.json` complex values.
  **Ground:** docs/06 §2 example as schema source; JSON-schema for the config committed.
  **Done:** precedence matrix tests; schema published in repo.

## E10-S02 — As a user, `convert` exposes the full P2 surface honestly. (P2)
- [ ] **E10-S02-T01 — `convert` wiring & flags**
  **Do:** `-o`, `--checkout-mode`, `--only-stage`, `--group-names`, `--offline`, `--frozen`/`--update`, `--strict`, `--no-bundle`; progress output; a final one-line summary (steps emitted, warnings count).
  **Ground:** docs/06 §1 flag list; each flag's behavior test cites the epic that implements it (cross-link table in a research note).
  **Done:** e2e per flag on fixtures; `--json` output schema stable.
- [ ] **E10-S02-T02 — `run` convenience proxy**
  **Do:** thin passthrough to `<outdir>/run.sh` forwarding args; zero logic duplication (guard test: proxy adds nothing but exec).
  **Ground:** docs/04 §2 entry-point contract (the proxy must forward exactly the documented flags; cite the flag claims from E05-S01-T03); POSIX `exec`/arg-forwarding semantics from the GNU bash manual (pin).
  **Done:** e2e parity: proxy vs direct invocation identical, including exit codes and signal handling.

## E10-S03 — As a user, auth commands make sign-in state obvious. (P3)
- [ ] **E10-S03-T01 — `auth login`/`auth status` UX**
  **Do:** device-code display flow (code + URL + spinner), mode display, org/identity/expiry table, `--github` variant; failure hints (firewall, conditional access).
  **Ground:** E09-S01 implementations + their pinned sources; UX copy reviewed against the real `az login` device flow wording.
  **Done:** manual walkthrough recorded; non-tty behavior defined & tested.

## E10-S04 — As a user, `doctor` tells me exactly what my machine is missing for a given generated project. (P3)
- [ ] **E10-S04-T01 — Doctor engine**
  **Do:** read `manifest.json` `tools[]`; probe PATH + versions (per-tool version-command table), compare semver ranges; remediation strings (install hints per OS); `--json`.
  **Ground:** each probe command cited from the tool's official docs (`az version`, `docker version --format`, `helm version --template`, `kubectl version --client -o json`, `pwsh -v` — pin each vendor page).
  **Done:** probe table tests with canned outputs; fixture manifest → doctor snapshot.
- [ ] **E10-S04-T02 — Doctor↔task contract**
  **Do:** `ToolRequirement` schema finalized (cmd, min, neededBy, remediation); aggregation in manifest; CI check: every task declaring CLI calls declares requirements.
  **Ground:** requirement values cite the task research notes (E07/E08) — doctor never invents versions.
  **Done:** contract test over all registered tasks.
