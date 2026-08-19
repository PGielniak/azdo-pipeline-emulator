# oracle probe — elseif-not-evaluated

A taken `if` followed by an `elseif` whose condition would raise `Key not found`. Rejection means chain conditions are evaluated eagerly; expansion means later branches are not evaluated once one has won.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
