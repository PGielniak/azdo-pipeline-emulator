# oracle probe — chain-insert-between

E03-S01-T02 left this unmeasured and handed it here: an `${{ insert }}` written **between** a false `${{ if }}` and its `${{ else }}`. If the `else` body appears the insert is an ordinary sibling under C-E03-128; if the document is rejected, a directive sibling breaks the chain where an ordinary key does not.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
