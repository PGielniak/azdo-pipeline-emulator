# oracle probe — type-tmpl-pool

`pool` in a template — root-only per the vendored schema, so this is the position split's second test.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
