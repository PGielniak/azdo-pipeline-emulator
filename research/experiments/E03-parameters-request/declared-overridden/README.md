# oracle probe — declared-overridden

The root declares `greeting` with a default and the request supplies a value. Does the request win over the declared default? This is the whole premise of threading the field.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"greeting":"from-request"}`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this script: every probe here is asking, not asserting.
