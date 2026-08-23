# oracle probe — number-typed-raw

The same parameter given a raw JSON number rather than a string. If this is accepted the field is not `Record<string, string>` and the client type is too narrow.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"count":42}`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this script: every probe here is asking, not asserting.
