# oracle probe — self-cycle

A template that includes itself. Cycle detection, or the 100-level nesting limit?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
