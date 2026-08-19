# oracle probe — key-boolean-nonloose

The Boolean key question again in a mapping with a **known schema**, where an unexpected key is a hard error — so the rendered spelling is visible in the rejection even if `env:` were to accept anything.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
