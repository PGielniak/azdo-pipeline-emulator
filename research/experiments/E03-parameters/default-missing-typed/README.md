# oracle probe — default-missing-typed

No default on `number`, `boolean`, `object`, `stepList` at the **root**: does an unpassed parameter of each type get a typed empty value, or nothing?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
