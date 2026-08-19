# oracle probe — lone-boolean

A lone expression returning a **Boolean**, both from a typed parameter and as a literal. The committed `insert-job-mapping` pair already shows a job's `continueOnError: true` coming back as `True` once it passes through the engine — this pins the same question for a lone scalar, and for both truth values.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
