# oracle probe — default-expression-mixed

A literal expression embedded in surrounding text — mixed content is a `format()` call (C-E02-109), so if the rule really is "literals only" this must reject.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
