# oracle probe — type-root-missing-untyped-object

Omit `type:` **and** give a mapping default — if the type is inferred rather than required, this is where it shows.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
