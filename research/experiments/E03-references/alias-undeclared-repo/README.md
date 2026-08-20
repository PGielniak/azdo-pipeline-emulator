# oracle probe — alias-undeclared-repo

An alias declared in `resources:` naming a repository that does not exist.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
