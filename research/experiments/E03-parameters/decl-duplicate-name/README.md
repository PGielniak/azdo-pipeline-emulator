# oracle probe — decl-duplicate-name

Two parameters with the same name; E01-S01-T04 established that the *parser* rejects duplicate mapping keys, but these are sequence items.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
