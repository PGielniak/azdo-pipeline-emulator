# oracle probe — runtime-not-in-values

A queue-time value outside the declared `values:` list.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Queue-time `templateParameters`: `{"p":"gamma"}`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
