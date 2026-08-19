# oracle probe — two-inserts-collision

Two `${{ insert }}` keys whose payloads collide with each other — the collision question with no literal key involved at all.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
