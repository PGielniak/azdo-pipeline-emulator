# oracle probe — implicit-index-name

A bare `index` inside a loop tests whether the service creates an implicit index named value.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
