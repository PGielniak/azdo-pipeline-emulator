# oracle probe — type-root-case

Type names are matched how? `String` vs `string` — the expression language folds case everywhere but directive keywords (C-E03-100), and the schema patterns are anchored lower case.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
