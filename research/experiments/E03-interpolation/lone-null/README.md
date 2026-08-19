# oracle probe — lone-null

A lone expression returning **Null** (a `variables` miss, which null-propagates per C-E02-08x). Does the key survive with an empty value, or vanish, or reject?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
