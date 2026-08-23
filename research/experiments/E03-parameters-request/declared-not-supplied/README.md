# oracle probe — declared-not-supplied

Control: the same document with no `templateParameters` must show the default.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `null`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this script: every probe here is asking, not asserting.
