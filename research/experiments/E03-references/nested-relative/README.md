# oracle probe — nested-relative

A bare name inside a template resolves against that template's own directory (C-E12-012), restated here as this task's own fixture: `/e03-refs/outer.yml` → `/e03-refs/leaf.yml`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
