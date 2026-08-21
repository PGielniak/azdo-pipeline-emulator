# oracle probe — default-wrong-type

A non-numeric default on a `number` parameter — the type check on the *declaration* rather than on a passed value.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
