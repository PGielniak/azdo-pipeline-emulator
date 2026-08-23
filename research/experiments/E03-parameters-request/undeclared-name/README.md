# oracle probe — undeclared-name

The request names a parameter the pipeline does not declare. Rejected, or silently ignored? Decides whether we validate names before sending or let the service answer.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"greeting":"ok","nosuchparameter":"x"}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Not predicted by this script: every probe here is asking, not asserting.
