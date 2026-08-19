# oracle probe — mixed-object

An **object** in mixed content. There is no documented Object→String conversion, so this is either a rejection or some undocumented rendering; either answer is a rule we must encode.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
