# oracle probe — key-string

The `each` example's own idiom, `${{ pair.key }}: ${{ pair.value }}`, reduced to a single literal string key expression. The baseline for the key cases below.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
