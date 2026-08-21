# oracle probe — pass-step-invalid-shape

A mapping with no known step keyword passed to `step` — is the *schema* of a step checked at binding time, or only when the value lands in `steps:`?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
