# oracle probe — template-scoped

THE ONE WITH CONSEQUENCES. The root has no `parameters:`; it includes a committed template that declares `greeting` and echoes it. Can `templateParameters` bind a **template's** parameter, or only the root pipeline's? If it can, E03-S06-T05 has an option (c); if it cannot, that option is closed by measurement.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"greeting":"from-request"}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Not predicted by this script: every probe here is asking, not asserting.
