# oracle probe — unknown-key

A property that is in no schema form, injected at stage level. If the service accepts it, our unknown-key rejection is stricter than the authority and must be downgraded.

- Base document: `fixtures/oracle/10-monorepo-triggers-pools.final.yml` (a committed corpus expansion, so the service accepts it unmutated)
- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Our diagnostic family: `SCHEMA_UNKNOWN_KEY`
- Verdict: **rejected** — the service agrees
- Outcome was **not** predicted by this script: every probe is asking, not asserting.
