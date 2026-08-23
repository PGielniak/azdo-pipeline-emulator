# oracle probe — number-typed

A `number`-typed root parameter given a **string** value — the only thing a `Record<string, string>` field can carry. Does the service coerce it to the declared type?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"count":"42"}`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this script: every probe here is asking, not asserting.
