# oracle probe — pass-nonnumeric-to-number

Pass `abc` to a `number` parameter: the rejection sentence for a failed coercion.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
