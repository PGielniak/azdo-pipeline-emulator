# oracle probe — pass-number-to-string

The task's first named coercion: pass the number `42` to a `string` parameter. `convertToJson` shows whether it arrived as `42` or `"42"`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
