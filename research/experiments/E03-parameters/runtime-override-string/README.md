# oracle probe — runtime-override-string

Runtime parameters "at root bound from CLI/config" are, on the service, the preview body's `templateParameters` dictionary — string-valued by REST contract. Override a `string`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Queue-time `templateParameters`: `{"p":"from-queue"}`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
