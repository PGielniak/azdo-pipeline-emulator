# E00 — Foundations & grounding infrastructure

Phase: P0 · Depends on: — · Design: PLAN.md §5 (D1, D6), docs/06 §4
Primary grounding set: `research/REFERENCES.md` (seeded), microsoft/azure-pipelines-vscode, learn.microsoft.com REST reference.

## E00-S01 — As a contributor, I have a repo where quality gates and conventions are automatic, so every later epic starts on rails.
Acceptance: fresh clone → `pnpm i && pnpm test && pnpm lint` green; CI enforces the same.

- [x] **E00-S01-T01 — Monorepo scaffold**
  **Do:** pnpm workspace with `packages/cli`, `packages/engine`, `packages/fetch`, `packages/emit`, `packages/runtime` (bash sources + bats), `fixtures/`, `research/`; TypeScript strict, Node ≥ 22, vitest, eslint+prettier; `packages/*` build via tsup.
  **Ground:** PLAN.md D1 rationale; verify Node LTS support statement on nodejs.org release schedule (pin in research note).
  **Done:** all packages build empty entry points; vitest sample test runs; layout documented in root README dev section.
- [x] **E00-S01-T02 — CI workflow**
  **Do:** GitHub Actions: lint + typecheck + unit (ubuntu, macos) + bats for `packages/runtime`; artifact upload of test reports; job for nightly oracle run (created disabled; enabled in E12-S03).
  **Ground:** bats-core official docs (github.com/bats-core/bats-core) for invocation; record versions in `research/E00-foundations.md`.
  **Done:** CI green on a PR touching each package.
- [x] **E00-S01-T03 — Grounding Protocol enforcement artifacts** *(closed 2026-07-31. The blocker was that `origin/main` held only the planning commit, so the template was never on the default branch. Merged PR #1 (7 commits incl. `a4b7767`, which adds the template); GitHub's `repository.pullRequestTemplates` now returns `pull_request_template.md` (1530 chars) — i.e. GitHub itself recognizes it, which is the mechanism that pre-fills the PR form. Dummy claim entry demonstrating the format: `research/README.md:17` (`[C-E06-007]`). Guard `scripts/check-verify-markers.sh --all` exits 0. **Caveat, recorded in `research/E00-foundations.md`:** the visual auto-fill was not observed end-to-end — API-created PRs never receive the template, and anonymous fetches of the compare page omit the PR form. A signed-in UI check on the next PR would close that gap.)*
  **Do:** `.github/pull_request_template.md` with the §3 BACKLOG checklist (sources linked, permalinks pinned, claim IDs added, VERIFY items resolved); `research/` README describing claim entry format; pre-commit check (lint rule or script) that flags `VERIFY:` markers left in changed code.
  **Ground:** BACKLOG.md §3 itself (meta); no external source needed — mark N/A explicitly (the only allowed N/A in the backlog).
  **Done:** template renders on PRs; a dummy claim entry exists demonstrating format.

## E00-S02 — As an engine developer, official schema and reference material are pinned in-repo, so parsing work never depends on live network or memory.
Acceptance: schema snapshot vendored with provenance; refresh script re-pins.

- [x] **E00-S02-T01 — Vendor the official YAML JSON schema**
  **Do:** script `scripts/refresh-schema.ts` downloading the pipeline schema from `microsoft/azure-pipelines-vscode` (locate `service-schema.json` in the repo; pin commit) into `packages/engine/vendor/schema/` with a `PROVENANCE.json` (URL, commit, date, sha256).
  **Ground:** github.com/microsoft/azure-pipelines-vscode — confirm the schema file's current path/name from the repo tree; learn.microsoft.com/azure/devops/pipelines/yaml-schema/ as the human-readable counterpart. Record both in `research/E00-foundations.md`.
  **Done:** vendored schema + provenance committed; refresh script idempotent; schema loads and compiles with the chosen JSON-schema validator.
- [x] **E00-S02-T02 — Seed and maintain `research/REFERENCES.md`**
  **Do:** verify every URL in the seeded file resolves (curl status + title); replace `VERIFY` markers with pinned links; add missing per-keyword yaml-schema pages index.
  **Ground:** the seeded `research/REFERENCES.md` itself lists the candidates; each must be confirmed live and corrected if moved.
  **Done:** zero unverified entries; file states last-checked date per link.
- [x] **E00-S02-T03 — task.json snapshot tooling**
  **Do:** script pulling `task.json` files for a configured task list from `microsoft/azure-pipelines-tasks` at a pinned release tag into `packages/emit/vendor/tasks-meta/<Name>@<major>/task.json` (+ PROVENANCE). Consumed by E09-S01.
  **Ground:** github.com/microsoft/azure-pipelines-tasks — confirm `Tasks/<Name>V<n>/task.json` layout and pick the pin tag from that repo's releases; note the repo's `README`/docs on task versioning.
  **Done:** snapshots for `CmdLineV2`, `BashV3`, `PowerShellV2`, `CopyFilesV2` committed with provenance; adding a task = one list entry.

## E00-S03 — As the project owner, the parity oracle against the real service exists from day one, so every engine decision can be verified, not guessed.
Acceptance: a scripted call returns the service's final YAML for an arbitrary YAML payload.

- [x] **E00-S03-T01 — Test-org runbook** *(done 2026-08-11. The oracle went live 2026-07-31 — project `oracle` + pipeline `oracle-anchor` `definitionId=19`, anchor YAML pushed, Step-5 preview returning HTTP 200 + `finalYaml` (C-E00-017/018 confirmed live) — and the last open Done item, "secrets stored", closed today: the owner **rotated the PAT** (the original had been transmitted through chat and was treated as compromised), wrote the replacement straight into `.env.oracle`, stored all four values as GitHub repo **secrets**, and revoked the old token. Verified live against the new token: a full `pnpm corpus-oracle` run returned all ten corpus expansions byte-identical, exercising Build (read) + Code (read). `ORACLE_ENABLED` stays unset until E12-S03. Recorded in `research/oracle-setup.md` (completion record + deviation 3 closed); **deviations 1 and 2 stand**: the oracle lives in the owner's personal org (isolation is at project level, so redaction is load-bearing) and the PAT is wider than Build (read) — scope minimality was not re-audited at rotation, and Code (write) is unexercised until a corpus fixture changes.)*
- [x] **E00-S03-T02 — Oracle spike: fetch `finalYaml`** *(done 2026-07-31: `packages/fetch/src/oracle.ts` (typed client: `previewUrl`/`preview`/`configFromEnv`/`redact`) + `scripts/oracle-probe.ts` (`pnpm oracle-probe`) → 6 redacted transcripts in `research/experiments/oracle-spike/`. Both Done items met: `five-line.md` is the committed request/response pair, and `README.md` documents every failure mode. Six new claims C-E00-022..027 — three of them corrections to what the runbook predicted: invalid PAT → **302** not 401, missing pipelineId → **500** not 404, empty `yamlOverride` → **200 expanding the committed YAML** rather than an error. Runbook + docs/02 §8 corrected per rule 5. Tests: 19 in `packages/fetch/test/oracle.test.ts`, offline via injected fetch.)*
  **Do:** minimal script (`packages/fetch/src/oracle.ts`) POSTing `{previewRun: true, yamlOverride}` to the preview endpoint; save request+response samples (secrets redacted) under `research/experiments/oracle-spike/`.
  **Ground:** same preview REST page; the saved live response **is** the grounding artifact proving endpoint, api-version, and `finalYaml` field name.
  **Done:** committed sample pair for a 5-line pipeline; documented failure modes (bad YAML → error shape).
