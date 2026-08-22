# oracle probe — type-root-schema-only

The five type names the vendored schema allows **only** at the pipeline root — `environment`, `filePath`, `pool`, `secureFile`, `serviceConnection` — none of which appears on any documentation page (C-E03-302).

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
