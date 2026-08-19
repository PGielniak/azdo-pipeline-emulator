# oracle probe — value-position

The directive in **value** position. C-E03-112 says a directive keyword in a value is not a directive at all, so this should be an ordinary expression parse of the text `insert`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
