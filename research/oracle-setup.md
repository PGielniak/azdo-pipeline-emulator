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
4. Free tier is sufficient: preview runs nothing (see above), so the missing free-parallelism
   grant for new orgs does not matter.

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

   `trigger: none` / `pr: none` so pushes never queue a real run (a queued run in a
   parallelism-less org just sits and errors — harmless but noisy).
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
- **Revocation**: User settings → Personal access tokens → select → **Revoke** (immediate).
  Revoke instantly if a transcript with an unredacted token was ever staged/pushed — note the
  PAT doc says tokens leaked to public GitHub repos are auto-revoked, but do not rely on it.
- **Entra-backed orgs**: a PAT goes inactive if you don't sign in for 90 days — irrelevant for
  a personal-MSA org, noted in case the test org is ever Entra-backed.
- **Secret hygiene in transcripts** (CLAUDE.md rule 4): before committing anything under
  `research/experiments/`, replace the org name with `{org}` and check no PAT slipped in.
  PATs are mechanically detectable: 84 chars with a fixed `AZDO` signature at positions 76–80
  (C-E00-021) — `grep -rE '[A-Za-z0-9]{75}AZDO[A-Za-z0-9]{4}'` over staged files.
- **End of project**: revoke the PAT, then delete the org (Organization settings → Overview →
  Delete). Nothing else lives there.

## Completion record (fill when followed end-to-end)

| Item | Value / date |
|---|---|
| Org created (name **redacted**; note only that it exists) | 2026-07-31 — existing personal org reused (see deviation below), not a throwaway |
| Project + pipeline created, `definitionId` noted | 2026-07-31 — project `oracle` (private, Basic process) + pipeline `oracle-anchor` `definitionId=19`; anchor `azure-pipelines.yml` pushed to `refs/heads/main` |
| PAT created (scope, expiry date) | 2026-07-31 — user-supplied, 84 chars (matches C-E00-021 format); scope broader than Build (read) — org-wide project list succeeded. **Rotation pending**, see below |
| Step-5 preview curl returned 200 + `finalYaml` | 2026-07-31 — HTTP 200; `steps:`-only probe expanded to `stages: __default` → `job: Job` → `task: CmdLine@2`, confirming C-E00-017/018 (route, api-version, body) and the `finalYaml` field name live |
| `.env.oracle` written locally (gitignore verified) | 2026-07-31 — `git check-ignore -v` → `.gitignore:7:.env.*`, confirmed before the token was written |
| GitHub repo secrets stored | _deferred_ — see rotation note; only needed by E12-S03 (workflow no-ops until `ORACLE_ENABLED`) |

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
3. **PAT rotation outstanding.** The current token was transmitted in cleartext through a chat
   transcript and must be treated as compromised: revoke it, issue a replacement scoped
   **Build (read) on this org only**, write it straight into `.env.oracle` (never into a
   transcript), re-run the Step-5 curl, and only then store the four GitHub repo secrets.
   Until that is done, item 6 above stays `_deferred_` and CI has no oracle credentials.
