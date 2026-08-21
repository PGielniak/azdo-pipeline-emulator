# oracle probe — values-case

Is the `values:` membership test case-sensitive? Declared `alpha`, passed `ALPHA`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
