# oracle probe — type-root-documented

All 12 types the yaml-schema page lists as the `enum` members, declared at the pipeline root in one document (C-E03-301). A single unknown name rejects the whole document, so one expansion accepts all twelve.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
