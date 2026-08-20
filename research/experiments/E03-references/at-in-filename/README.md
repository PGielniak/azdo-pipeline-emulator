# oracle probe — at-in-filename

A path whose *filename* contains `@` but names no repository. If the split is on the last `@`, this is an unknown alias; if paths may contain `@`, it is a missing file.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
