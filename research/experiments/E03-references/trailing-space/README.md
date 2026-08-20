# oracle probe — trailing-space

Is the reference trimmed before resolution? YAML keeps no trailing space on a plain scalar, so this is quoted to make the space survive the parse.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
