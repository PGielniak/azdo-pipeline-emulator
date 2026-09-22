# Oracle test-org runbook (E00-S03-T01)

Sets up the **parity oracle**: a throwaway Azure DevOps organization whose Pipelines *preview*
endpoint returns the service's final expanded YAML for any payload we send. Every engine
decision (E02/E03) is verified against it instead of guessed (PLAN D6, docs/02 §8).

The endpoint (grounded C-E00-017/018, `research/E00-foundations.md`):

```
POST https://dev.azure.com/{organization}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1
body:     { "previewRun": true, "yamlOverride": "<yaml string>" }
response: { "finalYaml": "<expanded yaml>" }   (200)
```

`pipelineId` is a **required path parameter** — that is the only reason the dummy pipeline
below exists. With `previewRun: true` the service does **not** create a run ("If true, don't
actually create a new run"), so the org never needs agents, parallelism grants, or minutes.

## What you end up with

| Artifact | Value used by tooling |
|---|---|
| Test organization | `AZDO_ORG_URL` = `https://dev.azure.com/<org>` |
| Project inside it | `AZDO_PROJECT` |
| Dummy pipeline definition | `AZDO_ORACLE_PIPELINE_ID` (integer) |
| PAT, scope Build (read) | `AZDO_PAT` |

Local wiring goes in `.env.oracle` (gitignored); CI wiring goes in GitHub repo secrets.

## Step 1 — Create the test organization (~5 min, browser)

1. Sign in with the Microsoft account you'll dedicate to this (a personal MSA is fine).
2. Follow the official how-to: <https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/create-organization?view=azure-devops> (verified 2026-07-30).
3. Name it something obviously disposable and non-identifying, e.g. `azdo-emu-oracle-<4 random chars>`.
   The org name appears in URLs inside experiment transcripts — we redact it before committing,
   but a meaningless name lowers the blast radius.
4. Free tier is sufficient for **preview**, which runs nothing (see above). *(Corrected
   2026-09-21, E11-S05-T01: this line used to say the missing free-parallelism grant "does not
   matter", full stop. **This org has hosted parallelism** — runs 539/540/544/553 all executed on
   the `Azure Pipelines` hosted queue and succeeded — and L6 depends on it. The line was written
   2026-07-30 when preview was the only planned use and was never revisited. This is the **second**
   assumed-unavailability claim found stale in this file in two days; see C-E12-056 and decision 91
   for the first. Test, do not assume: `curl -s -u ":$AZDO_PAT" "$AZDO_ORG_URL/_apis/distributedtask/pools"`
   lists the hosted pools, and a queued hosted run either starts or reports the missing grant.)*

**Dedicated org, not your real one.** Cleanup at end-of-project is then a single org deletion,
and a leaked PAT scoped here can touch nothing real.

## Step 2 — Create the project

1. In the new org, create a **private** project named `oracle` (any name works; keep it short —
   it becomes `AZDO_PROJECT`).
2. Leave defaults (Git repos enabled — the dummy pipeline needs one).

## Step 3 — Create the dummy pipeline definition

The preview endpoint is addressed *per pipeline*, so one definition must exist. It is never run.

1. In the project's default Azure Repos repo, initialize with a README, then add
   `azure-pipelines.yml` at the repo root with exactly:

   ```yaml
   # Oracle anchor pipeline — never runs; addressed by the preview endpoint only.
   trigger: none
   pr: none
   steps:
     - script: echo oracle anchor
   ```

   `trigger: none` / `pr: none` so pushes never queue a real run. *(The parenthetical here used to
   say such a run "just sits and errors in a parallelism-less org"; this org has parallelism, so an
   accidental trigger would really run and really spend minutes — which is the better reason to
   keep `trigger: none`. Corrected 2026-09-21, E11-S05-T01.)*
2. Pipelines → New pipeline → Azure Repos Git → select the repo → "Existing Azure Pipelines
   YAML file" → pick `/azure-pipelines.yml` → **Save** (dropdown next to Run — do *not* Run).
   Official walkthrough if the UI moved: <https://learn.microsoft.com/en-us/azure/devops/pipelines/create-first-pipeline?view=azure-devops> (verified 2026-07-30).
3. Read the pipeline ID from the browser URL: `…/_build?definitionId=<N>` → `N` is
   `AZDO_ORACLE_PIPELINE_ID` (typically `1` in a fresh project).

## Step 4 — Create the PAT

Grounding: C-E00-019/020. UI path per the PAT doc (verified 2026-07-30):
<https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops>

1. In the test org: User settings (gear icon, top right) → **Personal access tokens** → **+ New Token**.
2. Name: `azdo-emu-oracle`. **Organization: the test org only** (never "All accessible organizations").
3. Expiration: **30 days** (max 90; short is fine — rotation is cheap, see below).
4. Scopes → "Custom defined" → **Build → Read** (= `vso.build`, the scope the preview op
   documents). *If* the live spike (E00-S03-T02) gets 401/403 with it, bump to Build
   (Read & execute) and record the correction against C-E00-019.
5. Create → **copy the token now** — it is shown exactly once.

## Step 5 — Local wiring + end-to-end verification

1. Create `.env.oracle` at the repo root (covered by the `.env.*` gitignore rule — verify with
   `git check-ignore .env.oracle` before writing the value):

   ```sh
   AZDO_ORG_URL=https://dev.azure.com/<org>
   AZDO_PROJECT=oracle
   AZDO_ORACLE_PIPELINE_ID=1
   AZDO_PAT=<paste>
   ```

2. Verify the whole chain with one preview call (PAT goes in as Basic auth with an **empty
   username**, C-E00-020):

   ```sh
   set -a; . ./.env.oracle; set +a
   curl -sS -u ":$AZDO_PAT" \
     -H 'Content-Type: application/json' \
     -d '{"previewRun": true, "yamlOverride": "steps:\n- script: echo probe\n"}' \
     "$AZDO_ORG_URL/$AZDO_PROJECT/_apis/pipelines/$AZDO_ORACLE_PIPELINE_ID/preview?api-version=7.1"
   ```

   **Expected:** HTTP 200 with a JSON body whose `finalYaml` string contains the expanded
   pipeline (`steps` wrapped into a job).

   Diagnosing failures — **corrected 2026-07-31 against the live service** (E00-S03-T02); the
   original guidance here predicted 401/403 and 404 and was wrong on both counts:

   | Symptom | Means |
   |---|---|
   | **302** redirect to `…/_signin?realm=dev.azure.com` (HTML) | bad or expired PAT — *not* 401/403 (C-E00-025). With `curl -L` this looks like a successful 200 full of HTML |
   | **500** + `typeKey: PipelineNotFoundException` | wrong `AZDO_ORACLE_PIPELINE_ID` — *not* 404 (C-E00-026) |
   | **404** | wrong org or project in the URL |
   | **400** + `typeKey: PipelineValidationException` | the endpoint works; your probe YAML is invalid (this is the oracle answering, not a setup fault) |
   | **200** whose `finalYaml` is the anchor's `echo oracle anchor` | your `yamlOverride` arrived empty; the service silently falls back to the committed YAML (C-E00-024) |
3. Record the run in the completion record at the bottom of this file.

## Step 6 — CI secret wiring (GitHub)

`.github/workflows/oracle-nightly.yml` (created disabled in E00-S01-T02) expects:

1. Repo secrets (Settings → Secrets and variables → Actions → **Secrets**):
   `AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, `AZDO_PAT` — all four as
   secrets; the org name stays out of public logs that way.
2. Repo **variable** `ORACLE_ENABLED`: **leave unset for now.** E12-S03 sets it to `true` when
   the preview-diff harness exists; the workflow no-ops until then.

## Cleanup & rotation

- **PAT rotation** (PAT doc, "Rotation workflow"): create the replacement ≥ 7 days before
  expiry, same name/scopes → update `.env.oracle` + the `AZDO_PAT` repo secret → verify with
  the Step-5 curl → revoke the old token. Calendar-note the expiry when you create the PAT.
  **A noted expiry is an estimate, not a fact — re-test before believing it** (C-E12-056). The
  2026-08-11 PAT was noted as lapsing ~2026-09-10 and still returned 200 on 2026-09-21; in between,
  a task recorded a measurable behaviour cell as unmeasurable on the strength of that date, and
  the cell it invented instead was wrong. One curl settles it: `curl -s -o /dev/null -w '%{http_code}'
  -u ":$AZDO_PAT" "$AZDO_ORG_URL/_apis/projects?api-version=7.1-preview.4"` — 200 live, 302 lapsed
  (a lapse is never a 401, C-E00-025).
- **Revocation**: User settings → Personal access tokens → select → **Revoke** (immediate).
  Revoke instantly if a transcript with an unredacted token was ever staged/pushed — note the
  PAT doc says tokens leaked to public GitHub repos are auto-revoked, but do not rely on it.
- **Entra-backed orgs**: a PAT goes inactive if you don't sign in for 90 days — irrelevant for
  a personal-MSA org, noted in case the test org is ever Entra-backed.
- **Secret hygiene in transcripts** (CLAUDE.md rule 4): before committing anything under
  `research/experiments/`, replace the org name with `{org}` and check no PAT slipped in.
  PATs are mechanically detectable: 84 chars with a fixed `AZDO` signature at positions 76–80
  (C-E00-021) — `grep -rE '[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{4}'` over staged files.
  **A grep for the org name is not sufficient, and this is not theoretical** (C-E09-094,
  2026-09-22): a pipeline-artifact signed URL carries a **base64** path segment that decodes to
  `pipelineartifact://<org>/projectId/…`, so the org name can sit in a transcript while both
  `redact()` and that grep report clean — `redact()` matches the org as a literal string. **Decode
  before you trust the scan:**

  ```bash
  pnpm check-secrets                              # tracked files; what CI runs
  bash scripts/check-encoded-secrets.sh --staged  # what the pre-commit hook runs
  bash scripts/check-encoded-secrets.sh --file <path>   # an untracked capture, before it lands
  bash scripts/check-encoded-secrets.sh --self-test
  ```

  This is a **gate**, not a procedure to remember — `.githooks/pre-commit` runs the `--staged`
  form (activate it once per clone with `git config core.hooksPath .githooks`) and `ci.yml` runs
  `--all`. It decodes base64 runs and looks for Azure DevOps identifiers in the decoded bytes, so
  it works in CI with no credential; with `AZDO_ORG_URL` set it also checks the org slug, raw and
  encoded. Run `--self-test` when you doubt it: it fails if the detector has stopped firing, which
  otherwise looks exactly like a clean tree. It deliberately prints the file and the *class* of
  finding, never the matched text.

  Anything that embeds an identifier in an opaque token — signed URLs, continuation cursors — can
  do this; the rule is to decode what you cannot read, not to trust that it is opaque to readers too.
- **What now lives in the oracle project** (E12-S01-T02 — keep this list current, it *is* the
  cleanup checklist now that the project is not empty):
  - `azure-pipelines.yml` — the anchor (E00-S03-T01).
  - `/corpus/_probe/` — three template files backing the C-E12-011/012 resolution probe.
  - `/corpus/<entry>/` — the corpus v1 fixtures, mirrored from `fixtures/corpus/` by
    `node scripts/corpus-oracle.ts`; the service reads templates from the repo, so they must be
    there for the corpus to have oracle pairs at all.
  - Environments `corpus-staging`, `corpus-production` (no resources) and variable group
    `azdo-emu-corpus-group` (two non-secret dummy values), all authorized for the anchor pipeline
    by `node scripts/oracle-provision.ts`. They exist because an unknown `environment:`/`- group:`
    fails the YAML at load time (C-E12-015/017).
  - Owner decision recorded 2026-08-11: corpus files go to **`main`** under `corpus/` rather than
    to a dedicated ref. `trigger: none` on the anchor means the pushes queue nothing.
  - `/experiments/status-skipped.yml` and the pipeline **`oracle-status-probe`** (E02-S03-T03),
    pushed and created by `node scripts/expr-status-realrun.ts`. **This is the first thing in the
    repo that produces real runs** — the status functions are runtime-only and the job-level engine
    is closed, so no preview could answer what `succeeded()` does over a skipped dependency. Owner
    authorized it 2026-08-12. The probe is built to cost **no hosted-agent parallelism**: every job
    is agentless (`pool: server`, one `Delay@1` of 0 minutes), so a run completes in ~15 s on the
    orchestrator, and the datum is each job's own timeline result rather than anything it prints.
    Runs 520–527 are the recorded evidence. Two of its jobs end non-green **by design** (`dep_fail`
    fails, `dep_abandon` is abandoned — they are the Failed and Abandoned dependencies under test),
    so the pipeline's run history is expected to show failed runs; that is not a broken probe.
  - `/e2e/01-shell-artifacts.yml` + pipeline **`oracle-l6-shell-artifacts`** (E11-S05-T01), pushed
    and created by `node scripts/realrun.ts`. **This is the only probe here that consumes hosted-agent
    parallelism** — the fixture declares `vmImage: ubuntu-latest` because artifacts and step logs
    are the point, so it cannot be agentless like the others. Its CI job is `workflow_dispatch`-only
    for that reason. The file is pushed by reading `fixtures/e2e/01-shell-artifacts/azure-pipelines.yml`
    at run time, never a copy, so the L5 and L6 tiers cannot drift. Run 553 is the recorded evidence,
    and `research/experiments/E11-realrun/capture.json` holds it in full so the comparison can be
    redone (`--from-capture`) or the run re-read (`--reuse-run <id>`) without spending more minutes.
  - `/experiments/abandoned-aggregate.yml` + pipeline **`oracle-abandon-probe`** and
    `/experiments/abandoned-stage-only.yml` + pipeline **`oracle-abandon-stage-probe`**
    (E11-S04-T07), pushed and created by `node scripts/abandoned-aggregate-realrun.ts`
    (`--probe stage-only` for the second). Agentless like the status probe, so no hosted-agent
    parallelism. **There are two because the first could not answer its own question**: it returned
    `failed` at run scope while also containing stages that were themselves failed, so the result
    was not attributable to the abandoned node; the second removes every failed stage. Runs 550–552
    are the recorded evidence. **Every run of both is expected to end `failed`** — an abandoned
    stage is the thing under test — so a red run history here is the probe working, not breaking.
  - `/experiments/readonly-variable.yml` and the pipeline **`oracle-readonly-variable-probe`**
    (E06-S01-T01), pushed and created by `node scripts/readonly-variable-realrun.ts`. It has one
    hosted Ubuntu job because only an agent executes `task.setvariable`; run 539 records strict
    readonly enforcement (overwrite error; original value survives). Re-running the script queues
    another hosted job.
- **End of project**: revoke the PAT, then delete the org (Organization settings → Overview →
  Delete). If only the *project* is being cleaned up (the org is the owner's personal one — see
  deviation 1), deleting the `oracle` project removes the repo, both environments and the variable
  group with it.

## Completion record (fill when followed end-to-end)

| Item | Value / date |
|---|---|
| Org created (name **redacted**; note only that it exists) | 2026-07-31 — existing personal org reused (see deviation below), not a throwaway |
| Project + pipeline created, `definitionId` noted | 2026-07-31 — project `oracle` (private, Basic process) + pipeline `oracle-anchor` `definitionId=19`; anchor `azure-pipelines.yml` pushed to `refs/heads/main` |
| PAT created (scope, expiry date) | 2026-07-31 — user-supplied, 84 chars (matches C-E00-021 format); scope broader than Build (read). **Rotated 2026-08-11** (deviation 3 closed): replacement issued by the owner and written straight into `.env.oracle` — never through chat this time — old token revoked. Verified live: the full corpus (10 previews + repo tree reads) ran green against it and reproduced byte-identical goldens |
| Step-5 preview curl returned 200 + `finalYaml` | 2026-07-31 — HTTP 200; `steps:`-only probe expanded to `stages: __default` → `job: Job` → `task: CmdLine@2`, confirming C-E00-017/018 (route, api-version, body) and the `finalYaml` field name live |
| `.env.oracle` written locally (gitignore verified) | 2026-07-31 — `git check-ignore -v` → `.gitignore:7:.env.*`, confirmed before the token was written |
| GitHub repo secrets stored | 2026-08-11 — all four (`AZDO_ORG_URL`, `AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID`, `AZDO_PAT`) stored as **secrets** by the owner, so the org name stays out of public logs. Repo variable `ORACLE_ENABLED` deliberately still unset — E12-S03 sets it when the preview-diff harness exists |

### Deviations from this runbook (recorded 2026-07-31)

1. **Step 1 not followed — no throwaway org.** The oracle runs in the owner's existing personal
   organization. Consequences, accepted knowingly: the org name is identifying, so the
   redaction rule below is load-bearing rather than belt-and-braces; end-of-project cleanup is
   deleting the `oracle` **project**, not the org; and a leaked PAT here reaches 10 real
   projects, not an empty sandbox. Isolation is at the project level instead: `oracle` is a
   dedicated private project holding nothing but the anchor.
2. **PAT scope is wider than documented.** C-E00-019 says Build (read) suffices, and the preview
   call proves it works — but this token also lists every project in the org, so it is not
   minimally scoped. The narrowing happens at rotation.
3. **PAT rotation — closed 2026-08-11.** The original token had been transmitted in cleartext
   through a chat transcript and was treated as compromised. The owner issued a replacement,
   wrote it directly into `.env.oracle` (no chat round-trip), stored the four GitHub repo
   secrets, and revoked the old token; a full `pnpm corpus-oracle` run against the new token
   returned all ten expansions byte-identical, which exercises Build (read) and Code (read).
   **Code (write) is not yet exercised** by that check — nothing had changed, so no push was
   attempted; the first corpus fixture edit will prove it, and a 403 there means re-issuing with
   Code (read & write). Scope minimality (deviation 2) was not re-audited at rotation.
