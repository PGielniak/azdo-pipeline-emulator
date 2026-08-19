# oracle probe — key-null

A **Null** in key position. `Null → ''` would produce an empty key, which YAML permits and the pipeline schema may not.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
