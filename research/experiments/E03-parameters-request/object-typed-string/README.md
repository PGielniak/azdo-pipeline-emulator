# oracle probe — object-typed-string

The same `object` parameter given the JSON **as a string**. If this binds, a structured `--parameter name=@file.json` value can still be sent — serialized — despite the raw form being refused; if it does not, structured parameters cannot reach the service at all through this field.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- `templateParameters`: `{"config":"{\"key\":\"value\"}"}`
- Outcome: **HTTP 200 · expanded**
- Not predicted by this script: every probe here is asking, not asserting.
