# oracle probe — collision-from-each

A key produced by `each` colliding with a literal key. Records whether `'X' is already defined` is a general mapping rule rather than something `insert` owns.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
