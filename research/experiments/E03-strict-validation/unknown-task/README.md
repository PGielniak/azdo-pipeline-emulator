# oracle probe — unknown-task

A `task:` reference to a task that does not exist. Our validator carries a vendored task catalogue; this asks whether the service resolves task references during preview at all.

- Base document: `fixtures/oracle/10-monorepo-triggers-pools.final.yml` (a committed corpus expansion, so the service accepts it unmutated)
- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Our diagnostic family: `SCHEMA_UNKNOWN_TASK`
- Verdict: **rejected** — the service agrees
- Outcome was **not** predicted by this script: every probe is asking, not asserting.
