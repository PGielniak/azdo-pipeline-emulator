# oracle probe — runtime-override-number

Override a `number` parameter with the string `"8"`: does the queue-time value get the same coercion a YAML-passed value gets?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Queue-time `templateParameters`: `{"p":"8"}`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
