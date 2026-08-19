# oracle probe — lone-array-flatten

"When you insert an array into an array, you flatten the nested array" — the doc's one structural sentence, tested on a plain string array in `dependsOn`.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 200 · expanded**
