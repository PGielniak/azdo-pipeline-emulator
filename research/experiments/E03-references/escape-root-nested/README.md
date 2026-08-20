# oracle probe — escape-root-nested

The same escape from two levels down, where the traversal is only illegal after the third `../` — proves whether the check is on the final path or on each step.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
