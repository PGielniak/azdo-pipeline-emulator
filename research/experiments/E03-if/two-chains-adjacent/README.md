# oracle probe — two-chains-adjacent

Two complete chains in a row: the second `if` must start a new chain, so its `else` binds to it.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
