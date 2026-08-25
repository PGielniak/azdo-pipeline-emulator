# oracle probe — bad-type

A property whose value is the wrong type: `condition:` given a mapping where the schema says string. The question is whether the service type-checks the expanded document at all, or only its shape.

- Base document: `fixtures/oracle/10-monorepo-triggers-pools.final.yml` (a committed corpus expansion, so the service accepts it unmutated)
- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Our diagnostic family: `SCHEMA_TYPE`
- Verdict: **rejected** — the service agrees
- Outcome was **not** predicted by this script: every probe is asking, not asserting.
