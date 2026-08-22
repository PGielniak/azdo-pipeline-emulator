# oracle probe — runtime-undeclared

A queue-time value for a parameter the pipeline never declared.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Queue-time `templateParameters`: `{"nosuch":"value"}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
