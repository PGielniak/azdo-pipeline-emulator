# oracle probe — abs-from-template

An absolute path inside a nested template is still repository-absolute, not relative to the template — the two would differ here.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
