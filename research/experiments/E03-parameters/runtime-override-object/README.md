# oracle probe — runtime-override-object

Override an `object` parameter with a JSON string — is it parsed, or does it stay a string?

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Queue-time `templateParameters`: `{"p":"{\"a\": 1}"}`
- Outcome: **HTTP 200 · expanded**
- Outcome was **not** predicted by this script.
