# oracle probe — missing-file

A well-formed path to a file that does not exist — captures the wording and whether the message names branch and commit.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
