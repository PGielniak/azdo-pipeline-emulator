---
name: oracle-experiment
description: Run a parity experiment against the real Azure DevOps service via the Pipelines preview REST endpoint — submit a probe YAML, capture the service's final expanded YAML (or error), and store a redacted transcript under research/experiments/. Use when a backlog task requires oracle verification, when template/expression behavior is ambiguous, or to create corpus fixture pairs.
---

# Oracle experiment (service = ground truth)

Captures how Azure DevOps *actually* expands YAML, without running anything. Used for compile-time behavior: templates, expressions, parameters, validation errors.

## Prerequisites

Env vars (from the E00-S03-T01 runbook): `AZDO_ORG_URL` (e.g. `https://dev.azure.com/myorg`), `AZDO_PROJECT`, `AZDO_ORACLE_PIPELINE_ID` (the dummy definition), `AZDO_PAT`.
Missing → report exactly what's missing, point the user at `research/oracle-setup.md` (or E00-S03-T01 if not yet written), mark the calling task `[!]`, stop. **Never invent a fake "observed" result.**

## Procedure

1. **Design the probe:** the smallest YAML isolating exactly one behavior (one directive, one coercion, one visibility question). Multi-file probes: push the template files to the test org repo first (they must be reachable by the service), or inline via a single file when possible.
2. **Call the preview endpoint** (route per the pinned REST page; verify api-version on first use and record it):

```bash
curl -sS -u ":$AZDO_PAT" -H "Content-Type: application/json" \
  -X POST "$AZDO_ORG_URL/$AZDO_PROJECT/_apis/pipelines/$AZDO_ORACLE_PIPELINE_ID/preview?api-version=7.1" \
  -d "$(jq -n --rawfile y probe.yml '{previewRun: true, yamlOverride: $y, templateParameters: {}}')"
```

3. **Capture:** save `probe.yml`, the raw response, and the extracted `finalYaml` (or the error body — errors are equally valuable evidence) under `research/experiments/<area>/<short-name>/`. Redact org/project names and any identifiers; never store the PAT.
4. **Interpret:** write the observed behavior as claim entries (grounding skill §2) citing the transcript path. If the result contradicts our engine/design docs, say so loudly in your report.
5. **Fixture promotion:** if the probe exercises expansion behavior our engine must match, add the pair to `fixtures/corpus/` + `fixtures/oracle/` so it becomes a permanent regression test (E12 harness).

## Notes

- One behavior per probe. Batches of probes are fine, but each gets its own directory and claims.
- The service evolves: transcripts carry the date; nightly preview-diff (E12-S03) is what catches drift later — experiments don't need re-running manually.
- Rate-limit courtesy: sequential calls, no parallel hammering of the org.
