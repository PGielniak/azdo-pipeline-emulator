# oracle probe — block-scalar-expression

A block scalar carrying an expression. C-E02-109 measured the *error* shape here (one `format` whose literal keeps real newlines); this measures the value, and whether the trailing newline of the block survives the round trip.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
