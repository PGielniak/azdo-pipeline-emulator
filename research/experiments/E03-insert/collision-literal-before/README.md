# oracle probe — collision-literal-before

THE flagged question, first half: a literal key, then an insert supplying the same key. Error, first-wins, or last-wins?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
