# oracle probe — chain-insert-between-true

The control for `chain-insert-between`: the same shape with the `if` winning, so the output also fixes the relative order of the branch body and the inserted keys.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
