# oracle probe — rel-from-root

A bare relative path in the override resolves against the definition file's directory (`/azure-pipelines.yml` → repo root), so `e03-refs/leaf.yml` is `/e03-refs/leaf.yml`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
