# oracle probe — default-expression-parameter

`default-expression` proved a default is *evaluated*, contradicting "You can only use literals for parameter default values". So: can one default read another parameter?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
