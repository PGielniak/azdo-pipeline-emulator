# oracle probe — mixed-array

The array half of `mixed-object`. `join` documents "complex objects are converted to empty string" for its elements, which may or may not be the same rule.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
