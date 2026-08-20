# oracle probe — diamond-not-cycle

The same file included twice from one parent is a diamond, not a cycle, and must expand twice — the control that stops cycle detection from being "seen this path before".

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
