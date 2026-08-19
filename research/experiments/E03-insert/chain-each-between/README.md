# oracle probe — chain-each-between

The other half of the same open question: an `${{ each }}` between a false `${{ if }}` and its `${{ else }}`, in mapping position.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
