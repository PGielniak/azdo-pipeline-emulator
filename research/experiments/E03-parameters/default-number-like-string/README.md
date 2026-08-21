# oracle probe — default-number-like-string

The docs' one coercion note: `number` "may be restricted to `values:`, otherwise any number-like string is accepted". A quoted `'8'` as the default — does it arrive as 8 or as "8"?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
