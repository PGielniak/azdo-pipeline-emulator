# oracle probe — pass-null-to-number

An empty value bound to `number` — `pass-null` showed Null becoming `""` for a `string`, and `empty-string-to-number` showed `""` rejected by `number`, so this is where the two meet.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
