# oracle probe — collision-case

A collision that differs only in case (`FOO` literal vs `foo` inserted). Mapping keys are compared case-insensitively in the fork; Azure YAML keys are not obviously so.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
