# oracle probe — key-mixed-object

The two key-position failure modes side by side: `key-object` is a **lone** object key and rejects `Expected a scalar value`. If a key goes through the same `format` synthesis as a value, an object in **mixed** key content should instead give the conversion sentence — which would mean key position has two different rejections, not one.

- Endpoint: `POST {org}/{project}/_apis/pipelines/{pipelineId}/preview?api-version=7.1`
- Outcome: **HTTP 400 · rejected · typeKey=PipelineValidationException**
- Outcome was **not** predicted by this script.
