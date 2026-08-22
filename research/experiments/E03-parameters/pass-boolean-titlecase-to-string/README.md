# oracle probe — pass-boolean-titlecase-to-string

YAML `True` bound to a `string` parameter. Source text predicts `"True"`; a value-based conversion predicts `"true"` (C-E03-321 measured `true` → `"true"`).

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
