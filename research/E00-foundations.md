# E00 — Foundations: grounding notes

Claim format per BACKLOG.md §3. IDs sequential, never reused.

## E00-S01-T01 — Monorepo scaffold (D1 / Node LTS verification)

Design rationale consumed: PLAN.md §5 D1 — converter is TypeScript/Node ≥ 22 (task-ecosystem synergy,
`yaml` CST, MSAL, npm distribution). D1 is an internal decision; the external fact to verify is that
"Node ≥ 22" is a *supported LTS* floor.

[C-E00-001] Node.js 22 ("Jod") is a supported LTS line as of 2026-07-30: LTS start 2024-10-29,
Maintenance LTS since 2025-10-21, end-of-life 2027-04-30 — so PLAN.md D1's "Node ≥ 22" floor is a
supported-LTS floor (not EOL) until 2027-04-30.
  — https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json (checked 2026-07-30)
  — `"v22": {"start": "2024-04-24", "lts": "2024-10-29", "maintenance": "2025-10-21", "end": "2027-04-30", "codename": "Jod"}`
  — corroborated by https://nodejs.org/en/about/previous-releases (v22 and v24 listed LTS, v26 Current; checked 2026-07-30)

[C-E00-002] Node.js 24 ("Krypton") is the current Active LTS (Maintenance from 2026-10-20, EOL
2028-04-30) and Node 20 is EOL since 2026-04-30 — CI (E00-S01-T02) should therefore test on Node 22
and 24, and the engines floor must not be raised above 22 without a decision-record entry.
  — https://github.com/nodejs/Release/blob/e4bf922d83b877a116763e2f83d2d9b6701871f9/schedule.json (checked 2026-07-30)
  — `"v24": {"start": "2025-05-06", "lts": "2025-10-28", "maintenance": "2026-10-20", "end": "2028-04-30", "codename": "Krypton"}` · `"v20": {…, "end": "2026-04-30"}`

## E00-S01-T02 — CI workflow (bats invocation, action pins)

[C-E00-003] bats is invoked with paths to `.bats` files or directories containing them; directories
are not recursed unless `-r` is given — so `bats test` runs all `.bats` files directly under
`packages/runtime/test/`.
  — https://bats-core.readthedocs.io/en/stable/usage.html (checked 2026-07-30)
  — "To run your tests, invoke the `bats` interpreter with one or more paths to test files ending
    with the `.bats` extension, or paths to directories containing test files." · "it will not
    recurse unless you specify the `-r` flag"

[C-E00-004] bats writes machine-readable test reports via `--report-formatter junit` (same options
as `--formatter`: pretty, tap, tap13, junit) into the directory given by `-o/--output` — CI uses
this for the uploaded test-report artifact.
  — https://bats-core.readthedocs.io/en/stable/usage.html (checked 2026-07-30)
  — "`--report-formatter` … accepts the same options as `--formatter`." · "it may be placed
    elsewhere by specifying the `--output` flag"

[C-E00-005] bats itself supports Bash 3.2+ — so the bats harness runs on macOS runners' system
bash; this does *not* relax our runtime-library floor of bash ≥ 4 (emitted scripts + lib target
bash ≥ 4 per PLAN D2; E06 tests must ensure a bash ≥ 4 interpreter on macOS CI).
  — https://github.com/bats-core/bats-core/blob/ae4b94d7cc35f62468297791aa4ab8c3af7377ba/README.md (checked 2026-07-30)
  — "Bats is a TAP-compliant testing framework for Bash 3.2 or above."

## E00-S01-T03 — Grounding Protocol enforcement artifacts

Ground: **N/A by explicit task definition** — the source is BACKLOG.md §3 itself (meta-task; the
only allowed N/A in the backlog). No external claims; artifacts: PR template checklist,
`research/README.md` (claim format), `scripts/check-verify-markers.sh` (+ `.githooks/pre-commit`,
CI step) flagging `VERIFY:` markers left in code paths (`packages/`, `scripts/`, `fixtures/`).
`VERIFY` remains legitimate in `research/`, `docs/`, `backlog/` (it marks pending source pins by
design).

## E00-S02-T01 — Vendor the official YAML JSON schema

[C-E00-006] The machine-readable Azure Pipelines YAML schema lives at the repo root of
microsoft/azure-pipelines-vscode as `service-schema.json` (1,640,523 bytes at the pin; sha256
`f00a9630f6550204148634d9a13f634b5750a225559886effe09a751482f0459`).
  — https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cfdcb1449a588e08286d0bbbb5f62d2d83/service-schema.json (checked 2026-07-30)
  — repo tree at the pinned commit lists `service-schema.json` at the root (only other `*schema*.json` files are test fixtures under `src/test/`).

[C-E00-007] The schema declares JSON Schema **draft-07** with top-level `oneOf` + `definitions`.
  — same pinned file (checked 2026-07-30)
  — `"$schema": "http://json-schema.org/draft-07/schema#"`

[C-E00-008] The schema uses five non-standard (VS Code-extension) keywords the validator must
tolerate — and E01 must honor semantically where they change acceptance: `ignoreCase` (3770×),
`aliases` (552×), `doNotSuggest` (541×), `firstProperty` (294×), `deprecationMessage` (157×).
Counts from a keyword scan of the pinned file (schema-node positions only).
  — same pinned file (checked 2026-07-30)

[C-E00-009] The human-readable counterpart is the YAML schema reference landing page with
per-keyword subpages (pipeline, stages, jobs, steps.*, resources.*, …); canonical URL confirmed.
  — https://learn.microsoft.com/en-us/azure/devops/pipelines/yaml-schema/?view=azure-pipelines (checked 2026-07-30)
  — "The YAML schema reference for Azure Pipelines is a detailed reference for YAML pipelines that
    lists all supported YAML syntax and their available options."

[C-E00-010] The schema's `pattern` regexes use escapes that are **invalid under JavaScript
unicode regex mode** (e.g. `^[^\/~\^\: \[\]\\]+(\/[^\/~\^\: \[\]\\]+)*$` — `\:` is an invalid
escape with `/u`), so ajv must be configured with `unicodeRegExp: false` (ajv compiles patterns
with the `u` flag by default). Discovered by compiling the pinned schema; encoded in the
schema-vendor test.
  — https://github.com/microsoft/azure-pipelines-vscode/blob/2f4500cfdcb1449a588e08286d0bbbb5f62d2d83/service-schema.json (checked 2026-07-30)
  — ajv error: `SyntaxError: Invalid regular expression: /^[^\/~\^\: \[\]\\]+(\/[^\/~\^\: \[\]\\]+)*$/u: Invalid escape`

## E00-S02-T02 — REFERENCES.md verification pass (2026-07-30)

Method: curl status+title for all 34 doc URLs (33× HTTP 200; 1× 404 → relocated, below); 73
yaml-schema per-keyword subpage URLs all 200; GitHub rows pinned to same-day HEAD commits with
named paths confirmed via the contents/trees API. Results live in REFERENCES.md per-row.

[C-E00-011] Azure DevOps' Entra resource identifier is `499b84ac-1321-427f-aa17-267ca6975798`
(resource URI `https://app.vssps.visualstudio.com`; request tokens with the `.default` scope);
the old `…/integrate/get-started/authentication/` landing 404s — auth docs now live at
`authentication-guidance` and sibling pages, and ADO's own OAuth is deprecated in favor of Entra.
  — https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/entra-oauth?view=azure-devops (checked 2026-07-30)
  — "Azure DevOps' resource identifier: `499b84ac-1321-427f-aa17-267ca6975798`" · "Azure DevOps'
    resource URI: `https://app.vssps.visualstudio.com`" · "Use the `.default` scope when
    requesting a token with all scopes that the app is permissioned for."

[C-E00-012] The azure-pipelines-agent repo contains **no expressions or object-templating engine
sources**: the worker evaluates runtime conditions in `src/Agent.Worker/ExpressionManager.cs`
against the closed-distribution `Microsoft.TeamFoundation.DistributedTask.Expressions` NuGet
(repo tree at the pin has zero `Expressions/`/`ObjectTemplating` folders; `src/Sdk` does not
exist — `src/Agent.Sdk` is the agent client SDK holding `SecretMasking/`).
  — https://github.com/microsoft/azure-pipelines-agent/blob/c59f46aa13885f4ab59563248dfbdb3de899a068/src/Agent.Worker/ExpressionManager.cs (checked 2026-07-30)
  — "using Microsoft.TeamFoundation.DistributedTask.Expressions;" (file exposes
    `Parse(context, condition)` / `Evaluate(...)` for step/job conditions)

[C-E00-013] The open-source behavioral reference for the DistributedTask expressions and
object-templating engine is the **actions/runner** fork: `src/Sdk/DTExpressions2/`,
`src/Sdk/DTObjectTemplating/`, `src/Sdk/DTPipelines/` (forked from Azure DevOps when Actions
split; divergence from today's ADO service is possible, so the oracle (PLAN D6) outranks it per
the source hierarchy).
  — https://github.com/actions/runner/tree/34ef7f24f8875a3da11ae40ffd9668f0b4ca8440/src/Sdk (checked 2026-07-30)
  — directory listing: "DTExpressions2, DTGenerated, DTLogging, DTObjectTemplating, DTPipelines, …"

## E00-S02-T03 — task.json snapshot tooling (2026-07-30)

[C-E00-014] In-box pipeline tasks live at `Tasks/<Name>V<major>/task.json` in
microsoft/azure-pipelines-tasks, where the directory's `V<n>` suffix equals `version.Major`
inside task.json and `name` is the YAML-referenceable task name — confirmed at tag v277 for
all four E00 targets: CmdLineV2 (name=CmdLine, 2.276.0), BashV3 (name=Bash, 3.274.1),
PowerShellV2 (name=PowerShell, 2.276.1), CopyFilesV2 (name=CopyFiles, 2.276.0).
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/Tasks/CmdLineV2/task.json (checked 2026-07-30; raw fetches 200 for all four paths)
  — `"name": "CmdLine"` · `"version": { "Major": 2, "Minor": 276, "Patch": 0 }`

[C-E00-015] The tasks repo ships sprint-cadence release tags `v<sprint>`; the latest
non-prerelease at check time is **v277** (published 2026-07-20), and the tag resolves to
commit `8ba25cfb5c7736ba98a37488c0323f7320cb5b3e` — this is the snapshot pin for
`packages/emit/vendor/tasks-meta/`.
  — https://github.com/microsoft/azure-pipelines-tasks/releases/tag/v277 (checked 2026-07-30 via api.github.com `/releases` + `/git/ref/tags/v277`)
  — releases list: "v277 · 2026-07-20T12:05:37Z · prerelease: False"

[C-E00-016] Task versions are bumped per Azure DevOps sprint: `Minor` is set to the current
sprint number (patch reset to 0), `Patch` increments within a sprint, and `Major` changes only
for "large behavioral changes or changes without backward support" — so tasks inside one
release tag carry different minor versions (a task's version moves only when the task changes;
e.g. BashV3 is at 3.274.1 inside v277).
  — https://github.com/microsoft/azure-pipelines-tasks/blob/8ba25cfb5c7736ba98a37488c0323f7320cb5b3e/docs/taskversionbumping.md (checked 2026-07-30)
  — "If sprint number differs from current minor number - set it to current sprint number, set
    patch to 0." · "For major changes (large behavioral changes or changes without backward
    support) increase major number."

Observed `execution` handlers at v277 (for E09 later, not encoded now): CmdLineV2/PowerShellV2
list `PowerShell3` + Node10/16/20_1/24; BashV3/CopyFilesV2 are Node-only (Node10/16/20_1/24).

### GitHub Actions pins (latest releases checked 2026-07-30 via api.github.com)

`actions/checkout` v7.0.1 · `actions/setup-node` v7.0.0 · `actions/upload-artifact` v7.0.1 ·
`pnpm/action-setup` v6.0.9 (reads the pnpm version from root `packageManager`). Workflows pin the
major (`@v7`/`@v6`). bats-core latest release v1.14.0 (repo pinned at `ae4b94d`, 2026-07-26); npm
`bats` devDependency tracks it via `^1.13.0`.

### Toolchain versions pinned at scaffold time (2026-07-30)

- Local Node: v22.23.1 (maintenance-LTS line — satisfies engines `>=22`).
- pnpm: 11.18.0 (activated via corepack; recorded in root `package.json` `packageManager`).
- TypeScript pinned to the 5.x line (5.9.3 at scaffold): latest-resolved TS 7.0.2 (native compiler)
  breaks tsup dts emission (rollup-plugin-dts crash) and typescript-eslint 8.65 peer range is
  `>=4.8.4 <6.1.0`. Not a D1 change (D1 fixes the language, not the compiler major); revisit when
  tsup/typescript-eslint declare TS 7 support.
- bats 1.13.0 via the npm `bats` package (bats-core's official npm distribution) as a
  `packages/runtime` devDependency; formal bats-core doc grounding happens in E00-S01-T02.
- shellcheck v0.11.0 binary via the npm `shellcheck@4.1.0` wrapper (runtime devDependency;
  `allowBuilds` in pnpm-workspace.yaml lets its postinstall fetch the binary at install time) so
  `pnpm lint` works on machines without a system shellcheck.
