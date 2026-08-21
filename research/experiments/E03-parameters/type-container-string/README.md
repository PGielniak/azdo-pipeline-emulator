# oracle probe — type-container-string

A `container` parameter whose default is a bare string — if the Container type is the resource *alias* rather than an inline definition, this is what it accepts.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
