# oracle probe — type-root-legacyobject

The vendored schema allows `legacyObject` in a **template** and not at the root — the one name that is supposed to distinguish the two positions (C-E03-302). Root position.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
