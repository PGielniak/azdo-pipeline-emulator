# oracle probe — default-missing-string

A `string` parameter with no default, not passed. yaml-schema prose says parameters "must include a default value"; its own `default` row says the value must then be given at runtime; runtime-parameters says "the first available value is used" (C-E03-303).

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
