# oracle probe — chain-insert-before

Control for `chain-insert-between`: the same insert placed **before** the chain head instead of inside the chain. If this expands, the break is specifically about a directive sibling between two members, not about an insert being present in the mapping at all.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
