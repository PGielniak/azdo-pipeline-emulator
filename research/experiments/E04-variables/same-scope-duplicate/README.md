# oracle probe — same-scope-duplicate

Two entries with the same name in one scope. Does the expansion collapse them to the last one?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this probe: it is asking, not asserting.
