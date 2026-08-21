# oracle probe — default-missing-values

No default, but `values: [alpha, beta]` — the exact case runtime-parameters describes as "the first available value is used".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
