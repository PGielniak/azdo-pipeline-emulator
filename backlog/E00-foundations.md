# E00 — Foundations & expansion client

Phase: P1 · Depends on: — · Design: PLAN.md §5 (D1, D3), docs/05 §2, docs/06 §4
Primary grounding set: `research/REFERENCES.md` (seeded), learn.microsoft.com REST reference,
microsoft/azure-pipelines-vscode.

> S01–S03 are complete and carry over from the original plan unchanged. S04 is new: it promotes the
> preview client from a **test oracle** to the **product's expansion step** (PLAN D3, docs/07).

## E00-S01 — As a contributor, I have a repo where quality gates and conventions are automatic, so every later epic starts on rails.
Acceptance: fresh clone → `pnpm i && pnpm test && pnpm lint` green; CI enforces the same.

- [x] **E00-S01-T01 — Monorepo scaffold**
  **Do:** pnpm workspace with `packages/cli`, `packages/engine`, `packages/fetch`, `packages/emit`, `packages/runtime` (bash sources + bats), `fixtures/`, `research/`; TypeScript strict, Node ≥ 22, vitest, eslint+prettier; `packages/*` build via tsup.
  **Ground:** PLAN.md D1 rationale; verify Node LTS support statement on nodejs.org release schedule (pin in research note).
  **Done:** all packages build empty entry points; vitest sample test runs; layout documented in root README dev section.
- [x] **E00-S01-T02 — CI workflow**
  **Do:** GitHub Actions: lint + typecheck + unit (ubuntu, macos) + bats for `packages/runtime`; artifact upload of test reports; job for nightly oracle run (created disabled; enabled in E11).
  **Ground:** bats-core official docs (github.com/bats-core/bats-core) for invocation; record versions in `research/E00-foundations.md`.
  **Done:** CI green on a PR touching each package.
- [x] **E00-S01-T03 — Grounding Protocol enforcement artifacts**
  **Do:** `.github/pull_request_template.md` with the §3 BACKLOG checklist; `research/` README describing claim format; pre-commit check that flags `VERIFY:` markers left in changed code.
  **Ground:** BACKLOG.md §3 itself (meta); no external source needed — mark N/A explicitly.
  **Done:** template renders on PRs; a dummy claim entry exists demonstrating format.

## E00-S02 — As an engine developer, official schema and reference material are pinned in-repo, so parsing work never depends on live network or memory.
Acceptance: schema snapshot vendored with provenance; refresh script re-pins.

- [x] **E00-S02-T01 — Vendor the official YAML JSON schema**
  **Do:** script `scripts/refresh-schema.ts` downloading the pipeline schema from `microsoft/azure-pipelines-vscode` into `packages/engine/vendor/schema/` with `PROVENANCE.json`.
  **Ground:** github.com/microsoft/azure-pipelines-vscode — confirm the schema file's current path; learn.microsoft.com/azure/devops/pipelines/yaml-schema/ as the human-readable counterpart.
  **Done:** vendored schema + provenance committed; refresh script idempotent.
- [x] **E00-S02-T02 — Seed and maintain `research/REFERENCES.md`**
  **Do:** verify every URL in the seeded file resolves; replace `VERIFY` markers with pinned links; add missing per-keyword yaml-schema index.
  **Ground:** the seeded `research/REFERENCES.md` itself lists candidates; each confirmed live.
  **Done:** zero unverified entries; file states last-checked date per link.
- [x] **E00-S02-T03 — task.json snapshot tooling**
  **Do:** script pulling `task.json` files for a configured task list from `microsoft/azure-pipelines-tasks` at a pinned release into `packages/emit/vendor/tasks-meta/<Name>@<major>/task.json` (+ PROVENANCE). Consumed by E07 (real-task mode).
  **Ground:** github.com/microsoft/azure-pipelines-tasks — confirm `Tasks/<Name>V<n>/task.json` layout; pin the release tag.
  **Done:** snapshots for `CmdLineV2`, `BashV3`, `PowerShellV2`, `CopyFilesV2` committed with provenance.

## E00-S03 — As the project owner, the parity oracle against the real service exists from day one, so engine decisions are verified, not guessed.
Acceptance: a scripted call returns the service's final YAML for an arbitrary YAML payload.

- [x] **E00-S03-T01 — Test-org runbook**
  **Do:** `research/oracle-setup.md` documenting the throwaway org, dummy pipeline, PAT, local `.env.oracle` wiring, and end-to-end verification.
  **Ground:** learn.microsoft.com PAT + create-organization + create-first-pipeline pages (pinned).
  **Done:** runbook followed end-to-end; `finalYaml` returned live (C-E00-017/018).
- [x] **E00-S03-T02 — Oracle spike: fetch `finalYaml`**
  **Do:** minimal client (`packages/fetch/src/oracle.ts`) POSTing `{previewRun: true, yamlOverride}` to the preview endpoint; save redacted request/response samples under `research/experiments/oracle-spike/`.
  **Ground:** the preview REST page; the saved live response **is** the grounding artifact.
  **Done:** committed sample pair; documented failure modes (bad YAML shape, 302 bad PAT, 500 wrong id).

## E00-S04 — As the owner of `convert`, expansion is a first-class service call with provenance and cache, not a test-only helper.
Acceptance: `convert` obtains `finalYaml` from the service; the request/response and its hash are cached so `--frozen` re-converts offline.

- [x] **E00-S04-T01 — Expansion service API** *(done 2026-08-22: `packages/fetch/src/expand.ts` — `expand()` wraps `preview()` and returns a discriminated `ExpansionOutcome` (`expanded` → `{finalYaml, provenance}`), `provenanceFor()` and `expansionRequestHash()` (sha256, content-addressed). Re-exported from `packages/fetch/src/index.ts` so `convert` can import it. Grounding reused the live C-E00-017/018/023..025 claims — no new service behavior, so no new oracle calls. Tests: `packages/fetch/test/expand.test.ts` (8 tests) + existing oracle tests = 26 green; fetch typecheck clean. Redacted example pair: `research/experiments/E00-expansion/expand-example.md`.)*
  **Do:** add `packages/fetch/src/expand.ts` exposing `expand({ yamlOverride, templateParameters? }) → { finalYaml, provenance }`, wrapping the existing `preview()` client; provenance records api-version, pipelineId, request hash and redaction.
  **Ground:** C-E00-017/018 (route, body, `finalYaml`); docs/07 §4.
  **Done:** unit tests with injected fetch; a committed redacted expansion pair under `research/experiments/`; `expand()` wired so `convert` can call it.
- [ ] **E00-S04-T02 — Expansion cache & lockfile entry**
  **Do:** store the (redacted) preview response plus a content hash under `.cache/`; write an `azdo-emu.lock.json` entry pinning the request/response hash; `--frozen` resolves expansion from cache and errors only if absent.
  **Ground:** docs/05 §4 (cache/lockfile policy); PLAN D5.
  **Done:** offline re-convert after first fetch is byte-identical; cache miss under `--frozen` produces a clear error.
